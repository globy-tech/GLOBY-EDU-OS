# Project Status

## Release-preparation update — 2026-10-31

- Teacher exam-result projections now require the assigned student/class scope as well as an assigned subject; the focused school archive/workspace regressions cover cross-scope records.
- Isolated QA mode now canonicalizes existing path ancestors before checking the QA home and data files, and Firebase Admin is disabled while `GLOBY_QA_MODE=true`.
- Focused validation passed: 4 suites / 21 tests for QA path, Firebase Admin, and auth middleware; 4 suites / 17 tests for QA configuration, token revocation, storage, and pricing isolation; and 6 school suites / 80 tests after correcting the archive-route fixture to declare its assigned subject.
- These are targeted local tests, not a full-suite or production-readiness result. Protected school/audit JSON remains excluded from release packaging; Render, live Firebase/R2/Paystack, backup/restore, and rollback remain unverified.

The assessment below is a historical 2026-10-23 snapshot. Its teacher-result blocker and test evidence are superseded by this update; its remaining production and data-protection cautions still apply.

## Deployment assessment — 2026-10-23 (historical)

**Verdict: NOT READY for deployment.** This assessment supersedes the older 2026-10-18 snapshot below; that section is retained as historical evidence only.

- Branch `main`, HEAD `e077b8751b95f7137775e08188f1ac6c0d9154c1` (`Deploy responsive dashboard and auth security fixes`, 2026-10-08), still equal to `origin/main`. No later commit records these local changes.
- Worktree has 51 modified tracked files and 12 untracked files. Git reports 4,316 additions / 555 deletions in tracked files. Most changes are local, uncommitted work; Git history cannot establish who made each change or separate changes by author.
- Protected local data was not opened or edited. Diff metadata only: `backend/data/audit-logs.json` 1,302 additions / 89 deletions; `backend/data/schools.json` 8 additions / 8 deletions; `backend/data/pricing-plans.json` has no diff. The large audit-log change is unexplained here and must be reconciled by its owner before any release packaging.
- Recent local implementation work includes Firebase password recovery and maintenance enforcement, 14-day trial calculations, assignment deadline enforcement, teacher attendance permission changes, Firebase assignment/lesson/message persistence, Firebase fee-payment transactions, report-card entry/printing, and 20 MiB image-upload validation. These are source-level additions, not proof of production behavior.
- Repo guidance is incomplete: no `AGENTS.md` or Copilot instructions were found; root `README.md` still describes a scaffold, and `docs/ARCHITECTURE.md` is a placeholder. No Render manifest, `Procfile`, Dockerfile, or checked-in GitHub workflow was found. Runtime code does enforce Firebase mode and `NODE_ENV=production` when `RENDER_SERVICE_ID` is set.

### Functional status

| Area | Status | Current evidence and remaining verification |
|---|---|---|
| Authentication, login/logout, password recovery, sessions | PARTIAL | Firebase password change/recovery uses Firestore transaction logic, hashed reset-token records, and session revocation; local tests were added. Latest selected test run did not complete. Real Firebase Auth/Firestore and email delivery were not tested in this audit. |
| Super Admin administration and maintenance | PARTIAL | Admin routes and persisted maintenance setting are guarded server-side; mock tests cover normal-user blocking and Super Admin recovery access. No current authenticated browser or live Firestore check. |
| School Authority dashboard/management | PARTIAL | Tenant API and role guards are present. Several flows have local source/tests, but not all server-backed actions or production role behavior were verified. |
| Teacher attendance, classes, assignments, lessons, messages, results | PARTIAL | New Firebase-backed workflow and permission tests exist; frontend assertions have unresolved failures. Teacher result reads currently include records when the subject matches, even if student/class is outside the teacher's assigned scope (`backend/modules/school/school.service.js`, around line 1347). Treat as a release-blocking authorization defect until fixed and regression-tested. |
| Student assignments, submissions, results, messages | PARTIAL | Assignment deadline uses server time and authenticated student identity in source; role-specific projections and tenant gates exist. Local mock/Firebase behavior was not fully verified in the latest incomplete test run; no live datastore check. |
| Tenant isolation and server-side role authorization | PARTIAL | Auth, role, and tenant middleware guard school and file routes; the reviewed tests use mocks/fixtures. No real cross-tenant Firebase test. Teacher result scope issue above remains a blocker. |
| School fee payments, receipts, Paystack subscriptions | PARTIAL | Firebase fee/receipt/reference writes use a Firestore transaction in source and have optimistic-conflict mock coverage in prior worklog. Paystack verification/webhook behavior is mocked; no live or emulator transaction test. Tenant-embedded arrays also have Firestore document-size limits. |
| Maintenance mode/recovery | PARTIAL | Persisted Firestore setting; auth middleware blocks normal users and fails closed if it cannot read the setting; tenantless platform admins and logout/password-change recovery routes remain allowed. Only mocked tests are available in this audit. |
| Profile editing and profile images | PARTIAL | Teacher fields and student self-photo update have backend paths; the student profile otherwise displays read-only fields. Some general profile fields save only to local storage. Current upload helper discards the API's stable `path`, requests a signed URL that the server caps at 3,600 seconds, and persists the URL; no wired refresh from a stored path or image deletion/old-image cleanup was found. R2 remains unverified. Teacher email edits also lack a demonstrated Firebase Auth email-update/verification flow. |
| Frontend/backend integration and persistence | PARTIAL | API wrappers surface network/HTTP errors; local fallback remains for development, while production startup requires Firebase mode. Latest tests did not complete; no real Firebase persistence was checked. |
| Firebase Auth, Firestore, Firebase Admin, Cloudflare R2 | UNVERIFIED | Code and mocked tests are present. No emulator or approved live service was run. Production R2 configuration/bucket policy and upload/retrieval are unknown. |
| PWA, production build, Render behavior | PARTIAL / UNVERIFIED | Manifest, icons, service worker, and a production build script exist. The build script recursively removes the existing `dist` before rebuilding; because `dist` already existed and is ignored, build was intentionally not run. No current build result. No Render deployment manifest or live deployment check. |

