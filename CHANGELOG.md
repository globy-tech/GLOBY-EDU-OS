# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]
- Academic progression now has a tenant-scoped preview/confirmation workflow for bulk promotion, repeaters, manual placement, graduation, transfer, and withdrawal. Per-school progression paths, graduation classes, and configured class aliases are honored. Student IDs remain authoritative; current enrollments change safely while prior class/enrollment, attendance, and results history is preserved. Operation IDs make retries idempotent and all decisions are audited.
- Class management now rejects duplicate class identities within an academic year, supports explicitly configured class-label aliases, and stores multiple teacher IDs per class. The dashboard can configure aliases, select an academic year, assign multiple teachers, and show class rosters/attendance record counts. Prisma fields and a backfill migration are prepared but unapplied.
- Admissions now support a dedicated tenant-scoped approval workflow: pending applications are stored in `AdmissionApplication`, a School Authority review can approve or reject them, and approval requires a valid same-tenant class/academic year before creating or linking the authoritative student record and active enrollment. Retrying an approval does not create duplicate students or enrollments. The photo upload path preserves School Authority-only admission photo authorization and prevents pending-application photos from being treated as live student records.
- Firebase student creation uses create-only student/account writes and attempts cleanup if the paired user record fails, preventing successful responses for incomplete persistence. Fallback student duplicate checks now compare all email/username/ID aliases.
- Teacher onboarding now uses a tenant-bound Firebase invitation flow with verified email and password setup links. Invitation states distinguish provider acceptance from confirmed delivery, record failures, and support a safe resend without creating a duplicate Firebase account. The School Authority dashboard exposes invite/resend actions and delivery status; Firebase-backed storage is required.
- `npm run qa:start` now launches the existing isolated JSON QA store through Node.js, preserving the no-provision/no-overwrite checks, external-service isolation, and duplicate-port guard. The PowerShell launcher remains available as `npm run qa:start:ps`.
- `npm test` now routes Jest through a guarded temp-data wrapper that sets external QA file paths for the fallback JSON stores, forwards Jest args correctly, and removes the generated test files on exit without touching protected repository data.
- Updated stale login and School Authority dashboard source assertions to match the current email-based Teacher login label and “Invite Teacher” UI.

### QA verification — 2026-11-03

- Focused backend invitation, authentication, tenant authorization, registration, frontend syntax, and dashboard action checks passed. After updating stale UI assertions, the login and School Authority workspace suites passed: 22 tests.
- Teacher invitation password-setup and mocked Brevo/Resend delivery suites passed: 20 tests. No provider request was sent during these tests.
- The local home page and school-list endpoint returned HTTP 200. Existing synthetic School Authority login and same-tenant dashboard summary returned HTTP 200; cross-tenant summary access returned HTTP 403.
- The checked-in test instructions' local roster does not match the school IDs in the existing isolated QA store. Teacher login was not verified: the local JSON QA configuration does not provide Firebase Authentication, which the current Teacher sign-in path requires. No invitations were sent.
- GitHub push and Render deployment were not performed. Dashboard verification is incomplete, and no authenticated Render deployment integration is available in this environment.

### Related implementation files

- Backend: `backend/modules/school/school.service.js`, `backend/modules/school/school.controller.js`, `backend/modules/auth/auth.service.js`, `backend/modules/auth/utils/email.js`, and `backend/routes/auth.js`.
- Frontend: `frontend/marketing/src/main.js`, `frontend/marketing/src/pages/school-dashboard.js`, `frontend/marketing/src/pages/role-dashboards.js`, and `frontend/marketing/src/api/school.js`.
- QA and checks: `scripts/start-local-qa.js`, `package.json`, `tests/frontend-login-experience.test.js`, and `tests/school-dashboard-workspace.test.js`.
