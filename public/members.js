'use strict';
const $ = id => document.getElementById(id);
let token = '', account = null, draft = null, busy = false;
async function api(route, method = 'GET', body, admin = false, binary = false) {
  const headers = { Authorization: 'Bearer ' + (admin ? $('admin-token').value : token) };
  if (body) headers['Content-Type'] = 'application/json';
  const response = await fetch((admin ? '/api' : '/member') + route, { method, headers, body: body ? JSON.stringify(body) : undefined });
  if (binary && response.ok) return response.blob();
  const data = await response.json();
  if (!response.ok || data.ok === false) throw new Error(data.error || 'הפעולה לא הושלמה.');
  return data;
}
async function run(fn) {
  if (busy) return; busy = true; $('notice').textContent = '';
  document.querySelectorAll('button').forEach(b => b.disabled = true);
  try { await fn(); } catch (e) { $('notice').textContent = e.message; }
  finally { busy = false; document.querySelectorAll('button').forEach(b => b.disabled = false); }
}
function render(s) {
  draft = s; $('draft-panel').hidden = false;
  const field = s.schema[s.index];
  $('question').textContent = s.stage === 'menu' ? 'איזה מסמך תרצו להכין?' : s.stage === 'court' ? 'בחרו בית משפט מחוזי' : s.stage === 'field' ? field.label : s.stage === 'field_review' ? 'אישור התשובה' : 'בדיקת המסמך';
  $('court-choices').replaceChildren();
  if (s.stage === 'menu') {
    const b = document.createElement('button'); b.textContent = 'עתירה לבית המשפט המחוזי';
    b.onclick = () => run(() => act('pickMenu', { digit: '2' })); $('court-choices').append(b);
  }
  if (s.stage === 'court') for (const court of s.courts.filter(c => c.group === 'מחוזי')) {
    const b = document.createElement('button'); b.textContent = court.label; b.onclick = () => run(() => act('pickCourt', { code: court.code })); $('court-choices').append(b);
  }
  $('answer-panel').hidden = s.stage !== 'field';
  $('confirm-panel').hidden = s.stage !== 'field_review';
  $('review-panel').hidden = s.stage !== 'review';
  $('skip-answer').hidden = !!field?.required;
  $('answer').value = s.fields[field?.key] || '';
  $('pending').textContent = s.pending;
  $('document').textContent = s.document;
  $('edit-field').replaceChildren();
  s.schema.forEach((f, i) => { const o = document.createElement('option'); o.value = i; o.textContent = f.label; $('edit-field').append(o); });
}
async function act(action, data = {}) { render((await api('/drafts/' + draft.id + '/action', 'POST', { action, data })).session); }
async function drafts() {
  const data = await api('/drafts'); $('draft-list').replaceChildren();
  for (const d of data.drafts) { const b = document.createElement('button'); b.textContent = d.subject + ' — ' + new Date(d.updatedAt).toLocaleString('he-IL'); b.onclick = () => run(async () => render((await api('/drafts/' + d.id)).session)); $('draft-list').append(b); }
  if (!data.drafts.length) $('draft-list').textContent = 'עדיין אין טיוטות בחשבון.';
}
$('login-form').onsubmit = e => { e.preventDefault(); run(async () => { const data = await api('/login', 'POST', { code: $('code').value, pin: $('pin').value }); token = data.token; account = data.account; $('pin').value = ''; $('login-panel').hidden = true; $('account-panel').hidden = false; $('welcome').textContent = 'שלום ' + account.name; await drafts(); }); };
$('logout').onclick = () => run(async () => { try { await api('/logout', 'POST'); } finally { token = ''; account = draft = null; $('account-panel').hidden = $('draft-panel').hidden = true; $('draft-list').replaceChildren(); $('document').textContent = $('answer').value = $('pending').textContent = ''; $('login-panel').hidden = false; } });
$('new-draft').onclick = () => run(async () => render((await api('/drafts', 'POST', {})).session));
$('refresh-drafts').onclick = () => run(drafts);
$('submit-answer').onclick = () => run(() => act('submitAnswer', { text: $('answer').value }));
for (const [id, action] of [['confirm-answer','confirmAnswer'],['retry-answer','rejectAnswer'],['skip-answer','skipField'],['back-answer','goBack']]) $(id).onclick = () => run(() => act(action));
$('edit-answer').onclick = () => run(() => act('editField', { index: Number($('edit-field').value) }));
for (const ext of ['pdf', 'docx']) $(ext).onclick = () => run(async () => { const blob = await api('/drafts/' + draft.id + '/' + ext, 'GET', null, false, true); const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = 'draft.' + ext; a.click(); setTimeout(() => URL.revokeObjectURL(url), 10000); });
$('enroll-form').onsubmit = e => { e.preventDefault(); run(async () => { const data = await api('/accounts', 'POST', { name: $('name').value, identity: $('identity').value, prisonerNumber: $('prisoner-number').value, prison: $('prison').value, wing: $('wing').value, verifiedBy: $('verified-by').value }, true); $('credentials').textContent = 'קוד משתמש: ' + data.account.code + ' · קוד אישי: ' + data.pin + '. הקוד האישי מוצג כעת בלבד. העבירו אותו למשתמש בצורה פרטית.'; }); };