### Checks performed in this assessment

- `git diff --check`: passed (exit 0); Git emitted existing LF-to-CRLF warnings for the protected JSON files.
- Node syntax checks: passed for 44 changed tracked JavaScript files, plus the new `backend/modules/school/trial-period.js`.
- Safe Jest run: `backend/modules/school/__tests__/trial-period.test.js` passed. Broader selected batches were stopped after prolonged stalls. Four frontend suites reported failures (at least six assertions): stale renderer/navigation strings, a stale PWA cache-version expectation, missing profile-photo path refresh/path persistence, and missing checkout pending-state assertions. No full-suite pass count is available.
- Browser: shared local browser access timed out while reading the login page. No credentials were entered and no authenticated workflow was attempted in this assessment.
- No `.env` values, secret values, protected JSON contents, live services, payments, emails, accounts, or schools were accessed or changed. No application code was edited.

### Release blockers, ranked

1. **Teacher assessment privacy:** teacher results projection accepts a matching assigned subject independently of class/student assignment; verify and correct before deployment.
2. **Protected data/release contents:** the 1,302-line audit-log addition and school JSON changes are pre-existing local changes of unknown ownership. Do not package them without owner reconciliation and an explicit release-content review.
3. **Production integrations and operations:** Firebase Auth/Firestore, R2, Paystack, deployment configuration, domain/TLS, smoke tests, monitoring, backup, and rollback were not verified in an approved environment.
4. **Photo persistence:** uploaded profile images currently save short-lived signed URLs rather than the returned stable object path; older files are not removed. Fix or explicitly exclude the feature from this release.
5. **Incomplete gates:** no current full test result or current production build; build execution would delete the existing `dist` tree.

## Snapshot
- Audit timestamp: 2026-10-18 (client-readiness workflow audit).
- Branch: `main`.
- HEAD: `e077b8751b95f7137775e08188f1ac6c0d9154c1` (`Deploy responsive dashboard and auth security fixes`), equal to `origin/main` at audit time.
- The worktree is not clean: 30 modified tracked files and four existing untracked progress documents. Protected user data remains unchanged at 8 additions/8 deletions in `backend/data/schools.json` and 104 additions/89 deletions in `backend/data/audit-logs.json`; `backend/data/pricing-plans.json` has no diff. No destructive Git or production operation was run.
- Release verdict: NOT READY for production. Local verification is partial; paid subscription status reconciliation and all live deployment checks remain unresolved.

## Recovery State
Modified tracked files:
- `backend/data/audit-logs.json` (protected user data; preserved)
- `backend/data/schools.json` (protected user data; preserved)
- `backend/firebase.core.js`
- `backend/lib/__tests__/storage-config.test.js`
- `backend/lib/supabaseClient.js`
- `backend/modules/auth/__tests__/firebase-login-policy.test.js`
- `backend/modules/auth/middleware/auth.middleware.js`
- `backend/modules/auth/__tests__/credential-security.test.js`
- `backend/modules/pricing/__tests__/pricing.service.test.js`
- `backend/modules/school/__tests__/fallback.school.test.js`
- `backend/modules/school/__tests__/firebase-core-archive.test.js`
- `backend/modules/school/__tests__/school-archive.controller.test.js`
- `backend/modules/school/__tests__/school-archive.test.js`
- `backend/modules/school/school.controller.js`
- `backend/modules/school/school.service.js`
- `backend/modules/school/middleware/tenant.middleware.js`
- `backend/routes/__tests__/files.storage-routing.test.js`
- `backend/routes/files.js`
- `frontend/marketing/src/components/app-shell.js`
- `frontend/marketing/src/components/footer.js`
- `frontend/marketing/src/components/hero.js`
- `frontend/marketing/src/main.js`
- `frontend/marketing/src/pages/admin.js`
- `frontend/marketing/src/pages/school-dashboard.js`
- `frontend/marketing/src/styles.css`
- `tests/frontend-sidebar.test.js`
- `tests/frontend-syntax.test.js`
- `tests/school-dashboard-workspace.test.js`

