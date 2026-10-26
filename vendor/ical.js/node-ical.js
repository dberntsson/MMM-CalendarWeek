var ical = require('./ical')
  , request = require('request')
  , fs = require('fs')

exports.fromURL = function(url, opts, cb){
  if (!cb)
    return;
  request(url, opts, function(err, r, data){
    if (err)
      return cb(err, null);
    cb(undefined, ical.parseICS(data));
  })
}

exports.parseFile = function(filename){
  return ical.parseICS(fs.readFileSync(filename, 'utf8'))
}


var timedRule = require('./timed-rule');

ical.objectHandlers['RRULE'] = function(val, params, curr, stack, line){
  curr.rrule = line;
  return curr
}
var dateOnlyRule = require('./date-only-rule');
var originalEnd = ical.objectHandlers['END'];
ical.objectHandlers['END'] = function(val, params, curr, stack){
  if (curr.rrule && curr.start && curr.start.dateOnly) {
    try {
      curr.rrule = dateOnlyRule(curr.rrule, curr.start);
    } catch (err) {
      console.log('Unrecognised DATE-only recurrence in calendar feed, ignoring: ' + curr.rrule);
      curr.rrule = null;
    }
    return originalEnd.call(this, val, params, curr, stack);
  }
  if (curr.rrule) {
    try {
      curr.rrule = timedRule(curr.rrule, curr.start);
    } catch (err) {
      console.log('Unrecognised timed recurrence in calendar feed, ignoring: ' + curr.rrule);
      curr.rrule = null;
    }
  }
  return originalEnd.call(this, val, params, curr, stack);
}
