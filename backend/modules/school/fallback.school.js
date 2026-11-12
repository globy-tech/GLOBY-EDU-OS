const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const config = require('../../config/auth.config');
const {
  assertIsolatedQaConfiguration,
  assertTestDataFilePath,
} = require('../../config/qa-config');
const { generateSchoolSubdomain } = require('./tenant-hostname');

const SCHOOLS_FILE = process.env.GLOBY_SCHOOLS_FILE
  ? path.resolve(process.env.GLOBY_SCHOOLS_FILE)
  : path.join(__dirname, '../../data/schools.json');
const DEMO_SCHOOL_ID = 'globy-school';
const LEGACY_DEMO_SCHOOL_ID = 'GLOBY-DEMO-001';
const DEMO_SCHOOL_NAME = 'Globy School';
const DEMO_SCHOOL_EMAIL = 'authority@globyedu.test';
const DEMO_TEACHER_ID = 'T001';
const DEMO_TEACHER_EMAIL = 'teacher@globyedu.test';
const DEMO_STUDENT_ID = 'STU001';
const DEMO_STUDENT_EMAIL = 'student@globyedu.test';
const DEMO_PASSWORD = 'Benjamin@123';
const DEMO_SCHOOL_PASSWORD = 'GlobySchool@123';
const DEMO_TEACHER_PASSWORD = 'GlobyTeacher@123';
const DEMO_STUDENT_PASSWORD = 'GlobyStudent@123';

function isQaMode() {
  return String(process.env.GLOBY_QA_MODE || '').trim().toLowerCase() === 'true';
}

function assertFallbackStoreAllowed() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('[fallback.school] JSON fallback storage is disabled in production. Configure a production datastore.');
  }

  const isTestRuntime = process.env.NODE_ENV === 'test';
  const qaMode = isQaMode();
  const dataStoreMode = String(process.env.DATA_STORE_MODE || '').trim().toLowerCase();

  if (qaMode) {
    assertIsolatedQaConfiguration(process.env, path.resolve(__dirname, '../..'));
  }

  if (isTestRuntime) {
    assertTestDataFilePath(process.env, 'GLOBY_SCHOOLS_FILE', path.resolve(__dirname, '../..'));
  }

  if ((isTestRuntime || qaMode)
    && path.resolve(process.env.GLOBY_SCHOOLS_FILE) !== SCHOOLS_FILE) {
    throw new Error('[fallback.school] School data path changed after fallback storage was initialized.');
  }

  if (isTestRuntime || qaMode || dataStoreMode === 'json') {
    return;
  }

  throw new Error('[fallback.school] Set DATA_STORE_MODE=json to explicitly enable local JSON storage.');
}

function ensureSchoolDataFile() {
  assertFallbackStoreAllowed();
  try {
    fs.mkdirSync(path.dirname(SCHOOLS_FILE), { recursive: true });
  } catch (err) {
    if (isQaMode()) throw err;
  }
  if (!fs.existsSync(SCHOOLS_FILE)) {
    try {
      fs.writeFileSync(SCHOOLS_FILE, JSON.stringify({ schools: [] }, null, 2), 'utf-8');
    } catch (err) {
      if (isQaMode()) throw err;
    }
  }
}

