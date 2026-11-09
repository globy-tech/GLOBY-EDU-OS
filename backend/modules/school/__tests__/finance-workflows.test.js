const fs = require('fs');
const path = require('path');
jest.mock('../../audit/audit.service', () => ({
  listAuditEvents: jest.fn(),
  recordAuditEvent: jest.fn().mockResolvedValue({}),
}));

const schoolService = require('../school.service');
const schoolController = require('../school.controller');
const firebaseData = require('../../../firebase.data');
const firebaseCore = require('../../../firebase.core');
const prisma = require('../../../config/prisma.client');
const { recordAuditEvent } = require('../../audit/audit.service');

const SCHOOL_ID = 'finance-qa-school';
const ACTOR = { userId: 'finance-authority', roles: ['school_authority'], tenantId: SCHOOL_ID };

function createFirestore(initialTenant) {
  let tenant = structuredClone(initialTenant);
  let version = 0;
  const tenantDocument = { id: SCHOOL_ID };
  const firestore = {
    collection: jest.fn(() => ({ doc: jest.fn(() => tenantDocument) })),
    runTransaction: jest.fn(async (callback) => {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        let readVersion;
        let pendingWrite;
        const transaction = {
          get: jest.fn(async () => {
            readVersion = version;
            const snapshotTenant = structuredClone(tenant);
            return { id: SCHOOL_ID, exists: true, data: () => snapshotTenant };
          }),
          set: jest.fn((document, updates) => {
            if (document !== tenantDocument) throw new Error('Unexpected transaction document.');
            pendingWrite = updates;
          }),
        };
        const result = await callback(transaction);
        if (readVersion !== version) continue;
        tenant = { ...tenant, ...structuredClone(pendingWrite) };
        version += 1;
        return result;
      }
      throw new Error('Transaction aborted after retry limit.');
    }),
  };
  return {
    firestore,
    getTenant: () => structuredClone(tenant),
    setTenant: (value) => { tenant = structuredClone(value); },
  };
}

function routeHandlers(method, routePath) {
  const layer = schoolController.stack.find((entry) => entry.route?.path === routePath && entry.route.methods[method]);
  if (!layer) throw new Error(`Route not found: ${method.toUpperCase()} ${routePath}`);
  return layer.route.stack;
}

