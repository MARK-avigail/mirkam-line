import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildDocument } from './state-machine.js';

const renderer = fileURLToPath(new URL('../scripts/render_document.py', import.meta.url));
export function renderPdf(document, { test = true } = {}) {
  if (typeof document !== 'string' || document.length > 30000) throw new Error('Invalid document size');
  return new Promise((resolve, reject) => {
    const child = spawn(process.env.PYTHON_BIN || 'python3', [renderer], { stdio: ['pipe', 'pipe', 'pipe'] });
    const chunks = []; let length = 0; let settled = false;
    const timer = setTimeout(() => { child.kill(); finish(new Error('PDF rendering timed out')); }, 20000);
    function finish(error, result) { if (settled) return; settled = true; clearTimeout(timer); error ? reject(error) : resolve(result); }
    child.on('error', () => finish(new Error('PDF renderer unavailable; check Python setup')));
    child.stdout.on('data', chunk => { length += chunk.length; if (length > 5 * 1024 * 1024) { child.kill(); finish(new Error('PDF too large')); } else chunks.push(chunk); });
    child.stderr.resume();
    child.stdin.on('error', () => {});
    child.on('close', code => { const result = Buffer.concat(chunks); if (code !== 0 || !result.subarray(0, 5).equals(Buffer.from('%PDF-'))) finish(new Error('PDF rendering failed; check dependencies and Hebrew font')); else finish(null, result); });
    child.stdin.end(JSON.stringify({ document, test }));
  });
}
function escapeXml(text) { return String(text).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ''); }
function crc32(bytes) { let crc = 0xffffffff; for (const byte of bytes) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); } return (crc ^ 0xffffffff) >>> 0; }
function zip(files) {
  const parts = [], entries = []; let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const n = Buffer.from(name), data = Buffer.from(content), crc = crc32(data), h = Buffer.alloc(30 + n.length);
    h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x800, 6); h.writeUInt32LE(crc, 14); h.writeUInt32LE(data.length, 18); h.writeUInt32LE(data.length, 22); h.writeUInt16LE(n.length, 26); n.copy(h, 30);
    parts.push(h, data); entries.push({ n, data, crc, offset }); offset += h.length + data.length;
  }
  const start = offset;
  for (const e of entries) { const h = Buffer.alloc(46 + e.n.length); h.writeUInt32LE(0x02014b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(20, 6); h.writeUInt16LE(0x800, 8); h.writeUInt32LE(e.crc, 16); h.writeUInt32LE(e.data.length, 20); h.writeUInt32LE(e.data.length, 24); h.writeUInt16LE(e.n.length, 28); h.writeUInt32LE(e.offset, 42); e.n.copy(h, 46); parts.push(h); offset += h.length; }
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(offset - start, 12); end.writeUInt32LE(start, 16); parts.push(end); return Buffer.concat(parts);
}
export function renderDocx(document, { test = true } = {}) {
  if (typeof document !== 'string' || document.length > 30000) throw new Error('Invalid document size');
  const lines = test ? ['בדיקת מערכת — לא להגשה', '', ...document.split('\n')] : document.split('\n');
  const paragraphs = lines.map(line => {
    const heading = line === 'עתירה' || /^\d+\. /.test(line) || /^(ב?בית המשפט|בית משפט|נושא:)/.test(line);
    return `<w:p><w:pPr><w:bidi/><w:jc w:val="${['עתירה', 'נגד'].includes(line) ? 'center' : 'right'}"/><w:spacing w:after="120"/>${heading ? '<w:keepNext/>' : ''}</w:pPr><w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/><w:rtl/><w:sz w:val="${line === 'עתירה' ? 32 : 24}"/><w:szCs w:val="${line === 'עתירה' ? 32 : 24}"/>${heading ? '<w:b/><w:bCs/>' : ''}</w:rPr><w:t xml:space="preserve">${escapeXml(line)}</w:t></w:r></w:p>`;
  }).join('');
  return zip({
    '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    '_rels/.rels': '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    'word/document.xml': `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr></w:body></w:document>`
  });
}
export async function createAttachments(session) {
  const document = buildDocument(session.fields);
  const test = process.env.PHONE_PILOT !== '0';
  return [
    { filename: 'petition.pdf', content: await renderPdf(document, { test }), contentType: 'application/pdf' },
    { filename: 'petition.docx', content: renderDocx(document, { test }), contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }
  ];
}