function keepOnlyPrimarySchool(schools) {
  const list = Array.isArray(schools) ? schools : [];
  const unique = [];
  const seen = new Set();

  for (const school of list) {
    if (!school || typeof school !== 'object') continue;

    const schoolId = String(school?.schoolId || '').trim().toLowerCase();
    const legacyId = String(school?.id || '').trim().toLowerCase();
    const name = String(school?.name || '').trim().toLowerCase();
    const isDemo = schoolId === DEMO_SCHOOL_ID || legacyId === LEGACY_DEMO_SCHOOL_ID.toLowerCase() || name === DEMO_SCHOOL_NAME.toLowerCase();
    const dedupeKey = schoolId || legacyId || name || `${unique.length}`;

    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    if (!isDemo || unique.every((entry) => {
      const entryId = String(entry?.schoolId || '').trim().toLowerCase();
      const entryLegacy = String(entry?.id || '').trim().toLowerCase();
      const entryName = String(entry?.name || '').trim().toLowerCase();
      return !(entryId === DEMO_SCHOOL_ID || entryLegacy === LEGACY_DEMO_SCHOOL_ID.toLowerCase() || entryName === DEMO_SCHOOL_NAME.toLowerCase());
    })) {
      unique.push(school);
    } else {
      const demoIndex = unique.findIndex((entry) => {
        const entryId = String(entry?.schoolId || '').trim().toLowerCase();
        const entryLegacy = String(entry?.id || '').trim().toLowerCase();
        const entryName = String(entry?.name || '').trim().toLowerCase();
        return entryId === DEMO_SCHOOL_ID || entryLegacy === LEGACY_DEMO_SCHOOL_ID.toLowerCase() || entryName === DEMO_SCHOOL_NAME.toLowerCase();
      });
      if (demoIndex >= 0) {
        unique.splice(demoIndex, 1, school);
      } else {
        unique.push(school);
      }
    }
  }

  return unique;
}

function loadSchoolData() {
  assertFallbackStoreAllowed();
  const snapshot = globalThis.__workspaceSnapshot;
  let source = [];

  if (Array.isArray(snapshot)) {
    source = snapshot;
  } else if (snapshot && Array.isArray(snapshot.schools)) {
    source = snapshot.schools;
  } else {
    ensureSchoolDataFile();
    try {
      const raw = fs.readFileSync(SCHOOLS_FILE, 'utf-8');
      const json = JSON.parse(raw);
      source = Array.isArray(json.schools) ? json.schools : [];
    } catch (err) {
      if (isQaMode()) throw err;
      source = [];
    }
  }

  return Array.isArray(source) ? source : [];
}

function saveSchoolData(schools) {
  assertFallbackStoreAllowed();
  const normalized = Array.isArray(schools) ? schools : (schools && Array.isArray(schools.schools) ? schools.schools : []);
  const sanitized = Array.isArray(normalized) ? normalized : [];
  if (globalThis.__workspaceSnapshot !== undefined) {
    globalThis.__workspaceSnapshot = sanitized;
    return sanitized;
  }
  try {
    fs.mkdirSync(path.dirname(SCHOOLS_FILE), { recursive: true });
    fs.writeFileSync(SCHOOLS_FILE, JSON.stringify({ schools: sanitized }, null, 2), 'utf-8');
  } catch (err) {
    if (isQaMode()) throw err;
    globalThis.__workspaceSnapshot = sanitized;
  }
  return sanitized;
}

function normalizeSchoolId(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 30);
}

function createSchoolId(name, existingSchools = []) {
  const year = new Date().getFullYear();
  const nextSequence = (existingSchools || []).reduce((max, school) => {
    const match = String(school?.schoolId || '').match(/-(\d{5})$/);
    if (match) {
      const parsed = Number(match[1]);
      return Math.max(max, parsed);
    }
    return max;
  }, 0);
  const serial = String(nextSequence + 1).padStart(5, '0');
  return `GLB-${year}-${serial}`;
}

function createClassId(name, existingClasses = []) {
  const base = normalizeSchoolId(name) || `class-${crypto.randomBytes(4).toString('hex')}`;
  let classId = base;
  let suffix = 1;
  const existingIds = new Set(existingClasses.map((cls) => cls.classId));
  while (existingIds.has(classId)) {
    classId = `${base}-${suffix.toString().padStart(2, '0')}`;
    suffix += 1;
  }
  return classId;
}

function createEntityId(name, existingItems = [], prefix = 'item') {
  const base = normalizeSchoolId(name) || `${prefix}-${crypto.randomBytes(4).toString('hex')}`;
  let id = base;
  let suffix = 1;
  const existingIds = new Set(existingItems.map((item) => item.id || item.username || item.studentId || item.classId));
  while (existingIds.has(id)) {
    id = `${base}-${suffix.toString().padStart(2, '0')}`;
    suffix += 1;
  }
  return id;
}

