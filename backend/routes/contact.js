const express = require('express');
const { sendEmail } = require('../modules/auth/utils/email');

const router = express.Router();
const CONTACT_WINDOW_MS = 15 * 60 * 1000;
const CONTACT_CLEANUP_INTERVAL_MS = 60 * 1000;
const CONTACT_REQUEST_LIMIT = 5;
const MAX_TRACKED_CONTACT_IPS = 10000;
const contactAttempts = new Map();
let nextContactCleanupAt = 0;

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

function limitContactRequests(req, res, next) {
  const now = Date.now();
  if (now >= nextContactCleanupAt) {
    for (const [ip, attempt] of contactAttempts) {
      if (attempt.expiresAt <= now) contactAttempts.delete(ip);
    }
    nextContactCleanupAt = now + CONTACT_CLEANUP_INTERVAL_MS;
  }

  const ip = String(req.ip || req.socket?.remoteAddress || 'unknown').slice(0, 100);
  let current = contactAttempts.get(ip);
  if (current?.expiresAt <= now) {
    contactAttempts.delete(ip);
    current = null;
  }
  if (current && current.count >= CONTACT_REQUEST_LIMIT) {
    return res.status(429).json({ status: 'error', message: 'Too many contact requests. Please try again later.' });
  }
  if (!current && contactAttempts.size >= MAX_TRACKED_CONTACT_IPS) {
    return res.status(429).json({ status: 'error', message: 'The contact service is busy. Please try again later.' });
  }

  contactAttempts.set(ip, current
    ? { count: current.count + 1, expiresAt: current.expiresAt }
    : { count: 1, expiresAt: now + CONTACT_WINDOW_MS });
  return next();
}

router.post('/', limitContactRequests, async (req, res) => {
  const name = String(req.body?.name || '').replace(/[\r\n]+/g, ' ').trim();
  const email = String(req.body?.email || '').trim();
  const message = String(req.body?.message || '').trim();

  if (!name || !isValidEmail(email) || !message) {
    return res.status(400).json({ status: 'error', message: 'Please provide your name, a valid email address, and a message.' });
  }

  if (name.length > 120 || email.length > 254 || message.length > 5000) {
    return res.status(400).json({ status: 'error', message: 'Please shorten your message and try again.' });
  }

  const toEmail = process.env.CONTACT_EMAIL;

  if (!toEmail) {
    console.error('Contact form is missing CONTACT_EMAIL.');
    return res.status(503).json({ status: 'error', message: 'The contact service is not configured yet. Please email our team directly.' });
  }

  try {
    const delivery = await sendEmail(
      toEmail,
      `New GlobyEdu contact request from ${name}`,
      `<p><strong>Name:</strong> ${escapeHtml(name)}</p><p><strong>Email:</strong> ${escapeHtml(email)}</p><p>${escapeHtml(message).replace(/\n/g, '<br>')}</p>`,
      { replyTo: email },
    );
    if (delivery?.ok !== true) {
      const status = delivery?.reason === 'EMAIL_PROVIDER_NOT_CONFIGURED' ? 503 : 502;
      return res.status(status).json({ status: 'error', message: 'We could not send your message right now. Please try again shortly.' });
    }

    return res.json({ status: 'ok', message: 'Thanks! Our team will follow up within one business day.' });
  } catch (error) {
    console.error('Contact form request failed.');
    return res.status(502).json({ status: 'error', message: 'We could not send your message right now. Please try again shortly.' });
  }
});

module.exports = router;
