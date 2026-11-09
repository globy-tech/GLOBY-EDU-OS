async function request(url, options = {}) {
  try {
    const response = await fetch(url, { credentials: 'include', ...options });
    const data = await response.json().catch(() => null);
    return { ok: response.ok, status: response.status, data };
  } catch (error) {
    return { ok: false, status: 0, data: null, error };
  }
}

export function fetchPublicWebsiteCMS() {
  return request('/api/v1/website-cms');
}

export function fetchAdminWebsiteCMS(token) {
  return request('/api/v1/website-cms/admin', {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
}

export function publishWebsiteCMS(token, settings) {
  return request('/api/v1/website-cms', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ settings }),
  });
}

export function uploadWebsiteCMSLogo(token, file) {
  return request('/api/v1/website-cms/branding-logo', {
    method: 'POST',
    headers: {
      'Content-Type': file.type || 'application/octet-stream',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: file,
  });
}