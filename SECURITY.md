# Security Policy and School Data Controls

## Reporting

Do not post suspected vulnerabilities publicly. Contact the GlobyEdu security
owner through the approved private reporting channel and include the affected
route/component, impact, and safe reproduction details. The address previously
listed here is a placeholder and must be replaced with a verified contact
before public release.

## Tenant and role enforcement

- School API routes require authentication and tenant middleware. A tenant
  mismatch is rejected before the school service performs the operation.
- School Authority and School Head routes are role-gated. Teacher student and
  class reads/writes additionally rely on the teacher's persisted class
  assignment; a teacher cannot select another tenant's teacher or class.
- Class creation checks the tenant's existing class identity. Class labels are
  aliases only when explicitly configured in the tenant academic structure;
  names such as JHS 1 and Basic 7 are not globally merged.
- Class assignment writes validate every teacher identifier against the
  current tenant. Student removal is a request/approval archival workflow;
  approval requires School Authority authorization and exact student-ID
  confirmation, preserves the student and account records, and disables login
  through the archived status.
- Profile upload/download routes bind paths to an owner record and tenant.
  Student uploads are restricted to self or an assigned teacher; teacher
  uploads are restricted to self or School Authority. Production file storage
  uses Cloudflare R2.
- Teacher attendance submissions validate assigned student/class/date scope
  and record correction history. School Authority can review attendance but
  cannot submit it through the generic school update endpoint.
- Admissions are tenant-scoped and role-gated. Pending applications are kept
  separate from the authoritative student roster; approval converts a valid
  application into a single student record and enrollment when the class and
  academic year belong to the same school. Duplicate email matches link to the
  existing record rather than creating a new student.
- Student progression preview and confirmation are limited to School
  Authority/School Head roles and require the authenticated tenant to match the
  route school. Target classes and academic years are resolved inside that
  tenant; decisions cannot place a student in another school's class. A
  platform administrator must have the platform-admin claim to bypass tenant
  matching.
- Progression confirmation requires explicit confirmation and a bounded
  operation ID. It rejects duplicate decisions, decisions for students outside
  the preview, cross-year class placement, unconfigured graduation, and a
  second current enrollment in the target year. Operation history prevents a
  retry from applying a different decision under an already-used operation ID.
  Students are retained on graduation/transfer/withdrawal and prior attendance
  and results are not deleted or rewritten.

These are source and automated-test controls, not evidence that a production
Firebase/R2 configuration or deployment has been independently penetration
tested. Holiday/task generation and attendance holiday coverage remain
separate workflows and are not treated as available until their respective
APIs and tests are added and reviewed.

## Release controls

Never commit credentials or copy secret values into reports. Test data must use
the safe temporary wrapper or an explicitly isolated QA data directory. Review
and test migrations against a provisioned non-production database. No
production migration, deploy, push, or commit is performed by local validation.
