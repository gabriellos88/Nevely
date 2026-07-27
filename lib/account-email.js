const crypto = require('crypto');

const PURPOSES = {
  verify_email: {
    expiresMs: 24 * 60 * 60 * 1000,
    path: '/verify-email',
    subject: 'Verify your Nevely email'
  },
  password_reset: {
    expiresMs: 60 * 60 * 1000,
    path: '/reset-password',
    subject: 'Reset your Nevely password'
  },
  email_change: {
    expiresMs: 60 * 60 * 1000,
    path: '/confirm-email-change',
    subject: 'Confirm your new Nevely email'
  }
};

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function hashMetadata(value, pepper) {
  if (!value) return null;
  return crypto.createHmac('sha256', String(pepper)).update(String(value)).digest('hex');
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

async function queueAccountEmail(executor, {
  userId,
  purpose,
  recipient,
  publicOrigin,
  sender,
  ip,
  userAgent,
  metadataPepper,
  revokePrevious = true
}) {
  const configuration = PURPOSES[purpose];
  if (!configuration) throw new Error('Unsupported account email purpose');
  if (revokePrevious) {
    await executor.query(
      `UPDATE account_tokens SET revoked_at = NOW()
       WHERE user_id = $1 AND purpose = $2 AND used_at IS NULL AND revoked_at IS NULL`,
      [userId, purpose]
    );
  }
  const rawToken = crypto.randomBytes(32).toString('base64url');
  const tokenHash = hashToken(rawToken);
  const token = await executor.query(
    `INSERT INTO account_tokens
       (user_id, purpose, token_hash, target_email, expires_at,
        requested_ip_hash, requested_user_agent_hash)
     VALUES ($1, $2, $3, $4, NOW() + ($5 * INTERVAL '1 millisecond'), $6, $7)
     RETURNING id`,
    [
      userId,
      purpose,
      tokenHash,
      recipient,
      configuration.expiresMs,
      hashMetadata(ip, metadataPepper),
      hashMetadata(userAgent, metadataPepper)
    ]
  );
  const link = new URL(configuration.path, publicOrigin);
  link.searchParams.set('token', rawToken);
  const safeLink = escapeHtml(link.toString());
  const textBody = `${configuration.subject}\n\nOpen this single-use link:\n${link}\n\nIf you did not request this, you can ignore it.`;
  const htmlBody = `<p>${escapeHtml(configuration.subject)}</p><p><a href="${safeLink}">Continue securely</a></p><p>If you did not request this, you can ignore it.</p>`;
  await executor.query(
    `INSERT INTO email_outbox
       (account_token_id, user_id, purpose, idempotency_key, recipient, sender,
        subject, text_body, html_body)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      token.rows[0].id,
      userId,
      purpose,
      `${purpose}:${token.rows[0].id}`,
      recipient,
      sender,
      configuration.subject,
      textBody,
      htmlBody
    ]
  );
  return { tokenId: token.rows[0].id };
}

async function queueAccountEmailTransaction(db, options) {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const result = await queueAccountEmail(client, options);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function consumeAccountToken(executor, purpose, rawToken, { lock = true } = {}) {
  const result = await executor.query(
    `SELECT * FROM account_tokens
     WHERE token_hash = $1 AND purpose = $2
     ${lock ? 'FOR UPDATE' : ''}`,
    [hashToken(rawToken), purpose]
  );
  const token = result.rows[0];
  if (!token) return { status: 'invalid' };
  await executor.query(
    'UPDATE account_tokens SET attempts = attempts + 1 WHERE id = $1',
    [token.id]
  );
  if (token.used_at) return { status: 'used', token };
  if (token.revoked_at) return { status: 'revoked', token };
  if (new Date(token.expires_at).getTime() <= Date.now()) return { status: 'expired', token };
  return { status: 'valid', token };
}

function createOutboxWorker({
  db,
  environment,
  log,
  fetchImpl = global.fetch,
  intervalMs = 5_000
}) {
  let timer = null;
  let running = null;
  let stopped = false;

  async function send(row) {
    const mode = environment.EMAIL_DELIVERY_MODE || 'disabled';
    if (mode === 'disabled') throw Object.assign(
      new Error('Email delivery is disabled'),
      { code: 'EMAIL_DISABLED' }
    );
    let recipient = row.recipient;
    if (mode === 'test') recipient = environment.RESEND_TEST_RECIPIENT;
    const response = await fetchImpl('https://api.resend.com/emails', {
      method: 'POST',
      signal: AbortSignal.timeout(10_000),
      headers: {
        Authorization: `Bearer ${environment.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': row.idempotency_key
      },
      body: JSON.stringify({
        from: row.sender,
        to: [recipient],
        subject: row.subject,
        text: row.text_body,
        html: row.html_body
      })
    });
    if (!response.ok) {
      const error = new Error('Resend delivery failed');
      error.code = `RESEND_${response.status}`;
      throw error;
    }
    return response.json();
  }

  async function drainOnce() {
    if (!db.isConfigured || stopped || (environment.EMAIL_DELIVERY_MODE || 'disabled') === 'disabled') {
      return 0;
    }
    const client = await db.getClient();
    let rows = [];
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE email_outbox
         SET status = 'failed', last_error_code = 'LEASE_EXPIRED'
         WHERE status = 'sending' AND next_attempt_at <= NOW()`
      );
      const selected = await client.query(
        `SELECT * FROM email_outbox
         WHERE status IN ('pending', 'failed') AND next_attempt_at <= NOW()
         ORDER BY created_at
         FOR UPDATE SKIP LOCKED
         LIMIT 10`
      );
      rows = selected.rows;
      if (rows.length) {
        await client.query(
          `UPDATE email_outbox
           SET status = 'sending', next_attempt_at = NOW() + INTERVAL '10 minutes'
           WHERE id = ANY($1::uuid[])`,
          [rows.map((row) => row.id)]
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    for (const row of rows) {
      try {
        await send(row);
        await db.query(
          `UPDATE email_outbox
           SET status = 'sent', attempts = attempts + 1, sent_at = NOW(),
               last_error_code = NULL
           WHERE id = $1`,
          [row.id]
        );
      } catch (error) {
        const attempts = Number(row.attempts) + 1;
        const retrySeconds = Math.min(60 * (2 ** Math.min(attempts, 6)), 3600);
        await db.query(
          `UPDATE email_outbox
           SET status = 'failed', attempts = attempts + 1,
               next_attempt_at = NOW() + ($2 * INTERVAL '1 second'),
               last_error_code = $3
           WHERE id = $1`,
          [row.id, retrySeconds, String(error.code || 'DELIVERY_FAILED').slice(0, 80)]
        );
        log.error('email.outbox_delivery_failed', error);
      }
    }
    return rows.length;
  }

  function schedule() {
    if (stopped) return;
    timer = setTimeout(() => {
      running = drainOnce()
        .catch((error) => log.error('email.outbox_worker_failed', error))
        .finally(() => {
          running = null;
          schedule();
        });
    }, intervalMs);
    timer.unref?.();
  }

  return {
    start() {
      if (!timer && !stopped) schedule();
    },
    drainOnce,
    async stop() {
      stopped = true;
      clearTimeout(timer);
      if (running) await running;
    }
  };
}

module.exports = {
  consumeAccountToken,
  createOutboxWorker,
  hashToken,
  queueAccountEmail,
  queueAccountEmailTransaction
};
