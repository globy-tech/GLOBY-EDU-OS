const crypto = require('crypto');
const firebaseData = require('../../firebase.data');
const firebaseCore = require('../../firebase.core');
const pricingService = require('./pricing.service');

const memoryPayments = new Map();
const memorySubscriptions = new Map();
const memoryRefunds = new Map();

function assertPaymentsAllowed() {
  if (String(process.env.GLOBY_QA_MODE || '').trim().toLowerCase() === 'true') {
    throw new Error('Payment operations are disabled in isolated QA mode.');
  }
}

function isProductionStore() {
  return firebaseData.isFirebaseDataConfigured();
}

function createReference() {
  return `GLB-${Date.now()}-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
}

function normalizeEmail(email) {
  const value = String(email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) throw new Error('A valid payment email is required.');
  return value;
}

function assertPolicyAcceptance(acceptance = {}) {
  if (acceptance.terms !== true || acceptance.privacy !== true || acceptance.paymentRefund !== true) {
    throw new Error('Terms, Privacy Policy, and Payment & Refund Policy must be accepted before payment.');
  }
  return {
    version: String(acceptance.version || '2026-09-18'),
    acceptedAt: new Date().toISOString(),
  };
}

async function savePayment(payment) {
  if (isProductionStore()) return firebaseCore.saveById('payments', payment.reference, payment);
  memoryPayments.set(payment.reference, payment);
  return payment;
}

async function getPayment(reference) {
  if (isProductionStore()) return firebaseCore.getById('payments', reference);
  return memoryPayments.get(reference) || null;
}

async function saveSubscription(subscription) {
  if (isProductionStore()) return firebaseCore.saveById('subscriptions', subscription.schoolId, subscription);
  memorySubscriptions.set(subscription.schoolId, subscription);
  return subscription;
}

async function saveRefund(refund) {
  if (isProductionStore()) return firebaseCore.saveById('refundRequests', refund.id, refund);
  memoryRefunds.set(refund.id, refund);
  return refund;
}

function calculateExpiry(paymentDate, billingPeriod) {
  const expiry = new Date(paymentDate);
  expiry.setMonth(expiry.getMonth() + (billingPeriod === 'yearly' ? 12 : 1));
  return expiry.toISOString();
}

async function initializeCheckout({ schoolId, email, planSlug, billingPeriod, callbackUrl, acceptance }) {
  assertPaymentsAllowed();
  if (!schoolId) throw new Error('Authenticated school is required.');
  const plan = await pricingService.getPricingPlan(planSlug, billingPeriod);
  const policyAcceptance = assertPolicyAcceptance(acceptance);
  const paymentEmail = normalizeEmail(email);
  const reference = createReference();
  const secret = String(process.env.PAYSTACK_SECRET_KEY || '').trim();
  if (!secret) throw new Error('Paystack is not configured on the server.');

  const response = await fetch('https://api.paystack.co/transaction/initialize', {
    method: 'POST',
    headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: paymentEmail,
      amount: Math.round(plan.amount * 100),
      currency: plan.currency,
      reference,
      callback_url: callbackUrl,
      metadata: { schoolId, planSlug: plan.slug, billingPeriod: plan.billingPeriod },
    }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.status !== true || !body.data?.authorization_url) throw new Error(body.message || 'Unable to initialize Paystack checkout.');

  await savePayment({
    reference,
    schoolId,
    email: paymentEmail,
    planSlug: plan.slug,
    planName: plan.name,
    studentLimit: plan.studentLimit,
    billingPeriod: plan.billingPeriod,
    amount: plan.amount,
    amountMinor: Math.round(plan.amount * 100),
    currency: plan.currency,
    status: 'initialized',
    policyAcceptance,
    createdAt: new Date().toISOString(),
  });

  return {
    authorizationUrl: body.data.authorization_url,
    accessCode: body.data.access_code,
    reference,
    plan: plan.slug,
    planName: plan.name,
    studentLimit: plan.studentLimit,
    billingPeriod: plan.billingPeriod,
    amount: plan.amount,
    currency: plan.currency,
  };
}

function validateTransaction(payment, transaction) {
  if (!payment || !transaction) throw new Error('Payment record or transaction was not found.');
  if (transaction.status !== 'success') throw new Error('Paystack transaction was not successful.');
  if (String(transaction.reference) !== String(payment.reference)) throw new Error('Payment reference mismatch.');
  if (Number(transaction.amount) !== Number(payment.amountMinor)) throw new Error('Payment amount mismatch.');
  if (String(transaction.currency || '').toUpperCase() !== String(payment.currency).toUpperCase()) throw new Error('Payment currency mismatch.');
  const metadata = transaction.metadata || {};
  if (String(metadata.schoolId || '') !== String(payment.schoolId) || String(metadata.planSlug || '') !== String(payment.planSlug) || String(metadata.billingPeriod || '') !== String(payment.billingPeriod)) {
    throw new Error('Payment tenant or plan metadata mismatch.');
  }
}

async function activateVerifiedPayment(payment, transaction) {
  const alreadyActivated = payment.status === 'verified' || payment.status === 'activated';
  const paidAt = transaction.paid_at || transaction.paidAt || new Date().toISOString();
  const updatedPayment = alreadyActivated
    ? payment
    : await savePayment({ ...payment, status: 'activated', paidAt, verifiedAt: new Date().toISOString(), receiptNumber: payment.reference });
  await saveSubscription({
    schoolId: payment.schoolId,
    planSlug: payment.planSlug,
    planName: payment.planName,
    studentLimit: payment.studentLimit,
    billingPeriod: payment.billingPeriod,
    amount: payment.amount,
    currency: payment.currency,
    paymentReference: payment.reference,
    status: 'active',
    startedAt: paidAt,
    expiresAt: calculateExpiry(paidAt, payment.billingPeriod),
    updatedAt: new Date().toISOString(),
  });
  if (isProductionStore()) {
    const tenant = await firebaseCore.getTenant(payment.schoolId);
    if (tenant) await firebaseCore.saveTenant(payment.schoolId, { subscriptionPlan: payment.planSlug, subscriptionStatus: 'active', expiresAt: calculateExpiry(paidAt, payment.billingPeriod) });
  }
  return updatedPayment;
}

async function verifyPayment(reference, expectedSchoolId = null) {
  assertPaymentsAllowed();
  const payment = await getPayment(reference);
  if (!payment) throw new Error('Payment reference was not found.');
  if (expectedSchoolId && payment.schoolId !== expectedSchoolId) throw new Error('Tenant mismatch.');
  const secret = String(process.env.PAYSTACK_SECRET_KEY || '').trim();
  if (!secret) throw new Error('Paystack is not configured on the server.');
  const response = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, { headers: { Authorization: `Bearer ${secret}` } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.status !== true) throw new Error(body.message || 'Unable to verify Paystack payment.');
  validateTransaction(payment, body.data);
  return activateVerifiedPayment(payment, body.data);
}

function getPaystackWebhookSecret() {
  const secret = String(process.env.PAYSTACK_WEBHOOK_SECRET || '').trim();
  if (!secret || /^(?:[a-z][a-z0-9+.-]*:\\\\|(?:cd|set|export)\s)|[<>]|placeholder|xxxxx/i.test(secret)) return '';
  return secret;
}

function verifyWebhookSignature(rawBody, signature) {
  const secret = getPaystackWebhookSecret();
  if (!secret || !rawBody || !signature) return false;
  const normalizedRawBody = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody);
  const expected = crypto.createHmac('sha512', secret).update(normalizedRawBody).digest('hex');
  const provided = String(signature).trim();
  if (!provided || expected.length !== provided.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(provided));
  } catch {
    return false;
  }
}

async function processWebhook(rawBody, signature, event) {
  assertPaymentsAllowed();
  if (!verifyWebhookSignature(rawBody, signature)) throw new Error('Invalid Paystack webhook signature.');
  if (!event || event.event !== 'charge.success') return { ignored: true };
  const reference = event.data?.reference;
  if (!reference) throw new Error('Missing Paystack payment reference in webhook event.');
  const payment = await getPayment(reference);
  if (!payment) throw new Error('Payment reference was not found.');
  validateTransaction(payment, event.data);
  const activated = await activateVerifiedPayment(payment, event.data);
  return { processed: true, payment: activated };
}

async function requestRefund({ schoolId, reference, reason }) {
  assertPaymentsAllowed();
  const payment = await getPayment(reference);
  if (!payment || payment.schoolId !== schoolId) throw new Error('Payment was not found for this school.');
  const paidAt = new Date(payment.paidAt || payment.createdAt || Date.now());
  const now = new Date();
  const eligible = now.getTime() - paidAt.getTime() <= 14 * 24 * 60 * 60 * 1000;
  const refund = await saveRefund({
    id: `REF-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,
    schoolId,
    paymentReference: reference,
    paymentDate: paidAt.toISOString(),
    refundRequestDate: now.toISOString(),
    requestedAt: now.toISOString(),
    eligibility: eligible ? 'eligible' : 'outside_window',
    status: eligible ? 'Requested' : 'Rejected',
    decision: eligible ? 'Pending Review' : 'Rejected',
    processedDate: eligible ? null : now.toISOString(),
    reason: String(reason || '').trim(),
  });
  return refund;
}

module.exports = {
  initializeCheckout,
  verifyPayment,
  processWebhook,
  requestRefund,
  getPayment,
  validateTransaction,
  verifyWebhookSignature,
};