Untracked at audit time:
- `docs/project-progress/RELEASE-CHECKLIST.md`
- `docs/project-progress/ROADMAP.md`
- `docs/project-progress/STATUS.md`
- `docs/project-progress/WORKLOG.md`

No new `backend/data/pricing-plans.json` modification resulted from the audit test run. `.env` and credential values were not read or changed. Recent history: HEAD plus `4715aaa`, `c74baca`, `5f2b93e`, `e45f13a`.

## Verified Results
Run on 2026-10-17. Current evidence includes the following commands and outputs:
- `node --input-type=module --check frontend/marketing/src/pages/admin.js` → no syntax error.
- `npm test -- --runTestsByPath tests/frontend-syntax.test.js` → 1 suite passed, 9 tests passed.
- `npm test -- --runTestsByPath backend/routes/__tests__/files.storage-routing.test.js backend/modules/school/__tests__/school-archive.test.js` → 2 suites passed, 38 tests passed.
- `npm test -- --runTestsByPath backend/modules/auth/__tests__/credential-security.test.js backend/modules/auth/__tests__/firebase-login-policy.test.js backend/modules/pricing/__tests__/pricing.service.test.js` → 3 suites passed, 26 tests passed.
- `npm test -- --runTestsByPath backend/modules/school/__tests__/fallback.school.test.js` → 1 suite passed, 23 tests passed.
- `npm test -- --runTestsByPath backend/modules/school/__tests__/school-archive.test.js backend/modules/school/__tests__/firebase-core-archive.test.js backend/modules/school/__tests__/school-archive.controller.test.js` → 3 suites passed, 51 tests passed.
- `npm test -- --runTestsByPath backend/modules/pricing/__tests__/pricing.service.test.js backend/modules/pricing/__tests__/pricing.webhook-route.test.js backend/routes/__tests__/files.storage-routing.test.js tests/frontend-syntax.test.js` → 4 suites passed, 38 tests passed.
- `npm test -- --runTestsByPath backend/modules/auth/__tests__/auth.service.test.js backend/modules/auth/__tests__/firebase-login-policy.test.js backend/modules/pricing/__tests__/pricing.service.test.js backend/modules/pricing/__tests__/pricing.webhook-route.test.js backend/modules/school/__tests__/school-archive.test.js backend/modules/school/__tests__/school-archive.controller.test.js backend/routes/__tests__/files.storage-routing.test.js --testTimeout=30000` → 7 suites passed, 93 tests passed after adding persisted-expiry login, invalid/cross-tenant reference, and partial-webhook-retry coverage.
- A focused fault-injection regression reproduced a signed webhook retry returning success while the tenant remained expired after a subscription write failed; the retry completes entitlement writes after the fix.
- `npm run build` → succeeded, generated `dist/frontend`.
- `git diff --check` → exit 0; only JSON line-ending warnings were printed.
- The focused workflow-feedback regression for admin create/edit school submit locks passed with 9/9 assertions in the frontend syntax test.
- Photo-path persistence and refresh were verified with the local school-service and frontend-syntax suites; no live R2 verification occurred.
- Protected JSON diffs remain at their pre-test sizes; the audit logs and schools data were preserved and not rewritten in a destructive way.
- 2026-10-18: `npm test -- --runTestsByPath backend/modules/school/__tests__/school-archive.test.js` → 1 suite passed, 32 tests passed, including duplicate fee-reference rejection and distinct payment/receipt IDs for distinct references; fixtures used `global.__workspaceSnapshot`.
- 2026-10-18: `npm run build` succeeded after the fee-payment fix. Final `git diff --check` exited 0; only the pre-existing JSON LF-to-CRLF warnings were printed. Protected school/audit numstats remained 8/8 and 104/89; pricing data had no diff.

## Task Classification
Statuses below reflect inspected source plus the test run above. “Complete” means locally implemented and covered, not live-production verified.

