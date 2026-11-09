module.exports = function httpUrl(value, base) {
  let url;
  try {
    url = new URL(value, base);
  } catch {
    throw new Error('Invalid calendar URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Calendar URL must use HTTP or HTTPS');
  }
  return url;
};
