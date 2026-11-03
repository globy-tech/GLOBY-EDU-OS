// school.js
// Client-side wrapper for tenant-scoped school APIs and Super Admin school management.

import { addOfflineQueueEntry, getOfflineQueueEntries, removeOfflineQueueEntry, findOfflineQueueEntry, makeOfflineQueueSignature } from '../utils/pwa-queue.js';

function isOnline() {
  return typeof navigator !== 'undefined' ? navigator.onLine : true;
}

function handleUnauthorized(response) {
  if (response.status === 401 && typeof document !== 'undefined') {
    document.dispatchEvent(new CustomEvent('globyedu-auth-expired'));
  }

  if (response.status === 403 && typeof document !== 'undefined') {
    const message = String(response.data?.message || response.data?.error || '');
    if (/suspended|expired|blocked|inactive/i.test(message)) {
      document.dispatchEvent(new CustomEvent('globyedu-school-suspended', { detail: response.data }));
    }
  }
  if (response.status === 503 && response.data?.code === 'MAINTENANCE_MODE' && typeof document !== 'undefined') {
    document.dispatchEvent(new CustomEvent('globyedu-maintenance-mode', { detail: response.data }));
  }
  return response;
}

async function scheduleBackgroundSync() {
  if (!('serviceWorker' in navigator) || !('SyncManager' in window)) return;
  try {
    const registration = await navigator.serviceWorker.ready;
    if (registration.sync) {
      await registration.sync.register('globyedu-offline-sync');
    }
  } catch {
    // Ignore background sync registration failures.
  }
}

async function queueRequest(method, url, body) {
  if (!isOnline()) {
    const signature = makeOfflineQueueSignature(method, url, body);
    const existing = await findOfflineQueueEntry(signature);
    if (existing) {
      return { ok: false, offline: true, queued: true, message: 'A matching request is already queued for synchronization.' };
    }
    await addOfflineQueueEntry({ method, url, body, signature, timestamp: Date.now() });
    await scheduleBackgroundSync();
    return { ok: false, offline: true, queued: true, message: 'Offline request queued successfully. It will synchronize automatically once online.' };
  }
  return null;
}

async function getJson(url, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  try {
    const res = await fetch(url, { method: 'GET', headers });
    const data = await res.json().catch(() => null);
    return handleUnauthorized({ ok: res.ok, status: res.status, data });
  } catch (error) {
    return { ok: false, status: 0, data: { status: 'error', message: error.message || 'Network request failed.' } };
  }
}

async function postJson(url, body, token) {
  const queued = await queueRequest('POST', url, body);
  if (queued) return queued;

  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;

  try {
    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
    const data = await res.json().catch(() => null);
    return handleUnauthorized({ ok: res.ok, status: res.status, data });
  } catch (error) {
    const queued = await queueRequest('POST', url, body);
    return queued || { ok: false, status: 0, data: { status: 'error', message: error.message || 'Network request failed.' } };
  }
}

async function putJson(url, body, token) {
  const queued = await queueRequest('PUT', url, body);
  if (queued) return queued;

  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;

  try {
    const res = await fetch(url, { method: 'PUT', headers, body: JSON.stringify(body) });
    const data = await res.json().catch(() => null);
    return handleUnauthorized({ ok: res.ok, status: res.status, data });
  } catch (error) {
    const queued = await queueRequest('PUT', url, body);
    return queued || { ok: false, status: 0, data: { status: 'error', message: error.message || 'Network request failed.' } };
  }
}

async function deleteJson(url, token) {
  const queued = await queueRequest('DELETE', url, null);
  if (queued) return queued;

  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;

  try {
    const res = await fetch(url, { method: 'DELETE', headers });
    const data = await res.json().catch(() => null);
    return handleUnauthorized({ ok: res.ok, status: res.status, data });
  } catch (error) {
    return queueRequest('DELETE', url, null);
  }
}

export async function fetchSchoolSummary(token, schoolId) {
  return getJson(`/api/v1/schools/${encodeURIComponent(schoolId)}/summary`, token);
}

