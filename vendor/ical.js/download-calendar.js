const { setTimeout: delay } = require('node:timers/promises');
const digestAuthorization = require('./digest-auth');
const httpUrl = require('./http-url');

const retryableStatuses = new Set([408, 429, 500, 502, 503, 504]);
const redirectStatuses = new Set([301, 302, 303, 307, 308]);
const maxRetryDelay = 2000;

async function request(url, headers, auth, signal) {
  for (let redirects = 0; ; redirects++) {
    const options = { headers, signal, redirect: 'manual' };
    let response = await fetch(url, options);
    if (response.status === 401 && auth) {
      let authorization;
      try {
        authorization = digestAuthorization(response.headers.get('www-authenticate'), url, auth);
      } catch (error) {
        await response.body?.cancel();
        throw error;
      }
      if (authorization) {
        await response.body?.cancel();
        headers.set('Authorization', authorization);
        response = await fetch(url, options);
        headers.delete('Authorization');
      }
    }

    const location = response.headers.get('location');
    if (!redirectStatuses.has(response.status) || !location) return response;
    await response.body?.cancel();
    if (redirects >= 5) throw new Error('Calendar exceeded the HTTP redirect limit');
    const next = httpUrl(location, url);
    if (next.username || next.password) throw new Error('Calendar redirect contains credentials');
    if (next.origin !== url.origin) {
      headers.delete('Authorization');
      auth = null;
    }
    url = next;
  }
}

function retryDelay(response) {
  const header = response.headers.get('retry-after');
  if (!header) return 250;
  const ms = /^\d+$/.test(header) ? Number(header) * 1000 : Date.parse(header) - Date.now();
  return Number.isFinite(ms) ? Math.max(ms, 0) : 250;
}

module.exports = async function downloadCalendar(value, options = {}) {
  const url = httpUrl(value);
  const headers = new Headers(options.headers);
  const auth = options.auth || (url.username || url.password ? {
    user: decodeURIComponent(url.username), pass: decodeURIComponent(url.password)
  } : null);
  url.username = '';
  url.password = '';
  if (auth && auth.bearer !== undefined) {
    headers.set('Authorization', 'Bearer ' + auth.bearer);
  } else if (auth && auth.sendImmediately !== false) {
    headers.set('Authorization', 'Basic ' + Buffer.from(auth.user + ':' + auth.pass).toString('base64'));
  }
  const digest = auth && auth.sendImmediately === false ? auth : null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const signal = AbortSignal.timeout(options.timeout ?? 10000);
    let wait;
    try {
      const response = await request(url, new Headers(headers), digest, signal);
      if (response.ok) return await response.text();
      await response.body?.cancel();
      wait = retryDelay(response);
      if (attempt > 0 || !retryableStatuses.has(response.status) || wait > maxRetryDelay) {
        throw new Error('Calendar server returned HTTP ' + response.status);
      }
    } catch (error) {
      if (!signal.aborted && !(error instanceof TypeError)) throw error;
      if (attempt > 0) {
        throw new Error(signal.aborted ? 'Calendar download timed out' : 'Calendar download failed due to a network error', { cause: error });
      }
      wait = 250;
    }
    await delay(wait);
  }
};
