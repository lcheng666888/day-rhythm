import test from 'node:test';
import assert from 'node:assert/strict';
import {createState, normalizeState, collectDue, setNap, localDate, dateAfter, planReminder, updateReminder, formatFullDate, validTime} from '../scheduler.mjs';
const at = (year,month,day,hour,minute,second=0)=>new Date(year,month-1,day,hour,minute,second).getTime();
const evening=at(2026,10,16,23,40);
test('tonight can schedule tomorrow morning exactly, then fire once',()=>{
  const s=createState(evening);
  const error=updateReminder(s,'morning',{date:'2026-10-17',time:'07:30',repeat:'once',enabled:true},evening);
  assert.equal(error,'');assert.equal(s.morning.nextDue,at(2026,10,17,7,30));
  assert.equal(collectDue(s,at(2026,10,17,7,29)).events.length,0);
  assert.equal(collectDue(s,at(2026,10,17,7,30)).events[0].due,at(2026,10,17,7,30));
  assert.equal(s.morning.enabled,false);assert.equal(s.morning.nextDue,null);
  assert.equal(collectDue(s,at(2026,10,18,7,30)).events.length,0);
});
test('today in the past is rejected, without a silent move to tomorrow',()=>{
  const s=createState(evening);
  const error=updateReminder(s,'morning',{date:'2026-10-16',time:'07:30',repeat:'once',enabled:true},evening);
  assert.match(error,/已过/);assert.equal(s.morning.date,'2026-10-16');assert.equal(s.morning.nextDue,null);
});
test('daily repetition rolls forward explicitly and respects its starting date',()=>{
  assert.equal(planReminder({date:'2026-10-16',time:'07:30',repeat:'daily'},evening).due,at(2026,10,17,7,30));
  assert.equal(planReminder({date:'2026-10-20',time:'07:30',repeat:'daily'},evening).due,at(2026,10,20,7,30));
});
test('crossing midnight, month end and year end uses local calendar dates',()=>{
  for(const [start,end] of [[at(2026,10,16,23,59),'2026-10-17'],[at(2026,10,31,23,59),'2026-11-01'],[at(2026,12,31,23,59),'2027-01-01']]){
    assert.equal(dateAfter(start,1),end);
    assert.equal(localDate(planReminder({date:end,time:'00:00',repeat:'once'},start).due),end);
    assert.equal(localDate(planReminder({date:localDate(start),time:'00:00',repeat:'daily'},start).due),end);
  }
});
test('full date text has an accurate relative date, year, weekday and 24-hour time',()=>{
  assert.equal(formatFullDate(at(2026,10,17,7,30),evening),'明天，2026 年 10 月 17 日，周六 07:30');
  assert.equal(formatFullDate(at(2027,1,1,0,0),at(2026,12,31,23,59)),'明天，2027 年 1 月 1 日，周五 00:00');
  assert.doesNotMatch(formatFullDate(at(2026,10,20,7,30),evening),/今天|明天/);
});
test('editing date and time replaces the previous occurrence, not just the label',()=>{
  const s=createState(evening);
  updateReminder(s,'night',{date:'2026-10-17',time:'22:30',repeat:'once',enabled:true},evening);
  updateReminder(s,'night',{date:'2026-10-18',time:'21:15'},evening);
  assert.equal(collectDue(s,at(2026,10,17,22,30)).events.length,0);
  assert.equal(collectDue(s,at(2026,10,18,21,15)).events[0].due,at(2026,10,18,21,15));
});
test('refresh retains a single date far in the future and the exact due timestamp',()=>{
  const s=createState(evening);
  updateReminder(s,'morning',{date:'2027-01-01',time:'07:30',repeat:'once',enabled:true},evening);
  const restored=normalizeState(JSON.parse(JSON.stringify(s)),evening+1000);
  assert.equal(restored.morning.nextDue,at(2027,1,1,7,30));assert.equal(restored.morning.repeat,'once');
});
test('a just-overdue single reminder survives refresh, is consumed and retains its queued alert',()=>{
  const s=createState(evening),due=at(2026,10,17,7,30);
  updateReminder(s,'morning',{date:'2026-10-17',time:'07:30',repeat:'once',enabled:true},evening);
  const restored=normalizeState(s,due+1000);
  const {events}=collectDue(restored,due+1000); restored.pending.push(...events);
  assert.equal(events.length,1);assert.equal(restored.morning.enabled,false);
  const reloaded=normalizeState(restored,due+2000);
  assert.equal(reloaded.pending.length,1);assert.equal(collectDue(reloaded,due+2000).events.length,0);
});
test('invalid or incomplete fields are saved as drafts but never scheduled, including after reload',()=>{
  for(const time of ['', '7:30','07:','24:00','12:60','xx:yy']){
    assert.equal(validTime(time),false);
    const s=createState(evening);
    assert.ok(updateReminder(s,'morning',{time,date:'2026-10-17',repeat:'once',enabled:true},evening));
    assert.equal(s.morning.nextDue,null);
    assert.equal(normalizeState(s,evening).morning.nextDue,null);
  }
  assert.ok(planReminder({date:'2026-02-30',time:'07:30',repeat:'once'},evening).error);
  assert.ok(planReminder({date:'',time:'07:30',repeat:'once'},evening).error);
});
test('nap end date and time crosses year end and is the same occurrence that triggers',()=>{
  const now=at(2026,12,31,23,50),s=createState(now);setNap(s,20*60_000,now);
  assert.equal(formatFullDate(s.nap.deadline,now),'明天，2027 年 1 月 1 日，周五 00:10');
  assert.equal(collectDue(s,at(2027,1,1,0,10)).events[0].due,at(2027,1,1,0,10));
});
test('a single reminder missed for hours completes without ringing on another day',()=>{
  const s=createState(evening);
  updateReminder(s,'night',{date:'2026-10-17',time:'00:00',repeat:'once',enabled:true},evening);
  const restored=normalizeState(s,at(2026,10,17,12,0));
  const due=collectDue(restored,at(2026,10,17,12,0));
  assert.equal(due.events.length,0);assert.equal(due.missed.length,1);
  assert.equal(restored.night.enabled,false);assert.equal(restored.night.nextDue,null);
});
test('editing to an incomplete time disarms the old occurrence immediately',()=>{
  const s=createState(evening);
  updateReminder(s,'morning',{date:'2026-10-17',time:'07:30',repeat:'once',enabled:true},evening);
  updateReminder(s,'morning',{time:'07:'},evening);
  assert.equal(collectDue(s,at(2026,10,17,7,30)).events.length,0);
  assert.equal(normalizeState(s,at(2026,10,17,7,30)).morning.nextDue,null);
});
test('old saved daily settings migrate without changing their next occurrence',()=>{
  const old={version:1,morning:{enabled:true,time:'07:30',volume:65,nextDue:at(2026,10,17,7,30)}};
  const s=normalizeState(old,evening);
  assert.equal(s.version,2);assert.equal(s.morning.repeat,'daily');assert.equal(s.morning.nextDue,old.morning.nextDue);
});
