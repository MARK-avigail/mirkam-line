import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildHelpContext, normalizeHelp } from '../src/ivr/help-context.js';
import { generateHelp } from '../src/ivr/ai-help.js';

test('medical decision help includes the typed answer and the actual current field', () => {
  const answer = 'הרגשתי מאוד לא טוב ולא פינו אותי לבית החולים';
  const fields = { name: 'שם לבדיקה' };
  const c = buildHelpContext({field:{key:'decision',label:'כותרת אחרת'},answer,fields});
  assert.equal(c.answer, answer); assert.equal(c.field.key, 'decision');
  assert.equal(c.field.required, true); assert.equal(c.fields.name, fields.name);
  assert.match(c.guidance,/אל תבקש מספר תיק/);
});
test('a request for a case number in an unrelated field is replaced without inventing medical facts', () => {
  for (const answer of ['לא פינו אותי', 'פינו אותי בזמן', 'אין תשובה לבקשתי']) {
    const c = buildHelpContext({field:{key:'decision'},answer});
    const r = normalizeHelp({text:'מהו מספר התיק? אנא ספק את המספר המדויק.'},c);
    assert.doesNotMatch(r.text,/מספר התיק|לא פינו|חסימת|אבחנה/);
  }
});
test('case number remains optional in its own field', () => {
  const c = buildHelpContext({field:{key:'case_number'},answer:'אין לי מספר תיק'});
  assert.equal(c.field.required,false); assert.match(c.guidance,/אפשר לדלג/);
  assert.equal(normalizeHelp({text:'אם אין מספר תיק, אפשר לדלג.'},c).text,'אם אין מספר תיק, אפשר לדלג.');
});
test('missing fields and invalid answer types fail before requesting a model', () => {
  assert.throws(()=>buildHelpContext({field:{key:'unknown'}}));
  for (const answer of [{}, 7, 'א'.repeat(5001)]) assert.throws(()=>buildHelpContext({field:{key:'facts'},answer}));
});
test('blank draft does not silently reuse an old pending answer and source fields are unchanged', () => {
  const fields={facts:'עובדות קיימות'};
  assert.equal(buildHelpContext({field:{key:'facts'},answer:'',previousAnswer:'תשובה ישנה',fields}).answer,'');
  assert.deepEqual(fields,{facts:'עובדות קיימות'});
});
test('real help adapter sends scoped draft and rejects off-topic model output with isolated transport', async () => {
  const oldFetch=globalThis.fetch, oldKey=process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY='test-only-not-a-real-key';
  let sent;
  globalThis.fetch=async(_url,options)=>{sent=JSON.parse(options.body);return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({text:'מה מספר התיק במקרה הזה?'})}}]}));};
  try {
    const result=await generateHelp({field:{key:'decision'},answer:'לא פינו אותי לבית חולים'});
    const context=JSON.parse(sent.messages[1].content);
    assert.equal(context.answer,'לא פינו אותי לבית חולים');
    assert.equal(context.field.key,'decision'); assert.match(sent.messages[0].content,/אל תהפוך שדה רשות לחובה/);
    assert.doesNotMatch(result.text,/מספר התיק/);
  } finally {globalThis.fetch=oldFetch;if(oldKey===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=oldKey;}
});
