import { test } from 'node:test';
import assert from 'node:assert/strict';
import { presentReviewChunk, confirmReviewChunk, requireCompletedReview } from '../src/ivr/document-review.js';
import { offerPhoneApproval } from '../src/ivr/phone-guards.js';
import * as sm from '../src/state-machine.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function ready() {
  return { ...sm.newSession('phone'), stage: 'review', email: 'test@example.test', fields: { facts: 'עובדות לבדיקה '.repeat(140) } };
}
test('direct final callback cannot offer delivery before the document review', () => {
  const s = ready();
  assert.throws(() => confirmReviewChunk(s, '999', '1'));
  assert.throws(() => offerPhoneApproval(s));
  assert.equal(s.stage, 'review');
});
test('silence and repeat keep the current chunk without approving it', () => {
  const s = ready(); const first = presentReviewChunk(s);
  for (const digit of ['', '3', '9']) assert.equal(confirmReviewChunk(s, '0', digit), false);
  assert.equal(presentReviewChunk(s).text, first.text);
  assert.throws(() => requireCompletedReview(s));
});
test('old duplicate callbacks cannot skip an unpresented chunk', () => {
  const s = ready(); presentReviewChunk(s); confirmReviewChunk(s, '0', '1');
  assert.throws(() => confirmReviewChunk(s, '0', '1'));
  assert.throws(() => confirmReviewChunk(s, '1', '1'));
  assert.equal(s.phoneReview.index, 1);
});
test('malformed and out-of-range chunk numbers are refused', () => {
  const s = ready(); presentReviewChunk(s);
  for (const part of [undefined, '-1', '0.5', '0junk', '00', '999']) assert.throws(() => confirmReviewChunk(s, part, '1'));
  assert.equal(s.phoneReview.index, 0);
});
test('review progress survives actual session storage and reload', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mirkam-review-'));
  process.env.DATA_DIR = dir;
  const storage = await import('../src/storage.js');
  try {
    const s = ready(); presentReviewChunk(s); confirmReviewChunk(s, '0', '1'); storage.saveSession(s);
    const restored = storage.getSession(s.id);
    assert.equal(presentReviewChunk(restored).index, 1);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('changing the document restarts its review and blocks prior completion', () => {
  const s = ready();
  for (;;) { const c = presentReviewChunk(s); if (confirmReviewChunk(s, String(c.index), '1')) break; }
  requireCompletedReview(s);
  s.fields.facts += ' שינוי';
  assert.throws(() => requireCompletedReview(s));
  assert.equal(presentReviewChunk(s).index, 0);
});
test('normal sequential review allows recipient readback but does not itself approve sending', () => {
  const s = ready(); let count = 0;
  for (;;) { const c = presentReviewChunk(s); count++; if (confirmReviewChunk(s, String(c.index), '1')) break; }
  assert.ok(count > 1);
  offerPhoneApproval(s);
  assert.equal(s.stage, 'review');
  assert.equal(s.approvedAt, null);
  assert.equal(s.phoneEmailAwaitingConfirmation, s.email);
});
