/* Magic Mirror
 * Node Helper: Calendar - CalendarFetcher
 *
 * By Michael Teeuw http://michaelteeuw.nl
 * MIT Licensed.
 */

var ical = require("./vendor/ical.js");
var moment = require("moment");
var expandOccurrences = require("./recurrence");

var CalendarFetcher = function(url, reloadInterval, excludedEvents, maximumEntries, maximumNumberOfDays, auth, includePastEvents) {
	var self = this;

	var reloadTimer = null;
	var fetching = false;
	var events = [];

	var fetchFailedCallback = function() {};
	var eventsReceivedCallback = function() {};

	/* fetchCalendar()
	 * Initiates calendar fetch.
	 */
	var fetchCalendar = function() {

		if (fetching) return;
		fetching = true;
		clearTimeout(reloadTimer);
		reloadTimer = null;

		var nodeVersion = Number(process.version.match(/^v(\d+\.\d+)/)[1]);
		var opts = {
			headers: {
				"User-Agent": "Mozilla/5.0 (Node.js "+ nodeVersion + ") MagicMirror/"  + global.version +  " (https://github.com/MichMich/MagicMirror/)"
			}
		};

		if (auth) {
			if(auth.method === "bearer"){
				opts.auth = {
					bearer: auth.pass
				};

			} else {
				opts.auth = {
					user: auth.user,
					pass: auth.pass
				};

				if(auth.method === "digest"){
					opts.auth.sendImmediately = false;
				} else {
					opts.auth.sendImmediately = true;
				}
			}
		}

		function handleResult(err, data) {
			let failure = err;
			try {
				if (!failure) {
					const result = processCalendar(data);
					events = result.events;
					self.broadcastEvents();
					if (result.skipped > 0) {
						failure = new Error("Skipped " + result.skipped + " invalid calendar event(s)");
					}
				}
			} catch (error) {
				failure = error;
			} finally {
				fetching = false;
				scheduleTimer();
			}
			if (failure) fetchFailedCallback(self, failure);
		}

		try {
			ical.fromURL(url, opts, handleResult);
		} catch (error) {
			if (!fetching) throw error;
			handleResult(error);
		}
	};

	function processCalendar(data) {
		const newEvents = [];
		let skipped = 0;

		var eventDate = function(event, time) {
			const value = event[time];
			if (value == null) return moment.invalid();
			return value.length === 8 ? moment(value, "YYYYMMDD", true) : moment(new Date(value));
		};

		const now = new Date();
		const dayStart = moment(now).startOf("day");
		const today = dayStart.toDate();
		const future = dayStart.clone().add(maximumNumberOfDays, "days").toDate();
		const past = includePastEvents ? dayStart.clone().subtract(maximumNumberOfDays, "days").toDate() : today;
		const hasEnded = (end, fullDayEvent) => {
			if (includePastEvents) return end < past;
			return fullDayEvent ? end <= today : end < now;
		};

		for (var e in data) {
			var event = data[e];
			if (!event || event.type !== "VEVENT") continue;
			const previousCount = newEvents.length;
			try {
				// Preserve the legacy single-occurrence behavior for Facebook birthdays.
				const isFacebookBirthday = typeof event.uid === "string" && event.uid.includes("@facebook.com");
				var startDate = eventDate(event, "start");
				if (!startDate.isValid()) throw new Error("Invalid DTSTART");
				var endDate;
				if (typeof event.end !== "undefined") {
					endDate = eventDate(event, "end");
				} else if(typeof event.duration !== "undefined") {
					const dur = moment.duration(event.duration);
					endDate = startDate.clone().add(dur);
				} else if (event.start.dateOnly || event.start.length === 8 || isFacebookBirthday) {
					endDate = startDate.clone().add(1, "day");
				} else {
					endDate = startDate;
				}
				if (!endDate.isValid() || endDate.isBefore(startDate)) throw new Error("Invalid event end");

				var title = getTitleFromEvent(event);

				var excluded = false,
					dateFilter = null;

				for (var f in excludedEvents) {
					var filter = excludedEvents[f],
						testTitle = title.toLowerCase(),
						until = null,
						useRegex = false,
						regexFlags = "g";

					if (filter instanceof Object) {
						if (typeof filter.until !== "undefined") {
							until = filter.until;
						}

						if (typeof filter.regex !== "undefined") {
							useRegex = filter.regex;
						}

						// If additional advanced filtering is added in, this section
						// must remain last as we overwrite the filter object with the
						// filterBy string
						if (filter.caseSensitive) {
							filter = filter.filterBy;
							testTitle = title;
						} else if (useRegex) {
							filter = filter.filterBy;
							testTitle = title;
							regexFlags += "i";
						} else {
							filter = filter.filterBy.toLowerCase();
						}
					} else {
						filter = filter.toLowerCase();
					}

					if (testTitleByFilter(testTitle, filter, useRegex, regexFlags)) {
						if (until) {
							dateFilter = until;
						} else {
							excluded = true;
						}
						break;
					}
				}

				if (excluded) {
					continue;
				}

				var location = event.location || false;
				var geo = event.geo || false;
				var description = event.description || false;

				if (typeof event.rrule !== "undefined" && event.rrule !== null && !isFacebookBirthday) {
					for (var occurrence of expandOccurrences(event, startDate, endDate, past, future)) {
						const fullDayEvent = isFullDayEvent(occurrence.event);
						if (hasEnded(occurrence.end, fullDayEvent) || timeFilterApplies(now, occurrence.end, dateFilter)) continue;
						newEvents.push({
							title: getTitleFromEvent(occurrence.event),
							startDate: occurrence.start.format("x"),
							endDate: occurrence.end.format("x"),
							fullDayEvent: fullDayEvent,
							class: event.class,
							firstYear: event.start.getFullYear(),
							location: location,
							geo: geo,
							description: description
						});
					}
				} else {
					// console.log("Single event ...");
					// Single event.
					var fullDayEvent = (isFacebookBirthday) ? true : isFullDayEvent(event);

					if (hasEnded(endDate, fullDayEvent)) continue;

					if (startDate >= future) {
						//console.log("It exceeds the maximumNumberOfDays limit. So skip: " + title);
						continue;
					}

					if (timeFilterApplies(now, endDate, dateFilter)) {
						continue;
					}

					// Every thing is good. Add it to the list.

					newEvents.push({
						title: title,
						startDate: startDate.format("x"),
						endDate: endDate.format("x"),
						fullDayEvent: fullDayEvent,
						class: event.class,
						location: location,
						geo: geo,
						description: description
					});

				}
			} catch {
				newEvents.length = previousCount;
				skipped++;
			}
		}

		newEvents.sort(function(a, b) {
			return a.startDate - b.startDate;
		});

		return { events: newEvents.slice(0, maximumEntries), skipped };
	}

	/* scheduleTimer()
	 * Schedule the timer for the next update.
	 */
	var scheduleTimer = function() {
		//console.log('Schedule update timer.');
		clearTimeout(reloadTimer);
		reloadTimer = setTimeout(function() {
			fetchCalendar();
		}, reloadInterval);
	};

	/* isFullDayEvent(event)
	 * Checks if an event is a fullday event.
	 *
	 * argument event object - The event object to check.
	 *
	 * return bool - The event is a fullday event.
	 */
	var isFullDayEvent = function(event) {
		if (event.start.dateOnly === true) {
			return true;
		}
		if (event.start.length === 8) {
			return true;
		}

		var start = event.start || 0;
		var startDate = new Date(start);
		var end = event.end || 0;
		if (end > start && ((end - start) % (24 * 60 * 60 * 1000)) === 0 && startDate.getHours() === 0 && startDate.getMinutes() === 0) {
			// Is 24 hours, and starts on the middle of the night.
			return true;
		}

		return false;
	};

	/* timeFilterApplies()
	 * Determines if the user defined time filter should apply
	 *
	 * argument now Date - Date object using previously created object for consistency
	 * argument endDate Moment - Moment object representing the event end date
	 * argument filter string - The time to subtract from the end date to determine if an event should be shown
	 *
	 * return bool - The event should be filtered out
	 */
	var timeFilterApplies = function(now, endDate, filter) {
		if (filter) {
			var until = filter.split(" "),
				value = parseInt(until[0]),
				increment = until[1].slice("-1") === "s" ? until[1] : until[1] + "s", // Massage the data for moment js
				filterUntil = moment(endDate.format()).subtract(value, increment);

			return now < filterUntil.format("x");
		}

		return false;
	};

	/* getTitleFromEvent(event)
	* Gets the title from the event.
	*
	* argument event object - The event object to check.
	*
	* return string - The title of the event, or "Event" if no title is found.
	*/
	var getTitleFromEvent = function (event) {
		var title = "Event";
		if (event.summary) {
			title = (typeof event.summary.val !== "undefined") ? event.summary.val : event.summary;
		} else if (event.description) {
			title = event.description;
		}

		return title;
	};

	var testTitleByFilter = function (title, filter, useRegex, regexFlags) {
		if (useRegex) {
			// Assume if leading slash, there is also trailing slash
			if (filter[0] === "/") {
				// Strip leading and trailing slashes
				filter = filter.substr(1).slice(0, -1);
			}

			filter = new RegExp(filter, regexFlags);

			return filter.test(title);
		} else {
			return title.includes(filter);
		}
	};

	/* public methods */

	/* startFetch()
	 * Initiate fetchCalendar();
	 */
	this.startFetch = function() {
		fetchCalendar();
	};

	/* broadcastItems()
	 * Broadcast the existing events.
	 */
	this.broadcastEvents = function() {
		//console.log('Broadcasting ' + events.length + ' events.');
		eventsReceivedCallback(self);
	};

	/* onReceive(callback)
	 * Sets the on success callback
	 *
	 * argument callback function - The on success callback.
	 */
	this.onReceive = function(callback) {
		eventsReceivedCallback = callback;
	};

	/* onError(callback)
	 * Sets the on error callback
	 *
	 * argument callback function - The on error callback.
	 */
	this.onError = function(callback) {
		fetchFailedCallback = callback;
	};

	/* url()
	 * Returns the url of this fetcher.
	 *
	 * return string - The url of this fetcher.
	 */
	this.url = function() {
		return url;
	};

	/* events()
	 * Returns current available events for this fetcher.
	 *
	 * return array - The current available events for this fetcher.
	 */
	this.events = function() {
		return events;
	};
};

module.exports = CalendarFetcher;
