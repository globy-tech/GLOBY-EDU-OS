const mockAuthService = { loginPlatformAdmin: jest.fn() };
const mockFirebaseData = { isFirebaseDataConfigured: jest.fn(() => true) };
const mockAuditService = { recordAuditEvent: jest.fn(async () => undefined) };
const mockLoginRateLimiter = {
  getLoginAttemptKey: jest.fn(() => 'synthetic-attempt-key'),
  isLoginRateLimited: jest.fn(() => false),
  recordLoginFailure: jest.fn(),
  clearLoginFailures: jest.fn(),
};

jest.mock('../../modules/auth/auth.service', () => mockAuthService);
jest.mock('../../firebase.data', () => mockFirebaseData);
jest.mock('../../modules/audit/audit.service', () => mockAuditService);
jest.mock('../../modules/auth/utils/login-rate-limiter', () => mockLoginRateLimiter);

const authRouter = require('../auth');

const platformLoginHandler = authRouter.stack.find(
  (layer) => layer.route?.path === '/platform-login' && layer.route.methods.post,
).route.stack[0].handle;

const sensitiveMarkers = [
  'private-email-marker@example.test',
  'private-password-marker',
  'private-hash-marker',
  'private-reset-token-marker',
  'private-access-token-marker',
  'private-refresh-token-marker',
  'private-uid-marker',
  'private-key-marker',
];

function createRequest() {
  return {
    body: {
      username: sensitiveMarkers[0],
      password: sensitiveMarkers[1],
    },
    headers: {},
    ip: '127.0.0.1',
    get: () => 'synthetic-user-agent',
  };
}

function createResponse(cookie = jest.fn()) {
  const response = {
    cookie,
    status: jest.fn(function setStatus(statusCode) {
      this.statusCode = statusCode;
      return this;
    }),
    json: jest.fn(function setJson(body) {
      this.body = body;
      return this;
    }),
  };
  return response;
}

function attachDiagnostic(error, stage, category) {
  Object.defineProperty(error, 'platformAdminLoginDiagnostic', {
    value: { stage, category },
  });
  return error;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockFirebaseData.isFirebaseDataConfigured.mockReturnValue(true);
  mockLoginRateLimiter.isLoginRateLimited.mockReturnValue(false);
});

describe('platform Super Admin login diagnostics route', () => {
  test.each([
    ['firestore_lookup', 'firestore_lookup_failed'],
    ['password_check', 'password_mismatch'],
    ['firebase_identity', 'firebase_user_missing'],
    ['claims', 'firebase_account_disabled'],
    ['claims', 'custom_claims_invalid'],
    ['session', 'password_sync_pending'],
    ['session', 'session_creation_failed'],
  ])('keeps %s failures generic and logs only safe diagnostic fields', async (stage, category) => {
    const rawError = new Error(sensitiveMarkers.join(' '));
    mockAuthService.loginPlatformAdmin.mockRejectedValueOnce(attachDiagnostic(rawError, stage, category));
    const log = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const req = createRequest();
    const res = createResponse();

    try {
      await platformLoginHandler(req, res);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.body).toEqual({
        status: 'error',
        message: 'Unable to sign in. Please check your details.',
      });
      expect(req.platformLoginRequestId).toMatch(/^[0-9a-f-]{36}$/i);
      expect(log).toHaveBeenCalledTimes(1);
      expect(JSON.parse(log.mock.calls[0][0])).toEqual({
        event: 'auth.platform_login_failed',
        requestId: req.platformLoginRequestId,
        stage,
        category,
      });
      const loggedText = log.mock.calls.map(([entry]) => entry).join('\n');
      sensitiveMarkers.forEach((marker) => expect(loggedText).not.toContain(marker));
      expect(loggedText).not.toContain('Error:');
      expect(loggedText).not.toContain('at ');
    } finally {
      log.mockRestore();
    }
  });

  test('labels failures after service success as route_post_login without exposing the exception', async () => {
    mockAuthService.loginPlatformAdmin.mockResolvedValueOnce({
      refreshToken: sensitiveMarkers[5],
      user: { id: sensitiveMarkers[6] },
    });
    const log = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const req = createRequest();
    const res = createResponse(() => {
      throw new Error(sensitiveMarkers.join(' '));
    });

    try {
      await platformLoginHandler(req, res);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.body).toEqual({
        status: 'error',
        message: 'Unable to sign in. Please check your details.',
      });
      expect(JSON.parse(log.mock.calls[0][0])).toEqual({
        event: 'auth.platform_login_failed',
        requestId: req.platformLoginRequestId,
        stage: 'route_post_login',
        category: 'route_post_login_failure',
      });
      const loggedText = log.mock.calls.map(([entry]) => entry).join('\n');
      sensitiveMarkers.forEach((marker) => expect(loggedText).not.toContain(marker));
    } finally {
      log.mockRestore();
    }
  });
});
