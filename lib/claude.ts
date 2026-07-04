import Anthropic from '@anthropic-ai/sdk';

// Receipt parsing via Claude vision + OCR text. The image and the tesseract
// output are both sent: the image resolves OCR mistakes, the OCR text anchors
// exact strings so parsed items can be mapped back to word coordinates.

export interface ParsedItem {
  name: string;
  qty: number;
  unit: 'pc' | 'kg';
  unit_price_ore: number | null;
  line_total_ore: number;
  offer_qty: number | null;
  offer_total_ore: number | null;
  discount_ore: number;
  pant_ore: number;
  source_lines: string[];
}

export interface ParsedReceipt {
  store_name: string | null;
  purchase_date: string | null;
  purchase_time: string | null;
  total_ore: number | null;
  items: ParsedItem[];
}

const RECEIPT_SCHEMA = {
  type: 'object',
  properties: {
    store_name: {
      type: ['string', 'null'],
      description: 'Store name as printed at the top of the receipt, null if unreadable',
    },
    purchase_date: {
      type: ['string', 'null'],
      description: 'Purchase date in YYYY-MM-DD format, null if not found',
    },
    purchase_time: {
      type: ['string', 'null'],
      description: 'Purchase time of day in 24h HH:MM format (from the receipt datetime line), null if not found',
    },
    total_ore: {
      type: ['integer', 'null'],
      description: 'Receipt grand total in öre (SEK cents), null if not found',
    },
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Item name exactly as printed' },
          qty: { type: 'number', description: 'Quantity purchased (kg for weight items)' },
          unit: { type: 'string', enum: ['pc', 'kg'] },
          unit_price_ore: {
            type: ['integer', 'null'],
            description: 'Price per unit in öre (per kg for weight items), null if not printed',
          },
          line_total_ore: {
            type: 'integer',
            description: 'Line total in öre before discount',
          },
          offer_qty: {
            type: ['integer', 'null'],
            description: 'Multi-buy quantity, e.g. 2 for "2 för 45,00"',
          },
          offer_total_ore: {
            type: ['integer', 'null'],
            description: 'Multi-buy total in öre, e.g. 4500 for "2 för 45,00"',
          },
          discount_ore: {
            type: 'integer',
            description: 'Plain discount in öre applied to this item (positive, 0 if none). Do NOT use for multi-buy offers — those go in offer_qty/offer_total_ore.',
          },
          pant_ore: {
            type: 'integer',
            description: 'Total deposit (PANT) surcharge in öre for this line, e.g. 4 cans with 1,00 pant each = 400. 0 if none.',
          },
          source_lines: {
            type: 'array',
            items: { type: 'string' },
            description: 'The OCR text lines this item was read from, verbatim (including its PANT and RABATT lines)',
          },
        },
        required: [
          'name', 'qty', 'unit', 'unit_price_ore', 'line_total_ore',
          'offer_qty', 'offer_total_ore', 'discount_ore', 'pant_ore', 'source_lines',
        ],
        additionalProperties: false,
      },
    },
  },
  required: ['store_name', 'purchase_date', 'purchase_time', 'total_ore', 'items'],
  additionalProperties: false,
} as const;

// Static instruction block (kept first and stable for prompt caching).
const SYSTEM_PROMPT = `You are a receipt parser for Swedish grocery receipts. You receive a photo of a receipt and the raw OCR text extracted from it. Extract the store, purchase date, grand total and every purchased item.

Swedish receipt conventions:
- Prices use decimal comma: "22,50" means 22.50 SEK = 2250 öre. All monetary output must be integer öre.
- "PANT" (bottle/can deposit) is NEVER an item of its own. It is a surcharge on the beverage it belongs to (the pant line usually follows the beverage, or is included in its price block). Add the line's total pant to that item's pant_ore: e.g. 4 cans with "PANT 1,00" each, or a "PANT 4,00" line after 4 cans, both mean pant_ore=400 on the beverage item. line_total_ore EXCLUDES pant.
- Multi-buy offers ("2 för 45,00", "4 för 24", "3 f 30:-") set offer_qty and offer_total_ore on the item: offer_total_ore is what the customer actually pays for those units (excluding pant). Receipts often print the shelf price first and then a discount/adjustment line that creates the offer — e.g. "ENERGIDRYCK 4 st x 9,41 = 37,64" followed by "4 FÖR 24,00 -13,64": that is ONE item with qty=4, unit_price_ore=941, line_total_ore=3764, offer_qty=4, offer_total_ore=2400, discount_ore=0. Never put the same rebate in BOTH offer fields and discount_ore.
- Plain discount lines ("RABATT", "PRISNEDSATT", negative amounts) that are NOT an N-för-X offer modify the PRECEDING item: put the amount in that item's discount_ore (positive integer), do not create a separate item.
- Weight items print like "0,456 kg x 39,90 kr/kg": qty is the weight (0.456), unit is "kg", unit_price_ore is the per-kg price (3990).
- Quantity lines like "2 st x 12,90" mean qty=2, unit_price_ore=1290, line_total_ore=2580.
- Do NOT create items for: PANT lines, VAT summaries (MOMS), subtotals, payment lines (KORT, KONTANT, Mastercard), change (VÄXEL), loyalty points, opening hours, addresses, or "Att betala".
- Sanity: sum over items of (offer_total_ore if set, else line_total_ore) - discount_ore + pant_ore should equal the receipt total.
- The grand total is usually labelled "TOTALT", "ATT BETALA", "SUMMA" or "Total".
- The OCR text may contain recognition errors; use the image to resolve them. In source_lines, quote the OCR lines VERBATIM as given (even if misrecognized) so they can be located later.
- purchase_date: receipts print dates like "2026-07-01", "26-07-01" or "01.07.26"; output YYYY-MM-DD. The time usually follows the date ("2026-07-01 17:42"); output it as purchase_time in 24h HH:MM.`;

