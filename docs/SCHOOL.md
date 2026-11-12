# School Core System — Architecture and Workflows

The school/tenant record is the authority boundary for school users and school-owned data. The backend currently supports Firebase Core, Prisma, and isolated JSON QA persistence. School-specific reads and writes pass through authenticated routes and tenant middleware; teacher class scope is enforced in the school service.

## Core records

- `Tenant` owns academic years, terms, streams, subjects, classes, users, and enrollment records in Prisma. Firebase stores tenant-scoped documents, while the JSON QA adapter stores a school aggregate.
- A class is identified by its school, academic year (when configured), grade/name, section, and stream. Class creation rejects an existing matching identity instead of creating another record. Names are considered equivalent only when the school explicitly configures them under `academicStructure.classAliases`.
- Example alias configuration:

  ```json
  {
    "classAliases": {
      "JHS 1": ["Basic 7", "Form 1"],
      "JHS 2": ["Basic 8", "Form 2"],
      "JHS 3": ["Basic 9", "Form 3"]
    }
  }
  ```

  These equivalences are school-managed configuration, not global assumptions. Without this configuration, those names remain distinct. The School Authority can edit the academic structure through `PUT /api/v1/schools/:schoolId`; the Classes dashboard provides a line-based alias editor.
- Classes can list multiple `teacherIds`. Legacy `teacherId` records remain readable. The class assignment workflow validates teachers against the same tenant and persists the assignment in the class record.
- A student has a single `classId` in the school record. Student records and account records are synchronized by the supported create/update workflows. Firebase student creation uses create-only document writes; if the user document write fails after the student document succeeds, the service attempts to remove the partial student document and reports cleanup failures.

## API workflows

- `GET /api/v1/schools/:schoolId/entities/:entityType` lists tenant-scoped entities. Teacher requests for students/classes are filtered to assigned classes.
- `POST /api/v1/schools/:schoolId/entities/classes` creates a class after duplicate identity and teacher-tenant checks.
- `PUT /api/v1/schools/:schoolId/entities/classes/:classId` edits class identity or teacher assignments; it rejects a duplicate identity.
- `POST /api/v1/schools/:schoolId/entities/students` creates a student. Teachers must provide a class they are assigned to; the service verifies the persisted class and teacher authorization.
- `PUT /api/v1/schools/:schoolId/entities/students/:studentId` updates an authorized student record. School Authority owns enrollment/class placement and archival approval.
- Teachers can request student archival using `POST /api/v1/schools/:schoolId/entities/students/:studentId/deletion-request`. School Authority can approve or reject the request. Approval archives the student, preserves the record and class history, clears active class placement, and synchronizes the archived status to the student login account; approval can be retried safely.
- Profile files are stored through the existing tenant-scoped upload API. The upload route checks record ownership or teacher class assignment before persisting a file reference. Production storage remains Cloudflare R2.

## Attendance

Teachers submit records through the existing teacher workspace update route. The service validates each student, class, date, and attendance status against the teacher's assigned roster, deduplicates by date/class/student, and retains correction history. School Authority can review dashboard attendance summaries and records but cannot submit attendance through the generic school update endpoint.

School calendar entries are stored in the existing tenant `events` field with `kind: "school_calendar"`; no second calendar store or schema migration is required. School Authority and School Head can create, edit, or cancel entries through `POST /api/v1/schools/:schoolId/calendar` and `PUT /api/v1/schools/:schoolId/calendar/:eventId`. Calendar reads are available to authorized teachers and school administrators through `GET /api/v1/schools/:schoolId/calendar`. All routes enforce the school tenant boundary, and calendar mutations are audit-logged. Cancelled entries remain in history.

Calendar dates use strict `YYYY-MM-DD` school-local dates. School holidays, vacations, and special closures default to closing attendance; public holidays and custom entries do not close attendance unless explicitly marked. The School Authority attendance coverage excludes weekends and active declared closures.

`GET /api/v1/schools/:schoolId/attendance-tasks` returns deterministic, per-class teacher attendance tasks for the requested school-local date (or the current local date). The endpoint is teacher-only and returns only classes assigned to that teacher. It suppresses tasks on weekends, active closures, and outside configured current academic-year bounds. Task state is derived from the active class roster and persisted, valid attendance records: a task is complete only when all active roster members have a valid submission; an empty roster is `not_required`. Tasks are reconstructed on reads rather than stored separately, so a failed attendance write leaves the task pending and a retry or refresh reflects the persisted records.

## Admissions and progression

The school API now includes a tenant-scoped admissions workflow for pending applications, review, approval, and enrollment conversion. `GET /api/v1/schools/:schoolId/admissions`, `POST /api/v1/schools/:schoolId/admissions`, `PUT /api/v1/schools/:schoolId/admissions/:admissionId`, and `PUT /api/v1/schools/:schoolId/admissions/:admissionId/decision` are protected by School Authority / School Head / Super Admin role gates and tenant matching. Pending applications are stored as `AdmissionApplication` records and are not counted as active student roster entries. A decision to approve requires a valid class-year placement in the same tenant and persists one authoritative student record and one current enrollment. If the applicant already matches an existing active student email, the service links the same student record instead of creating a duplicate. Approved applicants become visible to the School Authority and any assigned teacher for that class immediately after the decision.

Academic progression is available through `GET /api/v1/schools/:schoolId/progression/preview?fromAcademicYearId=...&targetAcademicYearId=...` and `POST /api/v1/schools/:schoolId/progression/confirm`. Both are School Authority / School Head operations scoped to the authenticated tenant; a platform administrator must also carry the platform-admin claim. Confirmation requires an explicit `confirmed` flag, a stable operation ID, and decisions for the previewed students.

The Academic Management dashboard can configure class progression paths under `academicStructure.progressionPaths` (for example `JHS: ["JHS 1", "JHS 2", "JHS 3"]`), explicit cross-level transitions under `academicStructure.progression` (for example `"Primary 6": "JHS 1"`), and final-year classes under `academicStructure.graduationClasses`. Existing `classAliases` are used when resolving configured paths and target-year class records; unconfigured equivalences are not inferred. A class path without an available next-year class is presented for manual placement. Graduation is never inferred merely because a class is last in a progression path. Each preview supports promotion, repeating in the equivalent class in the target year, manual target placement, graduation, transfer, or withdrawal.

Progression updates the existing student identity, current class/year, class roster membership, and current enrollment. Prior enrollment rows are closed rather than deleted. The student metadata retains class and progression history, and attendance/results are not rewritten. Graduation, transfer, and withdrawal retain the student record, clear current class placement, and close the active enrollment; optional transfer destination and decision notes are retained in the progression history. Reusing the same operation ID is idempotent; a second current enrollment in the target year is rejected. The School Authority student directory shows the current class and most recent previous placement; teacher class rosters continue to be filtered by current assigned-class membership.

The existing Prisma `Enrollment` model supports the relational progression path, while Firebase Core and isolated JSON QA persistence retain enrollment records in their existing tenant-scoped collections/aggregate. Firebase progression commits the student, class rosters, and enrollment updates in one Firestore transaction; it rechecks the student's source placement and target-year enrollment inside the transaction so competing confirmations cannot overwrite one another. No new schema migration is required for this workflow. Historical attendance/result storage remains in place and is not copied into new-year rows.

## Database and release

The Prisma `Class` model now includes optional `academicYearId`/`section` and a `teacherIds` array. Migration `20261111120000_class_year_and_teacher_assignments` adds these fields and backfills the legacy `teacherId` into `teacherIds`. It has not been applied to any database. Validate and review it against a provisioned non-production database before deployment; never run it against production without the release owner’s approval.
