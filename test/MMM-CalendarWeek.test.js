const assert = require('assert');
const moment = require('moment');

// Mock the Module global and registration
global.Module = { register: function(name, definition) { global.MMM_CalendarWeek = definition; } };

// Import the module file (this will set global.MMM_CalendarWeek)
require('../MMM-CalendarWeek.js');

describe('MMM-CalendarWeek createEventList', function () {
  let instance;

  beforeEach(function () {
    // Create a new instance of the module definition
    instance = Object.assign({}, global.MMM_CalendarWeek);
    instance.config = { hidePrivate: false, hideOngoing: false, allowDuplicate: true, maximumEntries: 10 };
    instance.calendarData = {};
  });

  it('should not include events that have already ended', function () {
    const now = Date.now();
    instance.calendarData = {
      'test': [
        {
          title: 'Past Event',
          startDate: now - 2 * 60 * 60 * 1000, // 2 hours ago
          endDate: now - 1 * 60 * 60 * 1000,   // 1 hour ago
        },
        {
          title: 'Current Event',
          startDate: now - 30 * 60 * 1000,     // 30 min ago
          endDate: now + 30 * 60 * 1000,       // 30 min from now
        },
        {
          title: 'Future Event',
          startDate: now + 1 * 60 * 60 * 1000, // 1 hour from now
          endDate: now + 2 * 60 * 60 * 1000,   // 2 hours from now
        }
      ]
    };

    const events = instance.createEventList();
    const titles = events.map(e => e.title);

    assert(!titles.includes('Past Event'), 'Past events should not be included');
    assert(titles.includes('Current Event'), 'Current events should be included');
    assert(titles.includes('Future Event'), 'Future events should be included');
  });
});