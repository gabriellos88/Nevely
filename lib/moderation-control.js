const CHANNEL = 'nevely_moderation_control';
const ALLOWED_EVENTS = new Set(['account-banned', 'auth-required']);

function validControlMessage(value) {
  if (!value || value.version !== 1 || !Number.isSafeInteger(Number(value.userId)) || Number(value.userId) < 1) return null;
  if (!ALLOWED_EVENTS.has(value.event)) return null;
  return { userId: Number(value.userId), event: value.event };
}

function createModerationControlChannel({ db, chat, log = { error() {} } } = {}) {
  let listener = null;
  let started = false;

  async function payloadForUser(userId, event) {
    if (event !== 'account-banned') return {};
    const ban = await db.query(
      `SELECT type, reason, ends_at
       FROM account_bans
       WHERE user_id = $1 AND revoked_at IS NULL AND starts_at <= NOW()
         AND (type = 'permanent' OR ends_at > NOW())
       ORDER BY created_at DESC, id DESC LIMIT 1`,
      [userId]
    );
    if (!ban.rowCount) return { type: 'account-removed' };
    return { type: ban.rows[0].type, reason: ban.rows[0].reason, endsAt: ban.rows[0].ends_at };
  }

  async function apply(message) {
    const control = validControlMessage(message);
    if (!control || !chat?.terminateUser) return;
    const payload = await payloadForUser(control.userId, control.event);
    await chat.terminateUser(control.userId, payload, control.event);
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
    await db.query('SELECT pg_notify($1, $2)', [CHANNEL, JSON.stringify({ version: 1, ...message })]);
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

  return { start, stop, apply, publishUserTermination };
}

module.exports = { CHANNEL, createModerationControlChannel, validControlMessage };
