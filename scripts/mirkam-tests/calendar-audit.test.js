import test from 'node:test';
import assert from 'node:assert/strict';
import {calendarDate,addCalendarMonths} from '../../src/mirkam/workflow.js';
// Explicit Gregorian boundary fixtures for legal-document dates and four-month retention.
const fixtures=[
 [1,31,31,'2024-05-31'],[2,29,28,'2024-06-29'],[3,31,31,'2024-07-31'],
 [4,30,30,'2024-08-30'],[5,31,31,'2024-09-30'],[6,30,30,'2024-10-30'],
 [7,31,31,'2024-11-30'],[8,31,31,'2024-12-31'],[9,30,30,'2025-01-30'],
 [10,31,31,'2025-02-28'],[11,30,30,'2025-03-30'],[12,31,31,'2025-04-30']
];
const names=['ינואר','פברואר','מרץ','אפריל','מאי','יוני','יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר'];
for(const [month,leapEnd,normalEnd,retentionEnd] of fixtures){
 const mm=String(month).padStart(2,'0'),iso=`2024-${mm}-${leapEnd}`;
 test(`month ${month}: leap-year last day accepted`,()=>assert.equal(calendarDate(iso),iso));
 test(`month ${month}: day beyond leap-year boundary rejected`,()=>assert.throws(()=>calendarDate(`2024-${mm}-${leapEnd+1}`)));
 test(`month ${month}: non-leap last day accepted`,()=>assert.equal(calendarDate(`2025-${mm}-${normalEnd}`),`2025-${mm}-${normalEnd}`));
 test(`month ${month}: day beyond non-leap boundary rejected`,()=>assert.throws(()=>calendarDate(`2025-${mm}-${normalEnd+1}`)));
 test(`month ${month}: zero day rejected`,()=>assert.throws(()=>calendarDate(`2024-${mm}-0`)));
 test(`month ${month}: Israeli numeric date normalized`,()=>assert.equal(calendarDate(`${leapEnd}/${month}/2024`),iso));
 test(`month ${month}: Hebrew spoken month normalized`,()=>assert.equal(calendarDate(`${leapEnd} ב${names[month-1]} 2024`),iso));
 test(`month ${month}: four-month retention clamps target and preserves UTC time`,()=>assert.equal(new Date(addCalendarMonths(Date.parse(`${iso}T23:59:58.123Z`),4)).toISOString(),`${retentionEnd}T23:59:58.123Z`));
}
