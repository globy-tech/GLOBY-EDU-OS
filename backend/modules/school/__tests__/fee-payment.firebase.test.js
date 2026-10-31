const schoolService = require('../school.service');
const firebaseData = require('../../../firebase.data');
const firebaseCore = require('../../../firebase.core');

const SCHOOL_ID = 'firebase-fee-qa-school';
const ACTOR = { userId: 'fixture-authority', roles: ['school_authority'] };

function createFirestore(initialTenant) {
  let tenant = structuredClone(initialTenant);
  let version = 0;
  let transactionAttempts = 0;
  const tenantDocument = { id: SCHOOL_ID };
  const firestore = {
    collection: jest.fn(() => ({ doc: jest.fn(() => tenantDocument) })),
    runTransaction: jest.fn(async (callback) => {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        transactionAttempts += 1;
        let readVersion;
        let pendingWrite;
        const transaction = {
          get: jest.fn(async (document) => {
            if (document !== tenantDocument) throw new Error('Unexpected transaction document.');
            readVersion = version;
            const snapshotTenant = structuredClone(tenant);
            return {
              id: SCHOOL_ID,
              exists: true,
              data: () => snapshotTenant,
            };
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
    getTransactionAttempts: () => transactionAttempts,
  };
}

describe('Firebase fee payment transaction', () => {
  let fixture;

  beforeEach(() => {
    fixture = createFirestore({
      schoolId: SCHOOL_ID,
      name: 'Firebase Fee QA School',
      schoolStatus: 'active',
      subscriptionStatus: 'trial',
      payments: [],
      receipts: [],
    });
    jest.spyOn(firebaseData, 'isFirebaseDataConfigured').mockReturnValue(true);
    jest.spyOn(firebaseData, 'getFirestore').mockReturnValue(fixture.firestore);
    jest.spyOn(firebaseCore, 'getSchoolAggregate').mockImplementation(async () => ({
      ...fixture.getTenant(),
      id: SCHOOL_ID,
      students: [{ studentId: 'fixture-student', fullName: 'Fixture Student' }],
    }));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function paymentInput(reference) {
    return {
      studentId: 'fixture-student',
      amount: 125,
      paymentDate: '2026-10-18',
      method: 'cash',
      reference,
    };
  }

  test('rejects a sequential duplicate reference without appending a second receipt', async () => {
    const first = await schoolService.createFeePayment(SCHOOL_ID, paymentInput('BANK-ONCE'), ACTOR);

    await expect(schoolService.createFeePayment(SCHOOL_ID, paymentInput('BANK-ONCE'), ACTOR))
      .rejects.toThrow('Payment reference has already been recorded.');

    const tenant = fixture.getTenant();
    expect(tenant.payments).toEqual([first.payment]);
    expect(tenant.receipts).toEqual([first.receipt]);
  });

  test('retries concurrent transactions and records a shared reference only once', async () => {
    const outcomes = await Promise.allSettled([
      schoolService.createFeePayment(SCHOOL_ID, paymentInput('BANK-CONCURRENT'), ACTOR),
      schoolService.createFeePayment(SCHOOL_ID, paymentInput('BANK-CONCURRENT'), ACTOR),
    ]);

    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toHaveLength(1);
    expect(outcomes.find((outcome) => outcome.status === 'rejected').reason.message)
      .toBe('Payment reference has already been recorded.');
    expect(fixture.getTransactionAttempts()).toBeGreaterThan(2);
    expect(fixture.getTenant().payments).toHaveLength(1);
    expect(fixture.getTenant().receipts).toHaveLength(1);
  });

  test('allocates distinct payment and receipt IDs for distinct references', async () => {
    const first = await schoolService.createFeePayment(SCHOOL_ID, paymentInput('BANK-FIRST'), ACTOR);
    const second = await schoolService.createFeePayment(SCHOOL_ID, paymentInput('BANK-SECOND'), ACTOR);

    expect(second.payment.id).not.toBe(first.payment.id);
    expect(second.receipt.receiptNumber).not.toBe(first.receipt.receiptNumber);
    expect(second.receipt.paymentId).toBe(second.payment.id);
    expect(fixture.getTenant().payments).toHaveLength(2);
    expect(fixture.getTenant().receipts).toHaveLength(2);
  });

  test('allocates distinct IDs when different references race and one transaction retries', async () => {
    const outcomes = await Promise.all([
      schoolService.createFeePayment(SCHOOL_ID, paymentInput('BANK-RACE-FIRST'), ACTOR),
      schoolService.createFeePayment(SCHOOL_ID, paymentInput('BANK-RACE-SECOND'), ACTOR),
    ]);
    const [first, second] = outcomes;

    expect(first.payment.id).not.toBe(second.payment.id);
    expect(first.receipt.receiptNumber).not.toBe(second.receipt.receiptNumber);
    expect(new Set([first.payment.id, second.payment.id])).toHaveProperty('size', 2);
    expect(fixture.getTransactionAttempts()).toBeGreaterThan(2);
    expect(fixture.getTenant().payments).toHaveLength(2);
    expect(fixture.getTenant().receipts).toHaveLength(2);
  });

  test('allows blank-reference cash payments and allocates unique IDs', async () => {
    const first = await schoolService.createFeePayment(SCHOOL_ID, paymentInput(''), ACTOR);
    const second = await schoolService.createFeePayment(SCHOOL_ID, paymentInput(''), ACTOR);

    expect(first.payment.reference).toBeNull();
    expect(second.payment.reference).toBeNull();
    expect(second.payment.id).not.toBe(first.payment.id);
    expect(second.receipt.receiptNumber).not.toBe(first.receipt.receiptNumber);
    expect(fixture.getTenant().payments).toHaveLength(2);
    expect(fixture.getTenant().receipts).toHaveLength(2);
  });
});