function getEntityMeta(entityType) {
  const map = {
    departments: { collection: 'departments', idKey: 'id' },
    streams: { collection: 'streams', idKey: 'id' },
    subjects: { collection: 'subjects', idKey: 'id' },
    'academic-years': { collection: 'academicYears', idKey: 'id' },
    academicYears: { collection: 'academicYears', idKey: 'id' },
    terms: { collection: 'terms', idKey: 'id' },
    semesters: { collection: 'semesters', idKey: 'id' },
    classes: { collection: 'classes', idKey: 'classId' },
    teachers: { collection: 'teachers', idKey: 'username' },
    students: { collection: 'students', idKey: 'studentId' },
  };
  return map[entityType] || null;
}

function createWorkspaceId(prefix = 'item') {
  return `${prefix}-${crypto.randomBytes(4).toString('hex')}`;
}

function ensureWorkspaceCollections(school) {
  if (!Array.isArray(school.messages)) school.messages = [];
  if (!Array.isArray(school.supportTickets)) school.supportTickets = [];
  return school;
}

function ensureSchoolEntities(school) {
  if (!school.departments) school.departments = [];
  if (!school.streams) school.streams = [];
  if (!school.subjects) school.subjects = [];
  if (!school.academicYears) school.academicYears = [];
  if (!school.terms) school.terms = [];
  if (!school.semesters) school.semesters = [];
  if (!school.classes) school.classes = [];
  if (!Array.isArray(school.teachers)) school.teachers = [];
  if (!Array.isArray(school.students)) school.students = [];
  if (!Array.isArray(school.admissions)) school.admissions = [];
  if (!Array.isArray(school.enrollments)) school.enrollments = [];
  if (!Array.isArray(school.assignments)) school.assignments = [];
  if (!Array.isArray(school.lessons)) school.lessons = [];
  if (Array.isArray(school.users)) {
    const teacherUsers = school.users.filter((user) => user.role === 'teacher');
    const studentUsers = school.users.filter((user) => user.role === 'student');
    if (!school.teachers.length && teacherUsers.length) school.teachers = teacherUsers.map((user) => ({ ...user }));
    if (!school.students.length && studentUsers.length) school.students = studentUsers.map((user) => ({ ...user }));
  }
  if (!school.events) school.events = [];
  if (!school.announcements) school.announcements = [];
  ensureWorkspaceCollections(school);
  return school;
}

function normalizeWorkspaceMessage(school, payload = {}) {
  const message = {
    id: payload.id || createWorkspaceId('message'),
    folder: payload.folder || 'inbox',
    from: payload.from || 'School Head',
    to: payload.to || 'Support Team',
    subject: payload.subject || 'Workspace message',
    body: payload.body || '',
    unread: payload.unread !== false,
    createdAt: payload.createdAt || new Date().toISOString(),
    attachments: Array.isArray(payload.attachments) ? payload.attachments : [],
    metadata: payload.metadata || null,
    recipientType: payload.recipientType || payload.recipient || payload.to || 'all',
    audience: payload.audience || payload.recipientType || payload.recipient || 'all',
    senderId: payload.senderId || null,
    senderRole: payload.senderRole || null,
    senderName: payload.senderName || payload.from || null,
    recipientId: payload.recipientId || null,
    recipientRole: payload.recipientRole || null,
    readAt: payload.readAt || null,
    readBy: Array.isArray(payload.readBy) ? payload.readBy : [],
  };
  if (payload.status) message.status = payload.status;
  if (payload.schoolId) message.schoolId = payload.schoolId;
  if (payload.recipient) message.recipient = payload.recipient;
  if (payload.replyTo) message.replyTo = payload.replyTo;
  if (payload.forwardedFrom) message.forwardedFrom = payload.forwardedFrom;
  if (!message.schoolId) message.schoolId = school.schoolId;
  return message;
}

function normalizeSupportTicket(school, payload = {}) {
  const ticket = {
    id: payload.id || createWorkspaceId('ticket'),
    title: payload.title || payload.subject || 'Support ticket',
    message: payload.message || payload.body || '',
    status: payload.status || 'open',
    priority: payload.priority || 'normal',
    category: payload.category || 'general',
    createdAt: payload.createdAt || new Date().toISOString(),
    updatedAt: payload.updatedAt || new Date().toISOString(),
    replies: Array.isArray(payload.replies) ? payload.replies : [],
    attachments: Array.isArray(payload.attachments) ? payload.attachments : [],
    metadata: payload.metadata || null,
    schoolId: payload.schoolId || school.schoolId,
  };
  if (payload.requester) ticket.requester = payload.requester;
  if (payload.assignee) ticket.assignee = payload.assignee;
  if (payload.tags) ticket.tags = payload.tags;
  return ticket;
}

