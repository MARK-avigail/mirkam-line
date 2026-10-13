import { randomUUID } from 'crypto';
import { SCHEMA } from './schema.js';
import { COURTS } from './courts.js';

export function newSession(channel = 'phone') {
  return {
    id: randomUUID(),
    channel: channel,
    stage: 'menu',
    path: 'petition_district',
    index: 0,
    pending: '',
    fields: {},
    email: '',
    document: '',
    editing: false,
    approvedAt: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    log: []
  };
}

const TERMINAL = new Set(['sending','submitted','delivery_unknown','unknown','delivery_error','done']);
function mutable(s) { if (TERMINAL.has(s.stage)) throw new Error('delivery state cannot be changed'); }
function invalidate(s) {
  mutable(s); s.approvedAt = null;
  for (const key of ['phoneReview','phoneEmailAwaitingConfirmation','phoneOfferedFingerprint','phoneEmailConfirmed','phoneApprovalAt','phoneApprovedFingerprint']) delete s[key];
  if(s.stage==='approved') s.stage='review';
}
function log(s, event, detail) {
  s.log.push({ at: Date.now(), event: event, detail: detail || {} });
  s.updatedAt = Date.now();
}

function currentField(s) {
  return SCHEMA[s.index] || null;
}

export function pickMenu(s, digit) {
  if (s.stage !== 'menu') throw new Error('not in menu');
  if (digit !== '2') throw new Error('unsupported document path');
  const chosen = 'petition_district';
  invalidate(s);
  s.path = chosen;
  s.stage = 'court';
  log(s, 'menu_selected', { digit: digit, path: chosen });
  return s;
}

export function pickCourt(s, code) {
  if (s.stage !== 'court') throw new Error('not in court');
  const court = COURTS.find(function(c) { return c.code === code; });
  if (!court || court.group !== 'מחוזי' || s.path !== 'petition_district') throw new Error('invalid district court');
  invalidate(s);
  s.pending = '';
  s.fields.court = court.label;
  s.index = s.editing ? 0 : 1;
  s.stage = s.editing ? 'review' : 'field';
  if (s.editing) { s.editing = false; s.document = buildDocument(s.fields); }
  log(s, 'court_selected', { code: code, label: court.label });
  return s;
}

export function submitAnswer(s, text, source) {
  if (s.stage !== 'field') throw new Error('not in field');
  const f = currentField(s);
  if (!f) throw new Error('no current field');
  const cleaned = cleanText(text, f);
  validate(cleaned, f);
  invalidate(s);
  s.pending = cleaned;
  s.stage = 'field_review';
  log(s, 'answer_submitted', { key: f.key, source: source || 'voice', length: cleaned.length });
  return s;
}

export function confirmAnswer(s) {
  if (s.stage !== 'field_review') throw new Error('not in review');
  const f = currentField(s);
  if (!f) throw new Error('no current field');
  validate(s.pending, f);
  invalidate(s);
  s.fields[f.key] = s.pending;
  s.pending = '';
  if (s.editing) {
    s.editing = false;
    s.stage = 'review';
    s.document = buildDocument(s.fields);
    log(s, 'edit_finished', { key: f.key });
    return s;
  }
  s.index++;
  if (s.index >= SCHEMA.length) {
    s.stage = 'review';
    s.document = buildDocument(s.fields);
    log(s, 'document_ready');
  } else {
    s.stage = 'field';
    log(s, 'field_advanced', { next: SCHEMA[s.index].key });
  }
  return s;
}

export function rejectAnswer(s) {
  if (s.stage !== 'field_review') throw new Error('not in review');
  invalidate(s);
  s.pending = '';
  s.stage = 'field';
  log(s, 'answer_rejected');
  return s;
}

export function skipField(s) {
  if (s.stage !== 'field') throw new Error('not in field');
  const f = currentField(s);
  if (!f) throw new Error('no current field');
  if (f.required) throw new Error('required');
  invalidate(s);
  s.pending = '';
  s.fields[f.key] = '';
  if (s.editing) {
    s.editing = false; s.stage = 'review'; s.document = buildDocument(s.fields);
    log(s, 'edit_finished', { key: f.key });
    return s;
  }
  s.index++;
  if (s.index >= SCHEMA.length) {
    s.stage = 'review';
    s.document = buildDocument(s.fields);
  } else {
    s.stage = 'field';
  }
  log(s, 'field_skipped', { key: f.key });
  return s;
}

export function goBack(s) {
  if (!['field','field_review','court'].includes(s.stage)) throw new Error('cannot go back here');
  invalidate(s); s.pending = '';
  if (s.editing) { s.editing=false; s.stage='review'; s.document=buildDocument(s.fields); log(s,'edit_cancelled'); return s; }
  if(s.stage==='court') { s.stage='menu'; log(s,'back_to_menu'); return s; }
  if (s.index <= 1) {
    s.index = 0;
    s.stage = 'court';
    log(s, 'back_to_court');
    return s;
  }
  s.index--;
  s.stage = 'field';
  log(s, 'back', { index: s.index });
  return s;
}