| Area | Status | Evidence / gap |
|---|---|---|
| Student/teacher photos and other file uploads | PARTIAL | Tenant-scoped uploads accept files up to 20 MiB across profile photos, school logos, and branding; original image bytes are preserved. Production requires Cloudflare R2. Size-boundary and mocked storage-routing tests are locally verified; real authenticated R2 upload/retrieval remains unverified. |
| Teacher exam report cards | PARTIAL | Teacher report-card sheet supports assigned-student autocomplete, editable report headings, add/remove subject rows, print-ready report cards with the student's profile/passport photo, and persists rows in the existing tenant-scoped exam-results collection. Isolated local teacher workflow/API save and production build are verified; live datastore behavior and student/School Authority role-view QA remain unverified. |
| Super Admin permanent school deletion and dependency protection | COMPLETE locally | Archived-only guard, Firebase root/subcollection checks, fallback dependencies, mocked Prisma counts/foreign-key handling, and controller/audit behavior pass 3 suites / 51 tests. No real database deletion is approved or verified. |
| School Authority mobile usability | COMPLETE locally | Shared responsive shell, dashboard spacing, scrollable directory tables, and drawer keyboard/focus behavior verified in browser at 390px, 768px, and 1280px. No production/device QA. |
| Responsive headers across four dashboards | COMPLETE locally | All four roles render the expected shared shell at 390px and 1280px; no horizontal page overflow; desktop content/sidebar remain interactive. Static preview only. |
| Profile menus and account/settings actions | COMPLETE locally | Mocked browser verified profile/settings menu actions, help/messages/notifications routes, and logout/token clearing for all four roles. Backend-backed account actions and live auth remain unverified. |
| Loading/error/duplicate-submission handling | COMPLETE locally for the confirmed admin defect | The admin create/edit credential reset flows now guard against duplicate submits with busy-state checks and aria-busy state. A syntax break in the admin page was repaired, and the production build passes. Other critical workflows remain partially covered and require broader local verification before production. |
| Accessible hover/focus/keyboard/touch interactions | PARTIAL | Some labels, expanded states, keyboard behavior, and 44px controls exist. Drawer focus management and broader keyboard/touch audit remain. |
| Responsive sidebar/navigation | PARTIAL | Shared drawer now traps Tab, closes on Escape/backdrop, restores opener focus, and makes the background inert. Verified locally; all-role route/action and production device QA remain. |
| Super Admin metrics and school-scoped counts | COMPLETE locally | Firebase, Prisma, and fallback paths use populated profile collections or normalized role assignments without duplicate counting; archived records are excluded. Fixture tests pass; no live database verification. |
| Consolidated Super Admin subscription/pricing management | PARTIAL | Shared Plans & subscriptions renderer and legacy route mapping exist; behavior is only source-asserted in the focused UI suite. |
| Paystack-only provider UI | COMPLETE locally | Admin UI filters providers to Paystack; existing integration remains. UI test passed; no live payment run. |
| School fee-payment integrity | COMPLETE locally for Firebase transaction behavior; adapter-limited | Firebase now checks references, allocates IDs, and appends payment/receipt arrays atomically in a tenant-document transaction. Mocked conflict/retry tests cover duplicate rejection, lost-update prevention, unique IDs, and blank cash references. No emulator/live integration was run. Prisma/JSON remain unchanged and have no concurrency guarantee. |
| Trial/payment status, activation, expiry, renewal, suspension, data preservation | COMPLETE locally for access policy; external consistency PARTIAL | Tenant operational status, subscription status, and `expiresAt` are the access source of truth. Elapsed paid expiry derives `expired` even when status remains `active`; school/file APIs deny access without mutating history. Separate `subscriptions` documents are written after verified payment but have no backend authorization readers. Pending/failed verification does not activate; operational Super Admin activation does not renew. Live consistency is unverified. |
| Maintained docs and release notes | PARTIAL | Tracking docs now record this recovery; release-note accuracy and remaining docs reconciliation are outstanding. |

