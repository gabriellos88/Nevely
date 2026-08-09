const CHANNEL = 'nevely_moderation_control';
const ALLOWED_EVENTS = new Set(['account-banned', 'auth-required', 'guest-restricted', 'network-restricted']);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NETWORK_FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/;

function validControlMessage(value) {
  if (!value || !ALLOWED_EVENTS.has(value.event)) return null;
  if (value.version === 1 && Number.isSafeInteger(Number(value.userId)) && Number(value.userId) > 0) {
    return { principalType: 'user', userId: Number(value.userId), event: value.event };
  }
  if (value.version === 2 && value.principalType === 'guest' && UUID_PATTERN.test(String(value.guestId || ''))
      && value.event === 'guest-restricted') {
    return { principalType: 'guest', guestId: String(value.guestId).toLowerCase(), event: value.event };
  }
  if (value.version === 3 && value.principalType === 'network'
      && value.event === 'network-restricted'
      && NETWORK_FINGERPRINT_PATTERN.test(String(value.networkFingerprint || ''))
      && [4, 6].includes(Number(value.addressFamily))
      && Number.isInteger(Number(value.prefixLength))
      && ((Number(value.addressFamily) === 4 && Number(value.prefixLength) >= 24 && Number(value.prefixLength) <= 32)
        || (Number(value.addressFamily) === 6 && Number(value.prefixLength) >= 64 && Number(value.prefixLength) <= 128))) {
    return {
      principalType: 'network',
      networkFingerprint: String(value.networkFingerprint),
      addressFamily: Number(value.addressFamily),
      prefixLength: Number(value.prefixLength),
      event: value.event
    };
  }
  return null;
}

function createModerationControlChannel({ db, chat, log = { error() {} } } = {}) {
  let listener = null;
  let started = false;

  async function apply(message) {
    const control = validControlMessage(message);
    if (!control) return;
    if (control.principalType === 'user' && chat?.terminateUser) {
      await chat.terminateUser(control.userId, {}, control.event);
    }
    if (control.principalType === 'guest' && chat?.terminateGuest) {
      await chat.terminateGuest(control.guestId, {}, control.event);
    }
    if (control.principalType === 'network' && chat?.terminateNetwork) {
      await chat.terminateNetwork(control);
    }
  }

  async function start() {
    if (started) return true;
    if (!db?.isConfigured || !db.pool?.connect) return false;
    listener = await db.pool.connect();
    listener.on('notification', (notification) => {
      if (notification.channel !== CHANNEL) return;
      let message;
      try {
        message = JSON.parse(notification.payload || '');
      } catch {
        return;
      }
      void apply(message).catch((error) => log.error('moderation.control_apply_failed', error));
    });
    listener.on('error', (error) => log.error('moderation.control_listener_failed', error));
    await listener.query(`LISTEN ${CHANNEL}`);
    started = true;
    return true;
  }

  async function publishUserTermination(userId, event) {
    const message = validControlMessage({ version: 1, userId, event });
    if (!message || !db?.isConfigured) return false;
    await db.query('SELECT pg_notify($1, $2)', [CHANNEL, JSON.stringify({ version: 1, userId: message.userId, event: message.event })]);
    return true;
  }

  async function publishGuestTermination(guestId) {
    const message = validControlMessage({ version: 2, principalType: 'guest', guestId, event: 'guest-restricted' });
    if (!message || !db?.isConfigured) return false;
    await db.query('SELECT pg_notify($1, $2)', [CHANNEL, JSON.stringify({ version: 2, principalType: 'guest', guestId: message.guestId, event: message.event })]);
    return true;
  }

  async function publishNetworkTermination(network) {
    const message = validControlMessage({
      version: 3,
      principalType: 'network',
      event: 'network-restricted',
      networkFingerprint: network?.networkFingerprint,
      addressFamily: network?.addressFamily,
      prefixLength: network?.prefixLength
    });
    if (!message || !db?.isConfigured) return false;
    await db.query('SELECT pg_notify($1, $2)', [CHANNEL, JSON.stringify({ version: 3, ...message })]);
    return true;
  }

  async function stop() {
    if (!listener) return;
    listener.removeAllListeners('notification');
    listener.removeAllListeners('error');
    await listener.query(`UNLISTEN ${CHANNEL}`).catch(() => {});
    listener.release();
    listener = null;
    started = false;
  }

  return { start, stop, apply, publishUserTermination, publishGuestTermination, publishNetworkTermination };
}

module.exports = { CHANNEL, createModerationControlChannel, validControlMessage };