export function editField(s, index) {
  if (s.stage !== 'review') throw new Error('not in review');
  if (!Number.isInteger(index) || index < 0 || index >= SCHEMA.length) throw new Error('bad index');
  invalidate(s);
  s.editing = true;
  s.pending = '';
  s.index = index;
  s.stage = index === 0 ? 'court' : 'field';
  log(s, 'edit_started', { index: index });
  return s;
}

export function setEmail(s, email) {
  mutable(s);
  const normalized = String(email || '').trim().toLowerCase();
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(normalized)) throw new Error('invalid email');
  invalidate(s);
  s.email = normalized;
  log(s, 'email_set');
  return s;
}

function validateDocument(s) {
  if (s.path !== 'petition_district' || !COURTS.some(c=>c.group==='מחוזי' && c.label===s.fields.court)) throw new Error('invalid district court');
  const missing=missingFields(s); if(missing.length) throw new Error('missing: '+missing.join(', '));
  let total=0;
  for(const f of SCHEMA) { const value=s.fields[f.key] || ''; validate(value,f); total+=value.length; }
  if(total>20000) throw new Error('document too long');
}
export function finalize(s) {
  if(s.stage!=='review') throw new Error('not in review');
  validateDocument(s); s.document=buildDocument(s.fields); s.stage='approved'; s.approvedAt=Date.now(); log(s,'approved'); return s;
}
export function beginDelivery(s) {
  if(s.stage!=='approved' || !Number.isFinite(s.approvedAt)) throw new Error('explicit approval required');
  if(!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(s.email || '')) throw new Error('invalid email');
  validateDocument(s); s.document=buildDocument(s.fields); s.stage='sending'; log(s,'delivery_started'); return s;
}

export function snapshot(s) {
  const doc = buildDocument(s.fields);
  return Object.assign({}, s, {
    document: doc,
    schema: SCHEMA,
    courts: COURTS,
    current: currentField(s),
    missing: missingFields(s)
  });
}

function cleanText(text, field) {
  if(typeof text !== 'string') throw new Error('answer must be text');
  const s = text.replace(/\r/g, '').trim();
  if (field.type !== 'long') return s.replace(/\s+/g, ' ');
  return s.replace(/\r/g, '');
}

function validate(text, field) {
  if(typeof text !== 'string') throw new Error('answer must be text');
  if (field.required && !text) throw new Error('empty required field');
  const limit = field.type === 'long' ? 5000 : 300;
  if (text.length > limit) throw new Error('too long');
  if(field.type==='date' && text) {
    let y,m,d; let match=text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if(match) [,y,m,d]=match.map(Number); else { match=text.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/); if(match) [,d,m,y]=match.map(Number); }
    const date=new Date(Date.UTC(y,m-1,d));
    if(!match || y<1900 || y>2100 || date.getUTCFullYear()!==y || date.getUTCMonth()!==m-1 || date.getUTCDate()!==d) throw new Error('invalid calendar date');
  }
  if (field.type === 'digits' && text && !/^\d+$/.test(text)) throw new Error('not digits');
  if (field.length && text && text.length !== field.length) throw new Error('wrong length');
}

export function missingFields(s) {
  return SCHEMA.filter(function(f) {
    return f.required && !((s.fields[f.key] || '').trim());
  }).map(function(f) { return f.label; });
}

export function buildDocument(fields) {
  const v = function(k) { return String(fields[k] || '').trim() || '[להשלמה]'; };
  const lines = [];
  lines.push(v('court'));
  lines.push('מספר תיק: ' + (fields.case_number || '________________'));
  lines.push('');
  lines.push('העותר: ' + v('name'));
  lines.push('מספר זהות: ' + v('identity'));
  if (fields.prisoner_number) lines.push('מספר אסיר: ' + fields.prisoner_number);
  lines.push('בית הסוהר: ' + v('prison'));
  lines.push('');
  lines.push('נגד');
  lines.push('');
  lines.push('המשיב/ים:');
  lines.push(v('respondents'));
  lines.push('');
  lines.push('עתירה');
  lines.push('נושא: ' + v('subject'));
  lines.push('');
  const sections = [
    ['ההחלטה, המעשה או המחדל', 'decision'],
    ['העובדות', 'facts'],
    ['פניות קודמות ומענה', 'prior_requests'],
    ['נימוקים', 'grounds'],
    ['הסעד המבוקש', 'relief'],
    ['דחיפות ובקשה זמנית', 'urgency'],
    ['רשימת נספחים', 'annexes']
  ];
  let n = 0;
  for (let i = 0; i < sections.length; i++) {
    const label = sections[i][0];
    const key = sections[i][1];
    if (!fields[key] && ['prior_requests', 'urgency', 'annexes'].indexOf(key) !== -1) continue;
    n++;
    lines.push(n + '. ' + label);
    lines.push(v(key));
    if (key === 'decision' && fields.decision_date) {
      lines.push('מועד ההחלטה או האירוע: ' + fields.decision_date);
    }
    lines.push('');
  }
  lines.push('תאריך: ' + v('date'));
  lines.push('שם העותר: ' + v('name'));
  lines.push('חתימת העותר: ____________________');
  return lines.join('\n');
}
