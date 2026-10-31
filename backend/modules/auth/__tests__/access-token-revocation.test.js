const jwt = require('jsonwebtoken');

describe('fallback access token revocation', () => {
  const originalSecret = process.env.JWT_ACCESS_SECRET;

  beforeEach(() => {
    jest.resetModules();
    process.env.JWT_ACCESS_SECRET = 'isolated-test-access-secret';
  });

  afterAll(() => {
    if (originalSecret === undefined) delete process.env.JWT_ACCESS_SECRET;
    else process.env.JWT_ACCESS_SECRET = originalSecret;
  });

  test('revokes a token until its expiry without storing the raw token', () => {
    const { revokeAccessToken, isAccessTokenRevoked } = require('../utils/access-token-revocation');
    const token = jwt.sign({ userId: 'qa-school:qa-user' }, process.env.JWT_ACCESS_SECRET, { expiresIn: '5m' });
    const expiresAt = Math.floor(Date.now() / 1000) + 300;

    expect(isAccessTokenRevoked(token)).toBe(false);
    revokeAccessToken(token, expiresAt);
    expect(isAccessTokenRevoked(token)).toBe(true);
    expect(isAccessTokenRevoked('another-token')).toBe(false);
  });

  test('does not retain tokens without a future expiration', () => {
    const { revokeAccessToken, isAccessTokenRevoked } = require('../utils/access-token-revocation');
    const token = 'expired-qa-token';

    revokeAccessToken(token, Math.floor(Date.now() / 1000) - 1);
    expect(isAccessTokenRevoked(token)).toBe(false);
  });
});
