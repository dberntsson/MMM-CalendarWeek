const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const moment = require('moment-timezone');
moment.tz.setDefault('Europe/Stockholm');

const source = readFileSync(require.resolve('../MMM-CalendarWeek.js'), 'utf8');

function render(fields, options = {}, time = '2026-11-09T09:00:00') {
  const elements = [];
  const htmlWrites = [];
  const document = {
    createElement(tag) {
      const node = {
        tag, children: [], style: {}, textContent: '',
        appendChild(child) { this.children.push(child); },
        set innerHTML(value) { htmlWrites.push(value); }
      };
      elements.push(node);
      return node;
    },
    createTextNode(textContent) { return { textContent }; }
  };
  const now = moment(time);
  const clock = (...args) => args.length ? moment(...args) : now.clone();
  let calendar;
  vm.runInNewContext(source, {
    document, moment: clock, config: { timeFormat: 24 },
    Module: { register(name, module) { calendar = module; } }
  });
  calendar.config = {
    ...calendar.defaults, maximumNumberOfDays: 1, maximumDaysPerLine: 1,
    displayLocation: true, displayDescription: true, ...options
  };
  calendar.translate = key => key.toLowerCase();
  calendar.loaded = true;
  calendar.calendarData = { fixture: [{
    startDate: now.clone().hour(10).format('x'),
    endDate: now.clone().hour(11).format('x'),
    ...fields
  }] };
  calendar.getDom();
  return { elements, htmlWrites };
}

function lines(cell) {
  return cell.children.map(child => child.tag === 'br' ? '\n' : child.textContent).join('');
}

test('renders calendar fields as literal text and builds description and time breaks as elements', () => {
  const title = '<img src=x onerror=alert(1)> &amp;';
  const location = '<b>Kitchen & café</b>';
  const description = '<script>example</script>\r\nSecond line <br>';
  const { elements, htmlWrites } = render({ title, location, description }, {
    maxTitleLength: 0, showEndDate: true
  });

  assert.equal(lines(elements.find(node => node.className === 'title bright')), title);
  assert(elements.some(node => node.textContent === location));
  assert(elements.some(node => lines(node) === '<script>example</script>\nSecond line <br>'));
  const time = elements.find(node => node.className === 'time light');
  assert.equal(time.textContent, '10:00');
  assert.equal(lines(time), '\n11:00');
  assert(htmlWrites.every(value => !/<(?:img|b|script|\/br)>?/i.test(value)));
});

test('keeps title replacements, wrapping, and literal ellipses', () => {
  const wrapped = render({ title: 'Prefix A & B <em>longword</em>' }, {
    titleReplace: { 'Prefix ': '' }, wrapEvents: true, maxTitleLength: 7
  });
  const title = wrapped.elements.find(node => node.className === 'title bright');
  assert.equal(lines(title), 'A & B\n<em>longword</em>');
  assert.equal(title.children.filter(node => node.tag === 'br').length, 1);

  const truncated = render({ title: '  Meeting & coffee  ' }, { maxTitleLength: 7 });
  assert.equal(lines(truncated.elements.find(node => node.className === 'title bright')), 'Meeting…');
});

function timestamp(value) {
  return moment(value).format('x');
}

function eventDays(elements) {
  return elements.filter(node => node.className === 'normal col').map(column =>
    column.children.filter(row => row.className === 'normal').flatMap(row => row.children.filter(node => node.className === 'title bright').map(lines))
  );
}

test('labels the next calendar day as tomorrow after either DST change', () => {
  for (const [now, next] of [
    ['2026-03-29T00:00:00', '2026-03-30T00:30:00'],
    ['2026-10-25T00:00:00', '2026-10-26T00:00:00']
  ]) {
    const { htmlWrites } = render({
      title: 'Next day', fullDayEvent: true, startDate: timestamp(next),
      endDate: moment(next).add(1, 'day').format('x')
    }, { timeFormat: 'absolute', maximumNumberOfDays: 2 }, now);
    assert(htmlWrites.includes('Tomorrow'));
    assert(!htmlWrites.includes('Today'));
  }
});

test('places an ongoing all-day event through its last occupied day across DST', () => {
  const { elements } = render({
    title: 'Trip', fullDayEvent: true, startDate: timestamp('2026-10-24T00:00:00'),
    endDate: timestamp('2026-10-27T00:00:00')
  }, { maximumNumberOfDays: 3, showEndDate: true }, '2026-10-25T12:00:00');
  assert.deepEqual(eventDays(elements), [['Trip'], ['Trip'], []]);
  assert(!elements.some(node => node.className === 'time light'));
});

test('shows only the actual start and end on their respective days', () => {
  const fields = {
    title: 'Overnight', startDate: timestamp('2026-11-09T23:30:00'),
    endDate: timestamp('2026-11-11T02:15:00')
  };
  for (const showEndDate of [true, false]) {
    const { elements } = render(fields, { maximumNumberOfDays: 3, showEndDate });
    assert.deepEqual(eventDays(elements), [['Overnight'], ['Overnight'], ['Overnight']]);
    const timesByDay = elements.filter(node => node.className === 'normal col').map(column =>
      column.children.flatMap(row => row.children.filter(node => node.className === 'time light')
        .map(node => node.textContent + lines(node)))
    );
    assert.deepEqual(timesByDay, [['23:30'], [], showEndDate ? ['02:15'] : []]);
  }
});

test('keeps midnight endings off the next day and displays zero-duration events', () => {
  const midnight = render({
    title: 'Ends at midnight', startDate: timestamp('2026-11-09T23:00:00'),
    endDate: timestamp('2026-11-10T00:00:00')
  }, { maximumNumberOfDays: 2, showEndDate: true });
  assert.deepEqual(eventDays(midnight.elements), [['Ends at midnight'], []]);
  const time = midnight.elements.find(node => node.className === 'time light');
  assert.equal(time.textContent + lines(time), '23:00\n00:00');

  const point = render({
    title: 'Reminder', startDate: timestamp('2026-11-10T00:00:00'),
    endDate: timestamp('2026-11-10T00:00:00')
  }, { maximumNumberOfDays: 2 });
  assert.deepEqual(eventDays(point.elements), [[], ['Reminder']]);
});
