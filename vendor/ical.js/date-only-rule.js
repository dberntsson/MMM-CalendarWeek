// Expand DATE-only recurrences in a timezone-independent calendar coordinate
// system. UTC fields represent calendar fields here, not instants in time.
var rrulestr = require('rrule').rrulestr;

function toCalendar(date) {
  return new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(),
    date.getHours(), date.getMinutes(), date.getSeconds(), date.getMilliseconds()));
}

function fromCalendar(date) {
  var local = new Date(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(),
    date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds(), date.getUTCMilliseconds());
  local.dateOnly = true;
  return local;
}

module.exports = function (text, start) {
  var stamp = toCalendar(start).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  var rule = rrulestr(text + '\nDTSTART:' + stamp);
  return {
    // The fetcher consumes local instants; keep recurrence arithmetic in calendar
    // coordinates, including query boundaries, and convert only at the edges.
    between: function (after, before, inclusive, iterator) {
      return rule.between(toCalendar(after), toCalendar(before), inclusive,
        iterator ? function (date, index) { return iterator(fromCalendar(date), index); } : undefined
      ).map(fromCalendar);
    }
  };
};