## Current Task and Exact Next Action
- Last verified completed tasks: School Authority mobile usability, paid-expiry access enforcement, responsive shell/profile route subset, Super Admin metric counts, local photo-path persistence/refresh, and deletion guards, locally verified 2026-10-17.
- Current task: local essential-workflow audit found and fixed duplicate school fee recording and payment-ID reuse; prior subscription fixes remain unchanged.
- Exact next action: obtain client approval for an existing dedicated non-production test tenant and its Firebase/Firestore, R2, and Paystack test-mode environment, then run an end-to-end smoke covering registration/login, role/tenant isolation, profile photo upload/retrieval, and expired-tenant renewal. Do not create accounts/schools or initiate payments without explicit authorization.
- Cross-role QA completed: Super Admin, School Authority, Teacher, and Student shells render expected role navigation at 390x844 and 1280x800; no horizontal page overflow. Profile/settings hash targets and account-menu expansion verified. Static preview API calls returned expected 404s; no backend or live data was used. Logout/help/messages/notifications and production role workflows remain unverified.
- Payment expiry implementation: `resolveSchoolLifecycleStatus` derives expired status from elapsed paid `expiresAt`; tenant middleware denies school data and `/files` upload/retrieval; future dates remain allowed. Expired paid tenants, including persisted `subscriptionStatus: expired`, may authenticate for renewal; expired trials and operational suspension remain blocked.
- Subscription policy: the school/tenant record (`schoolStatus`/legacy operational status, `subscriptionStatus`, and `expiresAt`) controls access. Expiry is derived on reads; it is not persisted. Search found no backend reads of separate Firebase `subscriptions` documents for authorization or dashboard status, so a stale `active` value there cannot grant access. No migration or mass rewrite is justified.
- Renewal and suspension: expired users may authenticate to reach checkout/verification, while tenant-protected school and file routes deny access. Only verified Paystack processing updates subscription entitlement. Super Admin activation restores operational status only and does not renew; school roles cannot edit subscription lifecycle fields through the generic school update route.
- Latest confirmed local defect fixed: the admin edit form had an unclosed event-listener block, which broke the production build parser. The block was repaired in `frontend/marketing/src/pages/admin.js`; the same focused suites and the build now pass.
- Final policy test batch covers active and expired/stale-active tenants, paid-expiry renewal authentication, pending/failed verification, unknown and cross-school references, verified renewal, duplicate webhook delivery including retry after partial failure, suspension/reactivation, tenant billing-field authorization, history preservation, and API/file denial.
- Prisma school-update responses expose derived expiry without writing it back; a focused fixture confirms stored `active` remains unchanged.
- Metric implementation: role counts select nonempty student/teacher collections, otherwise normalize roles from school users; archived entries are excluded. Prisma platform summary includes nested user-role records. Tests cover Firebase profile counts, fallback duplicate/archive handling, Prisma relations, and fallback school summary counts.
- Mobile verification: phone 390x844 and tablet 768x1024 drawers open, focus moves to close, background becomes inert, Tab wraps, Escape closes/restores focus; Students navigation completes and closes drawer. Desktop 1280x800 keeps sidebar exposed and content interactive. No horizontal page overflow. Static preview returned expected 404s for API calls because no backend was started.
- Focused tests after mobile edit: 2 suites, 18 tests passed. Production build passed; `git diff --check` passed; changed frontend files have no editor diagnostics.

## Three-Hour Execution Plan
1. 30-45 min: verify photo upload URL lifetime, persistence, and retrieval locally.
2. 45-75 min: define paid-subscription status reconciliation and renewal-after-expiry policy; do not make an auth architecture change without that decision.
3. 30-45 min: run focused tests/build/diff checks and review remaining loading/accessibility gaps.
4. Remaining time: complete non-live checklist and handoff review. Do not deploy or commit without explicit approval.

Not safely verifiable in this window without approved production access: live R2 upload/retrieval, production Firebase/Firestore behavior, live Paystack payment/webhook/subscription behavior, production smoke/rollback, or permanent deletion of any live school. Never use `Globy School` / `globy-school` or `Bright Future Academy` / `GLB-2026-0BEAEE92319` for destructive testing.

## Outstanding Risks and Release Verdict
- Paid expiry is enforced by shared tenant middleware, including file access; separate subscription documents are intentionally not rewritten because they are non-authoritative. Production/live behavior remains unverified.
- Live credentials, webhook delivery, production data-store configuration, domain/TLS, deployment, smoke tests, and rollback are not verified here. No conclusion about secret values is recorded.
- Live R2 behavior and live database deletion are unverified; permanent deletion must remain prohibited outside an explicitly approved dedicated test school.
- Protected user data changes remain in place and must be reviewed as user work before any release action.
- Verdict: NOT PRODUCTION READY. Local expiry/access policy is verified; approved live Firebase/Paystack renewal checks, R2, and deployment gates remain outstanding. No commit, push, deployment, real payment, real subscription mutation, or destructive live operation was performed or approved.
2. Live Paystack keys and webhook secret are missing.
3. Real production domain, TLS, and deployment setup are outside this repository.
4. Protected data files (`backend/data/*.json`) must remain untouched unless explicitly approved.

## Release-readiness verdict
Not production-ready. The repo has strong local logic and test coverage, but all live external dependencies and deployment checks remain blocked by missing production configuration.

