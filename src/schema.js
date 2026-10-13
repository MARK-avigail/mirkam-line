export const SCHEMA = [
  { key: 'court',           label: 'בית המשפט',              type: 'menu',   required: true },
  { key: 'case_number',     label: 'מספר תיק',               type: 'text',   required: false },
  { key: 'name',            label: 'שם העותר',                type: 'text',   required: true, example: 'משה כהן' },
  { key: 'identity',        label: 'מספר זהות',              type: 'digits', required: true, length: 9 },
  { key: 'prisoner_number', label: 'מספר אסיר',              type: 'text',   required: false },
  { key: 'prison',          label: 'בית הסוהר',              type: 'text',   required: true, example: 'אילון' },
  { key: 'respondents',     label: 'המשיבים',                type: 'long',   required: true, example: 'שירות בתי הסוהר' },
  { key: 'subject',         label: 'נושא העתירה',            type: 'text',   required: true, example: 'תנאי מעצר' },
  { key: 'decision',        label: 'ההחלטה או המעשה',         type: 'long',   required: true },
  { key: 'decision_date',   label: 'מועד ההחלטה',            type: 'date',   required: false },
  { key: 'facts',           label: 'העובדות',                type: 'long',   required: true, maxSeconds: 300 },
  { key: 'prior_requests',  label: 'פניות קודמות',           type: 'long',   required: false, maxSeconds: 180 },
  { key: 'grounds',         label: 'נימוקים',                type: 'long',   required: true, maxSeconds: 300 },
  { key: 'relief',          label: 'הסעד המבוקש',            type: 'long',   required: true, maxSeconds: 180 },
  { key: 'urgency',         label: 'דחיפות',                 type: 'long',   required: false, maxSeconds: 120 },
  { key: 'annexes',         label: 'נספחים',                 type: 'long',   required: false, maxSeconds: 120 },
  { key: 'date',            label: 'תאריך המסמך',            type: 'date',   required: true }
];

export const SCHEMA_BY_KEY = Object.fromEntries(SCHEMA.map(f => [f.key, f]));
