/* Magic Mirror
 * Node Helper: Calendar
 *
 * By Michael Teeuw http://michaelteeuw.nl
 * MIT Licensed.
 */

var NodeHelper = require("node_helper");
var validUrl = require("valid-url");
var CalendarFetcher = require("./calendarfetcher.js");

// Use only settings consumed by CalendarFetcher. Filter order is significant.
function fetcherKey({ url, fetchInterval, excludedEvents, maximumEntries, maximumNumberOfDays, auth }) {
	const filters = (excludedEvents || []).map(filter => {
		if (!filter || typeof filter !== "object") return filter;
		return [filter.filterBy, filter.until, Boolean(filter.regex), Boolean(filter.caseSensitive)];
	});
	const credentials = !auth ? null : auth.method === "bearer"
		? ["bearer", auth.pass]
		: [auth.method === "digest" ? "digest" : "basic", auth.user, auth.pass];
	return JSON.stringify([url, fetchInterval, filters, maximumEntries, maximumNumberOfDays, credentials]);
}

module.exports = NodeHelper.create({
	start: function() {
		this.fetchers = new Map();
		console.log("Starting node helper for: " + this.name);
	},

	socketNotificationReceived: function(notification, payload) {
		if (notification === "ADD_CALENDAR") this.createFetcher(payload);
	},

	createFetcher: function(settings) {
		const { identifier, url, fetchInterval, excludedEvents, maximumEntries, maximumNumberOfDays, auth } = settings;
		if (!validUrl.isUri(url)) {
			this.sendSocketNotification("INCORRECT_URL", { identifier, url });
			return;
		}

		const key = fetcherKey(settings);
		const existing = this.fetchers.get(key);
		if (existing) {
			existing.subscribers.add(identifier);
			if (existing.events !== undefined) {
				this.sendSocketNotification("CALENDAR_EVENTS", { identifier, url, events: existing.events });
			}
			return;
		}

		const entry = { subscribers: new Set([identifier]), events: undefined };
		this.fetchers.set(key, entry);
		const fetcher = new CalendarFetcher(url, fetchInterval, excludedEvents, maximumEntries, maximumNumberOfDays, auth);

		fetcher.onReceive(sender => {
			entry.events = sender.events();
			for (const subscriber of entry.subscribers) {
				this.sendSocketNotification("CALENDAR_EVENTS", { identifier: subscriber, url, events: entry.events });
			}
		});
		fetcher.onError((sender, error) => {
			for (const subscriber of entry.subscribers) {
				this.sendSocketNotification("FETCH_ERROR", { identifier: subscriber, url, error: error.message });
			}
		});
		fetcher.startFetch();
	}
});
