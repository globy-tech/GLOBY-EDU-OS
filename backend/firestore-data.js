function sanitizeFirestoreData(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => (entry === undefined ? null : sanitizeFirestoreData(entry)));
  }

  if (!value || typeof value !== 'object') return value;

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return value;

  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .map(([key, entry]) => [key, sanitizeFirestoreData(entry)])
  );
}

module.exports = { sanitizeFirestoreData };
