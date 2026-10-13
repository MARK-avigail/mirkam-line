import express from 'express';
import { authenticate, accountForToken, revokeToken } from './accounts.js';
import { saveSession, listSessions } from './storage.js';
import { ownedDraft } from './owned-drafts.js';
import * as sm from './state-machine.js';
import { renderPdf, renderDocx } from './documents.js';

const router = express.Router();
const token = req => (req.get('authorization') || '').replace(/^Bearer /, '');
const wrap = fn => (req, res) => { try { fn(req, res); } catch (e) { res.status(400).json({ ok: false, error: e.message }); } };
router.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  const origin = req.get('origin');
  try { if (origin && new URL(origin).host !== req.get('host')) return res.sendStatus(403); }
  catch { return res.sendStatus(403); }
  next();
});
router.post('/login', wrap((req, res) => res.json({ ok: true, ...authenticate(req.body?.code, req.body?.pin, req.socket.remoteAddress || 'unknown') })));
router.use((req, res, next) => {
  try { req.account = accountForToken(token(req)); next(); }
  catch (e) { res.status(401).json({ ok: false, error: e.message }); }
});
router.post('/logout', wrap((req, res) => { revokeToken(token(req)); res.json({ ok: true }); }));
router.get('/me', (req, res) => res.json({ ok: true, account: req.account }));
router.get('/drafts', (req, res) => res.json({ ok: true, drafts: listSessions().filter(s => s.ownerId === req.account.id).map(s => ({ id: s.id, stage: s.stage, subject: s.fields.subject || 'טיוטה חדשה', updatedAt: s.updatedAt })) }));
router.post('/drafts', wrap((req, res) => {
  const s = sm.newSession('member'); s.ownerId = req.account.id;
  sm.pickMenu(s, '2');
  saveSession(s); res.json({ ok: true, session: sm.snapshot(s) });
}));
function own(req) {
  return ownedDraft(req.params.id, req.account.id);
}
router.get('/drafts/:id', wrap((req, res) => res.json({ ok: true, session: sm.snapshot(own(req)) })));
for (const ext of ['pdf', 'docx']) router.get('/drafts/:id/' + ext, async (req, res) => {
  try {
    const s = own(req), document = sm.buildDocument(s.fields);
    const bytes = ext === 'pdf' ? await renderPdf(document, { test: true }) : renderDocx(document, { test: true });
    res.set({ 'Content-Type': ext === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'Content-Disposition': `attachment; filename="draft.${ext}"` }).send(bytes);
  } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});
const actions = { pickMenu: (s, d) => sm.pickMenu(s, d.digit), pickCourt: (s, d) => sm.pickCourt(s, d.code), submitAnswer: (s, d) => sm.submitAnswer(s, d.text, 'typed'), confirmAnswer: sm.confirmAnswer, rejectAnswer: sm.rejectAnswer, skipField: sm.skipField, goBack: sm.goBack, editField: (s, d) => sm.editField(s, d.index) };
router.post('/drafts/:id/action', wrap((req, res) => {
  const s = own(req), { action, data = {} } = req.body || {};
  if (!Object.hasOwn(actions, action)) throw new Error('פעולה לא מוכרת.');
  actions[action](s, data); saveSession(s); res.json({ ok: true, session: sm.snapshot(s) });
}));
export default router;
