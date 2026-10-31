async function request(url, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  const token = localStorage.getItem('globyedu_accessToken');
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(url, { ...options, headers });
  const data = await response.json().catch(() => null);
  if (response.status === 503 && data?.code === 'MAINTENANCE_MODE' && typeof document !== 'undefined') {
    document.dispatchEvent(new CustomEvent('globyedu-maintenance-mode', { detail: data }));
  }
  return { ok: response.ok, status: response.status, data };
}

export async function fetchPublicPricing() {
  return request('/api/v1/pricing');
}

export async function fetchAdminPricing() {
  return request('/api/v1/pricing/all');
}

export async function updatePricingPlan(planId, payload) {
  return request(`/api/v1/pricing/${encodeURIComponent(planId)}`, { method: 'PUT', body: JSON.stringify(payload) });
}

export async function initializeSubscriptionCheckout(payload) {
  return request('/api/v1/pricing/checkout', { method: 'POST', body: JSON.stringify(payload) });
}

export async function verifySubscriptionPayment(reference) {
  return request('/api/v1/pricing/verify', { method: 'POST', body: JSON.stringify({ reference }) });
}

export async function fetchMaintenanceMode() {
  return request('/api/v1/platform-admins/maintenance');
}

export async function updateMaintenanceMode(maintenanceMode) {
  return request('/api/v1/platform-admins/maintenance', {
    method: 'PUT',
    body: JSON.stringify({ maintenanceMode }),
  });
}