## Client-Readiness Smoke Check 2026-10-18
- Current checkout: `main` at `e077b8751b95f7137775e08188f1ac6c0d9154c1`, equal to `origin/main`; 30 tracked files modified and the four progress documents are untracked. Existing protected data diffs remain `backend/data/schools.json` 8 additions / 8 deletions and `backend/data/audit-logs.json` 104 additions / 89 deletions. These files were not edited; pricing-plan data has no diff.
- No explicit approval or existing dedicated non-production tenant/environment is evidenced by the checkout or progress records. No service configuration or secret values were inspected, no endpoint was contacted, and no school/account or external test fixture was created.
- Safe local validation: the selected 13-suite command passed 12 suites / 120 tests and failed 1 test / 1 assertion (121 total). The failure is `tests/frontend-login-experience.test.js` expecting the former `remoteUrl` photo-upload expression; current code persists `uploadedPhoto.url` and `uploadedPhoto.path`. Relevant auth/service/session/role, fee-payment, subscription, file-routing, and frontend logout/sidebar tests passed. The test batch did not exercise live login, management persistence, R2 retrieval, or payment processing.
- `npm run build` passed and generated `dist/frontend`. `git diff --check` exited 0; Git reported existing LF-to-CRLF warnings for protected JSON and pricing-plan JSON files. No protected data change followed the checks.
- Fee-reference concurrency is NOT guaranteed. `createFeePayment` checks the school aggregate and then calls `updateSchool`; Firebase uses a normal tenant document `set`, Prisma uses a normal `tenant.update`, and fallback updates a JSON aggregate. The check, ID allocation, and write are not a transaction or backed by a demonstrated unique constraint. In particular, simultaneous requests can both observe the same reference as absent and allocate the same next IDs.
- Smallest safe storage-specific remedies to evaluate after the active adapter is approved/identified: Firestore transaction using a deterministic school+normalized-reference payment key and transactionally allocated IDs; Prisma transaction plus a database unique constraint on school and normalized reference (and atomic ID allocation); JSON fallback can only serialize within one process and is not multi-process protection. No storage redesign was made.
- External smoke still unverified: login and role access against a deployed identity provider; tenant read/write isolation; student/teacher management persistence; authenticated photo upload and retrieval; fee recording against the active persistence adapter; subscription expiry and renewal with test payment verification; and server-backed logout/session revocation. Local test assertions do not replace those checks.
- Highest-priority next action: obtain explicit approval and identify an already-existing dedicated non-production tenant/environment with approved test identity, storage, and payment setup; then run a synthetic, reversible workflow smoke. Do not create accounts/schools or initiate charges without that approval.
- Follow-up source verification: `tests/frontend-login-experience.test.js` has a stale expectation in its student-photo test. The current handler saves `profilePhoto: uploadedPhoto.url`, `profilePhotoPath: uploadedPhoto.path`, and local storage `uploadedPhoto.url`; the smallest test-only correction is to assert those three expressions. No app change is indicated by this failure.
- Adapter detail: production startup requires `DATA_STORE_MODE=firebase`; therefore Firestore is the mandated production path, although runtime environment values were not inspected. Its current fee flow reads the tenant then uses merge `set`, not a transaction. The minimal production fix is a Firestore transaction that reads the tenant document, checks the same-school external reference, allocates payment/receipt IDs from the transaction's current arrays, and writes both arrays atomically. Prisma's `Tenant` schema has no `payments`/`receipts` fields and there is no payment model, so the existing Prisma `tenant.update` path cannot safely serve this workflow; add explicit persistence/schema uniqueness and transaction support before enabling that adapter for fees. JSON fallback can at most serialize within one process and must not be treated as multi-process safe.

## Firebase Fee Concurrency Fix 2026-10-18
- Firebase `createFeePayment` now uses `firebaseCore.updateTenantInTransaction` to read the current tenant document, reject an existing nonblank reference, allocate payment and receipt IDs from current arrays, and append both records in one Firestore transaction. Firestore transaction retries re-run the check/allocation callback against current data. Blank references remain `null` and are not deduplicated.
- Added `backend/modules/school/__tests__/fee-payment.firebase.test.js`: 5 mock-backed tests cover sequential duplicate rejection, concurrent same-reference rejection (one success/one duplicate), distinct-reference concurrent ID allocation after retry, sequential distinct IDs, and blank-reference cash payments.
- `npm test -- --runTestsByPath backend/modules/school/__tests__/fee-payment.firebase.test.js` → 1 suite / 5 tests passed. Combined `npm test -- --runTestsByPath backend/modules/school/__tests__/fee-payment.firebase.test.js backend/modules/school/__tests__/school-archive.test.js --testTimeout=30000` → 2 suites / 37 tests passed.
- `npm run build` → passed. `git diff --check` → exit 0; existing LF-to-CRLF warnings for protected JSON only.
- Limit: transaction behavior was validated with a local mock that simulates optimistic conflicts and callback retries; no emulator run or external Firebase contact occurred. `firebase.json` configures Firestore on port 8080 and Firebase CLI 15.28.0 is installed, but Java is not on PATH, no emulator artifact was found in checked standard caches, `FIRESTORE_EMULATOR_HOST` is unset, and port 8080 has no listener. Firestore tenant-embedded arrays remain subject to the document-size limit as they grow. Prisma/JSON fallback concurrency behavior was not changed or claimed safe.
- Review confirmation: transaction code reads the tenant snapshot before its single `set`; the fee callback reconstructs arrays and IDs from each retry's snapshot. Duplicate detection throws before writing. The different-reference race test asserts both returned IDs and both final tenant arrays, so a lost append fails. The controller forwards the original error message; transaction failures are not labeled as duplicates.

