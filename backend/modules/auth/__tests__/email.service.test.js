describe('transactional email service', () => {
  const originalEnv = { ...process.env };
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.resetModules();
    process.env.BREVO_API_KEY = 'test_api_key';
    process.env.BREVO_SENDER_EMAIL = 'hello@globyedu.com';
    process.env.BREVO_SENDER_NAME = 'GlobyEdu';
    delete process.env.RESEND_API_KEY;
    delete process.env.RESEND_FROM_EMAIL;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ messageId: 'msg_123' }),
    });
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('sends an email via the Brevo API when configured', async () => {
    const { sendEmail } = require('../utils/email');

    const result = await sendEmail('student@example.com', 'Password reset', '<p>Reset</p>', {
      replyTo: 'reply@example.test',
    });

    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.brevo.com/v3/smtp/email',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          'api-key': 'test_api_key',
        }),
      })
    );
    expect(JSON.parse(global.fetch.mock.calls[0][1].body).replyTo).toEqual({ email: 'reply@example.test' });
    expect(result).toMatchObject({
      ok: true,
      provider: 'brevo',
      requestStatus: 'accepted',
      deliveryStatus: 'unconfirmed',
      status: 200,
      messageId: 'msg_123',
    });
  });

  it('skips delivery cleanly when Brevo is not configured', async () => {
    delete process.env.BREVO_API_KEY;
    delete process.env.BREVO_SENDER_EMAIL;

    const { sendEmail } = require('../utils/email');
    const result = await sendEmail('student@example.com', 'Password reset', '<p>Reset</p>');

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('EMAIL_PROVIDER_NOT_CONFIGURED');
    expect(console.warn.mock.calls.join(' ')).not.toContain('test_api_key');
  });

  it('uses Resend for transactional email when Brevo is not configured', async () => {
    delete process.env.BREVO_API_KEY;
    delete process.env.BREVO_SENDER_EMAIL;
    process.env.RESEND_API_KEY = 'resend_test_api_key';
    process.env.RESEND_FROM_EMAIL = 'GlobyEdu <hello@globyedu.com>';
    global.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ id: 'resend_msg_123' }),
    });

    const { sendEmail } = require('../utils/email');
    const result = await sendEmail('student@example.com', 'Verify your email', '<p>Verify</p>', {
      replyTo: 'reply@example.test',
    });

    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.resend.com/emails',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer resend_test_api_key',
        }),
      })
    );
    expect(JSON.parse(global.fetch.mock.calls[0][1].body).reply_to).toBe('reply@example.test');
    expect(result).toMatchObject({
      ok: true,
      status: 200,
      messageId: 'resend_msg_123',
      provider: 'resend',
      requestStatus: 'accepted',
      deliveryStatus: 'unconfirmed',
    });
  });

  it('handles provider failures without throwing', async () => {
    global.fetch.mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => JSON.stringify({ code: 'unauthorized' }),
    });

    const { sendEmail } = require('../utils/email');
    await expect(sendEmail('student@example.com', 'Password reset', '<p>Reset</p>')).resolves.toMatchObject({
      ok: false,
      reason: 'BREVO_API_ERROR',
      status: 401,
      provider: 'brevo',
    });
    expect(console.error).toHaveBeenCalled();
  });

  it('does not send with a malformed sender address', async () => {
    process.env.BREVO_SENDER_EMAIL = 'not-an-email';

    const { sendEmail } = require('../utils/email');
    const result = await sendEmail('student@example.com', 'Password reset', '<p>Reset</p>');

    expect(result).toMatchObject({ ok: false, reason: 'INVALID_SENDER_ADDRESS', provider: 'brevo' });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('reports an unverified sender rejection without logging provider response details', async () => {
    global.fetch.mockResolvedValue({
      ok: false,
      status: 403,
      text: async () => JSON.stringify({ code: 'sender_not_verified', email: 'student@example.com' }),
    });

    const { sendEmail } = require('../utils/email');
    const result = await sendEmail('student@example.com', 'Password reset', '<p>Reset</p>');

    expect(result).toMatchObject({ ok: false, reason: 'BREVO_API_ERROR', status: 403, provider: 'brevo' });
    expect(console.error.mock.calls.join(' ')).not.toContain('student@example.com');
    expect(console.error.mock.calls.join(' ')).not.toContain('test_api_key');
  });

  it('falls back to Resend when Brevo rejects the configured sender', async () => {
    process.env.RESEND_API_KEY = 'resend_test_api_key';
    process.env.RESEND_FROM_EMAIL = 'GlobyEdu <hello@globyedu.com>';
    global.fetch
      .mockResolvedValueOnce({
        ok: false,
        status: 403,
        text: async () => JSON.stringify({ code: 'sender_not_verified' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ id: 'resend_fallback_msg' }),
      });

    const { sendEmail } = require('../utils/email');
    const result = await sendEmail('teacher@example.com', 'Set up account', '<p>Set up</p>');

    expect(global.fetch).toHaveBeenNthCalledWith(
      1,
      'https://api.brevo.com/v3/smtp/email',
      expect.any(Object),
    );
    expect(global.fetch).toHaveBeenNthCalledWith(
      2,
      'https://api.resend.com/emails',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer resend_test_api_key',
        }),
      }),
    );
    expect(result).toMatchObject({
      ok: true,
      provider: 'resend',
      requestStatus: 'accepted',
      deliveryStatus: 'unconfirmed',
      messageId: 'resend_fallback_msg',
    });
  });

  it('does not risk duplicate delivery by falling back after a Brevo server error', async () => {
    process.env.RESEND_API_KEY = 'resend_test_api_key';
    process.env.RESEND_FROM_EMAIL = 'GlobyEdu <hello@globyedu.com>';
    global.fetch.mockResolvedValue({
      ok: false,
      status: 503,
      text: async () => '',
    });

    const { sendEmail } = require('../utils/email');
    const result = await sendEmail('teacher@example.com', 'Set up account', '<p>Set up</p>');

    expect(result).toMatchObject({
      ok: false,
      reason: 'BREVO_API_ERROR',
      status: 503,
      provider: 'brevo',
    });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.brevo.com/v3/smtp/email',
      expect.any(Object),
    );
  });
});
