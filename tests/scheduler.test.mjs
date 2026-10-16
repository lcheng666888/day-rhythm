import test from 'node:test';
import assert from 'node:assert/strict';
import { createState, nextDaily, collectDue, normalizeState, setDaily, setNap, pauseNap, formatRemaining } from '../scheduler.mjs';

const at = (h, m, s = 0, day = 16) => new Date(2026, 9, day, h, m, s).getTime();
test('daily time rolls to tomorrow after the selected time', () => {
  assert.equal(nextDaily('07:30', at(8, 0)), at(7, 30, 0, 17));
  assert.equal(nextDaily('07:30', at(7, 29)), at(7, 30));
});
test('alarm is consumed once, including across reload', () => {
  const state = createState(at(7, 29));
  setDaily(state, 'morning', '07:30', true, at(7, 29));
  assert.equal(collectDue(state, at(7, 30)).events[0].id, 'morning');
  assert.equal(collectDue(state, at(7, 30, 1)).events.length, 0);
  const restored = normalizeState(JSON.parse(JSON.stringify(state)), at(7, 30, 2));
  assert.equal(collectDue(restored, at(7, 30, 2)).events.length, 0);
});
test('nap stores an absolute deadline; refresh cannot restart it', () => {
  const state = createState(at(12, 0));
  setNap(state, 20 * 60_000, at(12, 0));
  const restored = normalizeState(JSON.parse(JSON.stringify(state)), at(12, 19));
  assert.equal(restored.nap.deadline, at(12, 20));
  assert.equal(collectDue(restored, at(12, 20)).events[0].id, 'nap');
  assert.equal(collectDue(restored, at(12, 21)).events.length, 0);
});
test('background delay within 5 minutes catches up exactly once', () => {
  const state = createState(at(7, 29));
  setDaily(state, 'morning', '07:30', true, at(7, 29));
  assert.equal(collectDue(state, at(7, 33)).events.length, 1);
  assert.equal(collectDue(state, at(7, 34)).events.length, 0);
});
test('stale alarms are marked missed, not sounded hours later', () => {
  const state = createState(at(7, 29));
  setDaily(state, 'morning', '07:30', true, at(7, 29));
  setNap(state, 60_000, at(7, 29));
  const due = collectDue(state, at(10, 0));
  assert.equal(due.events.length, 0);
  assert.equal(due.missed.length, 2);
  assert.equal(state.nap.deadline, null);
  assert.equal(state.morning.nextDue, at(7, 30, 0, 17));
});
test('same-time reminders are both collected in deterministic order', () => {
  const state = createState(at(7, 29));
  setDaily(state, 'morning', '07:30', true, at(7, 29));
  setDaily(state, 'night', '07:30', true, at(7, 29));
  setNap(state, 60_000, at(7, 29));
  assert.deepEqual(collectDue(state, at(7, 30)).events.map(e => e.id), ['morning', 'nap', 'night']);
});
test('pause/resume preserves remaining nap time', () => {
  const state = createState(at(12, 0));
  setNap(state, 20 * 60_000, at(12, 0));
  pauseNap(state, at(12, 5));
  assert.equal(state.nap.remaining, 15 * 60_000);
  assert.equal(state.nap.deadline, null);
  setNap(state, state.nap.remaining, at(12, 8));
  assert.equal(state.nap.deadline, at(12, 23));
});
test('corrupted storage is bounded and defaults are safe', () => {
  const restored = normalizeState({morning: {time: '99:90', volume: 200}, nap: {minutes: -3, deadline: 'bad'}, night: null}, at(8, 0));
  assert.equal(restored.morning.time, '07:30');
  assert.ok(restored.morning.volume <= 100);
  assert.equal(restored.nap.deadline, null);
  assert.ok(restored.nap.minutes >= 1);
});
test('disabled reminders do not fire and dates use local calendar', () => {
  const state = createState(at(7, 29));
  setDaily(state, 'morning', '07:30', false, at(7, 29));
  assert.equal(collectDue(state, at(7, 31)).events.length, 0);
  assert.equal(formatRemaining(3661000), '01:01:01');
  assert.equal(formatRemaining(-1000), '00:00:00');
});
test('daily reminder fires again the next day, and can be rescheduled', () => {
  const state = createState(at(7,29));
  setDaily(state,'morning','07:30',true,at(7,29));
  assert.equal(collectDue(state,at(7,30)).events.length,1);
  assert.equal(collectDue(state,at(7,30,0,17)).events.length,1);
  setDaily(state,'morning','08:00',true,at(7,31,0,17));
  assert.equal(state.morning.nextDue,at(8,0,0,17));
});
test('midnight and month changes follow the local calendar', () => {
  const now = new Date(2026,9,31,23,59,59).getTime();
  assert.equal(nextDaily('00:00',now),new Date(2026,10,1,0,0,0).getTime());
});
test('pending reminders survive a short reload but stale pending is dropped', () => {
  const state = createState(at(7,29));
  state.morning.enabled=true;
  state.pending=[{id:'morning',due:at(7,30)}];
  assert.equal(normalizeState(state,at(7,31)).pending.length,1);
  assert.equal(normalizeState(state,at(8,0)).pending.length,0);
});
