import { SCHEMA_BY_KEY } from '../schema.js';

const GUIDANCE = {
  case_number: 'אם כבר קיים מספר תיק, אפשר לציינו. זהו שדה רשות; אם אין מספר אפשר לדלג.',
  name: 'בקש רק את שם העותר. אין צורך לתאר את המקרה בשדה זה.',
  identity: 'בקש תשע ספרות של מספר הזהות, כולל אפס בתחילתו. אין לנחש ספרות חסרות.',
  decision: 'מקד את העזרה בהחלטה, במעשה או בהימנעות מפעולה שעליהם מתלוננים. אם תואר אי־פינוי לטיפול רפואי, התייחס לכך ובקש לכל היותר פרט רלוונטי אחד: למשל למי פנו או מה הייתה התגובה. אל תבקש מספר תיק.',
  facts: 'עזור לתאר מה קרה בסדר ברור על בסיס דברי המשתמש. שאל פרט אחד שחסר באמת, בלי לבקש מחדש פרטים שכבר נמסרו.',
  grounds: 'עזור להסביר למה המשתמש סבור שההחלטה פגעה בו, בלי להמציא זכויות, הוראות חוק או פסיקה.',
  relief: 'שאל איזו פעולה או תוצאה מבקשים מבית המשפט. אין להמציא סעד או להבטיח שיתקבל.',
  urgency: 'עזור לתאר את הדחיפות במילים של המשתמש. אין לקבוע אבחנה רפואית או קשר סיבתי.',
  annexes: 'שאל אילו מסמכים קיימים. רשימה אינה הוכחה שהקבצים כבר צורפו.'
};
export function buildHelpContext({ field, fields = {}, previousAnswer, answer }) {
  const spec = SCHEMA_BY_KEY[field?.key];
  if (!spec) throw new Error('לא נבחר שדה מוכר לעזרה.');
  const draft = answer ?? previousAnswer ?? '';
  if (typeof draft !== 'string' || draft.length > 5000) throw new Error('התשובה לעזרה אינה תקינה או ארוכה מדי.');
  return {
    field: { key: spec.key, label: spec.label, required: spec.required, type: spec.type },
    guidance: GUIDANCE[spec.key] || 'התייחס רק לשאלה הנוכחית. שאל הבהרה קצרה ורלוונטית אם היא נחוצה.',
    fields,
    answer: draft.trim()
  };
}
export function normalizeHelp(result, context) {
  if (typeof result?.text !== 'string' || !result.text.trim() || result.text.length > 500 || !/[א-ת]/.test(result.text)) throw new Error('העוזר לא החזיר הסבר עברי תקין.');
  let text = result.text.trim();
  // The case number is optional and must never become a prerequisite elsewhere.
  if (context.field.key !== 'case_number' && /מספר\s+(?:ה?תיק)|מספרו?\s+של\s+התיק/.test(text)) {
    text = context.field.key === 'decision' && context.answer
      ? 'נתמקד במה שתיארת. למי פנית בבקשה לפעול, ומה הייתה התגובה?'
      : 'נתמקד בשאלה הנוכחית: ' + context.field.label + '. אפשר להסביר במילים שלך; אין צורך במספר תיק כאן.';
  }
  return { type: 'clarify', text };
}
