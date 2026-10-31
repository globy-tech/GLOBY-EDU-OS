const { hashToken } = require('./token');

const revokedTokens = new Map();

function removeExpiredTokens(now = Math.floor(Date.now() / 1000)) {
  for (const [tokenHash, expiresAt] of revokedTokens) {
    if (expiresAt <= now) revokedTokens.delete(tokenHash);
  }
}

function revokeAccessToken(token, expiresAt) {
  const expiry = Number(expiresAt);
  if (!token || !Number.isFinite(expiry) || expiry <= Math.floor(Date.now() / 1000)) return;
  removeExpiredTokens();
  revokedTokens.set(hashToken(token), expiry);
}

function isAccessTokenRevoked(token) {
  removeExpiredTokens();
  return Boolean(token && revokedTokens.has(hashToken(token)));
}

module.exports = { revokeAccessToken, isAccessTokenRevoked };
