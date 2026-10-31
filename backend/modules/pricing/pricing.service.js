const fs = require('fs');
const path = require('path');
const prisma = require('../../config/prisma.client');
const firebaseData = require('../../firebase.data');

const PRICING_FILE = path.join(__dirname, '../../data/pricing-plans.json');
const QA_MODE = String(process.env.GLOBY_QA_MODE || '').trim().toLowerCase() === 'true';
const QA_PLANS = Object.freeze([
  {
    id: 'qa-basic',
    slug: 'qa-basic',
    name: 'QA Basic',
    studentLimit: 50,
    monthlyAmount: 0,
    yearlyAmount: 0,
    currency: 'GHS',
    active: true,
    displayOrder: 1,
    shortDescription: 'Synthetic plan for isolated local QA.',
    recommendedBadge: false,
  },
]);

function assertFallbackAllowed() {
  if (process.env.NODE_ENV === 'production' && String(process.env.DATABASE_URL || '').trim().length > 0) {
    return;
  }
  if (process.env.NODE_ENV === 'production' && String(process.env.DATA_STORE_MODE || '').trim().toLowerCase() === 'firebase') {
    return;
  }
  if (process.env.NODE_ENV === 'production') {
    console.warn('[pricing.service] No DATABASE_URL or Firebase mode configured; using JSON fallback pricing data in production.');
  }
}

function readFallback() {
  assertFallbackAllowed();
  try {
    const parsed = JSON.parse(fs.readFileSync(PRICING_FILE, 'utf8'));
    return Array.isArray(parsed.plans) ? parsed.plans : [];
  } catch {
    return [];
  }
}

function writeFallback(plans) {
  assertFallbackAllowed();
  fs.writeFileSync(PRICING_FILE, JSON.stringify({ plans }, null, 2), 'utf8');
}

function normalizePlan(plan) {
  return {
    id: plan.id,
    slug: String(plan.slug || plan.id || '').toLowerCase(),
    name: plan.name,
    studentLimit: Number(plan.studentLimit),
    monthlyAmount: Number(plan.monthlyAmount),
    yearlyAmount: Number(plan.yearlyAmount),
    currency: String(plan.currency || 'GHS').toUpperCase(),
    active: plan.active !== false,
    displayOrder: Number(plan.displayOrder || 0),
    shortDescription: String(plan.shortDescription || ''),
    recommendedBadge: Boolean(plan.recommendedBadge),
  };
}

function mergeConfiguredPlans(plans) {
  const plansByKey = new Map();
  readFallback().map(normalizePlan).forEach((plan) => {
    plansByKey.set(plan.slug, plan);
    plansByKey.set(plan.id, plan);
  });

  plans.forEach((plan) => {
    const normalized = normalizePlan(plan);
    const configured = plansByKey.get(normalized.slug) || plansByKey.get(normalized.id);
    const merged = normalizePlan({ ...configured, ...plan, id: plan.id || configured?.id });
    plansByKey.set(merged.slug, merged);
    plansByKey.set(merged.id, merged);
  });

  return [...new Set(plansByKey.values())].sort((a, b) => a.displayOrder - b.displayOrder);
}

async function listPricingPlans({ activeOnly = false } = {}) {
  if (QA_MODE) {
    return QA_PLANS
      .map(normalizePlan)
      .filter((plan) => !activeOnly || plan.active)
      .sort((a, b) => a.displayOrder - b.displayOrder);
  }
  if (firebaseData.isFirebaseDataConfigured()) {
    const snapshot = await firebaseData.getFirestore().collection('pricingPlans').orderBy('displayOrder').get();
    const storedPlans = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    return mergeConfiguredPlans(storedPlans).filter((plan) => !activeOnly || plan.active);
  }
  if (prisma && !prisma.__stub && prisma.pricingPlan?.findMany) {
    const rows = await prisma.pricingPlan.findMany({ orderBy: { displayOrder: 'asc' } });
    return mergeConfiguredPlans(rows).filter((plan) => !activeOnly || plan.active);
  }
  return readFallback().map(normalizePlan).filter((plan) => !activeOnly || plan.active).sort((a, b) => a.displayOrder - b.displayOrder);
}

async function getPricingPlan(slug, billingPeriod = 'monthly') {
  const normalizedPeriod = String(billingPeriod).toLowerCase();
  if (!['monthly', 'yearly'].includes(normalizedPeriod)) throw new Error('Billing period must be monthly or yearly.');
  const plan = (await listPricingPlans({ activeOnly: true })).find((entry) => entry.slug === String(slug).toLowerCase());
  if (!plan) throw new Error('Selected pricing plan is not available.');
  return { ...plan, billingPeriod: normalizedPeriod, amount: normalizedPeriod === 'yearly' ? plan.yearlyAmount : plan.monthlyAmount };
}

async function updatePricingPlan(id, updates = {}) {
  if (QA_MODE) throw new Error('Pricing updates are disabled in isolated QA mode.');
  const payload = {
    name: String(updates.name || '').trim(),
    studentLimit: Number(updates.studentLimit),
    monthlyAmount: Number(updates.monthlyAmount),
    yearlyAmount: Number(updates.yearlyAmount),
    currency: String(updates.currency || 'GHS').trim().toUpperCase(),
    active: updates.active === true,
    displayOrder: Number(updates.displayOrder || 0),
    shortDescription: String(updates.shortDescription || '').trim(),
    recommendedBadge: updates.recommendedBadge === true,
  };
  if (!payload.name || !Number.isInteger(payload.studentLimit) || payload.studentLimit < 1 || !Number.isFinite(payload.monthlyAmount) || payload.monthlyAmount < 0 || !Number.isFinite(payload.yearlyAmount) || payload.yearlyAmount < 0) {
    throw new Error('Plan name, student limit, and valid monthly/yearly prices are required.');
  }
  if (firebaseData.isFirebaseDataConfigured()) {
    await firebaseData.getFirestore().collection('pricingPlans').doc(String(id)).set(payload, { merge: true });
    return normalizePlan({ id, ...payload });
  }
  if (prisma && !prisma.__stub && prisma.pricingPlan?.update) {
    return normalizePlan(await prisma.pricingPlan.update({ where: { id }, data: payload }));
  }
  const plans = readFallback();
  const index = plans.findIndex((plan) => plan.id === id);
  if (index === -1) throw new Error('Pricing plan not found.');
  plans[index] = { ...plans[index], ...payload };
  writeFallback(plans);
  return normalizePlan(plans[index]);
}

async function initializePaystackCheckout({ planSlug, billingPeriod, email, callbackUrl }) {
  const plan = await getPricingPlan(planSlug, billingPeriod);
  const secret = String(process.env.PAYSTACK_SECRET_KEY || '').trim();
  if (!secret) throw new Error('Paystack is not configured on the server.');
  const response = await fetch('https://api.paystack.co/transaction/initialize', {
    method: 'POST',
    headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, amount: Math.round(plan.amount * 100), currency: plan.currency, callback_url: callbackUrl, metadata: { plan: plan.slug, billingPeriod: plan.billingPeriod } }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.status !== true) throw new Error(body.message || 'Unable to initialize Paystack checkout.');
  return { ...body.data, plan: plan.slug, billingPeriod: plan.billingPeriod, amount: plan.amount, currency: plan.currency };
}

module.exports = { listPricingPlans, getPricingPlan, updatePricingPlan, initializePaystackCheckout };