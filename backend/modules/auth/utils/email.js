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

async function sendEmail(to, subject, html) {
  const recipient = String(to || '').trim();
  const emailSubject = String(subject || '').trim() || 'GlobyEdu notification';

  if (!recipient) {
    return { ok: false, reason: 'MISSING_RECIPIENT' };
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

  if (!brevoConfigured) {
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
        const errorDetail = typeof parsedResponse?.message === 'string' ? parsedResponse.message : rawResponse;
        console.error('[email] Resend delivery failed', {
          status: response.status,
          detail: String(errorDetail || '').slice(0, 500),
        });
        return { ok: false, reason: 'RESEND_API_ERROR', status: response.status };
      }

      return {
        ok: true,
        status: response.status,
        messageId: parsedResponse?.id || null,
      };
    } catch (error) {
      console.error('[email] Resend request failed', {
        message: error && error.message ? String(error.message).slice(0, 300) : 'Unknown error',
      });
      return { ok: false, reason: 'RESEND_REQUEST_FAILED' };
    }
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
      const errorDetail = typeof parsedResponse?.message === 'string' ? parsedResponse.message : rawResponse;
      console.error('[email] Brevo delivery failed', {
        status: response.status,
        detail: String(errorDetail || '').slice(0, 500),
      });
      return { ok: false, reason: 'BREVO_API_ERROR', status: response.status };
    }

    return {
      ok: true,
      status: response.status,
      messageId: parsedResponse?.messageId || null,
    };
  } catch (error) {
    console.error('[email] Brevo request failed', {
      message: error && error.message ? String(error.message).slice(0, 300) : 'Unknown error',
    });
    return { ok: false, reason: 'BREVO_REQUEST_FAILED' };
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
    <p><a href="${verificationLink}">Verify your email address</a></p>
    <p><a href="${passwordResetLink}">Set your account password</a></p>
    <p>Both steps are required before signing in.</p>
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
