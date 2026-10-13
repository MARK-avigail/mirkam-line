import { createHash } from 'node:crypto';
import { buildDocument } from '../state-machine.js';

export function chunks(text) {
  return String(text).match(/[\s\S]{1,700}/g) || [''];
}
function current(session) {
  if (!['review', 'approved'].includes(session.stage)) throw new Error('המסמך אינו בשלב הקראה.');
  const document = buildDocument(session.fields);
  const hash = createHash('sha256').update(document).digest('hex');
  const parts = chunks(document);
  if (!session.phoneReview || session.phoneReview.hash !== hash) {
    session.phoneReview = { hash, index: 0, presented: false, complete: false };
  }
  const r = session.phoneReview;
  if (!Number.isInteger(r.index) || r.index < 0 || r.index >= parts.length) {
    session.phoneReview = { hash, index: 0, presented: false, complete: false };
  }
  return { parts, progress: session.phoneReview };
}
// The URL never selects a chunk: progress belongs to the stored document.
export function presentReviewChunk(session) {
  const { parts, progress } = current(session);
  progress.presented = true;
  return { index: progress.index, text: parts[progress.index], last: progress.index === parts.length - 1 };
}
export function confirmReviewChunk(session, part, digit) {
  const { parts, progress } = current(session);
  if (typeof part !== 'string' || !/^(0|[1-9]\d*)$/.test(part) || Number(part) !== progress.index || !progress.presented) {
    throw new Error('נמשיך מהקטע השמור. יש לשמוע את הקטע לפני אישורו.');
  }
  if (digit !== '1') return false;
  if (progress.index === parts.length - 1) {
    progress.complete = true;
    return true;
  }
  progress.index++;
  progress.presented = false;
  return false;
}
export function requireCompletedReview(session) {
  const { progress } = current(session);
  if (!progress.complete) throw new Error('יש להשלים את הקראת המסמך ואישור הקטעים לפני שליחה.');
}