function findSchoolBySchoolId(schools, schoolId) {
  const normalized = String(schoolId || '').trim();
  if (!normalized) return null;

  const match = schools.find((entry) => {
    const schoolIdValue = String(entry.schoolId || '').trim();
    const legacyIdValue = String(entry.id || '').trim();
    const nameValue = String(entry.name || '').trim();
    return (
      schoolIdValue.toLowerCase() === normalized.toLowerCase() ||
      legacyIdValue.toLowerCase() === normalized.toLowerCase() ||
      nameValue.toLowerCase() === normalized.toLowerCase() ||
      (normalized.toLowerCase() === 'globy-demo-001' && schoolIdValue.toLowerCase() === DEMO_SCHOOL_ID) ||
      (normalized.toLowerCase() === DEMO_SCHOOL_ID && legacyIdValue.toUpperCase() === LEGACY_DEMO_SCHOOL_ID)
    );
  });

  if (match) return match;

  if (normalized.toLowerCase() === 'globy-demo-001' || normalized.toLowerCase() === DEMO_SCHOOL_ID) {
    const seeded = ensureDemoSchool();
    if (seeded) {
      const fallback = findSchoolBySchoolId(loadSchoolData(), schoolId);
      if (fallback) return fallback;
    }
  }

  return null;
}

function findSchoolEntity(school, entityType, entityId) {
  const meta = getEntityMeta(entityType);
  if (!meta || !Array.isArray(school[meta.collection])) return null;
  return school[meta.collection].find((item) => entityMatchesIdentifier(item, entityType, entityId)) || null;
}

function entityMatchesIdentifier(item, entityType, entityId) {
  const normalizedId = String(entityId || '').trim().toLowerCase();
  if (!normalizedId) return false;
  const identifiers = [item.id, item.email, item.username, item.studentId, item.teacherId, item.classId]
    .filter(Boolean)
    .map((value) => String(value).trim().toLowerCase());
  return identifiers.includes(normalizedId);
}

function createStudentIdentifier(school, name = '') {
  const currentNumbers = (school.students || [])
    .map((entry) => String(entry.studentId || '').match(/(\d+)/)?.[1])
    .filter((value) => value !== undefined)
    .map(Number)
    .filter((value) => Number.isFinite(value));
  const nextNumber = currentNumbers.length ? Math.max(...currentNumbers) + 1 : 1;
  const base = String(name || 'student').trim();
  const suffix = base && /[A-Za-z]/.test(base) ? `-${base.toUpperCase().replace(/[^A-Z0-9]+/g, '').slice(0, 3) || 'STD'}` : '';
  return `STD-${String(nextNumber).padStart(3, '0')}${suffix}`.replace(/-+$/, '');
}

function createTeacherIdentifier(school, name = '') {
  const currentNumbers = (school.users || [])
    .filter((user) => user.role === 'teacher')
    .map((teacher) => String(teacher.teacherId || teacher.username || '').match(/(\d+)/)?.[1])
    .filter((value) => value !== undefined)
    .map(Number)
    .filter((value) => Number.isFinite(value));
  const nextNumber = currentNumbers.length ? Math.max(...currentNumbers) + 1 : 1;
  const base = String(name || 'teacher').trim();
  const suffix = base && /[A-Za-z]/.test(base) ? `-${base.toUpperCase().replace(/[^A-Z0-9]+/g, '').slice(0, 3) || 'TCH'}` : '';
  return `T-${String(nextNumber).padStart(3, '0')}${suffix}`.replace(/-+$/, '');
}

