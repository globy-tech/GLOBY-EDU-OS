function normalizeClassLabel(value) {
  return String(value || '').trim().toLowerCase();
}

export function getAttendanceStatusLabel(status) {
  const normalized = String(status || '').trim().toLowerCase();
  if (normalized === 'present' || normalized === 'late') return 'Present';
  if (normalized === 'absent' || normalized === 'excused') return 'Absent';
  return '—';
}

export function getAttendanceClassOptions(classes = []) {
  const options = new Map();
  const activeClasses = (Array.isArray(classes) ? classes : []).filter((classRecord) => {
    const status = String(classRecord.status || '').trim().toLowerCase();
    return !['archived', 'inactive', 'deleted'].includes(status);
  });
  const gradeCounts = new Map();
  activeClasses.forEach((classRecord) => {
    const grade = normalizeClassLabel(classRecord.grade);
    if (grade) gradeCounts.set(grade, (gradeCounts.get(grade) || 0) + 1);
  });

  activeClasses.forEach((classRecord) => {
    const id = String(classRecord.classId || classRecord.id || '').trim();
    const grade = String(classRecord.grade || '').trim();
    const aliases = [...new Set([classRecord.name, classRecord.className, grade && gradeCounts.get(normalizeClassLabel(grade)) === 1 ? grade : '']
      .map((value) => String(value || '').trim())
      .filter(Boolean))];
    if (!aliases.length) return;
    const key = id ? `id:${id}` : `name:${normalizeClassLabel(aliases[0])}`;
    if (!options.has(key)) options.set(key, { key, id, label: aliases[0], aliases });
  });
  return [...options.values()];
}

export function getAttendanceStudentOptions(records = []) {
  const options = new Map();
  (Array.isArray(records) ? records : []).forEach((record) => {
    const id = String(record.studentId || record.student_id || record.student || '').trim();
    if (!id) return;
    const key = id.toLowerCase();
    if (!options.has(key)) {
      options.set(key, {
        key,
        label: String(record.studentName || record.fullName || record.name || id).trim(),
      });
    }
  });
  return [...options.values()];
}

export function getAttendancePeriodOptions(records = [], field) {
  const aliases = field === 'academicYear' ? ['academicYear', 'currentAcademicYear'] : ['term', 'currentTerm'];
  const options = new Map();
  (Array.isArray(records) ? records : []).forEach((record) => {
    const value = String(aliases.map((key) => record[key]).find(Boolean) || '').trim();
    if (value && !options.has(value.toLowerCase())) options.set(value.toLowerCase(), { key: value, label: value });
  });
  return [...options.values()];
}

function attendanceRecordMatchesClass(record, classOption) {
  const recordId = String(record.classId || record.class_id || '').trim();
  if (recordId) return Boolean(classOption.id && recordId === classOption.id);
  const recordName = normalizeClassLabel(record.className || record.class || record.classroom);
  return Boolean(recordName && classOption.aliases.some((alias) => normalizeClassLabel(alias) === recordName));
}

export function summarizeAttendanceRecords(
  records = [],
  date = new Date().toISOString().slice(0, 10),
  classes = [],
  selectedClass = 'all',
  selectedStudent = 'all',
  selectedTerm = 'all',
  selectedAcademicYear = 'all',
) {
  const dateRecords = (Array.isArray(records) ? records : [])
    .filter((entry) => date === 'all' || String(entry.date || '').slice(0, 10) === date);
  const classOptions = getAttendanceClassOptions(classes);
  const selectedClassOption = classOptions.find((option) => option.key === selectedClass);
  const selectedStudentKey = String(selectedStudent || 'all').trim().toLowerCase();
  const periodRecords = dateRecords.filter((entry) => {
    const term = String(entry.term || entry.currentTerm || '').trim().toLowerCase();
    const academicYear = String(entry.academicYear || entry.currentAcademicYear || '').trim().toLowerCase();
    return (selectedTerm === 'all' || term === String(selectedTerm).trim().toLowerCase())
      && (selectedAcademicYear === 'all' || academicYear === String(selectedAcademicYear).trim().toLowerCase());
  });
  const validDateRecords = periodRecords
    .map((entry) => ({ ...entry, status: getAttendanceStatusLabel(entry.status).toLowerCase() }))
    .filter((entry) => entry.status === 'present' || entry.status === 'absent');
  const matchingRecords = validDateRecords.filter((entry) => {
    if (selectedClassOption && !attendanceRecordMatchesClass(entry, selectedClassOption)) return false;
    if (selectedStudentKey !== 'all') {
      const studentId = String(entry.studentId || entry.student_id || entry.student || '').trim().toLowerCase();
      if (studentId !== selectedStudentKey) return false;
    }
    return true;
  });
  const uniqueAttendanceRecords = new Map();
  matchingRecords.forEach((entry, index) => {
    const studentId = String(entry.studentId || entry.student_id || entry.id || entry.email || '').trim().toLowerCase();
    const entryDate = String(entry.date || '').slice(0, 10);
    const key = studentId ? `${entryDate}|student:${studentId}` : `${entryDate}|record:${index}`;
    const previous = uniqueAttendanceRecords.get(key);
    if (!previous || String(entry.updatedAt || '').localeCompare(String(previous.updatedAt || '')) >= 0) {
      uniqueAttendanceRecords.set(key, entry);
    }
  });
  const deduplicatedRecords = [...uniqueAttendanceRecords.values()];
  const list = deduplicatedRecords;
  const counts = { present: 0, absent: 0 };

  list.forEach((entry) => {
    const normalized = String(entry.status || '').trim().toLowerCase();
    if (normalized === 'present') counts.present += 1;
    else if (normalized === 'absent') counts.absent += 1;
  });

  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
  const coverageClasses = selectedClassOption ? [selectedClassOption] : classOptions;
  const submittedClasses = coverageClasses.filter((classOption) => validDateRecords.some((entry) => attendanceRecordMatchesClass(entry, classOption)));
  const pendingClasses = coverageClasses.filter((classOption) => !submittedClasses.includes(classOption));
  return {
    date: date === 'all' ? 'All dates' : date,
    records: list,
    total,
    counts,
    presentRatio: total ? Math.round((counts.present / total) * 100) : 0,
    coverage: {
      submitted: submittedClasses.length,
      pending: pendingClasses.length,
      pendingClassNames: pendingClasses.map((classOption) => classOption.label),
      unknown: validDateRecords.filter((entry) => !classOptions.some((classOption) => attendanceRecordMatchesClass(entry, classOption))).length,
      classCount: coverageClasses.length,
      selectedClass: selectedClassOption?.label || '',
      selectedTerm: selectedTerm === 'all' ? '' : selectedTerm,
      selectedAcademicYear: selectedAcademicYear === 'all' ? '' : selectedAcademicYear,
    },
    statusSummary: [
      { label: 'Present', count: counts.present, tone: 'emerald' },
      { label: 'Absent', count: counts.absent, tone: 'rose' },
    ],
  };
}
