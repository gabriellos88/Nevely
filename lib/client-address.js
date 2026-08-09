const proxyaddr = require('proxy-addr');

// Nevely is deployed behind one terminating application proxy. Keeping the
// trust function shared prevents Express and Socket.IO from interpreting the
// same connection differently. Production ingress must not expose the Node
// process directly; see the moderation runbook.
function trustApplicationProxy(_address, hop) {
  return hop < 1;
}

function trustedClientAddress(request) {
  if (!request?.socket?.remoteAddress) return '';
  return proxyaddr(request, trustApplicationProxy);
}

module.exports = { trustApplicationProxy, trustedClientAddress };
