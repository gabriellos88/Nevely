const DEFAULT_PAGE_SIZE = 30;
const MAX_PAGE_SIZE = 100;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const { isPublicId } = require('./public-identifiers');

function pageSize(value, fallback = DEFAULT_PAGE_SIZE) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, MAX_PAGE_SIZE);
}

function encodeCursor(row, timestampField = 'created_at') {
  if (!row) return null;
  const timestamp = new Date(row[timestampField]);
  const id = Number(row.id);
  if (!Number.isSafeInteger(id) || id < 1 || Number.isNaN(timestamp.getTime())) return null;
  return Buffer.from(JSON.stringify({
    version: 1,
    createdAt: timestamp.toISOString(),
    id
  }), 'utf8').toString('base64url');
}

function decodeCursor(value) {
  if (!value || typeof value !== 'string' || value.length > 256) return null;
  try {
    const decoded = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    const timestamp = new Date(decoded.createdAt);
    const id = Number(decoded.id);
    if (decoded.version !== 1
        || !Number.isSafeInteger(id)
        || id < 1
        || Number.isNaN(timestamp.getTime())) {
      return null;
    }
    return { createdAt: timestamp.toISOString(), id };
  } catch {
    return null;
  }
}

function encodeUuidCursor(row, timestampField = 'created_at') {
  if (!row) return null;
  const timestamp = new Date(row[timestampField]);
  const id = typeof row.id === 'string' ? row.id.toLowerCase() : '';
  if (!UUID_PATTERN.test(id) || Number.isNaN(timestamp.getTime())) return null;
  return Buffer.from(JSON.stringify({
    version: 2,
    createdAt: timestamp.toISOString(),
    id
  }), 'utf8').toString('base64url');
}

function decodeUuidCursor(value) {
  if (!value || typeof value !== 'string' || value.length > 256) return null;
  try {
    const decoded = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    const timestamp = new Date(decoded.createdAt);
    const id = typeof decoded.id === 'string' ? decoded.id.toLowerCase() : '';
    if (decoded.version !== 2
        || !UUID_PATTERN.test(id)
        || Number.isNaN(timestamp.getTime())) {
      return null;
    }
    return { createdAt: timestamp.toISOString(), id };
  } catch {
    return null;
  }
}

function cursorPage(rows, limit, timestampField = 'created_at') {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  return {
    items,
    page: {
      limit,
      hasMore,
      nextCursor: hasMore ? encodeCursor(items.at(-1), timestampField) : null
    }
  };
}

function uuidCursorPage(rows, limit, timestampField = 'created_at') {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  return {
    items,
    page: {
      limit,
      hasMore,
      nextCursor: hasMore ? encodeUuidCursor(items.at(-1), timestampField) : null
    }
  };
}

function encodePublicIdCursor(row, kind, timestampField = 'created_at') {
  if (!row) return null;
  const timestamp = new Date(row[timestampField]);
  const publicId = row.public_id || row.publicId;
  if (!isPublicId(publicId, kind) || Number.isNaN(timestamp.getTime())) return null;
  return Buffer.from(JSON.stringify({ version: 3, createdAt: timestamp.toISOString(), publicId }), 'utf8').toString('base64url');
}

function decodePublicIdCursor(value, kind) {
  if (!value || typeof value !== 'string' || value.length > 256) return null;
  try {
    const decoded = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    const timestamp = new Date(decoded.createdAt);
    if (decoded.version !== 3 || !isPublicId(decoded.publicId, kind) || Number.isNaN(timestamp.getTime())) return null;
    return { createdAt: timestamp.toISOString(), publicId: decoded.publicId };
  } catch {
    return null;
  }
}

function publicIdCursorPage(rows, limit, kind, timestampField = 'created_at') {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  return {
    items,
    page: {
      limit,
      hasMore,
      nextCursor: hasMore ? encodePublicIdCursor(items.at(-1), kind, timestampField) : null
    }
  };
}

function messagePage(rows, limit) {
  const hasMore = rows.length > limit;
  const newestFirst = hasMore ? rows.slice(0, limit) : rows;
  const items = [...newestFirst].reverse();
  return {
    items,
    page: {
      limit,
      hasMore,
      nextBeforeMessageId: hasMore && isPublicId(items[0]?.public_id || items[0]?.id, 'message')
        ? (items[0].public_id || items[0].id)
        : null
    }
  };
}

module.exports = {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  cursorPage,
  decodeCursor,
  decodePublicIdCursor,
  decodeUuidCursor,
  encodeCursor,
  encodePublicIdCursor,
  encodeUuidCursor,
  messagePage,
  pageSize,
  publicIdCursorPage,
  uuidCursorPage
};
