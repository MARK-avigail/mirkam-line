import { createHash } from 'node:crypto';
import { buildDocument, finalize } from '../state-machine.js';
import { requireCompletedReview } from './document-review.js';

export function validRecipient(email) {
  return typeof email === 'string' && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email);
}
function fingerprint(session) {
  return createHash('sha256').update(JSON.stringify([buildDocument(session.fields), session.email])).digest('hex');
}
export function identityAnswer(digits) {
  return typeof digits === 'string' && /^\d{9}$/.test(digits) ? digits : null;
}
export function offerPhoneApproval(session) {
  if (!['review', 'approved'].includes(session.stage)) throw new Error('המסמך אינו בשלב אישור.');
  if (!validRecipient(session.email)) throw new Error('לא הוגדרה כתובת מייל תקינה. המסמך נשמר והשליחה נחסמה.');
  requireCompletedReview(session);
  // A new readback replaces any previous approval, including after a configuration error.
  session.stage = 'review';
  session.approvedAt = null;
  delete session.phoneEmailConfirmed;
  delete session.phoneApprovalAt;
  delete session.phoneApprovedFingerprint;
  session.phoneEmailAwaitingConfirmation = session.email;
  session.phoneOfferedFingerprint = fingerprint(session);
}
export function approvePhoneDelivery(session, digit) {
  if (digit !== '1' || session.stage !== 'review') throw new Error('נדרשת הקשה מפורשת על 1 לאישור.');
  if (!validRecipient(session.email) || session.phoneEmailAwaitingConfirmation !== session.email || session.phoneOfferedFingerprint !== fingerprint(session)) {
    throw new Error('המסמך והכתובת חייבים להישמע ולקבל אישור מחדש לפני שליחה.');
  }
  finalize(session);
  session.phoneEmailConfirmed = session.email;
  session.phoneApprovalAt = session.approvedAt;
  session.phoneApprovedFingerprint = fingerprint(session);
  delete session.phoneEmailAwaitingConfirmation;
  delete session.phoneOfferedFingerprint;
}
export function requirePhoneDeliveryApproval(session) {
  if (session.channel !== 'phone') return;
  if (!validRecipient(session.email) || session.phoneEmailConfirmed !== session.email || session.phoneApprovalAt !== session.approvedAt || session.phoneApprovedFingerprint !== fingerprint(session)) {
    throw new Error('נדרש אישור מפורש למסמך ולכתובת המייל בשיחה.');
  }
}
