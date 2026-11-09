const express = require('express');

jest.mock('../../modules/auth/utils/email', () => ({ sendEmail: jest.fn() }));

const { sendEmail } = require('../../modules/auth/utils/email');
const contactRoutes = require('../contact');

let server;
let baseUrl;
let originalContactEmail;
let testIp = 10;

beforeAll(async () => {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json());
  app.use('/contact', contactRoutes);
  server = await new Promise((resolve) => {
    const listener = app.listen(0, () => resolve(listener));
  });
  baseUrl = `http://127.0.0.1:${server.address().port}/contact`;
});

beforeEach(() => {
  originalContactEmail = process.env.CONTACT_EMAIL;
  process.env.CONTACT_EMAIL = 'sales@example.test';
  testIp += 1;
  sendEmail.mockReset().mockResolvedValue({ ok: true, provider: 'brevo', deliveryStatus: 'unconfirmed' });
});

afterEach(() => {
  if (originalContactEmail === undefined) delete process.env.CONTACT_EMAIL;
  else process.env.CONTACT_EMAIL = originalContactEmail;
});

afterAll(async () => {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
});

async function submit(body, ip = `198.51.100.${testIp}`) {
  const response = await fetch(baseUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Forwarded-For': ip,
    },
    body: JSON.stringify(body),
  });
  return { response, body: await response.json() };
}

const validContact = {
  name: 'Synthetic Contact',
  email: 'person@example.test',
  message: 'Please contact our synthetic school.',
};

describe('public contact form delivery', () => {
  test('uses the shared transactional provider and sets reply-to to the validated visitor address', async () => {
    const { response, body } = await submit(validContact);

    expect(response.status).toBe(200);
    expect(body.status).toBe('ok');
    expect(sendEmail).toHaveBeenCalledWith(
      'sales@example.test',
      'New GlobyEdu contact request from Synthetic Contact',
      expect.stringContaining('Synthetic Contact'),
      { replyTo: 'person@example.test' },
    );
  });

  test('escapes user-supplied contact content and rejects invalid input before sending', async () => {
    await submit({ ...validContact, name: '<img src=x>' });
    expect(sendEmail.mock.calls[0][2]).toContain('&lt;img src=x&gt;');

    const invalid = await submit({ ...validContact, email: 'not-an-email' });
    expect(invalid.response.status).toBe(400);
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  test('returns a configuration error when no contact recipient is configured', async () => {
    delete process.env.CONTACT_EMAIL;
    const { response } = await submit(validContact);

    expect(response.status).toBe(503);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  test('maps provider failures and thrown errors to safe responses', async () => {
    sendEmail.mockResolvedValueOnce({ ok: false, reason: 'BREVO_API_ERROR' });
    expect((await submit(validContact)).response.status).toBe(502);

    sendEmail.mockRejectedValueOnce(new Error('synthetic provider failure'));
    const failed = await submit(validContact);
    expect(failed.response.status).toBe(502);
    expect(failed.body.message).not.toContain('synthetic provider failure');
  });

  test('rate limits repeated submissions from the same client address', async () => {
    const ip = '198.51.100.99';
    const responses = [];
    for (let attempt = 0; attempt < 6; attempt += 1) {
      responses.push(await submit(validContact, ip));
    }

    expect(responses.slice(0, 5).every(({ response }) => response.status === 200)).toBe(true);
    expect(responses[5].response.status).toBe(429);
    expect(sendEmail).toHaveBeenCalledTimes(5);
  });
});
