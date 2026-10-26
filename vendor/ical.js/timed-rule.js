// Expand wall-clock recurrences without letting the host timezone change their
// weekday. Convert actual instants only at the boundary of the recurrence engine.
var moment = require('moment-timezone');
var rrulestr = require('rrule').rrulestr;

module.exports = function (text, start) {
  var value = start.icalValue;
  if (/Z$/.test(value)) {
    return rrulestr(text + '\nDTSTART:' + value);
  }
  var zone = start.tz;
  if (zone && !moment.tz.zone(zone)) throw new Error('Unsupported timezone: ' + zone);
  function wall(date) {
    return zone ? moment(date).tz(zone) : moment(date);
  }
  function toCalendar(date) {
    var d = wall(date);
    return new Date(Date.UTC(d.year(), d.month(), d.date(), d.hour(), d.minute(), d.second(), d.millisecond()));
  }
  function fromCalendar(date) {
    var fields = [date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(),
      date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds(), date.getUTCMilliseconds()];
    return (zone ? moment.tz(fields, zone) : moment(fields)).toDate();
  }
  // RFC UNTIL expressed in UTC is an instant; compare its corresponding wall
  // time in the same calendar coordinates used for DTSTART and query bounds.
  text = text.replace(/UNTIL=(\d{8}T\d{6}Z)/, function (_, until) {
    var coordinate = toCalendar(moment.utc(until, 'YYYYMMDDTHHmmss[Z]').toDate());
    return 'UNTIL=' + coordinate.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  });
  var rule = rrulestr(text + '\nDTSTART:' + value + 'Z');
  return {
    between: function (after, before, inclusive, iterator) {
      return rule.between(toCalendar(after), toCalendar(before), inclusive,
        iterator ? function (date, index) { return iterator(fromCalendar(date), index); } : undefined
      ).map(fromCalendar);
    }
  };
};
