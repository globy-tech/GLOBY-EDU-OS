const prisma = require('../../config/prisma.client');
const firebaseCore = require('../../firebase.core');
const { loadSchoolData, saveSchoolData, findSchoolBySchoolId, ensureSchoolEntities } = require('./fallback.school');

function actorRoles(actor = {}) {
  const roles = Array.isArray(actor.roles) ? actor.roles : [actor.role].filter(Boolean);
  return new Set(roles.map((role) => String(typeof role === 'string' ? role : role?.name || role?.role?.name || '').toLowerCase()));
}

function assertAuthority(actor, schoolId) {
  const roles = actorRoles(actor);
  if (roles.has('super_admin') && actor.platformAdmin === true) return;
  if (!roles.has('school_authority') && !roles.has('school_head')) {
    throw new Error('Only School Authority can manage student progression.');
  }
  if (String(actor.tenantId || actor.schoolId || '') !== String(schoolId)) throw new Error('Tenant mismatch');
}

function normalize(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function getStudentKey(student = {}) {
  return String(student.studentId || student.id || student.username || student.email || '').trim();
}

function studentIdentifiers(student = {}) {
  return new Set([getStudentKey(student), student.id, student.userId, student.email, student.username]
    .filter(Boolean).map((value) => normalize(String(value).split(':').pop())));
}

function enrollmentBelongsToStudent(enrollment, student) {
  const identifiers = studentIdentifiers(student);
  return [enrollment.studentId, enrollment.userId]
    .some((value) => identifiers.has(normalize(String(value || '').split(':').pop())));
}

function getConfiguredAliases(school = {}) {
  const config = school.academicStructure?.classAliases || school.classAliases || {};
  if (Array.isArray(config)) {
    return config.map((entry) => ({
      canonical: String(entry?.canonical || entry?.name || '').trim(),
      aliases: Array.isArray(entry?.aliases) ? entry.aliases.map(String) : [],
    })).filter((entry) => entry.canonical);
  }
  if (config && typeof config === 'object') {
    return Object.entries(config).map(([canonical, aliases]) => ({
      canonical: String(canonical).trim(),
      aliases: Array.isArray(aliases) ? aliases.map(String) : [String(aliases || '')].filter(Boolean),
    }));
  }
  return [];
}

function canonicalClassName(school, value) {
  const key = normalize(value);
  const matches = getConfiguredAliases(school).filter(({ canonical, aliases }) => (
    [canonical, ...aliases].some((alias) => normalize(alias) === key)
  ));
  const names = [...new Set(matches.map(({ canonical }) => normalize(canonical)))];
  return names.length === 1 ? names[0] : key;
}

function getYearKey(year) {
  return String(year?.id || year?.academicYearId || year?.name || year?.label || '');
}

function yearMatches(year, id) {
  const key = normalize(id);
  return [year?.id, year?.academicYearId, year?.name, year?.label].some((value) => normalize(value) === key);
}

function classIdOf(record) {
  return String(record?.classId || record?.id || '');
}

function classNameOf(record) {
  return String(record?.name || record?.className || record?.grade || '');
}

function classForStudent(school, student, enrollments = []) {
  const studentKeys = new Set([getStudentKey(student), student.id, student.userId, student.email, student.username]
    .filter(Boolean).map(normalize));
  const currentEnrollment = enrollments.find((entry) => (
    entry.isCurrent !== false
    && String(entry.status || 'active').toLowerCase() === 'active'
    && [entry.studentId, entry.userId].some((value) => studentKeys.has(normalize(String(value || '').split(':').pop())))
  ));
  const classRef = currentEnrollment?.classId || student.classId || student.metadata?.classId;
  const className = currentEnrollment?.className || student.className || student.gradeLevel || student.grade;
  return (school.classes || []).find((entry) => (
    (classRef && [entry.classId, entry.id].some((value) => normalize(value) === normalize(classRef)))
    || (!classRef && className && [entry.name, entry.className, entry.grade].some((value) => normalize(value) === normalize(className)))
  )) || null;
}

function sourceClassForOperation(school, student, enrollments, operationId) {
  if (operationId) {
    const partialEnrollment = enrollments.find((entry) => (
      entry.progressionOperationId === operationId
      && enrollmentBelongsToStudent(entry, student)
      && entry.fromClassId
    ));
    if (partialEnrollment) {
      const source = (school.classes || []).find((entry) => normalize(classIdOf(entry)) === normalize(partialEnrollment.fromClassId));
      if (source) return source;
    }
  }
  return classForStudent(school, student, enrollments);
}

function configuredProgression(school) {
  const structure = school.academicStructure || {};
  const progression = structure.progression || structure.classProgression || {};
  const result = new Map();
  const addRule = (from, to) => {
    const rawKey = normalize(from);
    const canonicalKey = canonicalClassName(school, from);
    const target = String(to);
    for (const key of new Set([rawKey, canonicalKey])) {
      if (result.has(key)
        && normalize(canonicalClassName(school, result.get(key))) !== normalize(canonicalClassName(school, target))) {
        throw new Error(`Conflicting progression rules are configured for ${from}.`);
      }
    }
    result.set(rawKey, target);
    result.set(canonicalKey, target);
    return true;
  };
  if (Array.isArray(progression)) {
    progression.forEach((entry) => {
      const from = entry?.fromClassId || entry?.from || entry?.source;
      const to = entry?.toClassId || entry?.to || entry?.target;
      if (from && to) addRule(from, to);
    });
  } else if (progression && typeof progression === 'object') {
    Object.entries(progression).forEach(([from, to]) => {
      if (typeof to === 'string' || typeof to === 'number') {
        addRule(from, to);
      }
      else if (to && typeof to === 'object') {
        const target = to.toClassId || to.to || to.target;
        if (target) addRule(from, target);
      }
    });
  }

  const paths = structure.progressionPaths || {};
  const pathGroups = Array.isArray(paths)
    ? (paths.every((entry) => typeof entry === 'string') ? [paths] : paths)
    : Object.entries(paths).map(([level, path]) => ({ level, path }));
  pathGroups.forEach((group) => {
    const path = Array.isArray(group) ? group : group?.path || group?.classes || [];
    for (let index = 0; index < path.length - 1; index += 1) {
      const from = typeof path[index] === 'object' ? path[index].classId || path[index].name : path[index];
      const to = typeof path[index + 1] === 'object' ? path[index + 1].classId || path[index + 1].name : path[index + 1];
      const rawKey = normalize(from);
      const canonicalKey = canonicalClassName(school, from);
      if (from && to && !result.has(rawKey) && !result.has(canonicalKey)) {
        addRule(from, to);
      }
    }
  });
  return result;
}

function configuredGraduationClasses(school) {
  const structure = school.academicStructure || {};
  const values = structure.graduationClasses || structure.finalYearClasses || [];
  const configured = Array.isArray(values) ? [...values] : [values];
  return new Set(configured.filter(Boolean).flatMap((value) => [normalize(value), canonicalClassName(school, value)]));
}

function resolveClass(school, yearId, reference, sourceClass = null, { sameClass = false } = {}) {
  const targetYear = String(yearId);
  const referenceKey = normalize(reference);
  const sourceCanonical = sourceClass ? canonicalClassName(school, sourceClass.grade || sourceClass.className || classNameOf(sourceClass)) : '';
  const candidates = (school.classes || []).filter((entry) => (
    normalize(entry.academicYearId || entry.academicYear) === normalize(targetYear)
  ));
  if (sameClass && sourceClass) {
    return candidates.find((entry) => (
      [entry.name, entry.className, entry.grade].some((value) => canonicalClassName(school, value) === sourceCanonical)
      && normalize(entry.section) === normalize(sourceClass.section)
      && normalize(entry.streamId || entry.stream) === normalize(sourceClass.streamId || sourceClass.stream)
    )) || null;
  }
  const exact = candidates.find((entry) => [entry.classId, entry.id]
    .some((value) => normalize(value) === referenceKey))
    || candidates.find((entry) => [entry.name, entry.className]
      .some((value) => normalize(value) === referenceKey))
    || candidates.find((entry) => normalize(entry.grade) === referenceKey);
  if (exact) return exact;
  const canonicalReference = canonicalClassName(school, reference);
  return candidates.find((entry) => [entry.name, entry.className, entry.grade]
    .some((value) => canonicalClassName(school, value) === canonicalReference)) || null;
}

function progressionRecommendation(school, sourceClass, targetYearId) {
  if (!sourceClass) return { action: 'manual', reason: 'Current class could not be resolved.' };
  const finalClasses = configuredGraduationClasses(school);
  const sourceValues = [sourceClass.classId, sourceClass.id, classNameOf(sourceClass), sourceClass.grade]
    .filter(Boolean).flatMap((value) => [normalize(value), canonicalClassName(school, value)]);
  if (sourceValues.some((value) => finalClasses.has(value))) {
    return { action: 'graduated', reason: 'Configured final class.' };
  }
  const progression = configuredProgression(school);
  const references = [sourceClass.classId, sourceClass.id, classNameOf(sourceClass), sourceClass.grade]
    .filter(Boolean).flatMap((value) => [normalize(value), canonicalClassName(school, value)]);
  const nextReference = references.map((key) => progression.get(key)).find(Boolean);
  if (!nextReference) return { action: 'manual', reason: 'No configured progression rule.' };
  const targetClass = resolveClass(school, targetYearId, nextReference, sourceClass);
  if (!targetClass) return { action: 'manual', reason: 'Configured next class is unavailable in the target academic year.' };
  return { action: 'promote', targetClassId: classIdOf(targetClass), targetClassName: classNameOf(targetClass) };
}

async function loadSchool(schoolId) {
  if (firebaseCore.isFirebaseCoreMode()) {
    const school = await firebaseCore.getSchoolAggregate(schoolId);
    if (!school) throw new Error('School not found');
    return school;
  }
  if (prisma && prisma.__stub) {
    const school = findSchoolBySchoolId(loadSchoolData(), schoolId);
    if (!school) throw new Error('School not found');
    ensureSchoolEntities(school);
    return school;
  }
  const tenant = await prisma.tenant.findUnique({
    where: { schoolId },
    include: { academicYears: true, classes: true, users: { include: { roles: { include: { role: true } } } } },
  });
  if (!tenant) throw new Error('School not found');
  const students = tenant.users.filter((user) => user.roles?.some((role) => role.role?.name === 'student'))
    .map((user) => ({
      ...user,
      studentId: user.studentId,
      userId: user.id,
      classId: user.metadata?.classId || null,
      className: user.metadata?.className || null,
      currentAcademicYear: user.metadata?.currentAcademicYear || user.metadata?.academicYearId || null,
      metadata: user.metadata || {},
    }));
  const enrollments = await prisma.enrollment.findMany({ where: { user: { tenantId: tenant.id } } });
  return { ...tenant, schoolId, students, enrollments };
}

function resolveCandidates(school, sourceYear) {
  const enrollments = Array.isArray(school.enrollments) ? school.enrollments : [];
  const sourceYearId = getYearKey(sourceYear);
  return (Array.isArray(school.students) ? school.students : [])
    .filter((student) => ['active', ''].includes(String(student.status || 'active').toLowerCase()))
    .filter((student) => {
      const keys = studentIdentifiers(student);
      const enrolled = enrollments.some((entry) => (
        entry.isCurrent !== false
        && String(entry.status || 'active').toLowerCase() === 'active'
        && [entry.studentId, entry.userId].some((value) => keys.has(normalize(String(value || '').split(':').pop())))
        && yearMatches(sourceYear, entry.academicYearId)
      ));
      if (enrolled) return true;
      const currentYear = student.academicYearId || student.currentAcademicYear || student.metadata?.academicYearId || student.metadata?.currentAcademicYear;
      if (currentYear && yearMatches(sourceYear, currentYear)) return true;
      const currentClass = classForStudent(school, student, enrollments);
      return Boolean(currentClass && normalize(currentClass.academicYearId || currentClass.academicYear) === normalize(sourceYearId));
    });
}

async function previewProgression(schoolId, payload, actor) {
  assertAuthority(actor, schoolId);
  const { fromAcademicYearId, targetAcademicYearId } = payload || {};
  if (!fromAcademicYearId || !targetAcademicYearId || normalize(fromAcademicYearId) === normalize(targetAcademicYearId)) {
    throw new Error('Select distinct source and target academic years.');
  }
  const school = await loadSchool(schoolId);
  const years = school.academicYears || [];
  const sourceYear = years.find((year) => yearMatches(year, fromAcademicYearId));
  const targetYear = years.find((year) => yearMatches(year, targetAcademicYearId));
  if (!sourceYear || !targetYear) throw new Error('Source and target academic years must belong to this school.');
  if (String(targetYear.status || '').toLowerCase() === 'archived') {
    throw new Error('The target academic year is archived and cannot receive current enrollments.');
  }
  const students = resolveCandidates(school, sourceYear);
  const items = students.map((student) => {
    const sourceClass = sourceClassForOperation(school, student, school.enrollments || [], payload.operationId);
    const recommendation = progressionRecommendation(school, sourceClass, getYearKey(targetYear));
    return {
      studentId: getStudentKey(student),
      fullName: student.fullName || student.name || '',
      sourceClassId: sourceClass ? classIdOf(sourceClass) : student.classId || null,
      sourceClassName: sourceClass ? classNameOf(sourceClass) : student.className || student.grade || '',
      ...recommendation,
    };
  });
  return {
    fromAcademicYearId: getYearKey(sourceYear),
    targetAcademicYearId: getYearKey(targetYear),
    students: items,
    counts: items.reduce((counts, item) => {
      counts[item.action] = (counts[item.action] || 0) + 1;
      return counts;
    }, {}),
  };
}

function requestedDecisions(preview, payload) {
  const decisions = payload.decisions;
  if (!Array.isArray(decisions)) throw new Error('Student progression decisions are required.');
  const previewIds = new Set(preview.students.map((item) => normalize(item.studentId)));
  const byStudent = new Map();
  for (const decision of decisions) {
    const studentId = String(decision.studentId || '').trim();
    const key = normalize(studentId);
    if (!key || !previewIds.has(key)) throw new Error('A progression decision references a student outside the preview.');
    if (byStudent.has(key)) throw new Error('Duplicate student decisions are not allowed.');
    if (!['promote', 'repeat', 'manual', 'graduated', 'transferred', 'withdrawn'].includes(decision.action)) {
      throw new Error(`Unsupported progression action for ${studentId}.`);
    }
    byStudent.set(key, {
      studentId,
      action: decision.action,
      targetClassId: decision.targetClassId ? String(decision.targetClassId).trim() : undefined,
      transferDestination: String(decision.transferDestination || '').trim().slice(0, 200),
      note: String(decision.note || '').trim().slice(0, 500),
    });
  }
  for (const student of preview.students) {
    if (!byStudent.has(normalize(student.studentId))) {
      byStudent.set(normalize(student.studentId), {
        studentId: student.studentId,
        action: student.action === 'manual' ? 'manual' : student.action,
        targetClassId: student.targetClassId || null,
      });
    }
  }
  return byStudent;
}

function appendUnique(list, item, keyFn) {
  if (!list.some((entry) => keyFn(entry) === keyFn(item))) list.push(item);
}

function updateClassRoster(school, studentId, sourceClassId, targetClassId) {
  for (const record of school.classes || []) {
    if (!Array.isArray(record.studentIds)) continue;
    const matches = record.studentIds.some((value) => normalize(value) === normalize(studentId));
    if (matches && normalize(classIdOf(record)) === normalize(sourceClassId)) {
      record.studentIds = record.studentIds.filter((value) => normalize(value) !== normalize(studentId));
    }
    if (targetClassId && normalize(classIdOf(record)) === normalize(targetClassId) && !record.studentIds.some((value) => normalize(value) === normalize(studentId))) {
      record.studentIds.push(studentId);
    }
  }
}

function makeHistoryEntry(student, sourceClass, sourceYearId, action, targetClass, targetYearId, operationId, actor, details = {}) {
  return {
    operationId,
    action,
    fromAcademicYearId: sourceYearId || student.academicYearId || student.currentAcademicYear || student.metadata?.academicYearId || student.metadata?.currentAcademicYear || null,
    toAcademicYearId: targetYearId,
    fromClassId: sourceClass ? classIdOf(sourceClass) : student.classId || null,
    fromClassName: sourceClass ? classNameOf(sourceClass) : student.className || null,
    toClassId: targetClass ? classIdOf(targetClass) : null,
    toClassName: targetClass ? classNameOf(targetClass) : null,
    ...(details.transferDestination ? { transferDestination: details.transferDestination } : {}),
    ...(details.note ? { note: details.note } : {}),
    changedAt: new Date().toISOString(),
    changedBy: String(actor.userId || actor.username || actor.email || ''),
  };
}

function validateDecision(school, student, previewItem, decision, targetYearId, operationId) {
  if (['transferred', 'withdrawn'].includes(decision.action)) return null;
  if (decision.action === 'graduated') {
    const allowed = configuredGraduationClasses(school);
    if (![previewItem.sourceClassId, previewItem.sourceClassName, canonicalClassName(school, previewItem.sourceClassName)]
      .some((value) => allowed.has(normalize(value)))) {
      throw new Error(`Graduation is not configured for ${student.fullName || student.studentId}'s current class.`);
    }
    return null;
  }
  let targetClass;
  if (decision.action === 'repeat') {
    targetClass = resolveClass(school, targetYearId, '', (school.classes || []).find((entry) => normalize(classIdOf(entry)) === normalize(previewItem.sourceClassId)), { sameClass: true });
  } else {
    const requestedClass = decision.targetClassId || previewItem.targetClassId;
    if (!requestedClass) throw new Error(`Choose a target class for ${student.fullName || student.studentId}.`);
    targetClass = (school.classes || []).find((entry) => (
      normalize(classIdOf(entry)) === normalize(requestedClass)
      || normalize(entry.name) === normalize(requestedClass)
    ));
    if (!targetClass || normalize(targetClass.academicYearId || targetClass.academicYear) !== normalize(targetYearId)) {
      throw new Error(`The target class for ${student.fullName || student.studentId} is not in the target academic year.`);
    }
  }
  if (!targetClass) throw new Error(`No matching class exists in the target academic year for ${student.fullName || student.studentId}.`);
  if (student.metadata?.progressionHistory?.some((entry) => entry.operationId === operationId)) return { alreadyProcessed: true, targetClass };
  return targetClass;
}

async function persistFallbackStudent(school, student, sourceClass, targetYearId, decision, targetClass, operationId, actor) {
  const studentId = getStudentKey(student);
  const history = makeHistoryEntry(student, sourceClass, student.academicYearId || student.currentAcademicYear || '', decision.action, targetClass, targetYearId, operationId, actor, decision);
  const metadata = { ...(student.metadata || {}) };
  const previousHistory = Array.isArray(metadata.classHistory) ? metadata.classHistory : [];
  appendUnique(previousHistory, {
    academicYearId: history.fromAcademicYearId,
    classId: history.fromClassId,
    className: history.fromClassName,
    endedAt: history.changedAt,
    operationId,
  }, (entry) => `${entry.operationId || ''}|${entry.academicYearId || ''}|${entry.classId || ''}`);
  const progressionHistory = Array.isArray(metadata.progressionHistory) ? metadata.progressionHistory : [];
  appendUnique(progressionHistory, history, (entry) => entry.operationId);
  metadata.classHistory = previousHistory;
  metadata.progressionHistory = progressionHistory;
  const exited = ['graduated', 'transferred', 'withdrawn'].includes(decision.action);
  const updated = {
    ...student,
    metadata,
    status: exited ? decision.action : 'active',
    classId: exited ? null : classIdOf(targetClass),
    className: exited ? null : classNameOf(targetClass),
    grade: exited ? student.grade : classNameOf(targetClass),
    gradeLevel: exited ? student.gradeLevel : (targetClass.grade || classNameOf(targetClass)),
    academicYearId: targetYearId,
    currentAcademicYear: targetYearId,
    updatedAt: new Date().toISOString(),
  };
  school.students = (school.students || []).map((entry) => normalize(getStudentKey(entry)) === normalize(studentId) ? updated : entry);
  if (Array.isArray(school.users)) {
    school.users = school.users.map((entry) => (
      String(entry.role || '').toLowerCase() === 'student'
      && [entry.studentId, entry.id, entry.email, entry.username].some((value) => normalize(value) === normalize(studentId))
        ? { ...entry, status: updated.status, classId: updated.classId, className: updated.className, grade: updated.grade, academicYearId: updated.academicYearId, currentAcademicYear: updated.currentAcademicYear, metadata }
        : entry
    ));
  }
  updateClassRoster(school, studentId, classIdOf(sourceClass), targetClass ? classIdOf(targetClass) : null);
  const enrollments = Array.isArray(school.enrollments) ? school.enrollments : [];
  if (targetClass && enrollments.some((entry) => (
    [entry.studentId, entry.userId].some((value) => normalize(String(value || '').split(':').pop()) === normalize(studentId))
    && normalize(entry.academicYearId) === normalize(targetYearId)
    && entry.isCurrent !== false
    && String(entry.status || 'active').toLowerCase() === 'active'
    && entry.progressionOperationId !== operationId
  ))) {
    throw new Error(`A current enrollment already exists for ${student.fullName || studentId} in the target academic year.`);
  }
  enrollments.forEach((entry) => {
    if ([entry.studentId, entry.userId].some((value) => normalize(String(value || '').split(':').pop()) === normalize(studentId))
      && entry.isCurrent !== false && String(entry.status || 'active').toLowerCase() === 'active') {
      entry.isCurrent = false;
      entry.status = decision.action === 'promote' || decision.action === 'repeat' || decision.action === 'manual' ? 'completed' : decision.action;
    }
  });
  if (targetClass) {
    const targetEnrollment = {
      id: `${studentId}:${targetYearId}:${classIdOf(targetClass)}`,
      studentId,
      userId: studentId,
      academicYearId: targetYearId,
      classId: classIdOf(targetClass),
      className: classNameOf(targetClass),
      status: 'active',
      isCurrent: true,
      progressionOperationId: operationId,
      fromClassId: history.fromClassId,
      fromAcademicYearId: history.fromAcademicYearId,
      createdAt: new Date().toISOString(),
    };
    const existing = enrollments.find((entry) => normalize(entry.studentId || String(entry.userId || '').split(':').pop()) === normalize(studentId)
      && normalize(entry.academicYearId) === normalize(targetYearId)
      && normalize(entry.classId) === normalize(classIdOf(targetClass)));
    if (existing) {
      if (existing.progressionOperationId && existing.progressionOperationId !== operationId && existing.isCurrent) {
        throw new Error(`A current enrollment already exists for ${student.fullName || studentId} in the target academic year.`);
      }
      Object.assign(existing, targetEnrollment, { id: existing.id });
    } else {
      enrollments.push(targetEnrollment);
    }
  }
  school.enrollments = enrollments;
  return updated;
}

async function persistFirebaseStudent(school, student, sourceClass, targetYearId, decision, targetClass, operationId, actor) {
  const updated = await persistFallbackStudent(school, student, sourceClass, targetYearId, decision, targetClass, operationId, actor);
  const studentId = getStudentKey(student);
  const user = (school.users || []).find((entry) => String(entry.role || '').toLowerCase() === 'student'
    && [entry.studentId, entry.id, entry.email, entry.username].some((value) => normalize(value) === normalize(studentId)));
  const targetEnrollment = targetClass && (school.enrollments || []).find((entry) => (
    entry.progressionOperationId === operationId
    && normalize(entry.studentId || entry.userId) === normalize(studentId)
    && normalize(entry.classId) === normalize(classIdOf(targetClass))
  ));
  const result = await firebaseCore.commitAcademicProgression({
    schoolId: school.schoolId,
    studentId,
    fromAcademicYearId: student.academicYearId || student.currentAcademicYear || student.metadata?.academicYearId || '',
    sourceClassId: classIdOf(sourceClass),
    targetAcademicYearId: targetYearId,
    targetClassId: classIdOf(targetClass),
    operationId,
    action: decision.action,
    student: updated,
    ...(targetEnrollment ? { targetEnrollment } : {}),
    ...(user ? {
      userId: user.email || user.username || studentId,
      user: {
        ...user,
        studentId,
        status: updated.status,
        classId: updated.classId,
        className: updated.className,
        metadata: updated.metadata,
      },
    } : {}),
  });
  return { ...updated, idempotent: result.idempotent === true };
}

async function persistPrismaStudent(schoolId, previewItem, decision, targetYearId, operationId, actor) {
  const tenant = await prisma.tenant.findUnique({ where: { schoolId }, select: { id: true } });
  if (!tenant) throw new Error('School not found');
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.findFirst({ where: { tenantId: tenant.id, studentId: previewItem.studentId } });
    if (!user) throw new Error('Student not found in this school.');
    const metadata = user.metadata && typeof user.metadata === 'object' ? user.metadata : {};
    if ((metadata.progressionHistory || []).some((entry) => entry.operationId === operationId)) {
      return { studentId: user.studentId, action: decision.action, idempotent: true };
    }
    const sourceClass = await tx.class.findFirst({ where: { id: previewItem.sourceClassId, tenantId: tenant.id } });
    if (!sourceClass && previewItem.sourceClassId) throw new Error('Current class does not belong to this school.');
    const targetClass = decision.targetClassId
      ? await tx.class.findFirst({ where: { id: decision.targetClassId, tenantId: tenant.id, academicYearId: targetYearId } })
      : null;
    if (['promote', 'repeat', 'manual'].includes(decision.action) && !targetClass) throw new Error('Target class does not belong to this school and academic year.');
    if (targetClass) {
      const targetEnrollment = await tx.enrollment.findFirst({
        where: { userId: user.id, academicYearId: targetYearId, isCurrent: true, status: 'active' },
      });
      if (targetEnrollment) throw new Error(`A current enrollment already exists for ${user.studentId} in the target academic year.`);
    }
    const history = makeHistoryEntry({ ...user, classId: sourceClass?.id }, sourceClass, user.metadata?.academicYearId || previewItem.fromAcademicYearId, decision.action, targetClass, targetYearId, operationId, actor, decision);
    const classHistory = Array.isArray(metadata.classHistory) ? [...metadata.classHistory] : [];
    appendUnique(classHistory, {
      academicYearId: history.fromAcademicYearId,
      classId: history.fromClassId,
      className: history.fromClassName,
      endedAt: history.changedAt,
      operationId,
    }, (entry) => `${entry.operationId || ''}|${entry.academicYearId || ''}|${entry.classId || ''}`);
    const progressionHistory = Array.isArray(metadata.progressionHistory) ? [...metadata.progressionHistory] : [];
    appendUnique(progressionHistory, history, (entry) => entry.operationId);
    const exited = ['graduated', 'transferred', 'withdrawn'].includes(decision.action);
    const nextMetadata = {
      ...metadata,
      classHistory,
      progressionHistory,
      classId: exited ? null : targetClass?.id,
      className: exited ? null : targetClass?.name,
      academicYearId: targetYearId,
      currentAcademicYear: targetYearId,
    };
    const updatedUser = await tx.user.update({
      where: { id: user.id },
      data: { status: exited ? decision.action : 'active', metadata: nextMetadata },
    });
    await tx.enrollment.updateMany({
      where: { userId: user.id, isCurrent: true, status: 'active' },
      data: { isCurrent: false, status: exited ? decision.action : 'completed' },
    });
    if (sourceClass) {
      await tx.class.update({
        where: { id: sourceClass.id },
        data: { studentIds: (sourceClass.studentIds || []).filter((id) => normalize(id) !== normalize(user.studentId)) },
      });
    }
    if (targetClass) {
      await tx.class.update({
        where: { id: targetClass.id },
        data: { studentIds: [...new Set([...(targetClass.studentIds || []), user.studentId])] },
      });
      await tx.enrollment.upsert({
        where: { userId_academicYearId_classId: { userId: user.id, academicYearId: targetYearId, classId: targetClass.id } },
        create: { userId: user.id, academicYearId: targetYearId, classId: targetClass.id, status: 'active', isCurrent: true },
        update: { status: 'active', isCurrent: true },
      });
    }
    return { studentId: updatedUser.studentId, action: decision.action, idempotent: false };
  }, { isolationLevel: 'Serializable' });
}

