import nodemailer from 'nodemailer';
import { buildDocument, missingFields } from './state-machine.js';
import { createAttachments } from './documents.js';

export function mailConfiguration() {
  const host = process.env.SMTP_HOST, user = process.env.SMTP_USER, pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) throw new Error('SMTP not configured');
  const port = Number(process.env.SMTP_PORT || 587);
  if (![465, 587].includes(port)) throw new Error('SMTP must use TLS port 465 or 587');
  return { host, port, secure: port === 465, requireTLS: port === 587, auth: { user, pass }, tls: { minVersion: 'TLSv1.2' }, connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000 };
}
export async function verifyMailConnection() {
  const transport = nodemailer.createTransport(mailConfiguration());
  try { await transport.verify(); return { ok: true, verified: 'smtp_connection', sent: false }; }
  catch { throw new Error('SMTP connection check failed'); }
  finally { transport.close(); }
}
export async function sendDocument(session) {
  if (session.stage !== 'sending') throw new Error('Document is not approved for sending');
  if (missingFields(session).length) throw new Error('Required document fields are missing');
  const email = String(session.email || '').trim();
  if (!/^[^\s@<>\r\n]+@[^\s@<>\r\n]+\.[^\s@<>\r\n]+$/.test(email)) throw new Error('Invalid recipient email');
  const test = process.env.PHONE_PILOT !== '0';
  if (test && email.toLowerCase() !== String(process.env.TEST_EMAIL || '').trim().toLowerCase()) throw new Error('Pilot recipient must match TEST_EMAIL');
  const configuration = mailConfiguration();
  const attachments = await createAttachments(session);
  const transport = nodemailer.createTransport(configuration);
  try {
    const info = await transport.sendMail({ from: process.env.SMTP_FROM || configuration.auth.user, to: email, subject: test ? 'קו עתירה — בדיקת מערכת, לא להגשה' : 'קו עתירה — מסמך לבדיקה', text: 'מצורפים PDF ומסמך Word לבדיקה.\n\n' + buildDocument(session.fields), attachments });
    const accepted = (info.accepted || []).map(value => String(value).toLowerCase());
    if (!accepted.includes(email.toLowerCase()) || (info.rejected || []).length) throw new Error('Recipient not accepted');
    return { ok: true, messageId: info.messageId, status: 'accepted_by_mail_server', inboxVerified: false };
  } catch { throw new Error('Email delivery was not confirmed; check status before retrying'); }
  finally { transport.close(); }
}
