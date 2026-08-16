const MAX_VISIBLE_CONVERSATION_MESSAGES = 200;

async function persistConversationMessage(executor, active, socketId, text) {
  const client = await executor.getClient();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [active.conversationId]);
    const result = await client.query(
    `WITH new_message AS (
       INSERT INTO messages
         (conversation_id, sender_user_id, sender_guest_id, sender_socket_id,
          sender_display_name, body)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, conversation_id, sender_user_id, sender_guest_id, created_at
     ), new_receipts AS (
       INSERT INTO message_receipts (message_id, user_id, guest_id, delivered_at)
       SELECT DISTINCT new_message.id, cp.user_id, cp.guest_id, NOW()
       FROM new_message
       JOIN conversation_participants cp ON cp.conversation_id = new_message.conversation_id
       WHERE (cp.user_id IS NOT NULL OR cp.guest_id IS NOT NULL)
         AND NOT (
           cp.user_id IS NOT DISTINCT FROM new_message.sender_user_id
           AND cp.guest_id IS NOT DISTINCT FROM new_message.sender_guest_id
         )
       ON CONFLICT DO NOTHING
       RETURNING message_id
     ), touched_conversation AS (
       UPDATE conversations c
       SET last_activity_at = new_message.created_at,
           expires_at = new_message.created_at + INTERVAL '7 days'
       FROM new_message
       WHERE c.id = new_message.conversation_id
       RETURNING c.id
     ), retention_guard AS (
       SELECT (
         EXISTS (SELECT 1 FROM saved_chats s WHERE s.conversation_id = $1)
         OR EXISTS (
           SELECT 1 FROM reports r
           WHERE r.conversation_id = $1
             AND (r.retention_until IS NULL OR r.retention_until > NOW())
         )
       ) AS protected
     ), excess_messages AS (
       SELECT m.id
       FROM messages m CROSS JOIN retention_guard guard
       WHERE m.conversation_id = $1
         AND m.deleted_for_everyone_at IS NULL
         AND NOT guard.protected
       ORDER BY m.id DESC
       OFFSET GREATEST($7::integer - 1, 0)
     ), pruned_messages AS (
       DELETE FROM messages m
       USING excess_messages excess
       WHERE m.id = excess.id
       RETURNING m.id
     )
     SELECT id, created_at,
            (SELECT COUNT(*)::int FROM new_receipts) AS receipt_count,
            (SELECT COUNT(*)::int FROM pruned_messages) AS pruned_count
     FROM new_message
     WHERE EXISTS (SELECT 1 FROM touched_conversation)`,
    [
      active.conversationId,
      active.user.userId,
      active.user.guestId,
      socketId,
      active.user.displayName,
      text,
      MAX_VISIBLE_CONVERSATION_MESSAGES
    ]
    );
    await client.query('COMMIT');
    return result.rows[0];
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  MAX_VISIBLE_CONVERSATION_MESSAGES,
  persistConversationMessage
};