function createSchoolEntity(school, entityType, payload) {
  const meta = getEntityMeta(entityType);
  if (!meta) return null;
  if (!Array.isArray(school[meta.collection])) {
    school[meta.collection] = [];
  }

  const items = school[meta.collection];
  const idKey = meta.idKey;
  const itemName = payload.name || payload.title || payload.fullName || payload.studentId || payload.username || `${entityType.slice(0, 1).toUpperCase()}${Date.now()}`;

  const resolvedStudentId = entityType === 'students' && !payload[idKey]
    ? createStudentIdentifier(school, payload.fullName || payload.name || 'student')
    : payload[idKey] || createEntityId(itemName, items, entityType.replace(/s$/, ''));

  const newItem = {
    ...payload,
    [idKey]: resolvedStudentId,
  };

  if (entityType === 'teachers') {
    newItem.status = newItem.status || 'active';
    newItem.role = 'teacher';
    newItem.permissions = newItem.permissions || ['classes.manage', 'students.view'];
    newItem.emailVerified = newItem.emailVerified !== false;
  }

  if (entityType === 'students') {
    newItem.status = newItem.status || 'active';
    newItem.studentId = resolvedStudentId;
    newItem.grade = newItem.grade || payload.grade || 'N/A';
    newItem.admissionNumber = newItem.admissionNumber || `ADM-${Math.floor(1000 + Math.random() * 9000)}`;
    newItem.schoolId = school.schoolId;
    newItem.className = newItem.className || payload.className || null;
    newItem.classId = newItem.classId || payload.classId || null;
  }

  items.push(newItem);
  return newItem;
}

function updateSchoolEntity(school, entityType, entityId, updates) {
  const meta = getEntityMeta(entityType);
  if (!meta || !Array.isArray(school[meta.collection])) return null;
  const items = school[meta.collection];
  const index = items.findIndex((item) => entityMatchesIdentifier(item, entityType, entityId));
  if (index === -1) return null;
  const current = items[index];
  const updated = { ...current, ...updates, [meta.idKey]: current[meta.idKey] };
  items[index] = updated;
  return updated;
}

function deleteSchoolEntity(school, entityType, entityId) {
  const meta = getEntityMeta(entityType);
  if (!meta || !Array.isArray(school[meta.collection])) return null;
  const items = school[meta.collection];
  const index = items.findIndex((item) => entityMatchesIdentifier(item, entityType, entityId));
  if (index === -1) return null;
  const [removed] = items.splice(index, 1);
  return removed;
}

function searchSchoolEntities(school, query, scopes = []) {
  const lower = (query || '').toLowerCase();
  const results = [];
  const searchPools = scopes.length ? scopes : ['students', 'teachers', 'classes', 'subjects', 'departments', 'streams'];

  for (const scope of searchPools) {
    const meta = getEntityMeta(scope);
    if (!meta || !Array.isArray(school[meta.collection])) continue;
    const matches = school[meta.collection].filter((item) => {
      const text = Object.values(item)
        .filter((value) => typeof value === 'string')
        .join(' | ')
        .toLowerCase();
      return text.includes(lower);
    });
    results.push({ scope, items: matches });
  }
  return results;
}

function createTeacherRecord(school, payload) {
  if (!Array.isArray(school.users)) school.users = [];
  const { password, passwordHash, studentPasswordHash, passwordNeedsReset, ...safePayload } = payload || {};
  const identity = String(safePayload.username || safePayload.email || '').trim().toLowerCase();
  const requestedTeacherId = String(safePayload.teacherId || '').trim().toLowerCase();
  const existing = school.users.find((user) => (
    user.role === 'teacher' && (
      String(user.username || '').toLowerCase() === identity ||
      (identity && String(user.email || '').toLowerCase() === identity) ||
      (requestedTeacherId && String(user.teacherId || '').toLowerCase() === requestedTeacherId)
    )
  ));
  if (existing) {
    throw new Error('Teacher with that username or email already exists');
  }
  
  // Auto-generate Teacher ID if not provided
  const teacherId = safePayload.teacherId || createTeacherIdentifier(school, safePayload.fullName || safePayload.name || 'teacher');
  
  const teacher = {
    role: 'teacher',
    grade: safePayload.grade || 'N/A',
    fullName: safePayload.fullName || safePayload.name || 'Teacher',
    status: safePayload.status || 'active',
    emailVerified: safePayload.emailVerified !== false,
    developmentOnly: safePayload.developmentOnly || false,
    platformAdmin: false,
    email: safePayload.email || null,
    phone: safePayload.phone || null,
    department: safePayload.department || null,
    className: safePayload.className || null,
    assignedClasses: safePayload.assignedClasses || [],
    assignedSubjects: safePayload.assignedSubjects || [],
    permissions: safePayload.permissions || ['classes.manage', 'students.view'],
    ...safePayload,
    teacherId,
    username: safePayload.username || safePayload.email || teacherId,
    passwordHash: passwordHash || null,
    passwordNeedsReset: passwordNeedsReset !== false,
  };
  
  school.users.push(teacher);
  if (!Array.isArray(school.teachers)) school.teachers = [];
  school.teachers.push({ ...teacher });
  return teacher;
}

