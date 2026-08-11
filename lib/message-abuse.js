const crypto = require('node:crypto');

const ZERO_WIDTH = /[\u200b-\u200d\ufeff\u2060]/gu;
const WHITESPACE = /\s+/gu;
const LINK = /(?:https?:\/\/|www\.)[^\s<>()]+|(?:^|[\s([{"'])(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}(?=[:/?#\s)\]}",'.!?]|$)/iu;

function normalizeMessageForComparison(value) {
  if (typeof value !== 'string') return '';
  return value.normalize('NFKC').toLocaleLowerCase('und')
    .replace(ZERO_WIDTH, '')
    .replace(WHITESPACE, ' ')
    .trim();
}

function hasRepeatedCharacterFlood(normalized) {
  let previous = '';
  let run = 0;
  for (const character of normalized) {
    if (character === ' ') { previous = ''; run = 0; continue; }
    run = character === previous ? run + 1 : 1;
    previous = character;
    if (run >= 12) return true;
  }
  return false;
}

function utcDay(now = new Date()) { return now.toISOString().slice(0, 10); }

function createMessageAbuseProtector({ rateLimiter, hmacSecret, now = () => new Date() } = {}) {
  // A shared deployment secret is required: a process-local random key breaks replica handoff.
  const secret = typeof hmacSecret === 'string' && hmacSecret.length >= 16 ? hmacSecret : null;
  function bucket(principalType, principalId, signal, normalized) {
    return crypto.createHmac('sha256', secret)
      .update(`n5.2-message-signal\0${utcDay(now())}\0${principalType}\0${principalId}\0${signal}\0${normalized}`)
      .digest('hex');
  }
  async function consume({ principalType, principalId, text }) {
    const normalized = normalizeMessageForComparison(text);
    if (!secret || !normalized) return { allowed: true, retryAfterSeconds: 0 };
    const containsLink = LINK.test(normalized);
    const signals = [
      { action: 'message-duplicate', key: normalized },
      ...(containsLink ? [{ action: 'message-link-flood', key: '' }] : []),
      ...(hasRepeatedCharacterFlood(normalized) ? [{ action: 'message-repeated-character-flood', key: '' }] : [])
    ];
    for (const signal of signals) {
      const result = await rateLimiter.consume({ principalType: 'signal', principalId: bucket(principalType, principalId, signal.action, signal.key), action: signal.action });
      if (!result.allowed) return { allowed: false, retryAfterSeconds: result.retryAfterSeconds };
    }
    return { allowed: true, retryAfterSeconds: 0 };
  }
  return { consume, enabled: Boolean(secret) };
}

module.exports = { createMessageAbuseProtector, hasRepeatedCharacterFlood, normalizeMessageForComparison };
