export const BRANCHES = [
  {digit:'1',title:'כותבים עתירה',children:[{digit:'1',title:'הכנת עתירה עם עזרת AI'},{digit:'2',title:'הכנת עתירה ללא עזרת AI'}]},
  {digit:'2',title:'המסמכים והעתירות שלי',children:[{digit:'1',title:'המשך טיוטה'},{digit:'2',title:'מסמכים וגרסאות'},{digit:'3',title:'היסטוריית משלוחים'}]},
  {digit:'3',title:'מדברים עם ליין',children:[{digit:'1',title:'שיחה חדשה'},{digit:'2',title:'המשך שיחה שמורה'}]},
  {digit:'4',title:'הדואר הקולי המשפחתי שלי',children:[{digit:'1',title:'הודעה חדשה'},{digit:'2',title:'תשובות שהתקבלו'},{digit:'3',title:'אנשי קשר מאושרים'}]},
  {digit:'5',title:'עדכונים ממבריקה AI',children:[{digit:'1',title:'הודעות החברה'},{digit:'2',title:'המינוי והשימוש שלי'},{digit:'3',title:'פנייה למשרד'}]}
];
export const TOPICS=[
  {key:'subject',label:'מה הנושא שעליו תרצו להגיש עתירה?',required:true},
  {key:'relief',label:'מה תרצו שבית המשפט יורה לעשות?',required:true},
  {key:'decision',label:'ספרו מה עשו, או מה לא עשו, ועל מה אתם מבקשים להתלונן.',required:true},
  {key:'decision_date',label:'מתי זה קרה? אם אינכם יודעים אפשר לדלג.',date:true},
  {key:'facts',label:'מה קרה? ספרו את העובדות במילים שלכם.',required:true},
  {key:'prior_requests',label:'למי פניתם קודם, ומה הייתה התשובה?'},
  {key:'prior_petition',label:'האם הוגשה עתירה קודמת באותו עניין? אם כן, מה השתנה מאז?'},
  {key:'grounds',label:'מה לדעתכם לא תקין בהחלטה או בהתנהלות?',required:true},
  {key:'urgency',label:'האם יש דחיפות או בקשה זמנית? הסבירו אם כן.'},
  {key:'annexes',label:'אילו מסמכים ברשותכם יכולים לתמוך בעתירה?'}
];
export function validText(value,max=5000){if(typeof value!=='string'||!value.trim()||value.length>max)throw Error('לא התקבלה תשובה תקינה.');return value.trim();}
export function calendarDate(value){
  let text=validText(value,100);let match=text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/),y,m,d;
  if(match)[,y,m,d]=match.map(Number);else{match=text.match(/^(\d{1,2})[/.\s-](\d{1,2})[/.\s-](\d{4})$/);if(match)[,d,m,y]=match.map(Number);}
  if(!match){const spoken=spokenDate(text);if(spoken){({y,m,d}=spoken);match=true;}}
  const date=new Date(Date.UTC(y,m-1,d));if(!match||y<1900||y>2100||date.getUTCFullYear()!==y||date.getUTCMonth()+1!==m||date.getUTCDate()!==d)throw Error('התאריך אינו ברור. אמרו יום, חודש ושנה במספרים.');
  return `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
}
function spokenDate(text){
  const months=['ינואר','פברואר','מרץ','אפריל','מאי','יוני','יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר'];
  const words=text.replace(/[,.]/g,' ').replace(/^(?:בתאריך|תאריך|ביום|יום)\s+/,'').split(/\s+/).filter(Boolean);
  const index=words.findIndex(w=>months.includes(w.replace(/^ב/,'')));if(index<1||index===words.length-1)return null;
  const number=parts=>{if(parts.length===1&&/^\d+$/.test(parts[0]))return Number(parts[0]);const values={אחד:1,אחת:1,שניים:2,שתיים:2,שני:2,שתי:2,שלושה:3,שלוש:3,ארבעה:4,ארבע:4,חמישה:5,חמש:5,שישה:6,שש:6,שבעה:7,שבע:7,שמונה:8,תשעה:9,תשע:9,עשר:10,עשרה:10,עשרים:20,שלושים:30,ארבעים:40,חמישים:50,שישים:60,שבעים:70,שמונים:80,תשעים:90};if(parts.length>2)return NaN;const numbers=parts.map(w=>values[w.replace(/^ו/,'')]);if(numbers.some(n=>n===undefined))return NaN;if(numbers.length===1)return numbers[0];if(numbers[0]>=20&&numbers[0]%10===0&&numbers[1]>=1&&numbers[1]<=9)return numbers[0]+numbers[1];if(numbers[0]>=1&&numbers[0]<=9&&numbers[1]===10)return numbers[0]+10;return NaN;};
  const d=number(words.slice(0,index)),tail=words.slice(index+1).filter(w=>!['שנת','בשנת'].includes(w));let y;
  if(tail.length===1&&/^\d{4}$/.test(tail[0]))y=Number(tail[0]);else if(tail[0]==='אלפיים'){const n=tail.length===1?0:number(tail.slice(1));if(n>=0&&n<=99)y=2000+n;}else return null;
  return {d,m:months.indexOf(words[index].replace(/^ב/,''))+1,y};
}
export function addCalendarMonths(timestamp,months=4){const d=new Date(timestamp);if(!Number.isFinite(d.getTime()))throw Error('Invalid date');const day=d.getUTCDate();d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()+months);const max=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate();d.setUTCDate(Math.min(day,max));return d.getTime();}
export function nextTopic(d){return d.editing||TOPICS.find(t=>!Object.hasOwn(d.answers,t.key))?.key||null;}
export function prompt(d){const key=nextTopic(d);return key?TOPICS.find(t=>t.key===key).label:'עברנו על הפרטים. אפשר לבדוק את חבילת המסמכים ולתקן לפני אישור.';}
export function commands(state,digit){
  if(digit==='*')return 'commands';if(digit==='7')return 'save-exit';if(digit==='8')return 'back';if(digit==='9')return 'help';if(digit==='0')return 'skip';if(digit==='#')return 'finish-recording';return 'invalid';
}
