const crypto = require('crypto');

const GOOGLE_ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com']);
const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';

function decodeJson(value) {
  return JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
}

function createGoogleVerifier({ clientId, fetchImpl = global.fetch, now = () => Date.now() } = {}) {
  let cachedKeys = null;
  let cacheExpiresAt = 0;

  async function keys() {
    if (cachedKeys && cacheExpiresAt > now()) return cachedKeys;
    const response = await fetchImpl(GOOGLE_JWKS_URL, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(5_000)
    });
    if (!response.ok) throw new Error('Google signing keys are unavailable');
    const payload = await response.json();
    cachedKeys = new Map(payload.keys.map((key) => [key.kid, key]));
    const maxAge = /max-age=(\d+)/i.exec(response.headers.get('cache-control') || '');
    cacheExpiresAt = now() + Math.min(Number(maxAge?.[1] || 300), 3600) * 1000;
    return cachedKeys;
  }

  return async function verifyGoogleIdToken(rawToken, { nonce } = {}) {
    if (!clientId) throw new Error('Google authentication is not configured');
    const parts = String(rawToken || '').split('.');
    if (parts.length !== 3) throw new Error('Malformed Google credential');
    const [encodedHeader, encodedPayload, encodedSignature] = parts;
    const header = decodeJson(encodedHeader);
    const payload = decodeJson(encodedPayload);
    if (header.alg !== 'RS256' || !header.kid) throw new Error('Unsupported Google credential');
    const jwk = (await keys()).get(header.kid);
    if (!jwk) throw new Error('Unknown Google signing key');
    const validSignature = crypto.verify(
      'RSA-SHA256',
      Buffer.from(`${encodedHeader}.${encodedPayload}`),
      crypto.createPublicKey({ key: jwk, format: 'jwk' }),
      Buffer.from(encodedSignature, 'base64url')
    );
    const nowSeconds = Math.floor(now() / 1000);
    const audience = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!validSignature
      || !GOOGLE_ISSUERS.has(payload.iss)
      || !audience.includes(clientId)
      || Number(payload.exp) <= nowSeconds
      || Number(payload.iat) > nowSeconds + 60
      || payload.email_verified !== true
      || !payload.sub
      || !payload.email
      || !nonce
      || payload.nonce !== nonce) {
      throw new Error('Google credential validation failed');
    }
    return {
      subject: String(payload.sub),
      email: String(payload.email).toLowerCase(),
      name: String(payload.name || ''),
      picture: String(payload.picture || ''),
      expiresAt: new Date(Number(payload.exp) * 1000)
    };
  };
}

module.exports = { createGoogleVerifier };
