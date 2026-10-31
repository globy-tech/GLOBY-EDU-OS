const pricingService = require('../pricing.service');
const paymentService = require('../payment.service');

describe('authoritative pricing service', () => {
  it('loads the official active plans', async () => {
    const plans = await pricingService.listPricingPlans({ activeOnly: true });
    expect(plans.map((plan) => [plan.slug, plan.studentLimit, plan.monthlyAmount, plan.yearlyAmount])).toEqual([
      ['starter', 100, 150, 1500],
      ['growth', 300, 300, 3000],
      ['pro', 700, 500, 5000],
    ]);
  });

  it('fills missing database plans from defaults and preserves explicit inactive overrides', async () => {
    const firebaseData = require('../../../firebase.data');
    const firestore = {
      collection: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      get: jest.fn().mockResolvedValue({
        docs: [
          {
            id: 'starter-plan',
            data: () => ({
              slug: 'starter',
              name: 'Starter',
              studentLimit: 100,
              monthlyAmount: 175,
              yearlyAmount: 1500,
              currency: 'GHS',
              active: true,
              displayOrder: 1,
            }),
          },
          {
            id: 'pro-plan',
            data: () => ({
              slug: 'pro',
              name: 'Pro',
              studentLimit: 700,
              monthlyAmount: 500,
              yearlyAmount: 5000,
              currency: 'GHS',
              active: false,
              displayOrder: 3,
            }),
          },
        ],
      }),
    };
    const configuredSpy = jest.spyOn(firebaseData, 'isFirebaseDataConfigured').mockReturnValue(true);
    const firestoreSpy = jest.spyOn(firebaseData, 'getFirestore').mockReturnValue(firestore);

    try {
      const plans = await pricingService.listPricingPlans();
      const activePlans = await pricingService.listPricingPlans({ activeOnly: true });

      expect(plans.map((plan) => plan.slug)).toEqual(['starter', 'growth', 'pro', 'enterprise']);
      expect(plans.find((plan) => plan.slug === 'starter').monthlyAmount).toBe(175);
      expect(plans.find((plan) => plan.slug === 'pro').active).toBe(false);
      expect(activePlans.map((plan) => plan.slug)).toEqual(['starter', 'growth']);
    } finally {
      configuredSpy.mockRestore();
      firestoreSpy.mockRestore();
    }
  });

  it.each([
    ['starter', 'monthly', 150],
    ['starter', 'yearly', 1500],
    ['growth', 'monthly', 300],
    ['growth', 'yearly', 3000],
    ['pro', 'monthly', 500],
    ['pro', 'yearly', 5000],
  ])('resolves %s %s to the authoritative amount', async (slug, period, amount) => {
    await expect(pricingService.getPricingPlan(slug, period)).resolves.toMatchObject({ slug, billingPeriod: period, amount, currency: 'GHS' });
  });

  it('persists admin-editable plan metadata such as shortDescription', async () => {
    const plan = (await pricingService.listPricingPlans({ activeOnly: true }))[0];
    const updated = await pricingService.updatePricingPlan(plan.id, {
      ...plan,
      shortDescription: 'Essential school management tools for small schools ready to move their daily operations online.',
      recommendedBadge: true,
    });

    expect(updated.shortDescription).toBe('Essential school management tools for small schools ready to move their daily operations online.');
    expect(updated.recommendedBadge).toBe(true);

    const reloaded = await pricingService.getPricingPlan(plan.slug, 'monthly');
    expect(reloaded.shortDescription).toBe('Essential school management tools for small schools ready to move their daily operations online.');
    expect(reloaded.recommendedBadge).toBe(true);
  });

  it('rejects inactive or unknown plans and invalid periods', async () => {
    await expect(pricingService.getPricingPlan('missing', 'monthly')).rejects.toThrow('not available');
    await expect(pricingService.getPricingPlan('starter', 'termly')).rejects.toThrow('monthly or yearly');
  });

  it('initializes Paystack with the backend amount instead of a client amount', async () => {
    const originalFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: true, data: { reference: 'paystack-ref', authorization_url: 'https://checkout.test' } }),
    });
    const originalSecret = process.env.PAYSTACK_SECRET_KEY;
    const originalWebhookSecret = process.env.PAYSTACK_WEBHOOK_SECRET;
    process.env.PAYSTACK_SECRET_KEY = 'server-only-test-secret';
    process.env.PAYSTACK_WEBHOOK_SECRET = 'server-only-test-webhook-secret';
    try {
      const result = await pricingService.initializePaystackCheckout({ planSlug: 'starter', billingPeriod: 'monthly', email: 'school@example.test', amount: 1 });
      expect(result.amount).toBe(150);
      expect(global.fetch).toHaveBeenCalledWith('https://api.paystack.co/transaction/initialize', expect.objectContaining({
        body: expect.stringContaining('15000'),
        headers: expect.objectContaining({ Authorization: 'Bearer server-only-test-secret' }),
      }));
    } finally {
      global.fetch = originalFetch;
      if (originalSecret === undefined) delete process.env.PAYSTACK_SECRET_KEY;
      else process.env.PAYSTACK_SECRET_KEY = originalSecret;
    }
  });

  it.each(['pending', 'failed'])('does not activate a %s Paystack transaction', async (transactionStatus) => {
    const originalFetch = global.fetch;
    const originalSecret = process.env.PAYSTACK_SECRET_KEY;
    const firebaseData = require('../../../firebase.data');
    const firebaseMode = jest.spyOn(firebaseData, 'isFirebaseDataConfigured').mockReturnValue(false);
    process.env.PAYSTACK_SECRET_KEY = 'server-only-test-secret';
    global.fetch = jest.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: true, data: { authorization_url: 'https://checkout.test/pending', access_code: 'test-access-code' } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: true, data: { status: transactionStatus } }),
      });

    try {
      const checkout = await paymentService.initializeCheckout({
        schoolId: `school-${transactionStatus}-payment`,
        email: `${transactionStatus}@example.test`,
        planSlug: 'starter',
        billingPeriod: 'monthly',
        callbackUrl: 'https://example.test/checkout',
        acceptance: { terms: true, privacy: true, paymentRefund: true },
      });

      await expect(paymentService.verifyPayment(checkout.reference, `school-${transactionStatus}-payment`))
        .rejects.toThrow('Paystack transaction was not successful.');
      await expect(paymentService.getPayment(checkout.reference)).resolves.toMatchObject({ status: 'initialized' });
      expect(global.fetch).toHaveBeenCalledTimes(2);
    } finally {
      global.fetch = originalFetch;
      if (originalSecret === undefined) delete process.env.PAYSTACK_SECRET_KEY;
      else process.env.PAYSTACK_SECRET_KEY = originalSecret;
      firebaseMode.mockRestore();
    }
  });

  it('rejects unknown and cross-school references before accepting a verified renewal', async () => {
    const originalFetch = global.fetch;
    const originalSecret = process.env.PAYSTACK_SECRET_KEY;
    const firebaseData = require('../../../firebase.data');
    const firebaseMode = jest.spyOn(firebaseData, 'isFirebaseDataConfigured').mockReturnValue(false);
    let payment;
    process.env.PAYSTACK_SECRET_KEY = 'server-only-test-secret';
    global.fetch = jest.fn().mockImplementation(async (url) => {
      if (String(url).includes('/transaction/verify/')) {
        return {
          ok: true,
          json: async () => ({
            status: true,
            data: {
              reference: payment.reference,
              amount: payment.amountMinor,
              currency: payment.currency,
              status: 'success',
              metadata: { schoolId: payment.schoolId, planSlug: payment.planSlug, billingPeriod: payment.billingPeriod },
              paid_at: new Date().toISOString(),
            },
          }),
        };
      }
      return { ok: true, json: async () => ({ status: true, data: { authorization_url: 'https://checkout.test/verify' } }) };
    });

    try {
      const checkout = await paymentService.initializeCheckout({
        schoolId: 'school-verify-owner',
        email: 'verify@example.test',
        planSlug: 'starter',
        billingPeriod: 'monthly',
        callbackUrl: 'https://example.test/checkout',
        acceptance: { terms: true, privacy: true, paymentRefund: true },
      });
      payment = await paymentService.getPayment(checkout.reference);

      await expect(paymentService.verifyPayment('unknown-payment-reference', 'school-verify-owner'))
        .rejects.toThrow('Payment reference was not found.');
      await expect(paymentService.verifyPayment(checkout.reference, 'other-school'))
        .rejects.toThrow('Tenant mismatch.');
      expect(global.fetch).toHaveBeenCalledTimes(1);

      await expect(paymentService.verifyPayment(checkout.reference, 'school-verify-owner'))
        .resolves.toMatchObject({ status: 'activated', schoolId: 'school-verify-owner' });
      expect(global.fetch).toHaveBeenCalledTimes(2);
    } finally {
      global.fetch = originalFetch;
      if (originalSecret === undefined) delete process.env.PAYSTACK_SECRET_KEY;
      else process.env.PAYSTACK_SECRET_KEY = originalSecret;
      firebaseMode.mockRestore();
    }
  });

  it('records out-of-window refund requests without throwing and preserves the decision trail', async () => {
    const originalFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: true, data: { reference: 'paystack-refund-out', authorization_url: 'https://checkout.test/refund' } }),
    });
    const originalSecret = process.env.PAYSTACK_SECRET_KEY;
    process.env.PAYSTACK_SECRET_KEY = 'server-only-test-secret';
    try {
      const checkout = await paymentService.initializeCheckout({
        schoolId: 'school-refund-1',
        email: 'refund@example.test',
        planSlug: 'starter',
        billingPeriod: 'monthly',
        callbackUrl: 'https://example.com/checkout',
        acceptance: { terms: true, privacy: true, paymentRefund: true },
      });
      const paymentRecord = await paymentService.getPayment(checkout.reference);
      paymentRecord.paidAt = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString();
      paymentRecord.status = 'activated';

      await expect(paymentService.requestRefund({
        schoolId: paymentRecord.schoolId,
        reference: paymentRecord.reference,
        reason: 'Example refund request',
      })).resolves.toMatchObject({
        paymentReference: paymentRecord.reference,
        schoolId: paymentRecord.schoolId,
        status: 'Rejected',
        eligibility: 'outside_window',
      });
    } finally {
      global.fetch = originalFetch;
      if (originalSecret === undefined) delete process.env.PAYSTACK_SECRET_KEY;
      else process.env.PAYSTACK_SECRET_KEY = originalSecret;
    }
  });

  it('keeps webhook processing idempotent for duplicate successful events', async () => {
    const originalFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: true, data: { reference: 'paystack-webhook-idempotent', authorization_url: 'https://checkout.test/webhook' } }),
    });
    const originalSecret = process.env.PAYSTACK_SECRET_KEY;
    const originalWebhookSecret = process.env.PAYSTACK_WEBHOOK_SECRET;
    process.env.PAYSTACK_SECRET_KEY = 'server-only-test-secret';
    process.env.PAYSTACK_WEBHOOK_SECRET = 'server-only-test-webhook-secret';
    try {
      const checkout = await paymentService.initializeCheckout({
        schoolId: 'school-webhook-1',
        email: 'webhook@example.test',
        planSlug: 'starter',
        billingPeriod: 'monthly',
        callbackUrl: 'https://example.com/checkout',
        acceptance: { terms: true, privacy: true, paymentRefund: true },
      });
      const payment = await paymentService.getPayment(checkout.reference);
      payment.amountMinor = 15000;
      payment.status = 'initialized';
      const eventBody = {
        event: 'charge.success',
        data: {
          reference: checkout.reference,
          amount: 15000,
          currency: 'GHS',
          status: 'success',
          metadata: { schoolId: payment.schoolId, planSlug: payment.planSlug, billingPeriod: payment.billingPeriod },
          paid_at: new Date().toISOString(),
        },
      };
      const rawBody = JSON.stringify(eventBody);
      const signature = require('crypto').createHmac('sha512', 'server-only-test-webhook-secret').update(rawBody).digest('hex');
      const result = await paymentService.processWebhook(rawBody, signature, eventBody);
      const duplicate = await paymentService.processWebhook(rawBody, signature, eventBody);
      expect(result.processed).toBe(true);
      expect(duplicate.processed).toBe(true);
      expect((await paymentService.getPayment(checkout.reference)).status).toBe('activated');
    } finally {
      global.fetch = originalFetch;
      if (originalSecret === undefined) delete process.env.PAYSTACK_SECRET_KEY;
      else process.env.PAYSTACK_SECRET_KEY = originalSecret;
      if (originalWebhookSecret === undefined) delete process.env.PAYSTACK_WEBHOOK_SECRET;
      else process.env.PAYSTACK_WEBHOOK_SECRET = originalWebhookSecret;
    }
  });

  it('retries entitlement writes when a signed webhook previously failed partway through activation', async () => {
    const originalFetch = global.fetch;
    const originalSecret = process.env.PAYSTACK_SECRET_KEY;
    const originalWebhookSecret = process.env.PAYSTACK_WEBHOOK_SECRET;
    const records = new Map();
    let subscriptionWriteFailed = false;
    let tenant = { schoolId: 'school-webhook-retry', schoolStatus: 'active', subscriptionStatus: 'expired' };
    const firebaseData = require('../../../firebase.data');
    const firebaseCore = require('../../../firebase.core');
    const firebaseMode = jest.spyOn(firebaseData, 'isFirebaseDataConfigured').mockReturnValue(true);
    const saveById = jest.spyOn(firebaseCore, 'saveById').mockImplementation(async (collection, id, value) => {
      if (collection === 'subscriptions' && !subscriptionWriteFailed) {
        subscriptionWriteFailed = true;
        throw new Error('fixture subscription write failure');
      }
      records.set(`${collection}:${id}`, value);
      return value;
    });
    const getById = jest.spyOn(firebaseCore, 'getById').mockImplementation(async (collection, id) => records.get(`${collection}:${id}`) || null);
    const getTenant = jest.spyOn(firebaseCore, 'getTenant').mockImplementation(async () => tenant);
    const saveTenant = jest.spyOn(firebaseCore, 'saveTenant').mockImplementation(async (schoolId, patch) => {
      tenant = { ...tenant, ...patch, schoolId };
      return tenant;
    });
    const getPricingPlan = jest.spyOn(pricingService, 'getPricingPlan').mockResolvedValue({
      slug: 'starter', name: 'Starter', studentLimit: 100, billingPeriod: 'monthly', amount: 150, currency: 'GHS',
    });
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: true, data: { authorization_url: 'https://checkout.test/retry' } }),
    });
    process.env.PAYSTACK_SECRET_KEY = 'server-only-test-secret';
    process.env.PAYSTACK_WEBHOOK_SECRET = 'server-only-test-webhook-secret';

    try {
      const checkout = await paymentService.initializeCheckout({
        schoolId: tenant.schoolId,
        email: 'retry@example.test',
        planSlug: 'starter',
        billingPeriod: 'monthly',
        callbackUrl: 'https://example.test/checkout',
        acceptance: { terms: true, privacy: true, paymentRefund: true },
      });
      const payment = await paymentService.getPayment(checkout.reference);
      const event = {
        event: 'charge.success',
        data: {
          reference: checkout.reference,
          amount: payment.amountMinor,
          currency: payment.currency,
          status: 'success',
          metadata: { schoolId: payment.schoolId, planSlug: payment.planSlug, billingPeriod: payment.billingPeriod },
          paid_at: new Date().toISOString(),
        },
      };
      const rawBody = JSON.stringify(event);
      const signature = require('crypto').createHmac('sha512', process.env.PAYSTACK_WEBHOOK_SECRET).update(rawBody).digest('hex');

      await expect(paymentService.processWebhook(rawBody, signature, event)).rejects.toThrow('fixture subscription write failure');
      await expect(paymentService.processWebhook(rawBody, signature, event)).resolves.toMatchObject({ processed: true });

      expect(tenant.subscriptionStatus).toBe('active');
      expect(tenant.expiresAt).toBeTruthy();
      expect(records.get(`payments:${checkout.reference}`).status).toBe('activated');
    } finally {
      global.fetch = originalFetch;
      if (originalSecret === undefined) delete process.env.PAYSTACK_SECRET_KEY;
      else process.env.PAYSTACK_SECRET_KEY = originalSecret;
      if (originalWebhookSecret === undefined) delete process.env.PAYSTACK_WEBHOOK_SECRET;
      else process.env.PAYSTACK_WEBHOOK_SECRET = originalWebhookSecret;
      firebaseMode.mockRestore();
      saveById.mockRestore();
      getById.mockRestore();
      getTenant.mockRestore();
      saveTenant.mockRestore();
      getPricingPlan.mockRestore();
    }
  });

  it('renews subscription after verified payment without unsuspending the school', async () => {
    const originalFetch = global.fetch;
    const originalSecret = process.env.PAYSTACK_SECRET_KEY;
    const originalWebhookSecret = process.env.PAYSTACK_WEBHOOK_SECRET;
    const records = new Map();
    let tenant = { schoolId: 'school-payment-status-1', schoolStatus: 'suspended', status: 'suspended', subscriptionStatus: 'expired' };
    const firebaseData = require('../../../firebase.data');
    const firebaseCore = require('../../../firebase.core');
    const firebaseMode = jest.spyOn(firebaseData, 'isFirebaseDataConfigured').mockReturnValue(true);
    const saveById = jest.spyOn(firebaseCore, 'saveById').mockImplementation(async (collection, id, value) => {
      records.set(`${collection}:${id}`, value);
      return value;
    });
    const getById = jest.spyOn(firebaseCore, 'getById').mockImplementation(async (collection, id) => records.get(`${collection}:${id}`) || null);
    const getTenant = jest.spyOn(firebaseCore, 'getTenant').mockImplementation(async () => tenant);
    const saveTenant = jest.spyOn(firebaseCore, 'saveTenant').mockImplementation(async (schoolId, patch) => {
      tenant = { ...tenant, ...patch, schoolId };
      return tenant;
    });
    const getPricingPlan = jest.spyOn(pricingService, 'getPricingPlan').mockResolvedValue({
      slug: 'starter',
      name: 'Starter',
      studentLimit: 100,
      billingPeriod: 'monthly',
      amount: 150,
      currency: 'GHS',
    });
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: true, data: { reference: 'payment-status-renewal', authorization_url: 'https://checkout.test/renewal' } }),
    });
    process.env.PAYSTACK_SECRET_KEY = 'server-only-test-secret';
    process.env.PAYSTACK_WEBHOOK_SECRET = 'server-only-test-webhook-secret';

    try {
      const checkout = await paymentService.initializeCheckout({
        schoolId: tenant.schoolId,
        email: 'renewal@example.test',
        planSlug: 'starter',
        billingPeriod: 'monthly',
        callbackUrl: 'https://example.test/checkout',
        acceptance: { terms: true, privacy: true, paymentRefund: true },
      });
      const payment = await paymentService.getPayment(checkout.reference);
      const event = {
        event: 'charge.success',
        data: {
          reference: checkout.reference,
          amount: payment.amountMinor,
          currency: payment.currency,
          status: 'success',
          metadata: { schoolId: payment.schoolId, planSlug: payment.planSlug, billingPeriod: payment.billingPeriod },
          paid_at: new Date().toISOString(),
        },
      };
      const rawBody = JSON.stringify(event);
      const signature = require('crypto').createHmac('sha512', process.env.PAYSTACK_WEBHOOK_SECRET).update(rawBody).digest('hex');

      await paymentService.processWebhook(rawBody, signature, event);

      expect(tenant.schoolStatus).toBe('suspended');
      expect(tenant.status).toBe('suspended');
      expect(tenant.subscriptionStatus).toBe('active');
      expect(tenant.expiresAt).toBeTruthy();
      expect(saveTenant).toHaveBeenCalledWith(tenant.schoolId, expect.not.objectContaining({ schoolStatus: expect.anything(), status: expect.anything() }));
    } finally {
      global.fetch = originalFetch;
      if (originalSecret === undefined) delete process.env.PAYSTACK_SECRET_KEY;
      else process.env.PAYSTACK_SECRET_KEY = originalSecret;
      if (originalWebhookSecret === undefined) delete process.env.PAYSTACK_WEBHOOK_SECRET;
      else process.env.PAYSTACK_WEBHOOK_SECRET = originalWebhookSecret;
      firebaseMode.mockRestore();
      saveById.mockRestore();
      getById.mockRestore();
      getTenant.mockRestore();
      saveTenant.mockRestore();
      getPricingPlan.mockRestore();
    }
  });

  it('rejects shell-command text as a webhook secret without falling back to the API secret', () => {
    const originalSecret = process.env.PAYSTACK_SECRET_KEY;
    const originalWebhookSecret = process.env.PAYSTACK_WEBHOOK_SECRET;
    const rawBody = '{"event":"charge.success"}';
    process.env.PAYSTACK_SECRET_KEY = 'api-secret-test-value';
    process.env.PAYSTACK_WEBHOOK_SECRET = 'cd "C:\\temporary path"';
    const signature = require('crypto').createHmac('sha512', process.env.PAYSTACK_WEBHOOK_SECRET).update(rawBody).digest('hex');

    try {
      expect(paymentService.verifyWebhookSignature(rawBody, signature)).toBe(false);
    } finally {
      if (originalSecret === undefined) delete process.env.PAYSTACK_SECRET_KEY;
      else process.env.PAYSTACK_SECRET_KEY = originalSecret;
      if (originalWebhookSecret === undefined) delete process.env.PAYSTACK_WEBHOOK_SECRET;
      else process.env.PAYSTACK_WEBHOOK_SECRET = originalWebhookSecret;
    }
  });
});
