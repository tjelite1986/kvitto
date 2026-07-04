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
  is_pant: boolean;
  source_lines: string[];
}

export interface ParsedReceipt {
  store_name: string | null;
  purchase_date: string | null;
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
            description: 'Discount amount in öre applied to this item (positive number, 0 if none)',
          },
          is_pant: { type: 'boolean', description: 'True if this row is a deposit (PANT) line' },
          source_lines: {
            type: 'array',
            items: { type: 'string' },
            description: 'The OCR text lines this item was read from, verbatim',
          },
        },
        required: [
          'name', 'qty', 'unit', 'unit_price_ore', 'line_total_ore',
          'offer_qty', 'offer_total_ore', 'discount_ore', 'is_pant', 'source_lines',
        ],
        additionalProperties: false,
      },
    },
  },
  required: ['store_name', 'purchase_date', 'total_ore', 'items'],
  additionalProperties: false,
} as const;

// Static instruction block (kept first and stable for prompt caching).
const SYSTEM_PROMPT = `You are a receipt parser for Swedish grocery receipts. You receive a photo of a receipt and the raw OCR text extracted from it. Extract the store, purchase date, grand total and every purchased item.

Swedish receipt conventions:
- Prices use decimal comma: "22,50" means 22.50 SEK = 2250 öre. All monetary output must be integer öre.
- Multi-buy offers print like "2 för 45,00", "2st*22,50" or "3 f 30:-". Set offer_qty and offer_total_ore on the item they apply to.
- Discount lines ("RABATT", "PRISNEDSATT", negative amounts, lines starting with "*") modify the PRECEDING item: put the amount in that item's discount_ore (positive integer), do not create a separate item.
- "PANT" (bottle/can deposit) is a real cost: create a separate item with is_pant=true. A pant line often follows the beverage it belongs to.
- Weight items print like "0,456 kg x 39,90 kr/kg": qty is the weight (0.456), unit is "kg", unit_price_ore is the per-kg price (3990).
- Quantity lines like "2 st x 12,90" mean qty=2, unit_price_ore=1290.
- Do NOT create items for: VAT summaries (MOMS), subtotals, payment lines (KORT, KONTANT, Mastercard), change (VÄXEL), loyalty points, opening hours, addresses, or "Att betala".
- The grand total is usually labelled "TOTALT", "ATT BETALA", "SUMMA" or "Total".
- The OCR text may contain recognition errors; use the image to resolve them. In source_lines, quote the OCR lines VERBATIM as given (even if misrecognized) so they can be located later.
- purchase_date: receipts print dates like "2026-07-01", "26-07-01" or "01.07.26"; output YYYY-MM-DD.`;

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

export async function parseReceiptWithClaude(
  imageBase64: string,
  ocrText: string,
  storeContext: StoreContext | null
): Promise<{ parsed: ParsedReceipt; raw: string }> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY is not configured');
  }
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