function createStudentRecord(school, payload) {
  if (!Array.isArray(school.students)) school.students = [];
  const { password, passwordHash, studentPasswordHash, passwordNeedsReset, ...safePayload } = payload || {};
  const studentId = safePayload.studentId || createStudentIdentifier(school, safePayload.fullName || safePayload.username || 'student');
  const identities = [safePayload.email, safePayload.username]
    .map((value) => String(value || '').trim().toLowerCase())
    .filter(Boolean);
  const duplicate = school.students.find((student) => (
    identities.some((identity) => [student.email, student.username]
      .some((value) => String(value || '').trim().toLowerCase() === identity)) ||
    String(student.studentId || '').toLowerCase() === String(studentId).toLowerCase() ||
    (safePayload.admissionNumber && String(student.admissionNumber || '').trim().toLowerCase() === String(safePayload.admissionNumber).trim().toLowerCase())
  ));
  if (duplicate) throw new Error('Student with that email, student ID, or admission number already exists');
  const newStudent = {
    ...safePayload,
    studentId,
    status: safePayload.status || 'active',
    createdAt: safePayload.createdAt || new Date().toISOString(),
    passwordHash: passwordHash || null,
    passwordNeedsReset: passwordNeedsReset !== false,
  };
  school.students.push(newStudent);
  return newStudent;
}

function findPlatformAdminByEmail(email, schools) {
  if (!email) return null;
  const emailLower = email.toLowerCase();
  for (const school of schools) {
    const matched = (school.users || []).find(
      (user) => user.username.toLowerCase() === emailLower && user.role === 'super_admin'
    );
    if (matched) {
      return { user: matched, school };
    }
  }
  return null;
}

function findPlatformAdmins(schools, searchQuery) {
  let platformAdmins = [];
  for (const school of schools) {
    const admins = (school.users || []).filter(
      (user) => user.role === 'super_admin' && user.platformAdmin === true
    );
    platformAdmins = platformAdmins.concat(
      admins.map((user) => {
        const { password, passwordHash, studentPasswordHash, ...safeUser } = user;
        return {
        ...safeUser,
        schoolId: school.schoolId,
        schoolName: school.name,
        };
      })
    );
  }
  if (searchQuery) {
    const searchLower = searchQuery.toLowerCase();
    platformAdmins = platformAdmins.filter(
      (admin) =>
        admin.username.toLowerCase().includes(searchLower) ||
        admin.fullName.toLowerCase().includes(searchLower) ||
        admin.schoolName.toLowerCase().includes(searchLower)
    );
  }
  return platformAdmins;
}

