const { createCorsOriginValidator } = require('../cors.config');

describe('CORS origin policy', () => {
  test('allows configured HTTPS production origins and GlobyEdu HTTPS subdomains', () => {
    const isAllowedOrigin = createCorsOriginValidator({
      nodeEnv: 'production',
      configuredOrigins: 'https://portal.example.test',
    });

    expect(isAllowedOrigin('https://portal.example.test')).toBe(true);
    expect(isAllowedOrigin('https://schools.globyedu.com')).toBe(true);
    expect(isAllowedOrigin('https://globyedu.com')).toBe(true);
  });

  test('rejects localhost and insecure configured or GlobyEdu origins in production', () => {
    const isAllowedOrigin = createCorsOriginValidator({
      nodeEnv: 'production',
      configuredOrigins: 'http://localhost:3000,http://portal.example.test',
    });

    expect(isAllowedOrigin('http://localhost:3000')).toBe(false);
    expect(isAllowedOrigin('http://portal.example.test')).toBe(false);
    expect(isAllowedOrigin('http://schools.globyedu.com')).toBe(false);
  });

  test('allows local development origins outside production', () => {
    const isAllowedOrigin = createCorsOriginValidator({ nodeEnv: 'development', configuredOrigins: '' });

    expect(isAllowedOrigin('http://localhost:3000')).toBe(true);
    expect(isAllowedOrigin('https://schools.globyedu.com')).toBe(true);
    expect(isAllowedOrigin('https://unrelated.example.test')).toBe(false);
  });
});
