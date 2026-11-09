const { test } = require('node:test');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

function regressionCases() {
  const assert = require('node:assert/strict');
  const fs = require('node:fs');
  const vm = require('node:vm');
  const moment = require('moment');
  const ical = require('./vendor/ical.js');
  const source = fs.readFileSync('calendarfetcher.js', 'utf8');
  function parse(body) {
    return ical.parseICS('BEGIN:VCALENDAR\nVERSION:2.0\n' + body + '\nEND:VCALENDAR');
  }
  function event(fields) {
    return 'BEGIN:VEVENT\nUID:test@example.invalid\nSUMMARY:Test\n' + fields + '\nEND:VEVENT';
  }
  function fetch(data, day, days) {
    const now = moment(day).add(12, 'hours').valueOf();
    const previousNow = moment.now;
    moment.now = () => now;
    class Clock extends Date {
      constructor(...args) { super(...(args.length ? args : [now])); }
      static now() { return now; }
    }
    const context = {
      require: name => name === './recurrence' ? require('./recurrence') : name === 'moment' ? moment : { fromURL: (url, opts, callback) => callback(null, data) },
      module: { exports: {} }, process, global: { version: 'test' }, Date: Clock,
      console, setTimeout: () => 0, clearTimeout: () => {}
    };
    try {
      vm.runInNewContext(source, context);
      const fetcher = new context.module.exports('fixture', 300000, [], 100, days);
      fetcher.startFetch();
      return Array.from(fetcher.events(), e => ({ ...e }));
    } finally { moment.now = previousNow; }
  }
  const date = timestamp => moment(+timestamp).format('YYYY-MM-DD HH:mm');
  const weekly = 'DTSTART;VALUE=DATE:20260824\nDTEND;VALUE=DATE:20260825\nRRULE:FREQ=WEEKLY;WKST=MO;UNTIL=20261218;BYDAY=MO';
  const data = parse(event(weekly + '\nEXDATE;VALUE=DATE:20261026'));
  const events = fetch(data, '2026-10-25', 20);
  assert.deepEqual(events.map(e => date(e.startDate)), ['2026-11-02 00:00', '2026-11-09 00:00']);
  assert(events.every(e => e.fullDayEvent));
  assert.equal(date(events[0].endDate), '2026-11-03 00:00');
  // Daily events cross both European and US DST boundaries, including a
  // three-calendar-day duration. All exclusive ends must remain at midnight.
  for (const [start, end, day] of [
    ['20260327', '20260328', '2026-03-27'],
    ['20261023', '20261024', '2026-10-23'],
    ['20260306', '20260307', '2026-03-06'],
    ['20261030', '20261031', '2026-10-30'],
    ['20260327', '20260330', '2026-03-27']
  ]) {
    const expectedDays = moment(end, 'YYYYMMDD').diff(moment(start, 'YYYYMMDD'), 'days');
    const result = fetch(parse(event('DTSTART;VALUE=DATE:' + start + '\nDTEND;VALUE=DATE:' + end + '\nRRULE:FREQ=DAILY;COUNT=6')), day, 10);
    assert.equal(result.length, 6);
    result.forEach(e => {
      assert.equal(moment(+e.startDate).format('HH:mm'), '00:00');
      assert.equal(moment(+e.endDate).format('HH:mm'), '00:00');
      assert.equal(date(e.endDate), moment(+e.startDate).add(expectedDays, 'days').format('YYYY-MM-DD HH:mm'));
      assert(e.fullDayEvent);
    });
  }
  // A moved override outside the queried recurrence range must be included;
  // its longer duration must not leak into subsequent normal occurrences.
  const override = event('RECURRENCE-ID;VALUE=DATE:20261019\nDTSTART;VALUE=DATE:20261027\nDTEND;VALUE=DATE:20261029');
  const moved = fetch(parse(event(weekly) + '\n' + override), '2026-10-25', 20);
  assert.deepEqual(moved.map(e => date(e.startDate)), ['2026-10-26 00:00', '2026-10-27 00:00', '2026-11-02 00:00', '2026-11-09 00:00']);
  assert.equal(date(moved[1].endDate), '2026-10-29 00:00');
  assert.equal(date(moved[2].endDate), '2026-11-03 00:00');
  // Same-date override should replace rather than duplicate the occurrence.
  const sameDay = fetch(parse(event(weekly) + '\n' + event('RECURRENCE-ID;VALUE=DATE:20261102\nDTSTART;VALUE=DATE:20261102\nDTEND;VALUE=DATE:20261105')), '2026-11-02', 14);
  assert.equal(sameDay.length, 2);
  assert.equal(date(sameDay[0].endDate), '2026-11-05 00:00');
  assert.equal(date(sameDay[1].endDate), '2026-11-10 00:00');
  // Timed recurrence continues to use the legacy engine and elapsed duration.
  const timed = fetch(parse(event('DTSTART:20261102T100000\nDTEND:20261102T110000\nRRULE:FREQ=DAILY;COUNT=2')), '2026-11-02', 3);
  assert.deepEqual(timed.map(e => date(e.startDate)), ['2026-11-02 10:00', '2026-11-03 10:00']);
  assert(timed.every(e => +e.endDate - +e.startDate === 3600000 && !e.fullDayEvent));
  // Nonrecurring DATE-only events are still classified as all-day.
  const single = fetch(parse(event('DTSTART;VALUE=DATE:20261025\nDTEND;VALUE=DATE:20261026')), '2026-10-25', 2);
  assert.equal(single.length, 1);
  assert(single[0].fullDayEvent);
  assert.equal(date(single[0].endDate), '2026-10-26 00:00');
  // A named timezone must be respected even when the Node host is UTC or New York.
  const timedFields = 'DTSTART;TZID=Europe/Stockholm:20241029T100000\nDTEND;TZID=Europe/Stockholm:20241029T120000\nRRULE:FREQ=WEEKLY;WKST=MO;INTERVAL=2;BYDAY=TU';
  const tzMoment = require('moment-timezone');
  const stockholm = timestamp => tzMoment(+timestamp).tz('Europe/Stockholm').format('YYYY-MM-DD HH:mm Z');
  const autumn = fetch(parse(event(timedFields)), '2026-10-12', 35);
  assert.deepEqual(autumn.map(e => stockholm(e.startDate)), [
    '2026-10-13 10:00 +02:00', '2026-10-27 10:00 +01:00', '2026-11-10 10:00 +01:00'
  ]);
  assert(autumn.every(e => !e.fullDayEvent && +e.endDate - +e.startDate === 7200000));
  assert(autumn.every(e => stockholm(e.endDate).includes('12:00')));
  const spring = fetch(parse(event(timedFields)), '2026-03-16', 35);
  assert.deepEqual(spring.map(e => stockholm(e.startDate)), [
    '2026-03-17 10:00 +01:00', '2026-03-31 10:00 +02:00', '2026-04-14 10:00 +02:00'
  ]);
  const excludedTimed = fetch(parse(event(timedFields + '\nEXDATE;TZID=Europe/Stockholm:20261027T100000')), '2026-10-25', 20);
  assert.deepEqual(excludedTimed.map(e => stockholm(e.startDate)), ['2026-11-10 10:00 +01:00']);
  const timedOverride = event('RECURRENCE-ID;TZID=Europe/Stockholm:20261027T100000\nDTSTART;TZID=Europe/Stockholm:20261028T150000\nDTEND;TZID=Europe/Stockholm:20261028T180000');
  const overriddenTimed = fetch(parse(event(timedFields) + '\n' + timedOverride), '2026-10-25', 20);
  assert.deepEqual(overriddenTimed.map(e => stockholm(e.startDate)), ['2026-10-28 15:00 +01:00', '2026-11-10 10:00 +01:00']);
  assert.equal(+overriddenTimed[0].endDate - +overriddenTimed[0].startDate, 10800000);
  assert.equal(+overriddenTimed[1].endDate - +overriddenTimed[1].startDate, 7200000);
  // UTC recurrences preserve UTC time, rather than Stockholm wall time.
  const utcEvents = fetch(parse(event('DTSTART:20261020T090000Z\nDTEND:20261020T100000Z\nRRULE:FREQ=WEEKLY;COUNT=2;BYDAY=TU')), '2026-10-19', 15);
  assert.deepEqual(utcEvents.map(e => new Date(+e.startDate).toISOString()), ['2026-10-20T09:00:00.000Z', '2026-10-27T09:00:00.000Z']);
  // Floating times follow host local time across both clock changes.
  for (const first of ['20260327', '20261023', '20260306', '20261030']) {
    const floating = fetch(parse(event('DTSTART:' + first + 'T100000\nDTEND:' + first + 'T110000\nRRULE:FREQ=DAILY;COUNT=6')), moment(first, 'YYYYMMDD').format('YYYY-MM-DD'), 8);
    assert.equal(floating.length, 6);
    floating.forEach(e => assert.equal(moment(+e.startDate).format('HH:mm'), '10:00'));
  }
  // UTC UNTIL is inclusive and must be converted to calendar coordinates.
  const until = fetch(parse(event(timedFields.replace('INTERVAL=2;', 'INTERVAL=2;UNTIL=20261027T090000Z;'))), '2026-10-12', 35);
  assert.deepEqual(until.map(e => stockholm(e.startDate)), ['2026-10-13 10:00 +02:00', '2026-10-27 10:00 +01:00']);
  // Named-zone exception identities also work close to midnight (UTC day differs).
  const midnight = fetch(parse(event('DTSTART;TZID=Europe/Stockholm:20261020T003000\nDTEND;TZID=Europe/Stockholm:20261020T013000\nRRULE:FREQ=WEEKLY;COUNT=3;BYDAY=TU\nEXDATE;TZID=Europe/Stockholm:20261027T003000')), '2026-10-19', 16);
  assert.deepEqual(midnight.map(e => stockholm(e.startDate)), ['2026-10-20 00:30 +02:00', '2026-11-03 00:30 +01:00']);

  const ongoing = parse(event('DTSTART;VALUE=DATE:20261102\nDTEND;VALUE=DATE:20261105\nRRULE:FREQ=WEEKLY;COUNT=2'));
  const active = fetch(ongoing, '2026-11-03', 3);
  assert.deepEqual(active.map(e => [date(e.startDate), date(e.endDate)]), [
    ['2026-11-02 00:00', '2026-11-05 00:00']
  ]);
  assert.equal(fetch(ongoing, '2026-11-05', 4).length, 0);
  const fallOverlap = parse(event('DTSTART;VALUE=DATE:20261024\nDTEND;VALUE=DATE:20261027\nRRULE:FREQ=WEEKLY;COUNT=1'));
  assert.deepEqual(fetch(fallOverlap, '2026-10-26', 1).map(e => [date(e.startDate), date(e.endDate)]), [
    ['2026-10-24 00:00', '2026-10-27 00:00']
  ]);

  const overnight = parse(event('DTSTART:20261102T230000\nDTEND:20261103T020000\nRRULE:FREQ=WEEKLY;COUNT=2'));
  assert.deepEqual(fetch(overnight, '2026-11-03', 1).map(e => [date(e.startDate), date(e.endDate)]), [
    ['2026-11-02 23:00', '2026-11-03 02:00']
  ]);

  // Two exclusions and a moved occurrence share a UTC date with an unchanged
  // occurrence. Each exception must match only its original timestamp.
  const sameDate = event('DTSTART:20261102T090000Z\nDTEND:20261102T093000Z\nRRULE:FREQ=DAILY;BYHOUR=9,11,13,15;COUNT=4\nEXDATE:20261102T090000Z,20261102T130000Z');
  const movedTimed = event('RECURRENCE-ID:20261102T110000Z\nDTSTART:20261102T120000Z\nDTEND:20261102T123000Z');
  assert.deepEqual(fetch(parse(sameDate + '\n' + movedTimed), '2026-11-02', 2).map(e => new Date(+e.startDate).toISOString()), [
    '2026-11-02T12:00:00.000Z', '2026-11-02T15:00:00.000Z'
  ]);

}

for (const timezone of ['Europe/Stockholm', 'UTC', 'America/New_York']) {
  test('all-day and timed recurrence regressions in ' + timezone, () => {
    execFileSync(process.execPath, ['-e', '(' + regressionCases.toString() + ')()'], {
      cwd: path.join(__dirname, '..'), env: { ...process.env, TZ: timezone }, stdio: 'pipe'
    });
  });
}
