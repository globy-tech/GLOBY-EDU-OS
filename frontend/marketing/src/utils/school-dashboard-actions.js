function buildSchoolEntityPayload(entityType, data = {}) {
  const payload = { ...data };
  if (!payload.status) {
    payload.status = 'active';
  }

  if (entityType === 'departments' || entityType === 'streams' || entityType === 'subjects') {
    payload.name = data.name || data.label || '';
    payload.code = data.code || payload.code || '';
    payload.description = data.description || payload.description || null;
  }

  if (entityType === 'classes') {
    payload.name = data.name || '';
    payload.grade = data.grade || data.year || '';
    payload.section = data.section || data.stream || null;
    payload.streamId = data.streamId || null;
    delete payload.department;
    delete payload.capacity;
    delete payload.classTeacher;
    delete payload.subjects;
  }

  if (entityType === 'teachers' || entityType === 'students') {
    payload.fullName = data.fullName || data.name || '';
    payload.email = data.email || '';
    payload.phone = data.phone || null;
    payload.profilePhoto = data.profilePhoto || data.passportPhoto || null;
    payload.gender = data.gender || null;
    payload.dateOfBirth = data.dateOfBirth || data.birthDate || null;
    payload.address = data.address || data.homeAddress || null;
    payload.country = data.country || null;
    payload.region = data.region || null;
    payload.status = data.status || payload.status;

    if (entityType === 'students') {
      payload.gradeLevel = data.gradeLevel || data.grade || null;
      payload.className = data.className || null;
      payload.classId = data.classId || null;
      payload.section = data.section || data.stream || null;
      payload.studentId = data.studentId || null;
      payload.admissionNumber = data.admissionNumber || null;
      payload.currentAcademicYear = data.currentAcademicYear || data.academicYear || null;
      payload.currentTerm = data.currentTerm || data.term || null;
      payload.guardian = data.guardian || data.parentName || null;
      payload.parentPhone = data.parentPhone || data.guardianPhone || null;
      payload.parentEmail = data.parentEmail || data.guardianEmail || null;
      payload.medical = data.medical || data.medicalNotes || null;
      payload.house = data.house || null;
      payload.transportMode = data.transportMode || null;
      payload.enrollmentDate = data.enrollmentDate || null;
      payload.documents = Array.isArray(data.documents)
        ? data.documents
        : String(data.documents || '')
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean);
    }

    if (entityType === 'teachers') {
      delete payload.nationalId;
      delete payload.nationalIdNumber;
      delete payload.signature;
      payload.teacherId = data.teacherId || null;
      payload.employeeNumber = data.employeeNumber || null;
      payload.department = data.department || null;
      payload.position = data.position || data.jobTitle || null;
      payload.qualification = data.qualification || null;
      payload.yearsOfExperience = data.yearsOfExperience || data.experience || null;
      payload.currentAcademicYear = data.currentAcademicYear || data.academicYear || null;
      payload.currentTerm = data.currentTerm || data.term || null;
      payload.assignedClasses = Array.isArray(data.assignedClasses)
        ? data.assignedClasses
        : String(data.assignedClasses || data.classAssignments || '')
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean);
      payload.assignedSubjects = Array.isArray(data.assignedSubjects)
        ? data.assignedSubjects
        : String(data.assignedSubjects || data.subjectAssignments || '')
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean);
      payload.classTeacher = data.classTeacher !== undefined ? data.classTeacher : data.isClassTeacher || false;
      payload.houseMaster = data.houseMaster !== undefined ? data.houseMaster : data.isHouseMaster || false;
      payload.employmentDate = data.employmentDate || null;
      payload.employmentType = data.employmentType || null;
      payload.subjectSpecialty = data.subjectSpecialty || null;
      payload.documents = Array.isArray(data.documents)
        ? data.documents
        : String(data.documents || '')
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean);
    }
  }

  if (entityType === 'academic-years' || entityType === 'terms' || entityType === 'semesters') {
    payload.label = data.label || data.name || '';
    payload.startDate = data.startDate || null;
    payload.endDate = data.endDate || null;
    if (entityType !== 'academic-years') payload.academicYearId = data.academicYearId || null;
    delete payload.description;
  }

  return payload;
}

