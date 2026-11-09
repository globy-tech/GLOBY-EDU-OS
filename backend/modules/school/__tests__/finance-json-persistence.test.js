const fs = require('fs');
const os = require('os');
const path = require('path');

const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'globy-finance-json-'));
const schoolsFile = path.join(tempDirectory, 'schools.json');
const originalQaConfiguration = {
  GLOBY_QA_HOME: process.env.GLOBY_QA_HOME,
  GLOBY_SCHOOLS_FILE: process.env.GLOBY_SCHOOLS_FILE,
  GLOBY_AUDIT_FILE: process.env.GLOBY_AUDIT_FILE,
  GLOBY_PASSWORD_RESET_TOKENS_FILE: process.env.GLOBY_PASSWORD_RESET_TOKENS_FILE,
  DATA_STORE_MODE: process.env.DATA_STORE_MODE,
};
process.env.GLOBY_QA_HOME = tempDirectory;
process.env.GLOBY_SCHOOLS_FILE = schoolsFile;
process.env.GLOBY_AUDIT_FILE = path.join(tempDirectory, 'audit-logs.json');
process.env.GLOBY_PASSWORD_RESET_TOKENS_FILE = path.join(tempDirectory, 'password-reset-tokens.json');
process.env.DATA_STORE_MODE = 'json';

const schoolService = require('../school.service');
const firebaseCore = require('../../../firebase.core');
const prisma = require('../../../config/prisma.client');

const SCHOOL_ID = 'finance-json-qa-school';
const ACTOR = { userId: 'finance-json-authority', roles: ['school_authority'], tenantId: SCHOOL_ID };
const STUDENT = {
  id: 'finance-json-student-id',
  studentId: 'finance-json-student',
  fullName: 'Finance JSON Student',
  email: 'finance-json-student@example.test',
  className: 'Class 1',
};

describe('isolated JSON fallback finance persistence', () => {
  beforeEach(() => {
    jest.spyOn(firebaseCore, 'isFirebaseCoreMode').mockReturnValue(false);
    Object.defineProperty(prisma, '__stub', { configurable: true, value: true });
    fs.writeFileSync(schoolsFile, JSON.stringify({
      schools: [{
        id: SCHOOL_ID,
        schoolId: SCHOOL_ID,
        schoolCode: 'FINANCEJSON',
        name: 'Finance JSON QA School',
        status: 'trial',
        subscriptionStatus: 'trial',
        students: [STUDENT],
        invoices: [],
        payments: [{
          id: 'finance-json-payment',
          schoolId: SCHOOL_ID,
          studentId: STUDENT.studentId,
          studentName: STUDENT.fullName,
          amount: 80,
          reference: 'CASH-JSON-QA',
          status: 'received',
        }],
        receipts: [],
        refunds: [],
      }],
    }));
  });

  afterEach(() => jest.restoreAllMocks());

  afterAll(() => {
    for (const [variable, value] of Object.entries(originalQaConfiguration)) {
      if (value === undefined) delete process.env[variable];
      else process.env[variable] = value;
    }
    fs.rmSync(tempDirectory, { recursive: true, force: true });
  });

  test('persists invoices and pending refund requests to only the isolated fallback store', async () => {
    const invoice = await schoolService.createSchoolInvoice(SCHOOL_ID, {
      invoiceNumber: 'FINANCE-JSON-001',
      studentId: STUDENT.studentId,
      amount: 45,
      dueDate: '2026-12-01',
      description: 'JSON fallback test',
    }, ACTOR, 'json-invoice-key-0001');
    const refund = await schoolService.createSchoolRefundRequest(SCHOOL_ID, {
      paymentId: 'finance-json-payment',
      amount: 25,
      reason: 'JSON fallback refund review',
    }, ACTOR, 'json-refund-key-0001');
    const persisted = JSON.parse(fs.readFileSync(schoolsFile, 'utf8')).schools[0];

    expect(persisted.invoices).toHaveLength(1);
    expect(persisted.invoices[0]).toMatchObject({ id: invoice.id, status: 'pending', amount: 45 });
    expect(persisted.refunds).toHaveLength(1);
    expect(persisted.refunds[0]).toMatchObject({ id: refund.id, status: 'pending_review', amount: 25 });
    expect(persisted.invoices[0].requestHash).toMatch(/^[a-f0-9]{64}$/);
    expect(persisted.refunds[0].requestHash).toMatch(/^[a-f0-9]{64}$/);
    expect(persisted.invoices[0]).not.toHaveProperty('idempotencyKey');
    expect(persisted.refunds[0]).not.toHaveProperty('idempotencyKey');
    expect(path.resolve(process.env.GLOBY_SCHOOLS_FILE)).toBe(schoolsFile);
  });

  test('persists verified invoice settlement and receipt in the isolated JSON fallback', async () => {
    const invoice = await schoolService.createSchoolInvoice(SCHOOL_ID, {
      invoiceNumber: 'FINANCE-JSON-002',
      studentId: STUDENT.studentId,
      amount: 45,
      dueDate: '2026-12-01',
    }, ACTOR, 'json-invoice-key-0002');
    const previousKey = process.env.PAYSTACK_SECRET_KEY;
    const previousQa = process.env.GLOBY_QA_MODE;
    process.env.PAYSTACK_SECRET_KEY = 'test-paystack-secret';
    process.env.GLOBY_QA_MODE = 'false';
    const fetch = jest.spyOn(global, 'fetch').mockImplementation(async (url, options) => {
      if (String(url).endsWith('/transaction/initialize')) {
        const request = JSON.parse(options.body);
        return {
          ok: true,
          json: async () => ({
            status: true,
            data: { authorization_url: 'https://checkout.paystack.com/json', reference: request.reference },
          }),
        };
      }
      const reference = String(url).split('/').pop();
      return {
        ok: true,
        json: async () => ({
          status: true,
          data: {
            id: 7001,
            status: 'success',
            reference,
            amount: 4500,
            currency: 'USD',
            metadata: { schoolId: SCHOOL_ID, invoiceId: invoice.id, studentId: STUDENT.studentId },
          },
        }),
      };
    });

    try {
      const checkout = await schoolService.initializeInvoicePayment(
        SCHOOL_ID, invoice.id, ACTOR, 'json-checkout-key-0001',
      );
      const settlement = await schoolService.verifyAndLinkInvoicePayment(
        SCHOOL_ID,
        invoice.id,
        { reference: checkout.reference },
        ACTOR,
        'json-settlement-key-0001',
      );
      const persisted = JSON.parse(fs.readFileSync(schoolsFile, 'utf8')).schools[0];
      expect(settlement.invoice.status).toBe('paid');
      expect(persisted.invoices[0]).toMatchObject({
        id: invoice.id,
        status: 'paid',
        paymentReference: checkout.reference,
      });
      expect(persisted.payments.find((entry) => entry.reference === checkout.reference).status).toBe('verified');
      expect(persisted.receipts).toHaveLength(1);
      expect(persisted.receipts[0].paymentId).toBe(settlement.payment.id);
      expect(fetch).toHaveBeenCalledTimes(2);
    } finally {
      if (previousKey === undefined) delete process.env.PAYSTACK_SECRET_KEY;
      else process.env.PAYSTACK_SECRET_KEY = previousKey;
      if (previousQa === undefined) delete process.env.GLOBY_QA_MODE;
      else process.env.GLOBY_QA_MODE = previousQa;
    }
  });
});
