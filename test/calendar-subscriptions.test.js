const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');

const url = 'https://example.invalid/calendar.ics';
const helperSource = readFileSync(require.resolve('../node_helper.js'), 'utf8');
const moduleSource = readFileSync(require.resolve('../MMM-CalendarWeek.js'), 'utf8');

function setup() {
  const instances = [];
  const downloads = [];
  const events = [{ title: 'School' }, { title: 'Cleaning' }, { title: 'Dinner' }];
  class Fetcher {
    constructor(feedUrl, interval, excluded, limit, days, auth) {
      Object.assign(this, { interval, days, auth, starts: 0 });
      this.url = () => feedUrl;
      this.events = () => events.filter(event => !excluded.includes(event.title)).slice(0, limit);
      downloads.push(this);
    }
    onReceive(callback) { this.receive = callback; }
    onError(callback) { this.fail = error => callback(this, error); }
    broadcastEvents() { this.receive(this); }
    startFetch() { this.starts++; }
  }
  const context = {
    require: name => {
      if (name === 'node_helper') return { create: definition => definition };
      if (name === './vendor/ical.js/http-url') return require('../vendor/ical.js/http-url');
      return Fetcher;
    },
    module: { exports: {} }, console: { log() {} }
  };
  vm.runInNewContext(helperSource, context);
  const helper = context.module.exports;
  helper.start();
  helper.sendSocketNotification = (name, payload) => {
    for (const instance of instances) instance.socketNotificationReceived(name, payload);
  };

  function register(identifier, settings = {}, auth, feedUrl = url) {
    let definition;
    const errors = [];
    vm.runInNewContext(moduleSource, {
      Module: { register(name, value) { definition = value; } },
      Log: { error: message => errors.push(message), log() {} }
    });
    Object.assign(definition, {
      identifier, errors, calendarData: {}, updates: 0,
      config: { ...definition.defaults, calendars: [{ url: feedUrl }], broadcastEvents: false, ...settings },
      sendSocketNotification: (name, payload) => helper.socketNotificationReceived(name, payload),
      updateDom() { this.updates++; }
    });
    instances.push(definition);
    definition.addCalendar(feedUrl, auth, {});
    return definition;
  }
  return { register, downloads };
}

test('instances using one URL get their own settings, events and errors', () => {
  const { register, downloads } = setup();
  const first = register('module_1', {
    excludedEvents: ['Cleaning'], maximumEntries: 2, maximumNumberOfDays: 4, fetchInterval: 1000
  });
  const second = register('module_2', {
    excludedEvents: ['School'], maximumEntries: 1, maximumNumberOfDays: 7, fetchInterval: 2000
  });

  assert.equal(downloads.length, 2);
  assert.deepEqual(downloads.map(fetcher => [fetcher.interval, fetcher.days]), [[1000, 4], [2000, 7]]);
  downloads[0].broadcastEvents();
  assert.deepEqual(first.calendarData[url].map(event => event.title), ['School', 'Dinner']);
  assert.equal(second.calendarData[url], undefined);
  assert.equal(second.updates, 0);
  downloads[1].broadcastEvents();
  assert.deepEqual(second.calendarData[url].map(event => event.title), ['Cleaning']);
  assert.deepEqual(first.calendarData[url].map(event => event.title), ['School', 'Dinner']);
  downloads[1].fail(new Error('Unauthorized'));
  assert.deepEqual(first.errors, []);
  assert.deepEqual(second.errors, ['Calendar error: Unauthorized']);
});

test('equivalent settings reuse one download and deliver cached events to a new instance', () => {
  const { register, downloads } = setup();
  const first = register('module_1', {}, { user: 'fixture', pass: 'fixture' });
  downloads[0].broadcastEvents();
  const second = register('module_2', {}, { pass: 'fixture', method: 'basic', user: 'fixture' });
  assert.equal(downloads.length, 1);
  assert.equal(downloads[0].starts, 1);
  assert.deepEqual(second.calendarData[url], first.calendarData[url]);
  assert.equal(first.updates, 1);
  assert.equal(second.updates, 1);
  downloads[0].broadcastEvents();
  assert.equal(first.updates, 2);
  assert.equal(second.updates, 2);
});

test('the same URL with different credentials uses separate downloads', () => {
  const { register, downloads } = setup();
  register('module_1', {}, { method: 'bearer', pass: 'fixture-a' });
  register('module_2', {}, { method: 'bearer', pass: 'fixture-b' });
  assert.equal(downloads.length, 2);
});

test('rejects unsupported and malformed calendar URLs before creating a fetcher', () => {
  const { register, downloads } = setup();
  const valid = register('valid');
  const ftp = register('ftp', {}, undefined, 'ftp://example.invalid/calendar.ics');
  const malformed = register('malformed', {}, undefined, 'not-a-url');

  assert.equal(downloads.length, 1);
  assert.deepEqual(ftp.errors, ['Calendar error: Calendar URL must use HTTP or HTTPS']);
  assert.deepEqual(malformed.errors, ['Calendar error: Invalid calendar URL']);
  assert.deepEqual(valid.errors, []);
});
