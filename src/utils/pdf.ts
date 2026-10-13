import { PDFParse } from 'pdf-parse';

export async function pdfText(buffer: Buffer): Promise<string> {
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    const result = await parser.getText();
    // NFKC so visually identical code points (e.g. U+00B5 micro vs U+03BC mu) compare equal.
    return result.text.normalize('NFKC');
  } finally {
    await parser.destroy();
  }
}

export const isPdf = (buffer: Buffer) => buffer.subarray(0, 5).toString() === '%PDF-';
