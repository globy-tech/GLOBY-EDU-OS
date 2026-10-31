const fs = require('fs');

describe('isolated QA pricing and payment safeguards', () => {
  const originalQaMode = process.env.GLOBY_QA_MODE;

  beforeEach(() => {
    jest.resetModules();
    process.env.GLOBY_QA_MODE = 'true';
  });

  afterAll(() => {
    if (originalQaMode === undefined) delete process.env.GLOBY_QA_MODE;
    else process.env.GLOBY_QA_MODE = originalQaMode;
  });

  test('serves synthetic pricing without reading the shared pricing file', async () => {
    const readFileSync = jest.spyOn(fs, 'readFileSync');
    const pricingService = require('../pricing.service');

    try {
      await expect(pricingService.listPricingPlans()).resolves.toEqual([
        expect.objectContaining({ id: 'qa-basic', slug: 'qa-basic', monthlyAmount: 0, yearlyAmount: 0 }),
      ]);
      expect(readFileSync).not.toHaveBeenCalled();
      await expect(pricingService.updatePricingPlan('qa-basic', { name: 'Changed' }))
        .rejects.toThrow('Pricing updates are disabled in isolated QA mode.');
    } finally {
      readFileSync.mockRestore();
    }
  });

  test.each([
    ['checkout', (service) => service.initializeCheckout({ schoolId: 'qa-school' })],
    ['payment verification', (service) => service.verifyPayment('qa-reference')],
    ['webhook processing', (service) => service.processWebhook('', '', {})],
    ['refund requests', (service) => service.requestRefund({ schoolId: 'qa-school', reference: 'qa-reference' })],
  ])('blocks %s before contacting external services', async (_label, invoke) => {
    const paymentService = require('../payment.service');
    const fetch = jest.spyOn(global, 'fetch');

    try {
      await expect(invoke(paymentService)).rejects.toThrow('Payment operations are disabled in isolated QA mode.');
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      fetch.mockRestore();
    }
  });
});