export async function fetchSchoolDetails(token, schoolId) {
  return getJson(`/api/v1/schools/${encodeURIComponent(schoolId)}`, token);
}

export async function updateSchoolDetails(token, schoolId, payload) {
  return putJson(`/api/v1/schools/${encodeURIComponent(schoolId)}`, payload, token);
}

export async function createFeePayment(token, schoolId, payload) {
  return postJson(`/api/v1/schools/${encodeURIComponent(schoolId)}/payments`, payload, token);
}

export async function searchSchoolData(token, schoolId, term, scope = '') {
  const params = new URLSearchParams();
  if (term) params.set('term', term);
  if (scope) params.set('scope', scope);
  return getJson(`/api/v1/schools/${encodeURIComponent(schoolId)}/search?${params.toString()}`, token);
}

export async function fetchAdminDashboardSummary(token, days = 365) {
  return getJson(`/api/v1/schools/summary?days=${encodeURIComponent(days)}`, token);
}

export async function fetchPlatformAuditLogs(token, filters = {}) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => { if (value !== undefined && value !== '') params.set(key, value); });
  return getJson(`/api/v1/audit-logs?${params.toString()}`, token);
}

export async function fetchSchoolActivity(token, schoolId, limit = 100) {
  return getJson(`/api/v1/schools/${encodeURIComponent(schoolId)}/activity?limit=${encodeURIComponent(limit)}`, token);
}

export async function fetchAdminSchoolList(token, search = '') {
  const params = new URLSearchParams();
  if (search) params.set('search', search);
  const query = params.toString();
  return getJson(`/api/v1/schools${query ? `?${query}` : ''}`, token);
}

export async function fetchArchivedAdminSchools(token, search = '', status = '') {
  const params = new URLSearchParams();
  if (search) params.set('search', search);
  if (status) params.set('status', status);
  const query = params.toString();
  return getJson(`/api/v1/schools/archived${query ? `?${query}` : ''}`, token);
}

export async function archiveAdminSchool(token, schoolId) {
  return postJson(`/api/v1/schools/${encodeURIComponent(schoolId)}/archive`, {}, token);
}

export async function restoreAdminSchool(token, schoolId) {
  return postJson(`/api/v1/schools/${encodeURIComponent(schoolId)}/restore`, {}, token);
}

export async function permanentlyDeleteArchivedSchool(token, schoolId) {
  return deleteJson(`/api/v1/schools/${encodeURIComponent(schoolId)}/permanent`, token);
}

export async function createAdminSchool(token, payload) {
  return postJson('/api/v1/schools', payload, token);
}

export async function updateAdminSchool(token, schoolId, payload) {
  return putJson(`/api/v1/schools/${encodeURIComponent(schoolId)}`, payload, token);
}

export async function deleteAdminSchool(token, schoolId) {
  return deleteJson(`/api/v1/schools/${encodeURIComponent(schoolId)}`, token);
}

export async function activateAdminSchool(token, schoolId) {
  return postJson(`/api/v1/schools/${encodeURIComponent(schoolId)}/activate`, {}, token);
}

export async function fetchSchoolEntities(token, schoolId, entityType, query = {}) {
  const params = new URLSearchParams();
  if (query.search) params.set('search', query.search);
  if (query.status) params.set('status', query.status);
  if (query.page) params.set('page', query.page);
  if (query.pageSize) params.set('pageSize', query.pageSize);
  const path = `/api/v1/schools/${encodeURIComponent(schoolId)}/entities/${encodeURIComponent(entityType)}`;
  return getJson(`${path}?${params.toString()}`, token);
}

export async function createSchoolEntity(token, schoolId, entityType, payload) {
  return postJson(`/api/v1/schools/${encodeURIComponent(schoolId)}/entities/${encodeURIComponent(entityType)}`, payload, token);
}