function buildDemoSchool() {
  const superAdminPasswordHash = bcrypt.hashSync(DEMO_PASSWORD, config.bcrypt.saltRounds);
  const schoolAuthorityPasswordHash = bcrypt.hashSync(DEMO_SCHOOL_PASSWORD, config.bcrypt.saltRounds);
  const teacherPasswordHash = bcrypt.hashSync(DEMO_TEACHER_PASSWORD, config.bcrypt.saltRounds);
  const studentPasswordHash = bcrypt.hashSync(DEMO_STUDENT_PASSWORD, config.bcrypt.saltRounds);

  return {
    id: LEGACY_DEMO_SCHOOL_ID,
    schoolId: DEMO_SCHOOL_ID,
    subdomain: generateSchoolSubdomain(DEMO_SCHOOL_NAME, []),
    name: DEMO_SCHOOL_NAME,
    email: DEMO_SCHOOL_EMAIL,
    description: 'Development-only seed tenant for local testing.',
    country: 'Ghana',
    region: 'Ashanti',
    subscriptionPlan: 'Unlimited (Development Only)',
    subscriptionStatus: 'active',
    trialStatus: 'Unlimited Development Access',
    schoolStatus: 'active',
    developmentOnly: true,
    settings: {
      theme: 'default',
      notifications: { emailEnabled: true, smsEnabled: false },
      featureFlags: { messaging: true, analytics: true },
    },
    classes: [
      {
        classId: 'JHS-3A',
        name: 'JHS 3A',
        grade: 'JHS 3',
        teacher: DEMO_TEACHER_ID,
        students: [DEMO_STUDENT_ID],
        status: 'active',
      },
    ],
    students: [
      {
        studentId: DEMO_STUDENT_ID,
        fullName: 'Test Student',
        email: DEMO_STUDENT_EMAIL,
        className: 'JHS 3',
        role: 'student',
        status: 'active',
        emailVerified: true,
        developmentOnly: true,
        schoolId: DEMO_SCHOOL_ID,
        studentPasswordHash,
        passwordNeedsReset: true,
      },
    ],
    users: [
      {
        username: 'hellogloby@gmail.com',
        passwordHash: superAdminPasswordHash,
        role: 'super_admin',
        grade: 'N/A',
        fullName: 'Benjamin',
        status: 'active',
        emailVerified: true,
        developmentOnly: true,
        platformAdmin: true,
      },
      {
        username: 'ataetaben@gmail.com',
        passwordHash: superAdminPasswordHash,
        role: 'super_admin',
        grade: 'N/A',
        fullName: 'Benjamin',
        status: 'active',
        emailVerified: true,
        developmentOnly: true,
        platformAdmin: true,
      },
      {
        username: 'ataetabenjamin@gmail.com',
        passwordHash: superAdminPasswordHash,
        role: 'super_admin',
        grade: 'N/A',
        fullName: 'Benjamin',
        status: 'active',
        emailVerified: true,
        developmentOnly: true,
        platformAdmin: true,
      },
      {
        username: 'benjaminataeta@gmail.com',
        passwordHash: superAdminPasswordHash,
        role: 'super_admin',
        grade: 'N/A',
        fullName: 'Benjamin',
        status: 'active',
        emailVerified: true,
        developmentOnly: true,
        platformAdmin: true,
      },
      {
        username: DEMO_SCHOOL_EMAIL,
        passwordHash: schoolAuthorityPasswordHash,
        role: 'school_authority',
        grade: 'N/A',
        fullName: 'Globy School Authority',
        status: 'active',
        emailVerified: true,
        developmentOnly: true,
        platformAdmin: false,
      },
      {
        username: DEMO_TEACHER_ID,
        passwordHash: teacherPasswordHash,
        role: 'teacher',
        grade: 'JHS 3',
        fullName: 'Test Teacher',
        email: DEMO_TEACHER_EMAIL,
        status: 'active',
        emailVerified: true,
        developmentOnly: true,
        platformAdmin: false,
        teacherId: DEMO_TEACHER_ID,
        className: 'JHS 3',
      },
      {
        username: DEMO_STUDENT_ID,
        studentPasswordHash,
        role: 'student',
        grade: 'JHS 3',
        fullName: 'Test Student',
        email: DEMO_STUDENT_EMAIL,
        status: 'active',
        emailVerified: true,
        developmentOnly: true,
        platformAdmin: false,
        studentId: DEMO_STUDENT_ID,
        className: 'JHS 3',
        passwordNeedsReset: true,
      },
    ],
  };
}

