const fs = require('fs');
const path = require('path');
const express = require('express');
const originalQaMode = process.env.GLOBY_QA_MODE;
process.env.GLOBY_QA_MODE = 'false';
const apiRouter = require('../../../routes/api');
const { signAccessToken } = require('../../auth/utils/token');

const pricingFile = path.join(__dirname, '../../../data/pricing-plans.json');
const originalPricing = fs.readFileSync(pricingFile, 'utf8');

function createToken(roles, platformAdmin = false) {
  return signAccessToken({ userId: 'pricing-test-user', tenantId: platformAdmin ? null : 'globy-school', roles, platformAdmin, passwordNeedsReset: false });
}

describe('pricing API permissions', () => {
  let server;

  beforeAll(() => {
    const app = express();
    app.use(express.json());
    app.use('/api/v1', apiRouter);
    server = app.listen(0);
  });

  afterAll(async () => {
    try {
      fs.writeFileSync(pricingFile, originalPricing, 'utf8');
      await new Promise((resolve) => server.close(resolve));
    } finally {
      if (originalQaMode === undefined) delete process.env.GLOBY_QA_MODE;
      else process.env.GLOBY_QA_MODE = originalQaMode;
    }
  });

  it('allows public active pricing reads', async () => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/pricing`);
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.pricingPlans).toHaveLength(3);
  });

  it('allows only platform Super Admin to update pricing', async () => {
    const teacher = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/pricing/starter-plan`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${createToken(['teacher'])}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Changed', studentLimit: 100, monthlyAmount: 175, yearlyAmount: 1500, currency: 'GHS', active: true, displayOrder: 1 }),
    });
    expect(teacher.status).toBe(403);

    const admin = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/pricing/starter-plan`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${createToken(['super_admin'], true)}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Starter', studentLimit: 100, monthlyAmount: 175, yearlyAmount: 1500, currency: 'GHS', active: true, displayOrder: 1 }),
    });
    const body = await admin.json();
    expect(admin.status).toBe(200);
    expect(body.pricingPlan.monthlyAmount).toBe(175);
  });
});
