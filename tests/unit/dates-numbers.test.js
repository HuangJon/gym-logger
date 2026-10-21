import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isISODate, todayISO, dayNum, daysBetween, addDays, weekStart, fromDayNum, agoText, formatMonthDay, formatLong, formatShort } from '../../js/core/dates.js';
import { hasValue, round2, signed, estimateOneRepMax, parseWeight, parseReps } from '../../js/core/numbers.js';

test('isISODate', () => {
  assert.ok(isISODate('2026-10-21'));
  for (const bad of ['2026-1-21', '10/21/2026', '', null, undefined, 20261021]) assert.ok(!isISODate(bad));
});

test('todayISO uses local calendar date, zero-padded', () => {
  assert.equal(todayISO(new Date(2026, 0, 5, 23, 59)), '2026-01-05');
});

test('day arithmetic', () => {
  assert.equal(daysBetween('2026-10-01', '2026-10-21'), 20);
  assert.equal(daysBetween('2026-10-21', '2026-10-01'), -20);
  assert.equal(addDays('2026-02-27', 2), '2026-03-01');
  assert.equal(fromDayNum(dayNum('2026-04-19')), '2026-04-19');
  assert.equal(daysBetween('2026-03-07', '2026-03-09'), 2);   // across a DST change
});

test('weekStart is the Monday of that week', () => {
  assert.equal(fromDayNum(weekStart('2026-10-21')), '2026-10-19');   // Wed → Mon
  assert.equal(fromDayNum(weekStart('2026-10-19')), '2026-10-19');   // Mon → itself
  assert.equal(fromDayNum(weekStart('2026-10-25')), '2026-10-19');   // Sun → previous Mon
});

test('agoText', () => {
  const ref = '2026-10-21';
  assert.equal(agoText('2026-10-21', ref), 'today');
  assert.equal(agoText('2026-10-22', ref), 'today');
  assert.equal(agoText('2026-10-20', ref), 'yesterday');
  assert.equal(agoText('2026-10-16', ref), '5 days ago');
  assert.equal(agoText('2026-09-30', ref), '3 weeks ago');
  assert.equal(agoText('2026-05-28', ref), '5 months ago');
});

test('date formatting', () => {
  assert.equal(formatMonthDay('2026-04-09'), '4/9');
  assert.equal(formatLong('2026-10-21'), 'Wed, Oct 21, 2026');
  assert.equal(formatShort('2026-10-21'), 'Wed, Oct 21');
  assert.equal(formatShort(''), '');
});

test('hasValue', () => {
  for (const v of [0, 5, '5', 'x']) assert.ok(hasValue(v));
  for (const v of ['', null, undefined, NaN]) assert.ok(!hasValue(v));
});

test('round2 / signed', () => {
  assert.equal(round2(36.25), 36.25);
  assert.equal(round2(1.23456), 1.23);
  assert.equal(signed(2.5), '+2.5');
  assert.equal(signed(-1.75), '−1.75');
  assert.equal(signed(0), '±0');
});

test('estimateOneRepMax rounds to 0.5', () => {
  assert.equal(estimateOneRepMax(50, 8), 63.5);
  assert.equal(estimateOneRepMax(185, 5), 216);
});

test('parseWeight rejects zero, negatives, blanks, junk and absurd values', () => {
  assert.equal(parseWeight('187.5'), 187.5);
  assert.equal(parseWeight(' 50 '), 50);
  for (const bad of ['0', '-5', '', 'abc', '2001']) assert.equal(parseWeight(bad), null, bad);
});

test('parseReps', () => {
  assert.equal(parseReps(''), '');
  assert.equal(parseReps('12'), 12);
  assert.equal(parseReps('0'), 0);
  assert.equal(parseReps('-1'), null);
  assert.equal(parseReps('x'), null);
});
