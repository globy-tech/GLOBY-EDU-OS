const path = require('path');
const { spawnSync } = require('child_process');

const sessionReplacementCheck = String.raw`
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(process.argv[1], 'utf8');
const moduleUrl = 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
const { replaceAttendanceSession } = await import(moduleUrl);
const records = [
  { date: '2026-11-08', className: 'Class A', studentId: 'student-1', status: 'present' },
  { date: '2026-11-09', className: 'Class A', studentId: 'STUDENT-1', status: 'absent' },
  { date: '2026-11-09', className: 'class a', studentId: 'student-1', status: 'present' },
];
const roster = [
  { studentId: 'student-1', student: { fullName: 'Student One' }, status: 'absent' },
  { studentId: 'STUDENT-1', student: { fullName: 'Student One' }, status: 'present' },
];

const result = replaceAttendanceSession(records, roster, '2026-11-09', 'Class A', 'school-a', {
  academicYear: '2026/2027',
  term: 'Term 1',
});
assert.equal(result.length, 2);
assert.deepEqual(result[0], { date: '2026-11-08', className: 'Class A', studentId: 'student-1', status: 'present' });
assert.deepEqual({ ...result[1], recordedAt: undefined }, {
  schoolId: 'school-a',
  date: '2026-11-09',
  className: 'Class A',
  studentId: 'STUDENT-1',
  studentName: 'Student One',
  status: 'present',
  academicYear: '2026/2027',
  term: 'Term 1',
  recordedAt: undefined,
});
assert.equal(Number.isNaN(Date.parse(result[1].recordedAt)), false);
`;

test('attendance session replacement preserves history and deduplicates selected-session rows', () => {
  const helperPath = path.resolve(__dirname, '../frontend/marketing/src/utils/school-dashboard-actions.js');
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', sessionReplacementCheck, helperPath], {
    cwd: path.resolve(__dirname, '..'),
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`Attendance session replacement check failed: ${result.stderr || result.stdout || result.error}`);
  }
});
