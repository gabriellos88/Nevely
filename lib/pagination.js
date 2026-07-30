const DEFAULT_PAGE_SIZE = 30;
const MAX_PAGE_SIZE = 100;

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

function messagePage(rows, limit) {
  const hasMore = rows.length > limit;
  const newestFirst = hasMore ? rows.slice(0, limit) : rows;
  const items = [...newestFirst].reverse();
  return {
    items,
    page: {
      limit,
      hasMore,
      nextBeforeMessageId: hasMore ? Number(items[0].id) : null
    }
  };
}

module.exports = {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  cursorPage,
  decodeCursor,
  encodeCursor,
  messagePage,
  pageSize
};