function buildSchoolCollectionPayload(collectionName, data = {}) {
  const payload = { ...data };
  if (collectionName === 'attendanceRecords') {
    payload.date = data.date || '';
    payload.status = data.status || '';
    payload.studentName = data.studentName || data.student || data.fullName || null;
    payload.studentId = data.studentId || null;
    payload.className = data.className || data.class || null;
    payload.teacher = data.teacher || null;
    payload.subject = data.subject || null;
    payload.note = data.note || '';
    payload.recordedAt = data.recordedAt || new Date().toISOString();
  }

  if (collectionName === 'payments') {
    payload.amount = data.amount || '';
    payload.student = data.student || '';
    payload.method = data.method || '';
    payload.feeType = data.feeType || data.category || null;
    payload.term = data.term || null;
    payload.reference = data.reference || null;
    payload.status = data.status || 'received';
    payload.note = data.note || '';
  }

  if (collectionName === 'announcements') {
    payload.title = data.title || '';
    payload.detail = data.detail || '';
    payload.audience = data.audience || '';
    payload.channel = data.channel || 'all';
    payload.priority = data.priority || 'normal';
    payload.attachments = Array.isArray(data.attachments) ? data.attachments : String(data.attachments || '').split(',').map((item) => item.trim()).filter(Boolean);
    payload.effectiveDate = data.effectiveDate || null;
    payload.expiryDate = data.expiryDate || null;
  }

  if (collectionName === 'messages') {
    payload.recipient = data.recipient || '';
    payload.subject = data.subject || '';
    payload.body = data.body || '';
    payload.channel = data.channel || 'workspace';
    payload.sendVia = data.sendVia || 'email';
    payload.priority = data.priority || 'normal';
    payload.attachments = Array.isArray(data.attachments) ? data.attachments : String(data.attachments || '').split(',').map((item) => item.trim()).filter(Boolean);
  }

  if (collectionName === 'reports') {
    payload.title = data.title || '';
    payload.type = data.type || 'general';
    payload.summary = data.summary || '';
    payload.category = data.category || null;
    payload.author = data.author || null;
    payload.status = data.status || 'draft';
    payload.submittedAt = data.submittedAt || null;
    payload.relatedStudents = Array.isArray(data.relatedStudents) ? data.relatedStudents : String(data.relatedStudents || '').split(',').map((item) => item.trim()).filter(Boolean);
  }

  return payload;
}

function buildChangedFieldsPayload(currentData = {}, updatedData = {}) {
  const changes = {};
  Object.entries(updatedData).forEach(([key, value]) => {
    if (currentData[key] !== value) {
      changes[key] = value;
    }
  });
  return changes;
}

function normalizeAttendanceStatus(status) {
  const value = String(status || '').trim().toLowerCase();
  if (value === 'present' || value === 'late') return 'present';
  if (value === 'absent' || value === 'excused') return 'absent';
  return '';
}

function buildAttendanceRoster(students = [], records = [], date = '', className = '', classRecord = null) {
  const selectedClassId = String(classRecord?.classId || classRecord?.id || '').trim().toLowerCase();
  const selectedClassName = String(classRecord?.name || classRecord?.className || className || '').trim().toLowerCase();
  const selectedGrade = String(classRecord?.grade || '').trim().toLowerCase();
  const roster = Array.isArray(classRecord?.students) ? classRecord.students.map((entry) => String(entry?.studentId || entry?.id || entry).trim().toLowerCase()) : [];
  return (Array.isArray(students) ? students : [])
    .filter((student) => String(student.status || 'active').toLowerCase() !== 'archived')
    .filter((student) => {
      const studentId = String(student.studentId || student.id || student.email || '').trim().toLowerCase();
      const studentClassId = String(student.classId || '').trim().toLowerCase();
      const studentClassName = String(student.className || student.gradeLevel || student.grade || '').trim().toLowerCase();
      return (selectedClassId && studentClassId === selectedClassId)
        || (selectedClassName && studentClassName === selectedClassName)
        || (selectedGrade && studentClassName === selectedGrade)
        || roster.includes(studentId)
        || studentClassName === String(className).trim().toLowerCase();
    })
    .map((student) => {
      const studentId = student.studentId || student.id || student.email || '';
      const existing = (Array.isArray(records) ? records : []).find((record) => String(record.date || '').slice(0, 10) === String(date).slice(0, 10) && String(record.className || '').trim() === String(className).trim() && String(record.studentId || '').trim() === String(studentId).trim());
      return { student, studentId, status: normalizeAttendanceStatus(existing?.status) };
    });
}

function replaceAttendanceSession(records = [], roster = [], date = '', className = '', schoolId = '', academicPeriod = {}) {
  const normalizedDate = String(date).slice(0, 10);
  const sessionKey = (entry) => [
    String(entry.date || '').slice(0, 10),
    String(entry.className || '').trim().toLowerCase(),
    String(entry.studentId || '').trim().toLowerCase(),
  ].join('|');
  const keys = new Set(roster.map((entry) => sessionKey({ date: normalizedDate, className, studentId: entry.studentId })));
  const retained = (Array.isArray(records) ? records : [])
    .filter((record) => !keys.has(sessionKey(record)))
    .map((record) => ({
      ...record,
      date: String(record.date || '').slice(0, 10),
      status: normalizeAttendanceStatus(record.status) || record.status,
    }));
  const submitted = new Map();
  roster.filter((entry) => normalizeAttendanceStatus(entry.status)).forEach((entry) => {
    const record = {
      schoolId,
      date: normalizedDate,
      className,
      studentId: entry.studentId,
      studentName: entry.student?.fullName || entry.student?.name || 'Student',
      status: normalizeAttendanceStatus(entry.status),
      recordedAt: new Date().toISOString(),
      ...(academicPeriod.academicYear ? { academicYear: academicPeriod.academicYear } : {}),
      ...(academicPeriod.term ? { term: academicPeriod.term } : {}),
    };
    submitted.set(sessionKey(record), record);
  });
  return [...retained, ...submitted.values()];
}

export {
  buildSchoolEntityPayload,
  buildSchoolCollectionPayload,
  buildChangedFieldsPayload,
  normalizeAttendanceStatus,
  buildAttendanceRoster,
  replaceAttendanceSession,
};
