import { describe, it, expect } from 'vitest';
import { renderPdf, renderDocx } from '../src/documents.js';
import { spawnSync } from 'node:child_process';

describe('real document generation', () => {
  it('creates Hebrew A4 PDF with embedded font and multipage content', async () => {
    const pdf = await renderPdf('בית המשפט המחוזי בבאר שבע\nעתירה\nנושא: בדיקה\n' + '1. העובדות\nאירוע ביום 12/10/2026, מספר 123456789\n'.repeat(90));
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.toString('latin1')).toContain('/FontFile2');
    expect(pdf.toString('latin1')).toContain('/Count');
    expect(pdf.toString('latin1')).toMatch(/MediaBox\s*\[\s*0\s+0\s+595/);
  });
  it('creates a valid ZIP DOCX with Hebrew RTL and safely escaped user text', () => {
    const docx = renderDocx('עתירה\nשם: אבי & דנה <בדיקה>');
    const result = spawnSync(process.env.PYTHON_BIN || 'python3', ['-c', 'import sys,io,zipfile,xml.etree.ElementTree as E; z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())); assert z.testzip() is None; s=z.read("word/document.xml"); E.fromstring(s); sys.stdout.buffer.write(s)'], { input: docx });
    expect(result.status).toBe(0); const xml = result.stdout.toString();
    expect(xml).toContain('<w:bidi/>'); expect(xml).toContain('&amp;'); expect(xml).toContain('&lt;בדיקה&gt;'); expect(xml).toContain('בדיקת מערכת — לא להגשה');
  });
  it('rejects documents exceeding the bounded renderer input', () => { expect(() => renderPdf('a'.repeat(30001))).toThrow(); expect(() => renderDocx('a'.repeat(30001))).toThrow(); });
});