describe('school finance workflows', () => {
  let fixture;
  const student = { studentId: 'student-qa-1', fullName: 'QA Student', email: 'student@example.test', className: 'Class 1' };
  const payment = { id: 'payment-qa-1', studentId: student.studentId, studentName: student.fullName, amount: 100, status: 'received', reference: 'BANK-QA-1' };

  beforeEach(() => {
    recordAuditEvent.mockClear();
    fixture = createFirestore({
      schoolId: SCHOOL_ID,
      name: 'Finance QA School',
      schoolStatus: 'active',
      subscriptionStatus: 'trial',
      invoices: [],
      payments: [payment],
      receipts: [],
      refunds: [],
    });
    jest.spyOn(firebaseData, 'isFirebaseDataConfigured').mockReturnValue(true);
    jest.spyOn(firebaseData, 'getFirestore').mockReturnValue(fixture.firestore);
    jest.spyOn(firebaseCore, 'getSchoolAggregate').mockImplementation(async () => ({
      ...fixture.getTenant(),
      id: SCHOOL_ID,
      students: [student],
    }));
  });

  test('blocks all payment-provider calls in isolated QA mode', async () => {
    const invoice = await schoolService.createSchoolInvoice(SCHOOL_ID, invoiceInput(), ACTOR, 'invoice-key-0015');
    const previousKey = process.env.PAYSTACK_SECRET_KEY;
    const previousQa = process.env.GLOBY_QA_MODE;
    process.env.PAYSTACK_SECRET_KEY = 'test-paystack-secret';
    process.env.GLOBY_QA_MODE = 'true';
    const fetch = jest.spyOn(global, 'fetch');

    try {
      await expect(schoolService.initializeInvoicePayment(
        SCHOOL_ID, invoice.id, ACTOR, 'checkout-key-qa-001',
      )).rejects.toMatchObject({ statusCode: 503 });
      await expect(schoolService.verifyAndLinkInvoicePayment(
        SCHOOL_ID, invoice.id, { reference: 'PAYSTACK-QA-001' }, ACTOR, 'settlement-key-qa-001',
      )).rejects.toMatchObject({ statusCode: 503 });
      expect(fetch).not.toHaveBeenCalled();
      expect(fixture.getTenant().invoices[0].status).toBe('pending');
    } finally {
      if (previousKey === undefined) delete process.env.PAYSTACK_SECRET_KEY;
      else process.env.PAYSTACK_SECRET_KEY = previousKey;
      if (previousQa === undefined) delete process.env.GLOBY_QA_MODE;
      else process.env.GLOBY_QA_MODE = previousQa;
    }
  });

  afterEach(() => jest.restoreAllMocks());

  function invoiceInput(overrides = {}) {
    return {
      invoiceNumber: 'INV-QA-001',
      studentId: student.studentId,
      amount: 125.5,
      dueDate: '2026-11-15',
      description: 'Term fees',
      ...overrides,
    };
  }

  function successfulPaystackResponse(invoice, overrides = {}) {
    return {
      ok: true,
      json: async () => ({
        status: true,
        data: {
          id: 98765,
          status: 'success',
          reference: 'PAYSTACK-QA-001',
          amount: 12550,
          currency: 'USD',
          paid_at: '2026-11-08T12:00:00.000Z',
          metadata: {
            schoolId: SCHOOL_ID,
            invoiceId: invoice.id,
            studentId: student.studentId,
          },
          ...overrides,
        },
      }),
    };
  }

  function recordInitializedCheckout(invoice, reference = 'PAYSTACK-QA-001') {
    const tenant = fixture.getTenant();
    fixture.setTenant({
      ...tenant,
      payments: [...tenant.payments, {
        id: 'checkout-qa-1',
        schoolId: SCHOOL_ID,
        invoiceId: invoice.id,
        studentId: invoice.studentId,
        studentName: invoice.student,
        amount: invoice.amount,
        currency: invoice.currency,
        reference,
        provider: 'paystack',
        status: 'initialized',
        checkoutUrl: 'https://checkout.paystack.com/authorize',
      }],
    });
  }

  test('creates an authorized invoice with tenant-verified student data and pending status', async () => {
    const invoice = await schoolService.createSchoolInvoice(SCHOOL_ID, invoiceInput(), ACTOR, 'invoice-key-0001');

    expect(invoice).toMatchObject({
      schoolId: SCHOOL_ID,
      invoiceNumber: 'INV-QA-001',
      studentId: student.studentId,
      student: student.fullName,
      amount: 125.5,
      status: 'pending',
    });
    expect(invoice).not.toHaveProperty('idempotencyHash');
    expect(invoice).not.toHaveProperty('requestHash');
    expect(fixture.getTenant().invoices).toHaveLength(1);
  });

  test('makes invoice creation idempotent and rejects a reused key with different input', async () => {
    const first = await schoolService.createSchoolInvoice(SCHOOL_ID, invoiceInput(), ACTOR, 'invoice-key-0002');
    const retry = await schoolService.createSchoolInvoice(SCHOOL_ID, invoiceInput(), ACTOR, 'invoice-key-0002');

    expect(retry).toEqual(first);
    expect(fixture.getTenant().invoices).toHaveLength(1);
    await expect(schoolService.createSchoolInvoice(SCHOOL_ID, invoiceInput({ amount: 99 }), ACTOR, 'invoice-key-0002'))
      .rejects.toMatchObject({ statusCode: 409 });
  });

  test('rejects duplicate invoice numbers, invalid payloads and students outside the school', async () => {
    await schoolService.createSchoolInvoice(SCHOOL_ID, invoiceInput(), ACTOR, 'invoice-key-0003');
    await expect(schoolService.createSchoolInvoice(SCHOOL_ID, invoiceInput({ invoiceNumber: 'inv-qa-001' }), ACTOR, 'invoice-key-0004'))
      .rejects.toMatchObject({ statusCode: 409 });
    await expect(schoolService.createSchoolInvoice(SCHOOL_ID, invoiceInput({ amount: 0 }), ACTOR, 'invoice-key-0005'))
      .rejects.toThrow('Invoice amount must be a positive amount');
    await expect(schoolService.createSchoolInvoice(SCHOOL_ID, invoiceInput({ studentId: 'other-school-student' }), ACTOR, 'invoice-key-0006'))
      .rejects.toThrow('selected student does not belong to this school');
    await expect(schoolService.createSchoolInvoice(SCHOOL_ID, invoiceInput({ status: 'paid' }), ACTOR, 'invoice-key-0007'))
      .rejects.toThrow('unsupported fields');
  });

  test('accepts valid two-decimal amounts affected by binary floating-point representation', async () => {
    const invoice = await schoolService.createSchoolInvoice(
      SCHOOL_ID,
      invoiceInput({ invoiceNumber: 'INV-QA-115', amount: 1.15 }),
      ACTOR,
      'invoice-key-1150',
    );

    expect(invoice.amount).toBe(1.15);
  });

  test('does not expose internal idempotency hashes in student finance aliases', () => {
    const school = schoolService.getStudentSchoolView({
      schoolId: SCHOOL_ID,
      students: [{ studentId: student.studentId, fullName: student.fullName, className: 'Class 1' }],
      payments: [{
        ...payment,
        idempotencyHash: 'internal-idempotency-hash',
        requestHash: 'internal-request-hash',
      }],
    }, { userId: `${SCHOOL_ID}:${student.studentId}`, roles: ['student'] });

    expect(school.payments[0]).not.toHaveProperty('idempotencyHash');
    expect(school.fees[0]).not.toHaveProperty('idempotencyHash');
    expect(school.fees[0]).not.toHaveProperty('requestHash');
  });

  test('denies unauthorized roles and cross-school actors', async () => {
    await expect(schoolService.createSchoolInvoice(SCHOOL_ID, invoiceInput(), {
      userId: 'teacher-qa', roles: ['teacher'], tenantId: SCHOOL_ID,
    }, 'invoice-key-0008')).rejects.toMatchObject({ statusCode: 403 });
    await expect(schoolService.listSchoolInvoices(SCHOOL_ID, {
      userId: 'other-authority', roles: ['school_authority'], tenantId: 'another-school',
    })).rejects.toMatchObject({ statusCode: 403 });
  });

  test('allows cancellation but never permits an invoice to be marked paid by status input', async () => {
    const invoice = await schoolService.createSchoolInvoice(SCHOOL_ID, invoiceInput(), ACTOR, 'invoice-key-0009');
    const cancelled = await schoolService.cancelSchoolInvoice(SCHOOL_ID, invoice.id, { status: 'cancelled' }, ACTOR);

    expect(cancelled.status).toBe('cancelled');
    await expect(schoolService.cancelSchoolInvoice(SCHOOL_ID, invoice.id, { status: 'paid' }, ACTOR))
      .rejects.toThrow('may only be cancelled');
  });

  test('initializes Paystack checkout with server-calculated invoice values and idempotently reuses it', async () => {
    const invoice = await schoolService.createSchoolInvoice(SCHOOL_ID, invoiceInput(), ACTOR, 'invoice-key-0012');
    const previousKey = process.env.PAYSTACK_SECRET_KEY;
    const previousQa = process.env.GLOBY_QA_MODE;
    process.env.PAYSTACK_SECRET_KEY = 'test-paystack-secret';
    process.env.GLOBY_QA_MODE = 'false';
    const fetch = jest.spyOn(global, 'fetch').mockImplementation(async (_url, options) => {
      const request = JSON.parse(options.body);
      return {
        ok: true,
        json: async () => ({
          status: true,
          data: { authorization_url: 'https://checkout.paystack.com/authorize', reference: request.reference },
        }),
      };
    });

    try {
      const checkout = await schoolService.initializeInvoicePayment(
        SCHOOL_ID, invoice.id, ACTOR, 'checkout-key-0001',
      );
      const retry = await schoolService.initializeInvoicePayment(
        SCHOOL_ID, invoice.id, ACTOR, 'checkout-key-0001',
      );
      const requestBody = JSON.parse(fetch.mock.calls[0][1].body);
      expect(checkout).toEqual(retry);
      expect(checkout).toMatchObject({
        invoiceId: invoice.id,
        amount: invoice.amount,
        currency: invoice.currency,
        status: 'initialized',
      });
      expect(checkout.idempotencyHash).toBeUndefined();
      expect(requestBody).toMatchObject({
        email: student.email,
        amount: 12550,
        currency: 'USD',
        metadata: { schoolId: SCHOOL_ID, invoiceId: invoice.id, studentId: student.studentId },
      });
      expect(fixture.getTenant().payments.filter((entry) => entry.invoiceId === invoice.id)).toHaveLength(1);
      expect(fetch).toHaveBeenCalledTimes(1);
    } finally {
      if (previousKey === undefined) delete process.env.PAYSTACK_SECRET_KEY;
      else process.env.PAYSTACK_SECRET_KEY = previousKey;
      if (previousQa === undefined) delete process.env.GLOBY_QA_MODE;
      else process.env.GLOBY_QA_MODE = previousQa;
    }
  });

  test('reserves one checkout per invoice before contacting Paystack', async () => {
    const invoice = await schoolService.createSchoolInvoice(SCHOOL_ID, invoiceInput(), ACTOR, 'invoice-key-0013');
    const previousKey = process.env.PAYSTACK_SECRET_KEY;
    const previousQa = process.env.GLOBY_QA_MODE;
    process.env.PAYSTACK_SECRET_KEY = 'test-paystack-secret';
    process.env.GLOBY_QA_MODE = 'false';
    let releaseFetch;
    let requestReference;
    const fetch = jest.spyOn(global, 'fetch').mockImplementation(async (_url, options) => {
      requestReference = JSON.parse(options.body).reference;
      return new Promise((resolve) => { releaseFetch = resolve; });
    });

    try {
      const firstRequest = schoolService.initializeInvoicePayment(
        SCHOOL_ID, invoice.id, ACTOR, 'checkout-key-concurrent-001',
      );
      for (let attempt = 0; attempt < 10 && !releaseFetch; attempt += 1) {
        await new Promise((resolve) => setImmediate(resolve));
      }
      expect(releaseFetch).toBeDefined();
      await expect(schoolService.initializeInvoicePayment(
        SCHOOL_ID, invoice.id, ACTOR, 'checkout-key-concurrent-001',
      )).rejects.toMatchObject({ statusCode: 409 });
      expect(fetch).toHaveBeenCalledTimes(1);
      releaseFetch({
        ok: true,
        json: async () => ({
          status: true,
          data: { authorization_url: 'https://checkout.paystack.com/concurrent', reference: requestReference },
        }),
      });
      await expect(firstRequest).resolves.toMatchObject({ status: 'initialized', reference: requestReference });
      expect(fixture.getTenant().payments.filter((entry) => entry.invoiceId === invoice.id)).toHaveLength(1);
    } finally {
      if (previousKey === undefined) delete process.env.PAYSTACK_SECRET_KEY;
      else process.env.PAYSTACK_SECRET_KEY = previousKey;
      if (previousQa === undefined) delete process.env.GLOBY_QA_MODE;
      else process.env.GLOBY_QA_MODE = previousQa;
    }
  });

  test('does not report checkout success or permit duplicate attempts after provider initialization fails', async () => {
    const invoice = await schoolService.createSchoolInvoice(SCHOOL_ID, invoiceInput(), ACTOR, 'invoice-key-0014');
    const previousKey = process.env.PAYSTACK_SECRET_KEY;
    const previousQa = process.env.GLOBY_QA_MODE;
    process.env.PAYSTACK_SECRET_KEY = 'test-paystack-secret';
    process.env.GLOBY_QA_MODE = 'false';
    const fetch = jest.spyOn(global, 'fetch').mockRejectedValue(new Error('provider unavailable'));

    try {
      await expect(schoolService.initializeInvoicePayment(
        SCHOOL_ID, invoice.id, ACTOR, 'checkout-key-failed-001',
      )).rejects.toMatchObject({ statusCode: 502 });
      expect(fixture.getTenant().invoices[0]).toMatchObject({
        id: invoice.id,
        status: 'pending',
        checkoutStatus: 'initialization_failed',
      });
      expect(fixture.getTenant().payments.at(-1).status).toBe('initialization_failed');
      await expect(schoolService.initializeInvoicePayment(
        SCHOOL_ID, invoice.id, ACTOR, 'checkout-key-failed-002',
      )).rejects.toMatchObject({ statusCode: 409 });
      expect(fetch).toHaveBeenCalledTimes(1);
    } finally {
      if (previousKey === undefined) delete process.env.PAYSTACK_SECRET_KEY;
      else process.env.PAYSTACK_SECRET_KEY = previousKey;
      if (previousQa === undefined) delete process.env.GLOBY_QA_MODE;
      else process.env.GLOBY_QA_MODE = previousQa;
    }
  });

  test('links an invoice only after exact Paystack payment and tenant metadata verification', async () => {
    const invoice = await schoolService.createSchoolInvoice(SCHOOL_ID, invoiceInput(), ACTOR, 'invoice-key-0010');
    recordInitializedCheckout(invoice);
    const previousKey = process.env.PAYSTACK_SECRET_KEY;
    const previousQa = process.env.GLOBY_QA_MODE;
    process.env.PAYSTACK_SECRET_KEY = 'test-paystack-secret';
    process.env.GLOBY_QA_MODE = 'false';
    const fetch = jest.spyOn(global, 'fetch').mockResolvedValue(successfulPaystackResponse(invoice));

    try {
      const result = await schoolService.verifyAndLinkInvoicePayment(
        SCHOOL_ID,
        invoice.id,
        { reference: 'PAYSTACK-QA-001' },
        ACTOR,
        'settlement-key-0001',
      );
      expect(result.invoice.status).toBe('paid');
      expect(result.invoice.paymentReference).toBe('PAYSTACK-QA-001');
      expect(result.payment).toMatchObject({
        invoiceId: invoice.id,
        reference: 'PAYSTACK-QA-001',
        status: 'verified',
        provider: 'paystack',
      });
      expect(fixture.getTenant().payments.at(-1)).toEqual(result.payment);
      expect(fixture.getTenant().receipts.at(-1).paymentId).toBe(result.payment.id);
      const retry = await schoolService.verifyAndLinkInvoicePayment(
        SCHOOL_ID, invoice.id, { reference: 'PAYSTACK-QA-001' }, ACTOR, 'settlement-key-retry',
      );
      expect(retry).toMatchObject({ alreadyLinked: true, invoice: result.invoice, payment: null });
      expect(fixture.getTenant().payments.filter((entry) => entry.reference === 'PAYSTACK-QA-001')).toHaveLength(1);
      expect(fetch).toHaveBeenCalledWith(
        'https://api.paystack.co/transaction/verify/PAYSTACK-QA-001',
        expect.objectContaining({ headers: { Authorization: 'Bearer test-paystack-secret' } }),
      );
    } finally {
      if (previousKey === undefined) delete process.env.PAYSTACK_SECRET_KEY;
      else process.env.PAYSTACK_SECRET_KEY = previousKey;
      if (previousQa === undefined) delete process.env.GLOBY_QA_MODE;
      else process.env.GLOBY_QA_MODE = previousQa;
    }
  });

  test.each([
    ['provider reports failure', { status: 'failed' }],
    ['wrong amount', { amount: 12549 }],
    ['wrong currency', { currency: 'GHS' }],
    ['wrong tenant metadata', { metadata: { schoolId: 'other-school', invoiceId: 'invoice', studentId: student.studentId } }],
    ['wrong invoice metadata', { metadata: { schoolId: SCHOOL_ID, invoiceId: 'other-invoice', studentId: student.studentId } }],
    ['wrong student metadata', { metadata: { schoolId: SCHOOL_ID, invoiceId: 'invoice', studentId: 'other-student' } }],
  ])('does not mutate the invoice when Paystack verification fails: %s', async (_label, overrides) => {
    const invoice = await schoolService.createSchoolInvoice(SCHOOL_ID, invoiceInput(), ACTOR, `invoice-key-${_label.replace(/\W/g, '').padEnd(4, '0')}`);
    recordInitializedCheckout(invoice);
    const previousKey = process.env.PAYSTACK_SECRET_KEY;
    const previousQa = process.env.GLOBY_QA_MODE;
    process.env.PAYSTACK_SECRET_KEY = 'test-paystack-secret';
    process.env.GLOBY_QA_MODE = 'false';
    jest.spyOn(global, 'fetch').mockResolvedValue(successfulPaystackResponse(invoice, overrides));

    try {
      await expect(schoolService.verifyAndLinkInvoicePayment(
        SCHOOL_ID,
        invoice.id,
        { reference: 'PAYSTACK-QA-001' },
        ACTOR,
        'settlement-key-0002',
      )).rejects.toMatchObject({ statusCode: 409 });
      expect(fixture.getTenant().invoices[0].status).toBe('pending');
      expect(fixture.getTenant().payments).toHaveLength(2);
      expect(fixture.getTenant().payments[1]).toMatchObject({
        reference: 'PAYSTACK-QA-001',
        status: 'initialized',
      });
      expect(fixture.getTenant().receipts).toEqual([]);
    } finally {
      if (previousKey === undefined) delete process.env.PAYSTACK_SECRET_KEY;
      else process.env.PAYSTACK_SECRET_KEY = previousKey;
      if (previousQa === undefined) delete process.env.GLOBY_QA_MODE;
      else process.env.GLOBY_QA_MODE = previousQa;
    }
  });

  test('leaves invoice pending when Paystack is unavailable and rejects cross-school settlement', async () => {
    const invoice = await schoolService.createSchoolInvoice(SCHOOL_ID, invoiceInput(), ACTOR, 'invoice-key-0011');
    recordInitializedCheckout(invoice);
    const previousKey = process.env.PAYSTACK_SECRET_KEY;
    const previousQa = process.env.GLOBY_QA_MODE;
    process.env.PAYSTACK_SECRET_KEY = 'test-paystack-secret';
    process.env.GLOBY_QA_MODE = 'false';
    const fetch = jest.spyOn(global, 'fetch').mockRejectedValue(new Error('network unavailable'));
    try {
      await expect(schoolService.verifyAndLinkInvoicePayment(
        SCHOOL_ID,
        invoice.id,
        { reference: 'PAYSTACK-QA-001' },
        { ...ACTOR, tenantId: 'another-school' },
        'settlement-key-0003',
      )).rejects.toMatchObject({ statusCode: 403 });
      expect(fetch).not.toHaveBeenCalled();
      await expect(schoolService.verifyAndLinkInvoicePayment(
        SCHOOL_ID,
        invoice.id,
        { reference: 'PAYSTACK-QA-001' },
        ACTOR,
        'settlement-key-0004',
      )).rejects.toMatchObject({ statusCode: 502 });
      expect(fixture.getTenant().invoices[0].status).toBe('pending');
      expect(fixture.getTenant().payments).toHaveLength(2);
      expect(fixture.getTenant().payments[1]).toMatchObject({
        reference: 'PAYSTACK-QA-001',
        status: 'initialized',
      });
    } finally {
      if (previousKey === undefined) delete process.env.PAYSTACK_SECRET_KEY;
      else process.env.PAYSTACK_SECRET_KEY = previousKey;
      if (previousQa === undefined) delete process.env.GLOBY_QA_MODE;
      else process.env.GLOBY_QA_MODE = previousQa;
    }
  });

  test('persists finance records through the Prisma tenant transaction path', async () => {
    const originalStubDescriptor = Object.getOwnPropertyDescriptor(prisma, '__stub');
    const originalTransactionDescriptor = Object.getOwnPropertyDescriptor(prisma, '$transaction');
    const previousKey = process.env.PAYSTACK_SECRET_KEY;
    const previousQa = process.env.GLOBY_QA_MODE;
    const tenantRecord = {
      id: 'finance-prisma-tenant',
      schoolId: SCHOOL_ID,
      name: 'Finance Prisma QA School',
      status: 'trial',
      subscriptionStatus: 'trial',
      invoices: [],
      payments: [payment],
      receipts: [],
      refunds: [],
      users: [{
        id: 'prisma-student',
        email: 'student@example.test',
        firstName: 'QA',
        lastName: 'Student',
        metadata: { studentId: student.studentId },
        roles: [{ role: { name: 'student' } }],
      }],
    };
    const transaction = {
      tenant: {
        findUnique: jest.fn(async () => structuredClone(tenantRecord)),
        update: jest.fn(async ({ data }) => {
          Object.assign(tenantRecord, structuredClone(data));
          return structuredClone(tenantRecord);
        }),
      },
    };
    Object.defineProperty(prisma, '__stub', { configurable: true, value: false });
    Object.defineProperty(prisma, '$transaction', {
      configurable: true,
      value: jest.fn(async (callback) => callback(transaction)),
    });
    jest.spyOn(firebaseCore, 'isFirebaseCoreMode').mockReturnValue(false);
    jest.spyOn(prisma.tenant, 'findUnique').mockImplementation(async () => structuredClone(tenantRecord));
    process.env.PAYSTACK_SECRET_KEY = 'test-paystack-secret';
    process.env.GLOBY_QA_MODE = 'false';
    const fetch = jest.spyOn(global, 'fetch').mockImplementation(async (url, options) => {
      if (String(url).endsWith('/transaction/initialize')) {
        const request = JSON.parse(options.body);
        return {
          ok: true,
          json: async () => ({
            status: true,
            data: { authorization_url: 'https://checkout.paystack.com/prisma', reference: request.reference },
          }),
        };
      }
      const reference = String(url).split('/').pop();
      return {
        ok: true,
        json: async () => ({
          status: true,
          data: {
            id: 98766,
            status: 'success',
            reference,
            amount: 12550,
            currency: 'USD',
            paid_at: '2026-11-08T12:00:00.000Z',
            metadata: {
              schoolId: SCHOOL_ID,
              invoiceId: tenantRecord.invoices[0]?.id,
              studentId: student.studentId,
            },
          },
        }),
      };
    });

    try {
      const invoice = await schoolService.createSchoolInvoice(
        SCHOOL_ID,
        invoiceInput(),
        ACTOR,
        'invoice-key-prisma-001',
      );
      expect(invoice.status).toBe('pending');
      const checkout = await schoolService.initializeInvoicePayment(
        SCHOOL_ID, invoice.id, ACTOR, 'checkout-key-prisma-001',
      );
      expect(checkout.status).toBe('initialized');
      const settlement = await schoolService.verifyAndLinkInvoicePayment(
        SCHOOL_ID,
        invoice.id,
        { reference: checkout.reference },
        ACTOR,
        'settlement-key-prisma-001',
      );
      expect(settlement.invoice.status).toBe('paid');
      expect(tenantRecord.payments.find((entry) => entry.reference === checkout.reference).status).toBe('verified');
      expect(tenantRecord.receipts).toHaveLength(1);
      const refund = await schoolService.createSchoolRefundRequest(
        SCHOOL_ID,
        { paymentId: payment.id, amount: 30, reason: 'Prisma test refund' },
        ACTOR,
        'refund-key-prisma-001',
      );
      expect(refund.status).toBe('pending_review');
      expect(tenantRecord.invoices).toHaveLength(1);
      expect(tenantRecord.invoices[0].status).toBe('paid');
      expect(tenantRecord.refunds).toHaveLength(1);
      expect(transaction.tenant.update).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: tenantRecord.id },
        data: { invoices: [expect.objectContaining({ id: invoice.id, status: 'pending' })] },
      }));
      expect(transaction.tenant.update).toHaveBeenLastCalledWith(expect.objectContaining({
        data: { refunds: [expect.objectContaining({ id: refund.id, status: 'pending_review' })] },
      }));
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'Serializable' });
    } finally {
      if (originalStubDescriptor) Object.defineProperty(prisma, '__stub', originalStubDescriptor);
      else delete prisma.__stub;
      if (originalTransactionDescriptor) Object.defineProperty(prisma, '$transaction', originalTransactionDescriptor);
      else delete prisma.$transaction;
      if (previousKey === undefined) delete process.env.PAYSTACK_SECRET_KEY;
      else process.env.PAYSTACK_SECRET_KEY = previousKey;
      if (previousQa === undefined) delete process.env.GLOBY_QA_MODE;
      else process.env.GLOBY_QA_MODE = previousQa;
    }
  });

  test('keeps Prisma JSON finance fields aligned with the idempotent PostgreSQL migration', () => {
    const repositoryRoot = path.resolve(__dirname, '../../../../');
    const schema = fs.readFileSync(path.join(repositoryRoot, 'database/prisma/schema.prisma'), 'utf8');
    const migration = fs.readFileSync(
      path.join(repositoryRoot, 'database/prisma/migrations/20261023120000_school_finance_records/migration.sql'),
      'utf8',
    );
    ['invoices', 'payments', 'receipts', 'refunds'].forEach((field) => {
      expect(schema).toMatch(new RegExp(`${field}\\s+Json\\s+@default\\("\\[\\]"\\)`));
      expect(migration).toMatch(new RegExp(`ADD COLUMN IF NOT EXISTS "${field}" JSONB NOT NULL DEFAULT '\\[\\]'::jsonb`));
    });
  });

  test('stores refund requests as pending review, protects against duplicate and excess requests', async () => {
    const input = { paymentId: payment.id, amount: 60, reason: 'Duplicate payment' };
    const first = await schoolService.createSchoolRefundRequest(SCHOOL_ID, input, ACTOR, 'refund-key-0001');
    const retry = await schoolService.createSchoolRefundRequest(SCHOOL_ID, input, ACTOR, 'refund-key-0001');

    expect(retry).toEqual(first);
    expect(first.status).toBe('pending_review');
    expect(first).not.toHaveProperty('refundedAt');
    expect(fixture.getTenant().refunds).toHaveLength(1);
    const retriedWithNewKey = await schoolService.createSchoolRefundRequest(SCHOOL_ID, input, ACTOR, 'refund-key-0006');
    expect(retriedWithNewKey).toEqual(first);
    expect(fixture.getTenant().refunds).toHaveLength(1);
    await expect(schoolService.createSchoolRefundRequest(
      SCHOOL_ID,
      { paymentId: payment.id, amount: 50, reason: 'Second request' },
      ACTOR,
      'refund-key-0002',
    )).rejects.toMatchObject({ statusCode: 409 });
  });

  test('rejects invalid refund data and payments not recorded for this school', async () => {
    await expect(schoolService.createSchoolRefundRequest(
      SCHOOL_ID,
      { paymentId: 'unknown-payment', amount: 10, reason: 'Invalid payment' },
      ACTOR,
      'refund-key-0003',
    )).rejects.toThrow('successfully recorded payment');
    await expect(schoolService.createSchoolRefundRequest(
      SCHOOL_ID,
      { paymentId: payment.id, amount: 101, reason: 'Too much' },
      ACTOR,
      'refund-key-0004',
    )).rejects.toMatchObject({ statusCode: 409 });
    await expect(schoolService.createSchoolRefundRequest(
      SCHOOL_ID,
      { paymentId: payment.id, amount: 10, reason: '' },
      ACTOR,
      'refund-key-0005',
    )).rejects.toThrow('refund reason');
  });

  test('dedicated invoice and refund routes return explicit outcomes and audit successful requests', async () => {
    const invoice = { id: 'invoice-route-1', status: 'pending' };
    const refund = { id: 'refund-route-1', status: 'pending_review' };
    jest.spyOn(schoolService, 'createSchoolInvoice').mockResolvedValue(invoice);
    jest.spyOn(schoolService, 'createSchoolRefundRequest').mockResolvedValue(refund);
    const response = { status: jest.fn(), json: jest.fn() };
    response.status.mockReturnValue(response);
    response.json.mockReturnValue(response);
    const request = {
      params: { schoolId: SCHOOL_ID },
      body: {},
      user: ACTOR,
      headers: { 'idempotency-key': 'route-key-0001' },
      get: (name) => name === 'Idempotency-Key' ? 'route-key-0001' : undefined,
    };

    await routeHandlers('post', '/:schoolId/invoices').at(-1).handle(request, response);
    expect(response.status).toHaveBeenLastCalledWith(201);
    expect(response.json).toHaveBeenLastCalledWith({ status: 'ok', invoice });

    await routeHandlers('post', '/:schoolId/refund-requests').at(-1).handle(request, response);
    expect(response.json).toHaveBeenLastCalledWith({
      status: 'ok',
      refund,
      message: 'Refund request submitted for review. No payment has been refunded.',
    });
    expect(recordAuditEvent).toHaveBeenCalledTimes(2);
  });

  test.each(['invoices', 'refunds', 'payments', 'receipts'])('rejects generic school updates for %s', async (field) => {
    const response = { status: jest.fn(), json: jest.fn() };
    response.status.mockReturnValue(response);
    response.json.mockReturnValue(response);
    const request = {
      params: { schoolId: SCHOOL_ID },
      body: { [field]: [] },
      user: { userId: 'platform', roles: ['super_admin'], platformAdmin: true },
    };

    await routeHandlers('put', '/:schoolId').at(-1).handle(request, response);
    expect(response.status).toHaveBeenCalledWith(403);
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({ status: 'error' }));
  });
});