export interface StoreContext {
  layoutHints: string;
  examples: Array<{ ocr_excerpt: string; model_output: unknown; corrected: unknown }>;
}

function buildUserText(ocrText: string, storeContext: StoreContext | null): string {
  let text = '';
  if (storeContext) {
    if (storeContext.layoutHints.trim()) {
      text += `Layout notes for this store:\n${storeContext.layoutHints.trim()}\n\n`;
    }
    if (storeContext.examples.length > 0) {
      text += 'Corrections from previously confirmed receipts at this store — apply these patterns:\n';
      for (const ex of storeContext.examples) {
        text += `\nOCR excerpt:\n${ex.ocr_excerpt}\nModel output was:\n${JSON.stringify(ex.model_output)}\nCorrect interpretation:\n${JSON.stringify(ex.corrected)}\n`;
      }
      text += '\n';
    }
  }
  text += `OCR text of the receipt:\n\n${ocrText}`;
  return text;
}

/**
 * Parse via OpenRouter's OpenAI-compatible API. Same prompt and schema; the
 * model (default: Claude Haiku via OpenRouter) is billed from OpenRouter
 * credits instead of an Anthropic account.
 */
async function parseViaOpenRouter(
  apiKey: string,
  imageBase64: string,
  ocrText: string,
  storeContext: StoreContext | null
): Promise<{ parsed: ParsedReceipt; raw: string }> {
  const body = {
    model: process.env.OPENROUTER_MODEL ?? 'anthropic/claude-haiku-4.5',
    max_tokens: 8000,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          {
            type: 'image_url',
            image_url: { url: `data:image/jpeg;base64,${imageBase64}` },
          },
          { type: 'text', text: buildUserText(ocrText, storeContext) },
        ],
      },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: { name: 'receipt', strict: true, schema: RECEIPT_SCHEMA },
    },
  };

  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://kvitto.mecloud.win',
      'X-Title': 'Kvitto',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`OpenRouter error ${res.status}: ${errText.slice(0, 300)}`);
  }

  const data = await res.json();
  let content: string = data.choices?.[0]?.message?.content ?? '';
  if (!content) {
    throw new Error(`OpenRouter returned no content: ${JSON.stringify(data).slice(0, 300)}`);
  }
  // Some providers wrap JSON in markdown fences despite response_format
  content = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');

  const parsed = JSON.parse(content) as ParsedReceipt;
  return { parsed, raw: content };
}

async function parseViaAnthropic(
  apiKey: string,
  imageBase64: string,
  ocrText: string,
  storeContext: StoreContext | null
): Promise<{ parsed: ParsedReceipt; raw: string }> {
  const client = new Anthropic({ apiKey });

  const response = await client.messages.create({
    model: process.env.CLAUDE_MODEL ?? 'claude-haiku-4-5',
    max_tokens: 8000,
    system: SYSTEM_PROMPT,
    output_config: {
      format: {
        type: 'json_schema',
        schema: RECEIPT_SCHEMA as unknown as Record<string, unknown>,
      },
    },
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: 'image/jpeg', data: imageBase64 },
          },
          { type: 'text', text: buildUserText(ocrText, storeContext) },
        ],
      },
    ],
  });

  if (response.stop_reason === 'max_tokens') {
    throw new Error('Claude response was truncated (max_tokens reached)');
  }

  const textBlock = response.content.find((b) => b.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('Claude returned no text content');
  }

  const parsed = JSON.parse(textBlock.text) as ParsedReceipt;
  return { parsed, raw: textBlock.text };
}

/**
 * Provider dispatch: OpenRouter when OPENROUTER_API_KEY is set (unless
 * PARSER_PROVIDER=anthropic forces the direct API), else the Anthropic API.
 */
export async function parseReceiptWithClaude(
  imageBase64: string,
  ocrText: string,
  storeContext: StoreContext | null
): Promise<{ parsed: ParsedReceipt; raw: string }> {
  const provider = process.env.PARSER_PROVIDER;
  const openrouterKey = process.env.OPENROUTER_API_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;

  if (openrouterKey && provider !== 'anthropic') {
    return parseViaOpenRouter(openrouterKey, imageBase64, ocrText, storeContext);
  }
  if (anthropicKey) {
    return parseViaAnthropic(anthropicKey, imageBase64, ocrText, storeContext);
  }
  throw new Error('No parser API key configured (OPENROUTER_API_KEY or ANTHROPIC_API_KEY)');
}
