const DEFAULT_STRICT_PHASE_SECONDS = 10;

function normalizeStrictPhaseSeconds(value) {
  const seconds = Number(value);
  return Number.isInteger(seconds) && seconds >= 5 && seconds <= 30
    ? seconds
    : DEFAULT_STRICT_PHASE_SECONDS;
}

function initialMatchingPhase(interests) {
  return Array.isArray(interests) && interests.length ? 'strict' : 'relaxed';
}

function sharedInterestCount(first, second) {
  const secondInterests = new Set(Array.isArray(second?.interests) ? second.interests : []);
  return (Array.isArray(first?.interests) ? first.interests : [])
    .filter((interest) => secondInterests.has(interest)).length;
}

function interestsAllowMatch(first, second) {
  const sharedCount = sharedInterestCount(first, second);
  const requiresSharedInterest = first?.matchingPhase === 'strict'
    || second?.matchingPhase === 'strict';
  return {
    allowed: !requiresSharedInterest || sharedCount > 0,
    sharedCount
  };
}

function samePrincipal(first, second) {
  if (first?.userId && second?.userId) return first.userId === second.userId;
  if (first?.guestId && second?.guestId) return first.guestId === second.guestId;
  return false;
}

module.exports = {
  DEFAULT_STRICT_PHASE_SECONDS,
  initialMatchingPhase,
  interestsAllowMatch,
  normalizeStrictPhaseSeconds,
  samePrincipal,
  sharedInterestCount
};