## Phase 1 Application Audit 2026-10-18
- Confirmed, release-blocking privacy defect: `reportCards` are generated and stored on the school aggregate, but both student and teacher school projections spread the whole school object without scoping/removing `reportCards`. The student details route returns that projection. Existing projection tests omit report cards.
- Confirmed auth defect in Firebase production mode: `prisma.client.js` sets `prisma = null` for Firebase; change-password, forgot-password, and reset-password directly call Prisma. Auth middleware requires reset-marked users to use `/change-password`, so Firebase-created users requiring password reset cannot complete first-login setup. Firebase refresh/logout use Firestore; session listing/revocation endpoints remain Prisma-only.
- Confirmed production workflow gaps: assignment, lesson, and messaging service operations read/write JSON fallback directly, while `fallback.school` rejects all calls in production. These endpoints therefore cannot provide those workflows on the required Firebase production adapter. Existing tests use JSON snapshots and do not exercise these production paths.
- Confirmed integrity/authorization defects: generic school `PUT` lets School Authority/School Head send arbitrary aggregate fields including `payments`/`receipts`, bypassing the dedicated fee-payment duplicate/reference/receipt validation; teacher exam-result writes accept a row when either the student ID or class name is assigned, allowing a mismatched student/class result to be persisted.
- Confirmed assignment deadline defect in local service: submission accepts client-supplied `submittedAt` and records expired work as `late` rather than rejecting it. No late-deadline rejection test exists. Production execution is additionally blocked by the fallback-only storage gap.
- Confirmed maintenance-mode gap: the toggle is saved through browser `localStorage` admin state and no backend maintenance enforcement was found. It cannot block intended users across sessions/devices; Super Admin recovery behavior is UI-only.
- Confirmed workflow mismatch: School Authority attendance action sends `attendanceRecords` through generic school `PUT`, while the controller explicitly rejects that field for School Authority/School Head. Attendance teacher updates have local snapshot coverage, but not the authority action path.
- Audit verification: safe local/mock batch `npm test -- --runTestsByPath backend/modules/auth/__tests__/auth.service.test.js backend/modules/auth/__tests__/firebase-login-policy.test.js backend/modules/auth/__tests__/role.middleware.test.js backend/modules/auth/__tests__/auth.middleware.test.js backend/modules/school/__tests__/school-archive.test.js backend/modules/school/__tests__/fee-payment.firebase.test.js backend/routes/__tests__/files.storage-routing.test.js backend/modules/pricing/__tests__/pricing.service.test.js backend/modules/pricing/__tests__/pricing.webhook-route.test.js tests/exams-dashboard.test.js tests/school-dashboard-workspace.test.js tests/frontend-sidebar.test.js` → 12 suites / 107 tests passed. `git diff --check` passed with existing Windows JSON line-ending warnings. Full suite and file-mutating fallback suites were not run.
- Environment limits: no secret values or external services accessed. Firebase emulator is declared but not runnable on this machine (no Java on PATH, emulator artifact/cache absent, host unset); no R2, Paystack, Firebase Auth/Firestore, or deployment integration was exercised.
- Recommended first defect: scope `reportCards` in both role projections and add fixtures proving one student cannot receive another student's card, then a route-level projection assertion. Next prioritize generic payment write protection and teacher grade-result identity validation, followed by Firebase password recovery, Firebase-backed academic/messaging persistence, server-enforced deadlines, maintenance enforcement, and the attendance action contract.

