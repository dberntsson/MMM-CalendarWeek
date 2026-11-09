const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const moment = require('moment');
const ical = require('../vendor/ical.js');
const expandOccurrences = require('../recurrence');

const source = readFileSync(require.resolve('../calendarfetcher.js'), 'utf8');

function calendar(...entries) {
  return ical.parseICS('BEGIN:VCALENDAR\n' + entries.map((entry, index) =>
    'BEGIN:VEVENT\nUID:fixture-' + index + '\n' + entry + '\nEND:VEVENT'
  ).join('\n') + '\nEND:VCALENDAR');
}

function runRefreshes(...responses) {
  const now = new Date(2026, 10, 9, 10).valueOf();
  const clock = (...args) => args.length ? moment(...args) : moment(now);
  clock.invalid = moment.invalid;
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
  }
  const timers = [];
  const errors = [];
  const context = {
    require: name => {
      if (name === 'moment') return clock;
      if (name === './recurrence') return expandOccurrences;
      return { fromURL: (url, opts, callback) => callback(null, responses.shift()) };
    },
    module: { exports: {} }, process, global: {}, Date: Clock,
    setTimeout: callback => timers.push(callback), clearTimeout: () => {}
  };
  vm.runInNewContext(source, context);
  const fetcher = new context.module.exports('fixture', 300000, [], 20, 4);
  fetcher.onError((sender, error) => errors.push(error.message));
  fetcher.startFetch();
  return { fetcher, timers, errors };
}

test('date-only DTSTART defaults to a full day with an exclusive end', () => {
  const { fetcher, errors } = runRefreshes(calendar('SUMMARY:All day\nDTSTART;VALUE=DATE:20261109'));
  const events = fetcher.events();
  assert.equal(events.length, 1);
  assert.equal(events[0].fullDayEvent, true);
  assert.equal(+events[0].startDate, +new Date(2026, 10, 9));
  assert.equal(+events[0].endDate, +new Date(2026, 10, 10));
  assert.deepEqual(errors, []);
});

test('skips malformed events and still publishes valid entries and refreshes', () => {
  const mixed = calendar(
    'SUMMARY:Missing start',
    'SUMMARY:Invalid end\nDTSTART;VALUE=DATE:20261109\nDTEND:invalid',
    'SUMMARY:Valid\nDTSTART;VALUE=DATE:20261109'
  );
  const { fetcher, timers, errors } = runRefreshes(mixed, calendar('SUMMARY:Next refresh\nDTSTART;VALUE=DATE:20261109'));
  assert.equal(fetcher.events().length, 1);
  assert.equal(fetcher.events()[0].title, 'Valid');
  assert.deepEqual(errors, ['Skipped 2 invalid calendar event(s)']);
  assert.equal(timers.length, 1);
  timers.shift()();
  assert.equal(fetcher.events()[0].title, 'Next refresh');
  assert.equal(timers.length, 1);
});

test('keeps the last good data and schedules another refresh after a processing failure', () => {
  const first = calendar('SUMMARY:Last good event\nDTSTART;VALUE=DATE:20261109');
  const broken = new Proxy({}, { ownKeys() { throw new Error('Feed processing failed'); } });
  const next = calendar('SUMMARY:Recovered\nDTSTART;VALUE=DATE:20261109');
  const { fetcher, timers, errors } = runRefreshes(first, broken, next);
  timers.shift()();
  assert.equal(fetcher.events()[0].title, 'Last good event');
  assert.deepEqual(errors, ['Feed processing failed']);
  assert.equal(timers.length, 1);
  timers.shift()();
  assert.equal(fetcher.events()[0].title, 'Recovered');
  assert.equal(timers.length, 1);
});
