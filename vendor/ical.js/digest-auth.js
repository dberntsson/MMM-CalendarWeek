const { createHash, randomBytes } = require('node:crypto');

const algorithms = {
  MD5: 'md5',
  'SHA-256': 'sha256',
  'SHA-512-256': 'sha512-256'
};

module.exports = function digestAuthorization(challenge, url, auth) {
  const digest = /(?:^|,\s*)Digest\s+(.+)/i.exec(challenge || '');
  if (!digest) return null;

  const fields = new Map();
  for (const [, name, quoted, token] of digest[1].matchAll(/([\w-]+)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^,\s]+))/g)) {
    fields.set(name.toLowerCase(), quoted === undefined ? token : quoted.replace(/\\(.)/g, '$1'));
  }

  const realm = fields.get('realm');
  const nonce = fields.get('nonce');
  const algorithm = (fields.get('algorithm') || 'MD5').toUpperCase();
  const hashName = algorithms[algorithm.replace(/-SESS$/, '')];
  const qop = fields.get('qop');
  if (realm === undefined || !nonce || !hashName ||
      (qop && !qop.split(',').some(value => value.trim().toLowerCase() === 'auth'))) {
    throw new Error('Unsupported HTTP Digest challenge');
  }

  const hash = value => createHash(hashName).update(value).digest('hex');
  const quote = value => '"' + String(value).replace(/["\\]/g, '\\$&') + '"';
  const uri = url.pathname + url.search;
  const cnonce = randomBytes(16).toString('hex');
  const nc = '00000001';
  const session = algorithm.endsWith('-SESS');
  let ha1 = hash(auth.user + ':' + realm + ':' + auth.pass);
  if (session) ha1 = hash([ha1, nonce, cnonce].join(':'));
  const ha2 = hash('GET:' + uri);
  const response = hash((qop ? [ha1, nonce, nc, cnonce, 'auth', ha2] : [ha1, nonce, ha2]).join(':'));
  const header = [
    'username=' + quote(auth.user), 'realm=' + quote(realm), 'nonce=' + quote(nonce),
    'uri=' + quote(uri), 'response=' + quote(response), 'algorithm=' + algorithm
  ];
  if (fields.has('opaque')) header.push('opaque=' + quote(fields.get('opaque')));
  if (qop) header.push('qop=auth', 'nc=' + nc);
  if (qop || session) header.push('cnonce=' + quote(cnonce));
  return 'Digest ' + header.join(', ');
};
