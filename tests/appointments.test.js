import { describe, test, assert } from './runner.js';
import { toHM, parseHM, formatClock, addDays, startOfWeek, weekDays, monthGrid, overlaps, dayLabel } from '../js/core/time.js';
import { setDigitStyle } from '../js/core/format.js';
import { findConflicts, reminderMessage, whatsappLink } from '../js/services/appointments.js';
import { assignLanes } from '../js/modules/appointments/views.js';

const appt = (id, startMin, duration, extra = {}) => ({ id, date: '2026-10-22', startMin, duration, status: 'booked', chairId: 'c1', doctorId: 'd1', patientId: `p-${id}`, ...extra });

describe('time helpers', () => {
  test('clock formatting and parsing', () => {
    setDigitStyle('western');
    assert.equal(toHM(990), '16:30');
    assert.equal(parseHM('16:30'), 990);
    assert.equal(parseHM('24:00'), null);
    assert.equal(formatClock(990), '4:30 م');
    assert.equal(formatClock(9 * 60), '9:00 ص');
    assert.equal(formatClock(12 * 60), '12:00 م');
  });
  test('weeks start on Saturday', () => {
    assert.equal(startOfWeek('2026-10-22'), '2026-10-17'); // Thursday → Saturday before
    assert.equal(startOfWeek('2026-10-17'), '2026-10-17');
    assert.equal(startOfWeek('2026-10-23'), '2026-10-17'); // Friday
    assert.deepEqual([weekDays('2026-10-22')[0], weekDays('2026-10-22')[6]], ['2026-10-17', '2026-10-23']);
  });
  test('month grid and day math', () => {
    const g = monthGrid('2026-10-22');
    assert.equal(g.length, 42);
    assert.equal(g[0], '2026-09-26');
    assert.ok(g.includes('2026-10-01') && g.includes('2026-10-31'));
    assert.equal(addDays('2026-12-31', 1), '2027-01-01');
    assert.ok(dayLabel('2026-10-22').startsWith('الخميس'));
  });
  test('overlaps is half-open', () => {
    assert.ok(overlaps(600, 30, 615, 30));
    assert.ok(!overlaps(600, 30, 630, 30));
  });
});

describe('appointment conflicts', () => {
  const day = [appt('a', 960, 30), appt('b', 1020, 60, { chairId: 'c2', doctorId: 'd2' }), appt('x', 960, 30, { status: 'cancelled', chairId: 'c9', doctorId: 'd9' })];
  test('same chair or doctor overlapping → conflict with reasons', () => {
    const c = findConflicts(appt('new', 975, 30, { patientId: 'p-z' }), day);
    assert.equal(c.length, 1);
    assert.deepEqual(c[0].reasons, ['chair', 'doctor']);
  });
  test('different chair and doctor → no conflict; cancelled ignored', () => {
    assert.equal(findConflicts(appt('n', 960, 30, { chairId: 'c3', doctorId: 'd3', patientId: 'p-q' }), day).length, 0);
    assert.equal(findConflicts(appt('n', 960, 30, { chairId: 'c9', doctorId: 'd9', patientId: 'p-q' }), day).length, 0);
  });
  test('same patient double-booked elsewhere is a conflict; editing itself is not', () => {
    const c = findConflicts(appt('n', 1030, 15, { chairId: 'c5', doctorId: 'd5', patientId: 'p-b' }), day);
    assert.deepEqual(c[0].reasons, ['patient']);
    assert.equal(findConflicts({ ...day[0] }, day).length, 0);
  });
  test('lanes for overlapping blocks', () => {
    const lanes = assignLanes([appt('1', 600, 60), appt('2', 615, 30), appt('3', 700, 30)]);
    assert.deepEqual([lanes.get('1').lane, lanes.get('2').lane, lanes.get('1').lanes], [0, 1, 2]);
    assert.equal(lanes.get('3').lanes, 1);
  });
});

describe('reminders', () => {
  test('template placeholders are filled; unknown ones left as is', () => {
    const msg = reminderMessage(
      { patientName: 'سارة محمود', date: '2026-10-22', startMin: 17 * 60 + 30 },
      { template: 'مرحبًا {الاسم}، موعدك {اليوم} {التاريخ} {الوقت} في {العيادة} {غريب}', clinic: { name: 'عيادة جنة', phone: '01008137502' } },
    );
    assert.equal(msg, 'مرحبًا سارة، موعدك الخميس 22/10/2026 5:30 م في عيادة جنة {غريب}');
  });
  test('wa.me links only for mobiles, text is URL-encoded', () => {
    assert.equal(whatsappLink('0502345678', 'x'), null);
    const link = whatsappLink('01012345678', 'مرحبًا 5:30');
    assert.ok(link.startsWith('https://wa.me/201012345678?text='));
    assert.ok(!link.includes(' '));
  });
});
