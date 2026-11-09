const moment = require('moment');
const { occurrenceKey } = require('./vendor/ical.js/ical');

// Query far enough back to find ongoing events, then enforce the half-open
// display window using the actual start and end of each occurrence.
module.exports = function expandOccurrences(event, start, end, windowStart, windowEnd) {
  const dateOnly = event.start.dateOnly === true;
  const duration = dateOnly ? Math.max(1, end.diff(start, 'days')) : end.diff(start);
  const unit = dateOnly ? 'days' : 'milliseconds';
  const earliest = moment(windowStart).subtract(duration, unit).toDate();
  const overrides = event.recurrences || {};
  const exclusions = event.exdate || {};
  const occurrences = [];

  for (const date of event.rrule.between(earliest, windowEnd, true)) {
    const key = occurrenceKey(date, dateOnly);
    if (overrides[key] || exclusions[key]) continue;
    const from = moment(date);
    occurrences.push({ event, start: from, end: from.clone().add(duration, unit) });
  }

  // An override's actual dates can overlap the window even if its original
  // RECURRENCE-ID falls outside it.
  for (const override of Object.values(overrides)) {
    const from = moment(override.start);
    const to = override.end ? moment(override.end) : from.clone().add(moment.duration(override.duration || 0));
    if (override.start.dateOnly && to.diff(from, 'days') < 1) {
      occurrences.push({ event: override, start: from, end: from.clone().add(1, 'day') });
    } else {
      occurrences.push({ event: override, start: from, end: to });
    }
  }

  return occurrences.filter(({ start, end }) => {
    // A zero-duration reminder belongs to the window containing its start.
    if (start.isSame(end)) return start >= windowStart && start < windowEnd;
    return start < windowEnd && end > windowStart;
  });
};
