const crypto = require('crypto');

const PRINCIPALS = Object.freeze({
  user: Object.freeze({ prefix: 'nvy_', table: 'users', hexLength: 12 }),
  guest: Object.freeze({ prefix: 'gst_', table: 'guest_principals', hexLength: 12 }),
  friendRequest: Object.freeze({ prefix: 'frq_', table: 'friend_requests', hexLength: 24 }),
  notification: Object.freeze({ prefix: 'ntf_', table: 'notifications', hexLength: 24 }),
  chatRequest: Object.freeze({ prefix: 'crq_', table: 'chat_requests', hexLength: 24 }),
  conversation: Object.freeze({ prefix: 'cnv_', table: 'conversations', hexLength: 24 }),
  message: Object.freeze({ prefix: 'msg_', table: 'messages', hexLength: 24 })
});

function principal(kind) {
  const value = PRINCIPALS[kind];
  if (!value) throw new Error(`Unknown public identifier principal: ${kind}`);
  return value;
}

function publicIdPattern(kind) {
  const { prefix, hexLength } = principal(kind);
  return new RegExp(`^${prefix}[0-9a-f]{${hexLength}}$`);
}

function createPublicId(kind) {
  const { prefix, hexLength } = principal(kind);
  return `${prefix}${crypto.randomBytes(hexLength / 2).toString('hex')}`;
}

function isPublicId(value, kind) {
  return typeof value === 'string' && publicIdPattern(kind).test(value);
}

function cleanPublicId(value) {
  return typeof value === 'string' ? value.trim().slice(0, 40) : '';
}

async function nextAvailablePublicId(executor, kind, { generate = createPublicId, attempts = 20 } = {}) {
  const { table } = principal(kind);
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const candidate = generate(kind);
    if (!isPublicId(candidate, kind)) throw new Error('Public identifier generator returned an invalid value.');
    const existing = await executor.query(`SELECT 1 FROM ${table} WHERE public_id = $1 LIMIT 1`, [candidate]);
    if (!existing.rowCount) return candidate;
  }
  const error = new Error('Unable to allocate a unique public identifier.');
  error.code = 'PUBLIC_ID_COLLISION';
  throw error;
}

async function insertWithUniquePublicId(executor, kind, insert, { attempts = 20, generate = createPublicId } = {}) {
  const { table } = principal(kind);
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const publicId = await nextAvailablePublicId(executor, kind, { generate, attempts });
    try {
      return await insert(publicId);
    } catch (error) {
      // The preflight avoids ordinary collisions; this handles the only race
      // that remains, with the database unique index as final authority.
      if (error?.code === '23505' && error?.constraint === `${table}_public_id_unique`) continue;
      throw error;
    }
  }
  const error = new Error('Unable to persist a unique public identifier.');
  error.code = 'PUBLIC_ID_COLLISION';
  throw error;
}

module.exports = {
  HEX_LENGTH: 12,
  PRINCIPALS,
  cleanPublicId,
  createPublicId,
  isPublicId,
  insertWithUniquePublicId,
  nextAvailablePublicId,
  publicIdPattern
};
