const { loadSchoolData } = require('../../school/fallback.school');

function findFallbackUser(schoolId, username) {
  const schools = loadSchoolData();
  const school = schools.find((entry) => entry.schoolId === schoolId);
  if (!school || !Array.isArray(school.users)) return null;
  const normalizedUsername = String(username || '').toLowerCase();
  const user = school.users.find((entry) => [entry.username, entry.email, entry.teacherId, entry.studentId]
    .some((identifier) => String(identifier || '').toLowerCase() === normalizedUsername));
  if (!user) return null;
  return {
    userId: `${schoolId}:${user.username}`,
    tenantId: schoolId,
    roles: [user.role],
    platformAdmin: user.platformAdmin === true,
    passwordNeedsReset: user.passwordNeedsReset === true,
    status: user.status || 'active',
  };
}

function findFallbackUserByPayload(payload) {
  if (!payload || typeof payload.userId !== 'string' || !payload.userId.includes(':')) return null;
  const separator = payload.userId.indexOf(':');
  return findFallbackUser(payload.userId.slice(0, separator), payload.userId.slice(separator + 1));
}

module.exports = { findFallbackUser, findFallbackUserByPayload };
