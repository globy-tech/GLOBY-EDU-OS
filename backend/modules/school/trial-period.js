const DEFAULT_TRIAL_DAYS = 14;
const DEFAULT_TRIAL_DURATION_MS = DEFAULT_TRIAL_DAYS * 24 * 60 * 60 * 1000;
const DEFAULT_TRIAL_LABEL = `${DEFAULT_TRIAL_DAYS}-Day Trial`;

function createTrialEndDate(startedAt = new Date()) {
  const start = startedAt instanceof Date ? startedAt : new Date(startedAt);
  if (Number.isNaN(start.getTime())) throw new TypeError('Trial start date must be valid.');
  return new Date(start.getTime() + DEFAULT_TRIAL_DURATION_MS);
}

module.exports = { DEFAULT_TRIAL_DAYS, DEFAULT_TRIAL_LABEL, createTrialEndDate };
