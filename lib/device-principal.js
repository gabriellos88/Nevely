const crypto = require('crypto');

const COOKIE_NAME = 'nevely.device';
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,128}\.[A-Za-z0-9_-]{32,128}$/;

function cookieValue(header, name) {
  const prefix = `${name}=`;
  return String(header || '').split(';').map((part) => part.trim())
    .find((part) => part.startsWith(prefix))?.slice(prefix.length) || '';
}

function secretFor(environment = process.env) {
  return environment.DEVICE_PRINCIPAL_HMAC_KEY || environment.SESSION_SECRET || 'local-device-principal-only';
}

function sign(value, environment) {
  return crypto.createHmac('sha256', secretFor(environment)).update(value).digest('base64url');
}

function fingerprint(value, environment) {
  return crypto.createHmac('sha256', secretFor(environment)).update(`device:${value}`).digest('hex');
}

function verifiedDeviceToken(req, environment) {
  const token = cookieValue(req.headers?.cookie, COOKIE_NAME);
  if (!TOKEN_PATTERN.test(token)) return null;
  const [value, signature] = token.split('.');
  const expected = sign(value, environment);
  const left = Buffer.from(signature);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) return null;
  return value;
}

function devicePrincipal(req, res, environment = process.env) {
  let value = verifiedDeviceToken(req, environment);
  if (!value) {
    value = crypto.randomBytes(32).toString('base64url');
    res?.cookie?.(COOKIE_NAME, `${value}.${sign(value, environment)}`, {
      httpOnly: true,
      sameSite: 'lax',
      secure: environment.NODE_ENV === 'production',
      maxAge: 365 * 24 * 60 * 60 * 1000
    });
  }
  return fingerprint(value, environment);
}

module.exports = { COOKIE_NAME, devicePrincipal, verifiedDeviceToken };
