const { sanitizeFirestoreData } = require('../firestore-data');

describe('Firestore payload normalization', () => {
  test('omits nested undefined object properties without mutating the source', () => {
    const exam = { subject: 'Mathematics', score: undefined };
    const payload = {
      example: {
        examResults: [exam, { subject: 'Science', remark: undefined }],
      },
    };

    expect(sanitizeFirestoreData(payload)).toEqual({
      example: {
        examResults: [{ subject: 'Mathematics' }, { subject: 'Science' }],
      },
    });
    expect(exam).toEqual({ subject: 'Mathematics', score: undefined });
  });

  test('preserves array positions by converting undefined entries to null', () => {
    expect(sanitizeFirestoreData({ values: [1, undefined, { absent: undefined }] }))
      .toEqual({ values: [1, null, {}] });
  });

  test('preserves non-plain Firestore-compatible values', () => {
    const createdAt = new Date('2026-11-05T00:00:00.000Z');
    expect(sanitizeFirestoreData({ createdAt })).toEqual({ createdAt });
  });
});
