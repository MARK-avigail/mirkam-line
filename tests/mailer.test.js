import { describe, it, expect, vi, beforeEach } from 'vitest';
const mocks = vi.hoisted(() => ({ sendMail: vi.fn(), close: vi.fn(), verify: vi.fn(), createTransport: vi.fn(), createAttachments: vi.fn() }));
vi.mock('nodemailer', () => ({ default: { createTransport: mocks.createTransport } }));
vi.mock('../src/documents.js', () => ({ createAttachments: mocks.createAttachments }));
import { sendDocument, mailConfiguration, verifyMailConnection } from '../src/mailer.js';
import { SCHEMA } from '../src/schema.js';
function session() { return { stage: 'sending', email: 'recipient@gmail.com', document: 'STALE', fields: Object.fromEntries(SCHEMA.filter(f => f.required).map(f => [f.key, f.type === 'digits' ? '123456789' : 'חדש'])) }; }
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv('SMTP_HOST', 'smtp.gmail.com'); vi.stubEnv('SMTP_USER', 'sender@gmail.com'); vi.stubEnv('SMTP_PASS', 'test'); vi.stubEnv('SMTP_PORT', '587'); vi.stubEnv('PHONE_PILOT', '1'); vi.stubEnv('TEST_EMAIL', 'recipient@gmail.com');
  mocks.createTransport.mockReturnValue({ sendMail: mocks.sendMail, close: mocks.close, verify: mocks.verify }); mocks.createAttachments.mockResolvedValue([{ filename: 'petition.pdf', content: Buffer.from('%PDF-') }]); mocks.sendMail.mockResolvedValue({ accepted: ['recipient@gmail.com'], rejected: [], messageId: 'test' }); mocks.verify.mockResolvedValue(true);
});
describe('secure approved email delivery', () => {
  it('attaches PDF, uses current fields and reports SMTP acceptance only', async () => { const receipt = await sendDocument(session()); expect(receipt.inboxVerified).toBe(false); const message = mocks.sendMail.mock.calls[0][0]; expect(message.attachments[0].filename).toBe('petition.pdf'); expect(message.text).not.toContain('STALE'); expect(mocks.createTransport.mock.calls[0][0].requireTLS).toBe(true); });
  it('prevents sending before explicit approval', async () => { await expect(sendDocument({ ...session(), stage: 'review' })).rejects.toThrow(); expect(mocks.sendMail).not.toHaveBeenCalled(); });
  it('restricts pilot destination', async () => { await expect(sendDocument({ ...session(), email: 'other@gmail.com' })).rejects.toThrow(); });
  it('requires accepted recipient and does not retry', async () => { mocks.sendMail.mockResolvedValue({ accepted: [], rejected: ['recipient@gmail.com'] }); await expect(sendDocument(session())).rejects.toThrow(); expect(mocks.sendMail).toHaveBeenCalledTimes(1); expect(mocks.close).toHaveBeenCalled(); });
  it('rejects incomplete documents', async () => { await expect(sendDocument({ ...session(), fields: {} })).rejects.toThrow(); });
  it('uses implicit TLS on 465 and rejects plaintext ports', () => { vi.stubEnv('SMTP_PORT', '465'); expect(mailConfiguration().secure).toBe(true); vi.stubEnv('SMTP_PORT', '25'); expect(mailConfiguration).toThrow(); });
  it('verifies connection without sending a message', async () => { expect((await verifyMailConnection()).sent).toBe(false); expect(mocks.sendMail).not.toHaveBeenCalled(); });
});
