const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const { createHash } = require('node:crypto');
const { promisify } = require('node:util');
const { gzipSync } = require('node:zlib');
const ical = require('../vendor/ical.js');
const load = promisify(ical.fromURL);
const calendar = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:fixture\r\nDTSTART:20261109T120000Z\r\nSUMMARY:Fixture\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n';

async function serve(t, handler) {
  const server = createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => {
    server.closeAllConnections();
    return new Promise(resolve => server.close(resolve));
  });
  return 'http://127.0.0.1:' + server.address().port;
}

test('downloads compressed feeds using Basic and Bearer credentials', async t => {
  const seen = [];
  const url = await serve(t, (req, res) => {
    seen.push(req.headers.authorization);
    res.writeHead(200, { 'Content-Encoding': 'gzip' });
    res.end(gzipSync(calendar));
  });
  assert.equal((await load(url, { auth: { user: 'user', pass: 'pass' } })).fixture.summary, 'Fixture');
  await load(url, { auth: { bearer: 'fixture-token' } });
  assert.deepEqual(seen, ['Basic dXNlcjpwYXNz', 'Bearer fixture-token']);
});

for (const algorithm of ['MD5', 'MD5-sess', 'SHA-256']) {
  test('answers a ' + algorithm + ' Digest challenge with a valid response', async t => {
    const seen = [];
    const url = await serve(t, (req, res) => {
      seen.push(req.headers.authorization);
      if (!req.headers.authorization) {
        res.writeHead(401, { 'WWW-Authenticate': 'Digest realm="Fixture realm", nonce="sample", algorithm=' + algorithm + ', qop="auth,auth-int"' });
        return res.end();
      }
      const fields = Object.fromEntries(Array.from(req.headers.authorization.matchAll(/(\w+)=(?:"([^"]*)"|([^, ]+))/g), m => [m[1], m[2] ?? m[3]]));
      const hash = input => createHash(algorithm === 'SHA-256' ? 'sha256' : 'md5').update(input).digest('hex');
      let ha1 = hash('user:Fixture realm:pass');
      if (algorithm.endsWith('-sess')) ha1 = hash(ha1 + ':sample:' + fields.cnonce);
      const expected = hash([ha1, 'sample', fields.nc, fields.cnonce, 'auth', hash('GET:/feed?source=test')].join(':'));
      if (fields.response !== expected || fields.uri !== '/feed?source=test') res.statusCode = 401;
      res.end(calendar);
    });
    assert.equal((await load(url + '/feed?source=test', { auth: { user: 'user', pass: 'pass', sendImmediately: false } })).fixture.summary, 'Fixture');
    assert.equal(seen.length, 2);
    assert.equal(seen[0], undefined);
  });
}

test('keeps credentials on same-origin redirects and strips them across origins', async t => {
  const seen = [];
  const target = await serve(t, (req, res) => {
    seen.push(req.headers.authorization);
    res.end(calendar);
  });
  const origin = await serve(t, (req, res) => {
    seen.push(req.headers.authorization);
    res.writeHead(302, { Location: req.url === '/' ? '/redirect' : target });
    res.end();
  });
  await load(origin, { auth: { bearer: 'fixture-token' } });
  assert.deepEqual(seen, ['Bearer fixture-token', 'Bearer fixture-token', undefined]);
});

test('retries a transient response once and does not retry 401 or long Retry-After', async t => {
  const hits = {};
  const url = await serve(t, (req, res) => {
    hits[req.url] = (hits[req.url] || 0) + 1;
    if (req.url === '/auth') res.statusCode = 401;
    else if (req.url === '/busy') res.writeHead(429, { 'Retry-After': '60' });
    else if (hits[req.url] === 1) res.writeHead(503, { 'Retry-After': '0' });
    res.end(calendar);
  });
  await load(url + '/retry', {});
  await assert.rejects(load(url + '/auth', {}), /HTTP 401/);
  await assert.rejects(load(url + '/busy', {}), /HTTP 429/);
  assert.deepEqual(hits, { '/retry': 2, '/auth': 1, '/busy': 1 });
});

test('times out a stalled response body and caps attempts at two', async t => {
  let hits = 0;
  const url = await serve(t, (req, res) => {
    hits++;
    res.writeHead(200);
    res.write('BEGIN:VCALENDAR\r\n');
  });
  await assert.rejects(load(url, { timeout: 100 }), /timed out/);
  assert.equal(hits, 2);
});

test('rejects malformed feeds and catches parser exceptions', async t => {
  const url = await serve(t, (req, res) => {
    res.end(req.url === '/html' ? '<html>Login</html>' :
      calendar.replace('DTSTART:20261109T120000Z', 'DTSTART;TZID=Invalid/Zone:20261109T120000'));
  });
  await assert.rejects(load(url + '/html', {}), /not a complete iCalendar document/);
  await assert.rejects(load(url + '/parse', {}), /Unable to parse/);
});
