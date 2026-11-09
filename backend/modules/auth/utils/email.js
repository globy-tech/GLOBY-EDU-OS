// email.js
// Server-side email delivery for GlobyEdu using Brevo.
// Kept intentionally small and backend-only so frontend code never sees provider secrets.

function getBrevoConfig() {
  return {
    apiKey: String(process.env.BREVO_API_KEY || '').trim(),
    senderEmail: String(process.env.BREVO_SENDER_EMAIL || '').trim(),
    senderName: String(process.env.BREVO_SENDER_NAME || 'GlobyEdu').trim(),
  };
}

function getResendConfig() {
  return {
    apiKey: String(process.env.RESEND_API_KEY || '').trim(),
    fromEmail: String(process.env.RESEND_FROM_EMAIL || '').trim(),
  };
}

function isBrevoConfigured() {
  const { apiKey, senderEmail } = getBrevoConfig();
  return Boolean(apiKey && senderEmail);
}

function getSenderAddress(value) {
  const sender = String(value || '').trim();
  const displayNameMatch = sender.match(/<([^<>]+)>$/);
  return displayNameMatch ? displayNameMatch[1].trim() : sender;
}

function isValidSender(value) {
  return /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(getSenderAddress(value));
}

async function sendWithResend(recipient, emailSubject, html, resendConfig, fallbackFromBrevo = false, options = {}) {
  if (!isValidSender(resendConfig.fromEmail)) {
    console.warn('[email] The configured Resend sender address is invalid.', { fallbackFromBrevo });
    return { ok: false, reason: 'INVALID_SENDER_ADDRESS', provider: 'resend' };
  }

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${resendConfig.apiKey}`,
      },
      body: JSON.stringify({
        from: resendConfig.fromEmail,
        to: [recipient],
        subject: emailSubject,
        html: String(html || ''),
        ...(options.replyTo ? { reply_to: options.replyTo } : {}),
      }),
    });

    const rawResponse = await response.text();
    let parsedResponse = {};
    try {
      parsedResponse = rawResponse ? JSON.parse(rawResponse) : {};
    } catch (error) {
      parsedResponse = {};
    }

    if (!response.ok) {
      console.error('[email] Resend request rejected', {
        status: response.status,
        fallbackFromBrevo,
      });
      return { ok: false, reason: 'RESEND_API_ERROR', status: response.status, provider: 'resend' };
    }

    return {
      ok: true,
      status: response.status,
      messageId: parsedResponse?.id || null,
      provider: 'resend',
      requestStatus: 'accepted',
      deliveryStatus: 'unconfirmed',
    };
  } catch (error) {
    console.error('[email] Resend request failed.', { fallbackFromBrevo });
    return { ok: false, reason: 'RESEND_REQUEST_FAILED', provider: 'resend' };
  }
}

async function sendEmail(to, subject, html, options = {}) {
  const recipient = String(to || '').trim();
  const emailSubject = String(subject || '').trim() || 'GlobyEdu notification';
  const replyTo = String(options.replyTo || '').trim();

  if (!recipient) {
    return { ok: false, reason: 'MISSING_RECIPIENT' };
  }
  if (replyTo && !isValidSender(replyTo)) {
    return { ok: false, reason: 'INVALID_REPLY_TO' };
  }

  const brevoConfigured = isBrevoConfigured();
  const resendConfig = getResendConfig();
  const resendConfigured = Boolean(resendConfig.apiKey && resendConfig.fromEmail);

  if (!brevoConfigured && !resendConfigured) {
    console.warn('[email] No transactional email provider is configured; email delivery was skipped.');
    return { ok: false, reason: 'EMAIL_PROVIDER_NOT_CONFIGURED' };
  }

  if (typeof fetch !== 'function') {
    console.error('[email] Fetch API is unavailable in the current runtime.');
    return { ok: false, reason: 'EMAIL_TRANSPORT_UNAVAILABLE' };
  }

  if (brevoConfigured && !isValidSender(getBrevoConfig().senderEmail)) {
    console.warn('[email] The configured transactional sender address is invalid.', { provider: 'brevo' });
    return resendConfigured
      ? sendWithResend(recipient, emailSubject, html, resendConfig, true, { replyTo })
      : { ok: false, reason: 'INVALID_SENDER_ADDRESS', provider: 'brevo' };
  }

  if (!brevoConfigured && !isValidSender(resendConfig.fromEmail)) {
    console.warn('[email] The configured transactional sender address is invalid.', { provider: 'resend' });
    return { ok: false, reason: 'INVALID_SENDER_ADDRESS', provider: 'resend' };
  }

  if (!brevoConfigured) {
    return sendWithResend(recipient, emailSubject, html, resendConfig, false, { replyTo });
  }

  const { apiKey, senderEmail, senderName } = getBrevoConfig();

  try {
    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'api-key': apiKey,
      },
      body: JSON.stringify({
        sender: {
          email: senderEmail,
          name: senderName || 'GlobyEdu',
        },
        to: [{ email: recipient, name: recipient }],
        ...(replyTo ? { replyTo: { email: replyTo } } : {}),
        subject: emailSubject,
        html: String(html || ''),
      }),
    });

    const rawResponse = await response.text();
    let parsedResponse = {};
    try {
      parsedResponse = rawResponse ? JSON.parse(rawResponse) : {};
    } catch (error) {
      parsedResponse = { raw: rawResponse };
    }

    if (!response.ok) {
      console.error('[email] Brevo request rejected', {
        status: response.status,
      });
      const requestWasRejected = response.status >= 400 && response.status < 500;
      return resendConfigured && requestWasRejected
        ? sendWithResend(recipient, emailSubject, html, resendConfig, true, { replyTo })
        : { ok: false, reason: 'BREVO_API_ERROR', status: response.status, provider: 'brevo' };
    }

    return {
      ok: true,
      status: response.status,
      messageId: parsedResponse?.messageId || null,
      provider: 'brevo',
      requestStatus: 'accepted',
      deliveryStatus: 'unconfirmed',
    };
  } catch (error) {
    console.error('[email] Brevo request failed.');
    return { ok: false, reason: 'BREVO_REQUEST_FAILED', provider: 'brevo' };
  }
}

function welcomeTemplate({ fullName, schoolName, schoolId, appUrl }) {
  return `
    <p>Hi ${fullName},</p>
    <p>Welcome to GlobyEdu OS. Your school account for <strong>${schoolName}</strong> is now active.</p>
    <p>Your School ID is: <strong>${schoolId}</strong></p>
    <p>Use this School ID to sign in at <a href="${appUrl}/#/login">School Login</a>.</p>
    <p>If you need help, contact support@globyedu.com.</p>
  `;
}

function verificationTemplate(verificationLink) {
  return `
    <p>Please verify your account by clicking the link below:</p>
    <p><a href="${verificationLink}">Verify Email</a></p>
  `;
}

function teacherAccountSetupTemplate({ fullName, schoolName, schoolId, verificationLink, passwordResetLink }) {
  const safeName = String(fullName || 'Teacher').replace(/[<>&"]/g, '');
  const safeSchoolName = String(schoolName || 'your school').replace(/[<>&"]/g, '');
  const safeSchoolId = String(schoolId || '').replace(/[<>&"]/g, '');
  return `
    <p>Hi ${safeName},</p>
    <p>Your teacher account for <strong>${safeSchoolName}</strong> has been created.</p>
    <p>Your School ID is <strong>${safeSchoolId}</strong>.</p>
    ${verificationLink
    ? `<p><a href="${verificationLink}">Verify your email address</a></p>`
    : '<p>Your email address is already verified.</p>'}
    <p><a href="${passwordResetLink}">Set your account password</a></p>
    <p>Verify your email and set your password before signing in.</p>
  `;
}

function resetTemplate(token, appUrl) {
  return `
    <p>You requested a password reset for your GlobyEdu account.</p>
    <p>Use the following link to reset your password:</p>
    <p><a href="${appUrl}/#/reset-password?token=${token}">Reset Password</a></p>
    <p>If you did not request this, ignore this message.</p>
  `;
}

module.exports = {
  getBrevoConfig,
  isBrevoConfigured,
  sendEmail,
  verificationTemplate,
  teacherAccountSetupTemplate,
  resetTemplate,
  welcomeTemplate,
};