async function confirmProgression(schoolId, payload, actor) {
  assertAuthority(actor, schoolId);
  if (payload?.confirmed !== true) throw new Error('Promotion requires explicit confirmation.');
  const operationId = String(payload.operationId || '').trim();
  if (operationId.length < 8 || operationId.length > 120) throw new Error('A valid progression operation ID is required.');
  const school = await loadSchool(schoolId);
  const requestDecisions = Array.isArray(payload.decisions) ? payload.decisions : [];
  if (!requestDecisions.length) throw new Error('At least one student progression decision is required.');
  const requestedStudentIds = new Set();
  for (const decision of requestDecisions) {
    const key = normalize(decision.studentId);
    if (!key || requestedStudentIds.has(key)) throw new Error('Duplicate student decisions are not allowed.');
    requestedStudentIds.add(key);
  }
  const processedStudents = (school.students || [])
    .filter((student) => student.metadata?.progressionHistory?.some((entry) => entry.operationId === operationId));
  const processedById = new Map(processedStudents
    .map((student) => [normalize(getStudentKey(student)), student.metadata.progressionHistory.find((entry) => entry.operationId === operationId)]));
  requestDecisions.forEach((decision) => {
    const previous = processedById.get(normalize(decision.studentId));
    if (previous && (
      previous.action !== decision.action
      || normalize(previous.fromAcademicYearId) !== normalize(payload.fromAcademicYearId)
      || normalize(previous.toAcademicYearId) !== normalize(payload.targetAcademicYearId)
      || (decision.targetClassId && normalize(previous.toClassId) !== normalize(decision.targetClassId))
    )) {
      throw new Error(`Progression operation ${operationId} was already applied with a different decision.`);
    }
  });
  const alreadyProcessed = new Set(processedStudents
    .map((student) => normalize(getStudentKey(student))));
  const pendingDecisions = requestDecisions.filter((decision) => !alreadyProcessed.has(normalize(decision.studentId)));
  if (!pendingDecisions.length) {
    return {
      operationId,
      fromAcademicYearId: payload.fromAcademicYearId,
      targetAcademicYearId: payload.targetAcademicYearId,
      results: requestDecisions.map((decision) => ({ studentId: decision.studentId, action: decision.action, idempotent: true })),
    };
  }
  const preview = await previewProgression(schoolId, payload, actor);
  const decisions = requestedDecisions(preview, { ...payload, decisions: pendingDecisions });
  const plans = preview.students.map((item) => {
    const decision = decisions.get(normalize(item.studentId));
    const student = (school.students || []).find((entry) => normalize(getStudentKey(entry)) === normalize(item.studentId));
    if (!student) throw new Error('A student in the progression preview no longer exists.');
    const targetClass = validateDecision(school, student, item, decision, preview.targetAcademicYearId, operationId);
    if (targetClass?.alreadyProcessed) {
      return { item, decision, student, targetClass: null, alreadyProcessed: true };
    }
    if (targetClass && (school.enrollments || []).some((entry) => (
      enrollmentBelongsToStudent(entry, student)
      && normalize(entry.academicYearId) === normalize(preview.targetAcademicYearId)
      && entry.isCurrent !== false
      && String(entry.status || 'active').toLowerCase() === 'active'
      && entry.progressionOperationId !== operationId
    ))) {
      throw new Error(`A current enrollment already exists for ${student.fullName || item.studentId} in the target academic year.`);
    }
    return { item, decision, student, targetClass, alreadyProcessed: false };
  });
  const results = [];
  for (const { item, decision, student, targetClass, alreadyProcessed: wasProcessed } of plans) {
    if (wasProcessed) {
      results.push({ studentId: item.studentId, action: decision.action, idempotent: true });
      continue;
    }
    let result;
    if (firebaseCore.isFirebaseCoreMode()) {
      result = await persistFirebaseStudent(school, student, sourceClassForOperation(school, student, school.enrollments || [], operationId), preview.targetAcademicYearId, decision, targetClass, operationId, actor);
    } else if (prisma && !prisma.__stub) {
      result = await persistPrismaStudent(
        schoolId,
        { ...item, fromAcademicYearId: preview.fromAcademicYearId },
        { ...decision, ...(targetClass ? { targetClassId: classIdOf(targetClass) } : {}) },
        preview.targetAcademicYearId,
        operationId,
        actor,
      );
    } else {
      result = await persistFallbackStudent(school, student, sourceClassForOperation(school, student, school.enrollments || [], operationId), preview.targetAcademicYearId, decision, targetClass, operationId, actor);
    }
    results.push({ studentId: item.studentId, action: decision.action, idempotent: result.idempotent === true });
  }
  if (!firebaseCore.isFirebaseCoreMode() && (!prisma || prisma.__stub)) {
    const schools = loadSchoolData();
    const index = schools.findIndex((entry) => entry.schoolId === schoolId || entry.id === schoolId);
    if (index < 0) throw new Error('School not found');
    schools[index] = school;
    saveSchoolData(schools);
  }
  return { operationId, fromAcademicYearId: preview.fromAcademicYearId, targetAcademicYearId: preview.targetAcademicYearId, results };
}

module.exports = { previewProgression, confirmProgression, assertAuthority, canonicalClassName };
