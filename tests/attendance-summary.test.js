const path = require('path');
const { spawnSync } = require('child_process');

const attendanceSummaryChecks = String.raw`
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

const { getAttendanceClassOptions, getAttendancePeriodOptions, summarizeAttendanceRecords } = await import(pathToFileURL(process.argv[1]).href);
const classes = [
  { classId: 'class-a', name: 'Class A', status: 'active' },
  { id: 'class-b', name: 'Class B', status: 'active' },
  { id: 'class-old', name: 'Archived Class', status: 'archived' },
];
const records = [
  { date: '2026-11-09', classId: 'class-a', className: 'Class A', studentId: 'student-1', status: 'present' },
  { date: '2026-11-09', classId: 'class-a', className: 'Class A', studentId: 'student-1', status: 'absent' },
  { date: '2026-11-09', classId: 'class-b', className: 'Class B', studentId: 'student-2', status: 'present' },
  { date: '2026-11-09', status: 'present' },
  { date: '2026-11-08', classId: 'class-a', className: 'Class A', studentId: 'student-3', status: 'present' },
  { date: '2026-11-10', classId: 'class-a', className: 'Class A', studentId: 'student-4', status: 'present' },
];

const today = summarizeAttendanceRecords(records, '2026-11-09', classes);
assert.equal(today.total, 3, 'a duplicate student must not be double-counted');
assert.deepEqual(today.counts, { present: 2, absent: 1 });
assert.deepEqual(today.coverage, {
  submitted: 2,
  pending: 0,
  pendingClassNames: [],
  unknown: 1,
  classCount: 2,
  required: true,
  notRequiredReason: '',
  selectedClass: '',
  selectedTerm: '',
  selectedAcademicYear: '',
});

const classA = summarizeAttendanceRecords(records, '2026-11-09', classes, 'id:class-a');
assert.equal(classA.total, 1);
assert.deepEqual(classA.counts, { present: 0, absent: 1 });
assert.equal(classA.coverage.classCount, 1);

const student2 = summarizeAttendanceRecords(records, '2026-11-09', classes, 'all', 'STUDENT-2');
assert.equal(student2.total, 1);
assert.deepEqual(student2.counts, { present: 1, absent: 0 });

const periodRecords = [
  { date: '2026-11-09', classId: 'class-a', studentId: 'student-6', status: 'present', term: 'Term 1', academicYear: '2026/2027' },
  { date: '2026-10-09', classId: 'class-a', studentId: 'student-7', status: 'absent', term: 'Term 1', academicYear: '2026/2027' },
  { date: '2026-09-09', classId: 'class-a', studentId: 'student-8', status: 'present', term: 'Term 2', academicYear: '2025/2026' },
];
const allDates = summarizeAttendanceRecords(periodRecords, 'all', classes, 'all', 'all', 'Term 1', '2026/2027');
assert.equal(allDates.date, 'All dates');
assert.equal(allDates.total, 2, 'period filters must apply across all attendance dates');
assert.deepEqual(allDates.counts, { present: 1, absent: 1 });
assert.deepEqual(getAttendancePeriodOptions(periodRecords, 'term').map((option) => option.label), ['Term 1', 'Term 2']);
assert.deepEqual(getAttendancePeriodOptions(periodRecords, 'academicYear').map((option) => option.label), ['2026/2027', '2025/2026']);

const instructionalDay = summarizeAttendanceRecords(records, '2026-11-10', classes);
assert.deepEqual(instructionalDay.coverage.pendingClassNames, ['Class B']);
assert.equal(instructionalDay.coverage.pending, 1);

const duplicateGradeClasses = [
  { classId: 'class-c', name: 'Class C', grade: 'Grade 8', status: 'active' },
  { classId: 'class-d', name: 'Class D', grade: 'Grade 8', status: 'active' },
];
const options = getAttendanceClassOptions(duplicateGradeClasses);
assert.deepEqual(options.map((option) => option.aliases), [['Class C'], ['Class D']]);
const ambiguous = summarizeAttendanceRecords([
  { date: '2026-11-09', className: 'Grade 8', studentId: 'student-4', status: 'present' },
  { date: '2026-11-09', classId: 'unknown-class', className: 'Class C', studentId: 'student-5', status: 'present' },
], '2026-11-09', duplicateGradeClasses);
assert.equal(ambiguous.coverage.unknown, 2, 'ambiguous grades and mismatched class IDs must not count as active class submissions');
assert.equal(ambiguous.coverage.submitted, 0);
`;

test('attendance summaries filter by date and class, deduplicate students, and report pending classes', () => {
  const helperPath = path.resolve(__dirname, '../frontend/marketing/src/utils/attendance-summary.mjs');
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', attendanceSummaryChecks, helperPath], {
    cwd: path.resolve(__dirname, '..'),
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`Attendance summary check failed: ${result.stderr || result.stdout || result.error}`);
  }
});
