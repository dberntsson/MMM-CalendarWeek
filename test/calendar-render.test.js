const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const moment = require('moment');

const source = readFileSync(require.resolve('../MMM-CalendarWeek.js'), 'utf8');

function render(fields, options = {}) {
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
  const now = moment('2026-11-09T09:00:00');
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
  calendar.createEventList = () => [{
    startDate: now.clone().hour(10).format('x'),
    endDate: now.clone().hour(11).format('x'),
    ...fields
  }];
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