## Phase 1 Local Browser Smoke 2026-10-20
- Local app started with the existing `npm start` command on `127.0.0.1:4000`; root HTTP response was 200. Browser-loaded login, Super Admin login, school password-recovery, and platform-admin password-recovery views. Teacher and Student role selection rendered their expected login field prompts. Unauthenticated direct navigation to the teacher dashboard redirected back to login.
- No browser console errors, failed network requests, or >=400 responses were observed during the login page reload. Server startup remained responsive.
- **Pass (limited):** app starts locally; public/login route rendering; login role-selection UI; unauthenticated teacher-route gate.
- **Blocked / not tested:** sign-in/out, recovery submission, all authenticated dashboards and workflows, school/tenant API isolation, unauthorized API attempts, and maintenance-mode behavior. No approved isolated test environment or credentials were available. Submitting fallback logins would append local audit events; submitting recovery could send real email. Protected local JSON therefore remained untouched by test actions. Configured datastore is local JSON; Firebase credentials are present but `FIRESTORE_EMULATOR_HOST` is unset. No real Firebase/Firestore integration is claimed.
- No confirmed defects found in the limited browser run; no code fixes or automated tests were run for this checkpoint. Existing source/test findings recorded in the audit section above are not newly confirmed by browser execution.
- Next: provide approved, isolated non-production tenant and pre-provisioned role test accounts, and confirm permitted reversible actions. Then run the requested authenticated flows against that environment only. Do not use production data or send real mail/payments.

## Local Super Admin Reset Follow-up 2026-10-20
- Confirmed local reset/login mismatch in the fallback path: backend startup seeded the demo school and replaced existing demo Super Admin password hashes, undoing an earlier local reset after restart.
- Fixed fixture refresh to preserve existing credential hashes/reset flags and added snapshot-only coverage for admin, teacher, and student accounts. Focused test passed: 1 suite / 1 test; `git diff --check` exited 0 (existing protected-JSON line-ending warnings only).
- No browser login retry, password inspection, JSON data access, email send, production action, or Firebase integration was performed. Ask the user to complete any necessary local password recovery themselves; credential values must not be shared in chat. Production readiness is unchanged and remains blocked on approved isolated integration testing.

## Approved Browser Test Environment 2026-10-20
- User approved non-production Firebase project `globyedu-os`. Local `.env` is now set to `DATA_STORE_MODE=firebase` (only this ignored local setting changed; credentials were not printed or inspected). App started with `npm start` at `127.0.0.1:4000`, and root returned HTTP 200.
- Shared browser currently shows School Authority login, not the authenticated dashboard. User reported sign-in, but the browser evidence does not confirm it; no credentials were entered or read, and no authenticated test is claimed.
- **Real Firestore integration: not yet verified.** No authenticated Firebase/API call or data read/write occurred. Wait for the user to sign in manually using the approved non-production test account, then proceed with read-only checks before any write.
- The local server is running; keep all actions on the approved test project and localhost. Preserve protected JSON; do not request credentials in chat or trigger email/payment/destructive actions.

## School Authority Sign-in Attempt 2026-10-20
- One user-authorized browser sign-in attempt was made with the supplied test account on localhost configured for the approved non-production Firebase project. Result: HTTP 401; browser stayed at login. Password field was cleared by reload. No retries.
- Cause remains unconfirmed: check the existing test account's Firebase Auth status, password, and tenant/role mapping in the approved test project. Do not infer a code defect from a generic 401.
- Firebase/Firestore integration remains unverified: an HTTP 401 proves only that the browser received an HTTP response; no successful Auth session or Firestore read/write occurred. No authenticated workflows passed.
- Credentials were not saved in project documentation. Protect any password exposed in chat/tool output; rotate it if it is a real or reused credential. Further attempts should be owner-entered only after account mapping is confirmed.

## School Authority Mapping Follow-up 2026-10-20
- Read-only metadata check against approved non-production Firebase confirmed the tenant exists and has exactly one matching account row; row is active, verified, and contains a password hash. Role is `school_head`, accepted by the existing School Authority login policy. Firebase Auth identity exists and is verified.
- Correct prior interpretation: role is not mismatched. HTTP 401 cause remains unconfirmed because no password/hash verification or further login was done. Reset through local JSON mode does not change Firebase-mode records. If reset is needed, owner must initiate the app's Forgot Password while configured for approved Firebase, noting it sends email; automation did not send one.
- Cleared the browser password and reloaded. No app code change justified by this evidence; authenticated workflow and actual Firestore persistence remain unverified.

## Super Admin Browser Check 2026-10-21
- **Passed:** Owner-entered Super Admin login reached the local dashboard. Read-only dashboard and School Management routes loaded; directory displayed three rows.
- **Passed (read-only):** Maintenance control was visible and off. No settings or school records were changed. Logout returned to the Super Admin login screen.
- **Browser diagnostics:** During overview/school-directory navigation, 0 console errors, 0 uncaught page errors, 0 failed requests, and 0 HTTP responses >=400.
- **Limits:** Local server startup reported development Super Admin seeding was skipped because JSON fallback is disabled, then started normally. No writes were performed; this does not verify Firestore persistence despite the configured approved non-production target. School Authority, Teacher, and Student authenticated workflows remain untested.
- **Safety:** No production access, email, payments, maintenance changes, commit, push, or deploy.
