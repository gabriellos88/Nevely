function createPresence(io) {
  const socketsByUser = new Map();

  function add(userId, socketId) {
    if (!userId) return;
    const key = Number(userId);
    const sockets = socketsByUser.get(key) || new Set();
    sockets.add(socketId);
    socketsByUser.set(key, sockets);
  }

  function remove(userId, socketId) {
    if (!userId) return;
    const key = Number(userId);
    const sockets = socketsByUser.get(key);
    if (!sockets) return;
    sockets.delete(socketId);
    if (!sockets.size) socketsByUser.delete(key);
  }

  return {
    add,
    remove,
    isOnline(userId) {
      return Boolean(userId && socketsByUser.get(Number(userId))?.size);
    },
    getSockets(userId) {
      return [...(socketsByUser.get(Number(userId)) || [])];
    },
    emitToUser(userId, event, payload) {
      for (const socketId of this.getSockets(userId)) io.to(socketId).emit(event, payload);
    }
  };
}

module.exports = { createPresence };
