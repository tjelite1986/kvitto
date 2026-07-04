import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';

const execFileAsync = promisify(execFile);

export interface OcrWord {
  t: string; // text
  x: number;
  y: number;
  w: number;
  h: number;
  conf: number;
}

export interface OcrLine {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
  words: number[]; // indexes into the words array
}

export interface OcrResult {
  words: OcrWord[];
  lines: OcrLine[];
  text: string;
}

// PSM 4 = "single column of text of variable sizes" — fits receipt layouts.
const TESSERACT_PSM = '4';
const TESSERACT_TIMEOUT_MS = 60_000;

// In dev on the Pi the system tessdata lacks Swedish; a project-local
// .tessdata dir (with swe+eng traineddata) takes precedence when present.
// In Docker the apk packages provide swe+eng and this dir does not exist.
function tessdataDirArgs(): string[] {
  const localDir = path.join(process.cwd(), '.tessdata');
  if (fs.existsSync(path.join(localDir, 'swe.traineddata'))) {
    return ['--tessdata-dir', localDir];
  }
  return [];
}

/** Run tesseract on an image and return parsed words grouped into lines. */
export async function runOcr(imagePath: string): Promise<OcrResult> {
  const { stdout } = await execFileAsync(
    'tesseract',
    [imagePath, 'stdout', ...tessdataDirArgs(), '-l', 'swe+eng', '--psm', TESSERACT_PSM, 'tsv'],
    { timeout: TESSERACT_TIMEOUT_MS, maxBuffer: 20 * 1024 * 1024 }
  );
  return parseTsv(stdout);
}

/**
 * Parse tesseract TSV output. Level-5 rows are words with pixel coordinates;
 * words sharing (block, par, line) numbers are grouped into lines.
 */
export function parseTsv(tsv: string): OcrResult {
  const words: OcrWord[] = [];
  const lineMap = new Map<string, OcrLine>();
  const lineOrder: string[] = [];

  const rows = tsv.split('\n');
  for (let i = 1; i < rows.length; i++) {
    const cols = rows[i].split('\t');
    if (cols.length < 12) continue;
    const level = Number(cols[0]);
    if (level !== 5) continue;

    const text = cols[11].trim();
    if (!text) continue;

    const word: OcrWord = {
      t: text,
      x: Number(cols[6]),
      y: Number(cols[7]),
      w: Number(cols[8]),
      h: Number(cols[9]),
      conf: Number(cols[10]),
    };
    const wordIndex = words.length;
    words.push(word);

    const lineKey = `${cols[2]}:${cols[3]}:${cols[4]}`; // block:par:line
    let line = lineMap.get(lineKey);
    if (!line) {
      line = { text: '', x: word.x, y: word.y, w: word.w, h: word.h, words: [] };
      lineMap.set(lineKey, line);
      lineOrder.push(lineKey);
    }
    line.text = line.text ? `${line.text} ${text}` : text;
    line.words.push(wordIndex);
    const right = Math.max(line.x + line.w, word.x + word.w);
    const bottom = Math.max(line.y + line.h, word.y + word.h);
    line.x = Math.min(line.x, word.x);
    line.y = Math.min(line.y, word.y);
    line.w = right - line.x;
    line.h = bottom - line.y;
  }

  const lines = lineOrder.map((key) => lineMap.get(key)!);
  const text = lines.map((l) => l.text).join('\n');
  return { words, lines, text };
}
