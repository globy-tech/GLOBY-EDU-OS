const { DEFAULT_TRIAL_DAYS, DEFAULT_TRIAL_LABEL, createTrialEndDate } = require('../trial-period');

describe('school trial period', () => {
  it('uses a consistent 14-day default and calculates expiry from the start date', () => {
    const startedAt = new Date('2026-10-01T12:00:00.000Z');

    expect(DEFAULT_TRIAL_DAYS).toBe(14);
    expect(DEFAULT_TRIAL_LABEL).toBe('14-Day Trial');
    expect(createTrialEndDate(startedAt).toISOString()).toBe('2026-10-15T12:00:00.000Z');
  });

  it('rejects an invalid trial start date', () => {
    expect(() => createTrialEndDate('not-a-date')).toThrow('Trial start date must be valid.');
  });
});