function ensureDemoSchool() {
  const schools = loadSchoolData();
  let changed = false;
  let school = schools.find(
    (entry) => entry.schoolId === DEMO_SCHOOL_ID || entry.id === LEGACY_DEMO_SCHOOL_ID || entry.name === DEMO_SCHOOL_NAME || entry.schoolId === 'GLOBY-DEMO-001'
  );

  if (!school) {
    school = buildDemoSchool();
    schools.push(school);
    changed = true;
  } else {
    const demo = buildDemoSchool();
    if (!Array.isArray(school.users)) school.users = [];
    if (!Array.isArray(school.students)) school.students = [];

    school.id = demo.id;
    school.schoolId = demo.schoolId;
    school.subdomain = generateSchoolSubdomain(demo.name, schools);
    school.name = demo.name;
    school.email = demo.email;
    school.description = demo.description;
    school.country = demo.country;
    school.region = demo.region;
    school.subscriptionPlan = school.subscriptionPlan || demo.subscriptionPlan;
    school.subscriptionStatus = demo.subscriptionStatus;
    school.trialStatus = demo.trialStatus;
    school.schoolStatus = demo.schoolStatus;
    school.developmentOnly = school.developmentOnly ?? demo.developmentOnly;
    school.settings = school.settings || demo.settings;
    school.classes = Array.isArray(school.classes) ? school.classes : demo.classes;
    school.students = Array.isArray(school.students) ? school.students : demo.students;
    changed = true;

    for (const demoUser of demo.users) {
      const existing = school.users.find((entry) => entry.username.toLowerCase() === demoUser.username.toLowerCase());
      if (!existing) {
        school.users.push(demoUser);
        changed = true;
        continue;
      }

      if (String(existing.role || '').toLowerCase() === 'student') {
        delete existing.passwordHash;
      }

      const credentialFields = ['passwordHash', 'studentPasswordHash', 'passwordNeedsReset'];
      const existingCredentials = Object.fromEntries(credentialFields
        .filter((field) => Object.prototype.hasOwnProperty.call(existing, field))
        .map((field) => [field, existing[field]]));
      const sameUser = Object.keys(demoUser).every((field) => credentialFields.includes(field)
        ? Object.prototype.hasOwnProperty.call(existing, field)
        : existing[field] === demoUser[field]);
      if (!sameUser) {
        Object.assign(existing, demoUser);
        Object.assign(existing, existingCredentials);
        if (String(existing.role || '').toLowerCase() === 'student') {
          if (demoUser.studentPasswordHash) {
            existing.studentPasswordHash = existingCredentials.studentPasswordHash || demoUser.studentPasswordHash;
          }
          delete existing.passwordHash;
        }
        changed = true;
      }
    }

    const blockedUsers = school.users.filter((entry) => entry.role === 'super_admin' && !['ataetaben@gmail.com', 'ataetabenjamin@gmail.com', 'hellogloby@gmail.com'].includes(entry.username.toLowerCase()));
    for (const blocked of blockedUsers) {
      school.users = school.users.filter((entry) => !(entry !== blocked && entry.username.toLowerCase() === blocked.username.toLowerCase() && entry.role !== 'super_admin'));
    }
    const allowedSuperAdmins = demo.users.filter((entry) => entry.role === 'super_admin');
    for (const allowed of allowedSuperAdmins) {
      const active = school.users.find((entry) => entry.username.toLowerCase() === allowed.username.toLowerCase() && entry.role === 'super_admin');
      if (!active) {
        school.users.push(allowed);
      }
    }
  }

  if (changed) {
    const nextSchools = keepOnlyPrimarySchool(schools);
    if (nextSchools.length !== schools.length) {
      schools.splice(0, schools.length, ...nextSchools);
    }
    saveSchoolData(schools);
  }

  return school;
}

module.exports = {
  loadSchoolData,
  saveSchoolData,
  createSchoolId,
  normalizeSchoolId,
  createClassId,
  createEntityId,
  getEntityMeta,
  ensureSchoolEntities,
  ensureWorkspaceCollections,
  normalizeWorkspaceMessage,
  normalizeSupportTicket,
  createWorkspaceId,
  findSchoolBySchoolId,
  findSchoolEntity,
  createSchoolEntity,
  updateSchoolEntity,
  deleteSchoolEntity,
  searchSchoolEntities,
  createTeacherRecord,
  createStudentRecord,
  createStudentIdentifier,
  createTeacherIdentifier,
  findPlatformAdminByEmail,
  findPlatformAdmins,
  ensureDemoSchool,
};
