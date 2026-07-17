const crypto = require('crypto');
const { cleanText, requireAdmin, requireAuth, sessionUser } = require('./auth');

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function asId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function registerApiRoutes(app, db, presence) {
  const auth = [requireAuth];

  app.get('/api/account', ...auth, asyncRoute(async (req, res) => {
    const result = await db.query(
      `SELECT id, public_id, username, display_name, email, role, plan, age, gender,
              country, profile_image_url, created_at
       FROM users WHERE id = $1 AND deleted_at IS NULL`,
      [req.session.user.id]
    );
    res.json({ user: result.rows[0] });
  }));

  app.patch('/api/account', ...auth, asyncRoute(async (req, res) => {
    const displayName = cleanText(req.body.displayName, 40);
    const email = cleanText(req.body.email, 255).toLowerCase();
    const age = Number(req.body.age);
    const gender = cleanText(req.body.gender, 30) || null;
    const country = cleanText(req.body.country, 80) || null;
    const profileImageUrl = cleanText(req.body.profileImageUrl, 500) || null;

    if (displayName.length < 2) return res.status(400).json({ error: 'Display name is too short.' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Invalid email address.' });
    if (!Number.isInteger(age) || age < 18 || age > 120) return res.status(400).json({ error: 'Age must be between 18 and 120.' });

    try {
      const result = await db.query(
        `UPDATE users
         SET display_name = $1, email = $2, age = $3, gender = $4, country = $5,
             profile_image_url = $6, updated_at = NOW()
         WHERE id = $7 AND deleted_at IS NULL
         RETURNING *`,
        [displayName, email, age, gender, country, profileImageUrl, req.session.user.id]
      );
      req.session.user = sessionUser(result.rows[0]);
      res.json({ user: req.session.user });
    } catch (error) {
      if (error.code === '23505') return res.status(409).json({ error: 'That email is already in use.' });
      throw error;
    }
  }));

  app.delete('/api/account', ...auth, asyncRoute(async (req, res) => {
    if (req.body.confirmation !== 'DELETE') {
      return res.status(400).json({ error: 'Type DELETE to confirm permanent account deletion.' });
    }
    const userId = req.session.user.id;
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE messages SET sender_user_id = NULL, sender_display_name = 'Deleted user'
         WHERE sender_user_id = $1`,
        [userId]
      );
      await client.query('DELETE FROM saved_chats WHERE user_id = $1', [userId]);
      await client.query('DELETE FROM notifications WHERE user_id = $1', [userId]);
      await client.query('DELETE FROM friend_requests WHERE sender_user_id = $1 OR receiver_user_id = $1', [userId]);
      await client.query('DELETE FROM chat_requests WHERE sender_user_id = $1 OR receiver_user_id = $1', [userId]);
      await client.query('DELETE FROM friendships WHERE user_id = $1 OR friend_id = $1', [userId]);
      await client.query('DELETE FROM blocked_users WHERE blocker_user_id = $1 OR blocked_user_id = $1', [userId]);
      await client.query(
        `UPDATE users
         SET username = 'deleted_' || id,
             display_name = 'Deleted user',
             email = 'deleted_' || id || '@deleted.nevely.invalid',
             password_hash = $2,
             profile_image_url = NULL,
             deleted_at = NOW(), updated_at = NOW()
         WHERE id = $1`,
        [userId, crypto.randomBytes(32).toString('hex')]
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    req.session.destroy(() => res.status(204).end());
  }));

  app.post('/api/account/avatar', ...auth, (req, res) => {
    res.status(501).json({ error: 'Avatar upload storage is not configured yet.' });
  });

  app.get('/api/users/:id/profile', ...auth, asyncRoute(async (req, res) => {
    const targetId = asId(req.params.id);
    const result = await db.query(
      `SELECT u.id, u.public_id, u.display_name, u.country, u.profile_image_url, u.plan,
              EXISTS(SELECT 1 FROM friendships f WHERE f.user_id = $1 AND f.friend_id = u.id) AS is_friend,
              EXISTS(SELECT 1 FROM blocked_users b WHERE b.blocker_user_id = $1 AND b.blocked_user_id = u.id) AS is_blocked
       FROM users u WHERE u.id = $2 AND u.deleted_at IS NULL`,
      [req.session.user.id, targetId]
    );
    if (!result.rowCount) return res.status(404).json({ error: 'User not found.' });
    res.json({ user: result.rows[0], online: presence.isOnline(targetId) });
  }));

  app.get('/api/conversations', ...auth, asyncRoute(async (req, res) => {
    const result = await db.query(
      `SELECT c.id, c.type, c.status, c.started_at, c.ended_at, c.expires_at,
              COALESCE(partner.display_name, 'Guest') AS partner_name,
              partner.user_id AS partner_user_id, partner.profile_image_url,
              EXISTS(SELECT 1 FROM saved_chats s WHERE s.user_id = $1 AND s.conversation_id = c.id) AS saved,
              (SELECT body FROM messages m WHERE m.conversation_id = c.id AND m.deleted_for_everyone_at IS NULL ORDER BY m.created_at DESC LIMIT 1) AS last_message
       FROM conversation_participants mine
       JOIN conversations c ON c.id = mine.conversation_id
       LEFT JOIN LATERAL (
         SELECT cp.user_id, COALESCE(u.display_name, cp.display_name) AS display_name, u.profile_image_url
         FROM conversation_participants cp
         LEFT JOIN users u ON u.id = cp.user_id
         WHERE cp.conversation_id = c.id AND cp.socket_id <> mine.socket_id
         ORDER BY cp.joined_at LIMIT 1
       ) partner ON TRUE
       WHERE mine.user_id = $1 AND c.deleted_for_everyone_at IS NULL
         AND (c.expires_at > NOW() OR EXISTS (SELECT 1 FROM saved_chats s2 WHERE s2.conversation_id = c.id))
       ORDER BY c.started_at DESC LIMIT 100`,
      [req.session.user.id]
    );
    res.json({ conversations: result.rows });
  }));

  app.get('/api/conversations/:id/messages', ...auth, asyncRoute(async (req, res) => {
    const conversationId = asId(req.params.id);
    const allowed = await db.query(
      `SELECT c.id, c.status, c.started_at, c.ended_at,
              EXISTS(SELECT 1 FROM saved_chats s WHERE s.user_id = $1 AND s.conversation_id = c.id) AS saved
       FROM conversations c JOIN conversation_participants cp ON cp.conversation_id = c.id
       WHERE c.id = $2 AND cp.user_id = $1 AND c.deleted_for_everyone_at IS NULL
         AND (c.expires_at > NOW() OR EXISTS (SELECT 1 FROM saved_chats s2 WHERE s2.conversation_id = c.id))`,
      [req.session.user.id, conversationId]
    );
    if (!allowed.rowCount) return res.status(404).json({ error: 'Conversation unavailable or expired.' });
    const messages = await db.query(
      `SELECT id, sender_user_id, sender_display_name, body, created_at
       FROM messages WHERE conversation_id = $1 AND deleted_for_everyone_at IS NULL
       ORDER BY created_at`,
      [conversationId]
    );
    res.json({ conversation: allowed.rows[0], messages: messages.rows });
  }));

  app.delete('/api/conversations/:id', ...auth, asyncRoute(async (req, res) => {
    if (req.body.confirmation !== 'DELETE FOR EVERYONE') {
      return res.status(400).json({ error: 'Explicit confirmation is required.' });
    }
    const conversationId = asId(req.params.id);
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const result = await client.query(
        `UPDATE conversations c SET status = 'deleted', deleted_for_everyone_at = NOW()
         WHERE c.id = $1 AND EXISTS (
           SELECT 1 FROM conversation_participants cp WHERE cp.conversation_id = c.id AND cp.user_id = $2
         ) RETURNING c.id`,
        [conversationId, req.session.user.id]
      );
      if (!result.rowCount) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Conversation not found.' });
      }
      await client.query('UPDATE messages SET deleted_for_everyone_at = NOW() WHERE conversation_id = $1', [conversationId]);
      await client.query('DELETE FROM saved_chats WHERE conversation_id = $1', [conversationId]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    res.status(204).end();
  }));

  app.get('/api/saved-chats', ...auth, asyncRoute(async (req, res) => {
    const limit = req.session.user.plan === 'premium' ? 10 : 2;
    const result = await db.query(
      `SELECT s.conversation_id, s.created_at, c.started_at,
              COALESCE(partner.display_name, 'Guest') AS partner_name
       FROM saved_chats s JOIN conversations c ON c.id = s.conversation_id
       LEFT JOIN LATERAL (
         SELECT COALESCE(u.display_name, cp.display_name) AS display_name
         FROM conversation_participants cp LEFT JOIN users u ON u.id = cp.user_id
         WHERE cp.conversation_id = c.id AND cp.user_id IS DISTINCT FROM $1
         ORDER BY cp.joined_at LIMIT 1
       ) partner ON TRUE
       WHERE s.user_id = $1 ORDER BY s.created_at DESC`,
      [req.session.user.id]
    );
    res.json({ chats: result.rows, limit, used: result.rowCount });
  }));

  app.put('/api/conversations/:id/saved', ...auth, asyncRoute(async (req, res) => {
    const limit = req.session.user.plan === 'premium' ? 10 : 2;
    const conversationId = asId(req.params.id);
    const owns = await db.query(
      'SELECT 1 FROM conversation_participants WHERE conversation_id = $1 AND user_id = $2',
      [conversationId, req.session.user.id]
    );
    if (!owns.rowCount) return res.status(404).json({ error: 'Conversation not found.' });
    const count = await db.query('SELECT COUNT(*)::int AS count FROM saved_chats WHERE user_id = $1', [req.session.user.id]);
    if (count.rows[0].count >= limit) return res.status(409).json({ error: `Saved chat limit reached (${limit}).`, limit });
    await db.query(
      `INSERT INTO saved_chats (user_id, conversation_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [req.session.user.id, conversationId]
    );
    res.status(201).json({ saved: true, limit });
  }));

  app.delete('/api/conversations/:id/saved', ...auth, asyncRoute(async (req, res) => {
    await db.query('DELETE FROM saved_chats WHERE user_id = $1 AND conversation_id = $2', [req.session.user.id, asId(req.params.id)]);
    res.status(204).end();
  }));

  app.get('/api/friends', ...auth, asyncRoute(async (req, res) => {
    const result = await db.query(
      `SELECT u.id, u.public_id, u.display_name, u.profile_image_url, u.country
       FROM friendships f JOIN users u ON u.id = f.friend_id
       WHERE f.user_id = $1 AND u.deleted_at IS NULL ORDER BY u.display_name`,
      [req.session.user.id]
    );
    res.json({ friends: result.rows.map((friend) => ({ ...friend, online: presence.isOnline(friend.id) })) });
  }));

  app.delete('/api/friends/:id', ...auth, asyncRoute(async (req, res) => {
    const friendId = asId(req.params.id);
    await db.query('DELETE FROM friendships WHERE (user_id = $1 AND friend_id = $2) OR (user_id = $2 AND friend_id = $1)', [req.session.user.id, friendId]);
    res.status(204).end();
  }));

  app.get('/api/friend-requests', ...auth, asyncRoute(async (req, res) => {
    const result = await db.query(
      `SELECT fr.id, fr.created_at, u.id AS sender_id, u.display_name, u.profile_image_url
       FROM friend_requests fr JOIN users u ON u.id = fr.sender_user_id
       WHERE fr.receiver_user_id = $1 AND fr.status = 'pending' ORDER BY fr.created_at DESC`,
      [req.session.user.id]
    );
    res.json({ requests: result.rows });
  }));

  app.post('/api/friend-requests', ...auth, asyncRoute(async (req, res) => {
    const receiverId = asId(req.body.userId);
    if (!receiverId || receiverId === req.session.user.id) return res.status(400).json({ error: 'Invalid user.' });
    const result = await db.query(
      `INSERT INTO friend_requests (sender_user_id, receiver_user_id)
       VALUES ($1, $2)
       ON CONFLICT (sender_user_id, receiver_user_id) DO UPDATE SET status = 'pending', created_at = NOW(), responded_at = NULL
       RETURNING id`,
      [req.session.user.id, receiverId]
    );
    await db.query(
      `INSERT INTO notifications (user_id, type, title, body, data)
       VALUES ($1, 'friend_request', 'New friend request', $2, jsonb_build_object('requestId', $3, 'userId', $4))`,
      [receiverId, `${req.session.user.displayName} sent you a friend request.`, result.rows[0].id, req.session.user.id]
    );
    presence.emitToUser(receiverId, 'notification-created', { type: 'friend_request' });
    res.status(201).json({ requestId: result.rows[0].id });
  }));

  app.patch('/api/friend-requests/:id', ...auth, asyncRoute(async (req, res) => {
    const status = req.body.action === 'accept' ? 'accepted' : 'declined';
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const result = await client.query(
        `UPDATE friend_requests SET status = $1, responded_at = NOW()
         WHERE id = $2 AND receiver_user_id = $3 AND status = 'pending'
         RETURNING sender_user_id`,
        [status, asId(req.params.id), req.session.user.id]
      );
      if (!result.rowCount) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Request not found.' });
      }
      if (status === 'accepted') {
        const senderId = result.rows[0].sender_user_id;
        await client.query(
          `INSERT INTO friendships (user_id, friend_id) VALUES ($1, $2), ($2, $1) ON CONFLICT DO NOTHING`,
          [req.session.user.id, senderId]
        );
        await client.query(
          `INSERT INTO notifications (user_id, type, title, body)
           VALUES ($1, 'friend_accepted', 'Friend request accepted', $2)`,
          [senderId, `${req.session.user.displayName} accepted your friend request.`]
        );
        presence.emitToUser(senderId, 'notification-created', { type: 'friend_accepted' });
      }
      await client.query('COMMIT');
      res.json({ status });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }));

  app.get('/api/chat-requests', ...auth, asyncRoute(async (req, res) => {
    const result = await db.query(
      `SELECT cr.id, cr.created_at, u.id AS sender_id, u.display_name, u.profile_image_url
       FROM chat_requests cr JOIN users u ON u.id = cr.sender_user_id
       WHERE cr.receiver_user_id = $1 AND cr.status = 'pending' ORDER BY cr.created_at DESC`,
      [req.session.user.id]
    );
    res.json({ requests: result.rows });
  }));

  app.get('/api/notifications', ...auth, asyncRoute(async (req, res) => {
    const result = await db.query(
      `SELECT id, type, title, body, data, read_at, created_at
       FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100`,
      [req.session.user.id]
    );
    res.json({ notifications: result.rows });
  }));

  app.patch('/api/notifications/:id/read', ...auth, asyncRoute(async (req, res) => {
    await db.query('UPDATE notifications SET read_at = COALESCE(read_at, NOW()) WHERE id = $1 AND user_id = $2', [asId(req.params.id), req.session.user.id]);
    res.status(204).end();
  }));

  app.get('/api/blocks', ...auth, asyncRoute(async (req, res) => {
    const result = await db.query(
      `SELECT u.id, u.public_id, u.display_name, u.profile_image_url, b.created_at
       FROM blocked_users b JOIN users u ON u.id = b.blocked_user_id
       WHERE b.blocker_user_id = $1 ORDER BY b.created_at DESC`,
      [req.session.user.id]
    );
    res.json({ users: result.rows });
  }));

  app.put('/api/blocks/:id', ...auth, asyncRoute(async (req, res) => {
    const blockedId = asId(req.params.id);
    if (!blockedId || blockedId === req.session.user.id) return res.status(400).json({ error: 'Invalid user.' });
    await db.query('INSERT INTO blocked_users (blocker_user_id, blocked_user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [req.session.user.id, blockedId]);
    res.status(201).json({ blocked: true });
  }));

  app.delete('/api/blocks/:id', ...auth, asyncRoute(async (req, res) => {
    await db.query('DELETE FROM blocked_users WHERE blocker_user_id = $1 AND blocked_user_id = $2', [req.session.user.id, asId(req.params.id)]);
    res.status(204).end();
  }));

  app.get('/admin', requireAuth, requireAdmin, asyncRoute(async (req, res) => {
    const [users, reports, price] = await Promise.all([
      db.query(`SELECT id, public_id, display_name, email, role, plan, created_at FROM users WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT 100`),
      db.query(`SELECT r.*, reporter.display_name AS reporter_name, reported.display_name AS reported_name FROM reports r LEFT JOIN users reporter ON reporter.id = r.reporter_user_id LEFT JOIN users reported ON reported.id = r.reported_user_id ORDER BY r.created_at DESC LIMIT 100`),
      db.query(`SELECT * FROM plan_price_history WHERE plan = 'premium' ORDER BY created_at DESC LIMIT 1`)
    ]);
    res.render('admin', { pageTitle: 'Admin', users: users.rows, reports: reports.rows, price: price.rows[0] });
  }));

  app.post('/api/admin/users/:id/ban', requireAuth, requireAdmin, asyncRoute(async (req, res) => {
    const type = req.body.type === 'permanent' ? 'permanent' : 'temporary';
    const hours = Math.min(Math.max(Number(req.body.hours) || 24, 1), 24 * 365);
    const result = await db.query(
      `INSERT INTO bans (user_id, type, reason, ends_at, created_by)
       VALUES ($1, $2, $3, CASE WHEN $2 = 'temporary' THEN NOW() + ($4 || ' hours')::interval ELSE NULL END, $5)
       RETURNING id`,
      [asId(req.params.id), type, cleanText(req.body.reason, 500), hours, req.session.user.id]
    );
    if (type === 'permanent') {
      const user = await db.query('SELECT last_ip FROM users WHERE id = $1', [asId(req.params.id)]);
      if (user.rows[0]?.last_ip) {
        await db.query(
          `INSERT INTO bans (user_id, ip_address, type, reason, created_by) VALUES ($1, $2, 'ip', $3, $4)`,
          [asId(req.params.id), user.rows[0].last_ip, cleanText(req.body.reason, 500), req.session.user.id]
        );
      }
    }
    await db.query(
      `INSERT INTO notifications (user_id, type, title, body) VALUES ($1, 'ban', 'Account suspension', $2)`,
      [asId(req.params.id), type === 'permanent' ? 'Your account was permanently suspended.' : `Your account was suspended for ${hours} hours.`]
    );
    presence.emitToUser(asId(req.params.id), 'account-banned', { type, hours });
    res.status(201).json({ banId: result.rows[0].id });
  }));

  app.delete('/api/admin/users/:id', requireAuth, requireAdmin, asyncRoute(async (req, res) => {
    if (req.body.confirmation !== 'BAN AND DELETE') {
      return res.status(400).json({ error: 'Explicit confirmation is required.' });
    }
    const userId = asId(req.params.id);
    if (userId === req.session.user.id) return res.status(400).json({ error: 'You cannot delete your own admin account here.' });
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const user = await client.query('SELECT last_ip FROM users WHERE id = $1 AND deleted_at IS NULL FOR UPDATE', [userId]);
      if (!user.rowCount) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'User not found.' });
      }
      await client.query(
        `INSERT INTO bans (user_id, type, reason, created_by) VALUES ($1, 'permanent', $2, $3)`,
        [userId, cleanText(req.body.reason, 500) || 'Account removed by administrator', req.session.user.id]
      );
      if (user.rows[0].last_ip) {
        await client.query(
          `INSERT INTO bans (user_id, ip_address, type, reason, created_by) VALUES ($1, $2, 'ip', $3, $4)`,
          [userId, user.rows[0].last_ip, cleanText(req.body.reason, 500) || 'Account removed by administrator', req.session.user.id]
        );
      }
      await client.query(`UPDATE messages SET sender_user_id = NULL, sender_display_name = 'Deleted user' WHERE sender_user_id = $1`, [userId]);
      await client.query('DELETE FROM saved_chats WHERE user_id = $1', [userId]);
      await client.query('DELETE FROM friendships WHERE user_id = $1 OR friend_id = $1', [userId]);
      await client.query(
        `UPDATE users SET username = 'deleted_' || id, display_name = 'Deleted user',
             email = 'deleted_' || id || '@deleted.nevely.invalid', password_hash = $2,
             profile_image_url = NULL, deleted_at = NOW(), updated_at = NOW()
         WHERE id = $1`,
        [userId, crypto.randomBytes(32).toString('hex')]
      );
      await client.query('COMMIT');
      presence.emitToUser(userId, 'account-banned', { type: 'permanent' });
      res.status(204).end();
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }));

  app.patch('/api/admin/reports/:id', requireAuth, requireAdmin, asyncRoute(async (req, res) => {
    const status = req.body.action === 'dismiss' ? 'dismissed' : 'resolved';
    const result = await db.query(
      `UPDATE reports SET status = $1, reviewed_by = $2, reviewed_at = NOW(), resolution = $3 WHERE id = $4
       RETURNING reporter_user_id`,
      [status, req.session.user.id, cleanText(req.body.resolution, 1000), asId(req.params.id)]
    );
    const reporterId = result.rows[0]?.reporter_user_id;
    if (reporterId) {
      await db.query(
        `INSERT INTO notifications (user_id, type, title, body) VALUES ($1, 'report_processed', 'Report reviewed', $2)`,
        [reporterId, status === 'resolved' ? 'Your report was reviewed and action was taken.' : 'Your report was reviewed and dismissed.']
      );
      presence.emitToUser(reporterId, 'notification-created', { type: 'report_processed' });
    }
    res.json({ status });
  }));

  app.post('/api/admin/prices', requireAuth, requireAdmin, asyncRoute(async (req, res) => {
    const priceCents = Math.max(0, Math.round(Number(req.body.price) * 100));
    await db.query(
      `INSERT INTO plan_price_history (plan, price_cents, currency, changed_by) VALUES ('premium', $1, $2, $3)`,
      [priceCents, cleanText(req.body.currency, 3).toUpperCase() || 'USD', req.session.user.id]
    );
    res.status(201).json({ priceCents });
  }));
}

module.exports = { registerApiRoutes };
