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
      require: name => name === 'moment' ? moment : { fromURL: (url, opts, callback) => callback(null, data) },
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
}

for (const timezone of ['Europe/Stockholm', 'UTC', 'America/New_York']) {
  test('date-only recurrence and fetcher regressions in ' + timezone, () => {
    execFileSync(process.execPath, ['-e', '(' + regressionCases.toString() + ')()'], {
      cwd: path.join(__dirname, '..'), env: { ...process.env, TZ: timezone }, stdio: 'pipe'
    });
  });
}
