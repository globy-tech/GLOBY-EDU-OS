// auth.js
// Lightweight frontend API wrapper for auth endpoints.
// This file performs client-side requests to the backend auth routes.

function dispatchMaintenanceMode(response, data) {
  if (response.status === 503 && data?.code === 'MAINTENANCE_MODE' && typeof document !== 'undefined') {
    document.dispatchEvent(new CustomEvent('globyedu-maintenance-mode', { detail: data }));
  }
}

async function postJson(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  dispatchMaintenanceMode(res, data);
  return { ok: res.ok, status: res.status, data };
}

async function getJson(url, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(url, { method: 'GET', headers, credentials: 'include' });
  const data = await res.json().catch(() => null);
  dispatchMaintenanceMode(res, data);
  return { ok: res.ok, status: res.status, data };
}

export async function studentLogin(schoolId, studentId, password, options = {}) {
  const payload = {
    schoolId,
    username: studentId,
    password,
    loginType: 'student',
  };
  return postJson('/api/v1/auth/school-login', payload);
}

export async function teacherLogin(schoolId, teacherId, password, options = {}) {
  const payload = {
    schoolId: schoolId || '',
    username: teacherId,
    password,
    loginType: 'teacher',
  };
  return postJson('/api/v1/auth/school-login', payload);
}

export async function schoolAuthorityLogin(schoolId, email, password) {
  const payload = {
    schoolId,
    username: email,
    password,
    loginType: 'school_authority',
  };
  return postJson('/api/v1/auth/school-login', payload);
}

export async function schoolLogin(email, password, schoolId) {
  const payload = { schoolId, username: email, password, loginType: 'school' };
  return postJson('/api/v1/auth/login', payload);
}

export async function firebaseLogin(idToken, schoolId, platformAdmin = false, options = {}) {
  return postJson('/api/v1/auth/firebase-login', { idToken, schoolId, platformAdmin, identifier: options.identifier, loginType: options.loginType });
}

export async function linkFirebaseIdentity(idToken, accessToken) {
  return postJsonWithToken('/api/v1/auth/firebase-link', { idToken }, accessToken);
}

export async function platformAdminLogin(email, password) {
  const payload = { username: email, password };
  return postJson('/api/v1/auth/platform-login', payload);
}

export async function logout(accessToken) {
  if (!accessToken) {
    return { ok: false, status: 401, data: { status: 'error', message: 'Authenticated session is required.' } };
  }
  return postJsonWithToken('/api/v1/auth/logout', {}, accessToken);
}

export async function refreshAuthSession() {
  return postJson('/api/v1/auth/refresh', {});
}

export async function forgotPassword(email, loginType = 'school') {
  return postJson('/api/v1/auth/forgot-password', { email, loginType });
}

export async function sendFirebasePasswordReset(email) {
  const payload = { email };
  return postJson('/api/v1/auth/forgot-password', payload);
}

export async function confirmFirebasePasswordReset(oobCode, newPassword) {
  return postJson('/api/v1/auth/reset-password', { token: oobCode, password: newPassword });
}

export async function changePassword(accessToken, oldPassword, newPassword) {
  return postJsonWithToken('/api/v1/auth/change-password', { oldPassword, newPassword }, accessToken);
}

async function postJsonWithToken(url, body, token) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    credentials: 'include',
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  dispatchMaintenanceMode(res, data);
  return { ok: res.ok, status: res.status, data };
}

export async function register(schoolName, adminName, email, phone, country, password) {
  // Accept either a single payload object or the legacy argument list for compatibility.
  let payload;
  if (typeof schoolName === 'object') {
    payload = schoolName;
  } else {
    payload = { schoolName, head: { fullName: adminName, email }, phone, country, headPassword: password };
  }
  return postJson('/api/v1/auth/register', payload);
}

export async function fetchSchoolSummary(token, schoolId) {
  return getJson(`/api/v1/schools/${encodeURIComponent(schoolId)}/summary`, token);
}