export async function resendTeacherInvitation(token, schoolId, teacherId) {
  return postJson(`/api/v1/schools/${encodeURIComponent(schoolId)}/teachers/${encodeURIComponent(teacherId)}/resend-invitation`, {}, token);
}

export async function updateSchoolEntity(token, schoolId, entityType, entityId, payload) {
  return putJson(`/api/v1/schools/${encodeURIComponent(schoolId)}/entities/${encodeURIComponent(entityType)}/${encodeURIComponent(entityId)}`, payload, token);
}

export async function deleteSchoolEntity(token, schoolId, entityType, entityId) {
  return deleteJson(`/api/v1/schools/${encodeURIComponent(schoolId)}/entities/${encodeURIComponent(entityType)}/${encodeURIComponent(entityId)}`, token);
}

export async function fetchAssignments(token, schoolId, query = {}) {
  const params = new URLSearchParams(query);
  return getJson(`/api/v1/schools/${encodeURIComponent(schoolId)}/assignments${params.toString() ? `?${params}` : ''}`, token);
}

export async function createAssignment(token, schoolId, payload) {
  return postJson(`/api/v1/schools/${encodeURIComponent(schoolId)}/assignments`, payload, token);
}

export async function submitAssignment(token, schoolId, assignmentId, payload) {
  return postJson(`/api/v1/schools/${encodeURIComponent(schoolId)}/assignments/${encodeURIComponent(assignmentId)}/submissions`, payload, token);
}

export async function fetchLessons(token, schoolId, query = {}) {
  const params = new URLSearchParams(query);
  return getJson(`/api/v1/schools/${encodeURIComponent(schoolId)}/lessons${params.toString() ? `?${params}` : ''}`, token);
}

export async function createLesson(token, schoolId, payload) {
  return postJson(`/api/v1/schools/${encodeURIComponent(schoolId)}/lessons`, payload, token);
}

export async function fetchWorkspaceMessages(token, schoolId, query = {}) {
  const params = new URLSearchParams();
  if (query.folder) params.set('folder', query.folder);
  if (query.search) params.set('search', query.search);
  const path = `/api/v1/schools/${encodeURIComponent(schoolId)}/messages${params.toString() ? `?${params.toString()}` : ''}`;
  return getJson(path, token);
}

export async function fetchMessageRecipients(token, schoolId) {
  return getJson(`/api/v1/schools/${encodeURIComponent(schoolId)}/message-recipients`, token);
}

export async function createWorkspaceMessage(token, schoolId, payload) {
  return postJson(`/api/v1/schools/${encodeURIComponent(schoolId)}/messages`, payload, token);
}

export async function updateWorkspaceMessage(token, schoolId, messageId, payload) {
  return putJson(`/api/v1/schools/${encodeURIComponent(schoolId)}/messages/${encodeURIComponent(messageId)}`, payload, token);
}

export async function deleteWorkspaceMessage(token, schoolId, messageId) {
  return deleteJson(`/api/v1/schools/${encodeURIComponent(schoolId)}/messages/${encodeURIComponent(messageId)}`, token);
}

export async function fetchSupportTickets(token, schoolId, query = {}) {
  const params = new URLSearchParams();
  if (query.status) params.set('status', query.status);
  const path = `/api/v1/schools/${encodeURIComponent(schoolId)}/support-tickets${params.toString() ? `?${params.toString()}` : ''}`;
  return getJson(path, token);
}

export async function createSupportTicket(token, schoolId, payload) {
  return postJson(`/api/v1/schools/${encodeURIComponent(schoolId)}/support-tickets`, payload, token);
}

export async function updateSupportTicket(token, schoolId, ticketId, payload) {
  return putJson(`/api/v1/schools/${encodeURIComponent(schoolId)}/support-tickets/${encodeURIComponent(ticketId)}`, payload, token);
}

export async function deleteSupportTicket(token, schoolId, ticketId) {
  return deleteJson(`/api/v1/schools/${encodeURIComponent(schoolId)}/support-tickets/${encodeURIComponent(ticketId)}`, token);
}
