# Release Checklist

Status includes the 2026-10-31 release-preparation update and the historical 2026-10-23 assessment. Older dated checklist entries are historical; the latest update supersedes conflicting earlier entries. `[x]` means locally verified only, not production/live verification.

## Release-preparation update — 2026-10-31
- Teacher exam-result reads now require authorized student/class scope as well as an assigned subject; focused school regressions pass after updating the route-test fixture with the teacher's assigned subject.
- Isolated QA mode canonicalizes QA home/store paths and disables Firebase Admin; focused QA path, Firebase Admin, auth middleware, storage, revocation, and pricing-isolation tests pass.
- These are targeted local checks, not a full-suite or production build result. Protected school/audit JSON remains excluded; Render, live Firebase/R2/Paystack, backup/restore, and rollback remain unverified.

## Automated Tests and Build
- [x] Focused local lifecycle/payment/access tests: 7 suites, 93 tests passed; external payment/storage paths are mocked. Coverage includes pending/failed, unknown/cross-tenant and verified references, duplicate delivery after partial activation failure, paid-expiry login/access, expired-trial denial, and file access.
- [x] `git diff --check` exited 0; existing JSON LF-to-CRLF warnings were reported.
- [x] Prior production build succeeded on an earlier checkpoint; it does not verify the current worktree.
- [ ] Current production build: not run because the script deletes the existing `dist` tree before rebuilding; `dist` was present and preserved.
- [ ] Full automated suite: not run in this audit.
- [ ] Review complete worktree, including protected data changes and untracked docs, before release.

## Authentication and Role Permissions
- [x] Shared app shell routes are role-aware in local source.
- [ ] Verify School Authority, Super Admin, Teacher, and Student login/role permissions in targeted tests after all changes.
- [ ] Verify production Firebase Auth, claims, cookies, and session expiry against approved deployment.

## Tenant Isolation and School Data Safety
- [x] File upload path is scoped from authenticated tenant; route tests include cross-role/path cases.
- [x] School deletion is Super Admin-only and requires archive plus no related dependencies in the applicable data adapter; local regression tests passed.
- [ ] Verify cross-tenant reads/writes with approved non-production test tenants.
- [ ] No destructive test against `Globy School` (`globy-school`) or `Bright Future Academy` (`GLB-2026-0BEAEE92319`). No live deletion without explicit approval and an approved dedicated test school.
- [ ] Confirm archived, expired, or suspended school data remains preserved.

## Photo Upload and Retrieval
- [x] Local gallery/camera UI, tenant-scoped upload route, 20 MiB per-file limit across upload surfaces, validation, and mocked route tests exist.
- [ ] Current frontend upload flow persists only the signed URL and discards the upload response's stable path; the signed URL is capped at 3,600 seconds by the API. Prior service tests for path persistence do not verify this current UI integration.
- [ ] Current frontend photo refresh from a stored path is not wired/verified. The selected frontend test expects a refresh helper that is absent from the current source.
- [ ] Replace/remove old profile images and clean up objects not currently implemented/verified.
- [ ] Verify real authenticated R2 upload and retrieval in an approved test environment.
- [ ] Confirm production R2 configuration, permissions, CORS/public or signed URL policy, and rollback without exposing credentials.
- [ ] Confirm both student and teacher workflows persist and render the retrieved photo.

## Exams and Report Cards
- [x] Teacher report-card sheet uses assigned-student autocomplete and stores editable report columns and subject rows in tenant-scoped exam results.
- [ ] Verify saved custom headings/rows render as intended in teacher, student, and School Authority views using an approved non-production account.

## Super Admin and School Authority Workflows
- [x] Permanent deletion guard and archive/restore route tests passed locally: 3 suites / 51 tests cover Firebase subcollections/root records, fallback dependencies, mocked Prisma counts and foreign-key rejection, and Super Admin route/audit handling. The Prisma empty-tenant deletion uses a mock only.
- [ ] Verify archive, restore, and permanent-delete UI/API workflow with a dedicated approved test tenant only.
- [x] Local School Authority mobile shell/layout checked at 390x844, 768x1024, and 1280x800; drawer keyboard/focus and route behavior passed.
- [ ] Production/device QA for School Authority mobile remains pending.
- [x] Local responsive headers/shell for all four roles checked at 390px and 1280px; expected role labels and profile/settings targets verified.
- [x] Local mocked-browser check: logout/help/messages/notifications/profile/settings controls route correctly for all four roles; logout clears the fake token and targets the appropriate login portal.
- [ ] Verify backend-backed account actions for all roles in an approved non-production environment.
- [ ] Complete remaining keyboard/focus/touch review across all roles and real browser/device QA.
- [x] Admin create/edit/reset school workflows now guard against duplicate submissions while exposing busy state to assistive tech via aria-busy and disabled controls. Verified in the focused frontend syntax regression (1 suite, 9 tests).
- [ ] Verify remaining dashboard loading, error, and duplicate-submission handling for photo upload, student/teacher save, and payment submission under a controlled mock-only environment.
- [x] Fee-payment service rejects repeated nonblank references and assigns unique payment/receipt IDs for distinct payments; in-memory regression passed (school-archive suite: 32 tests).
- [x] Firebase fee-reference checks, ID allocation, and payment/receipt writes are atomic in one tenant-document transaction; mock-backed conflict/retry regressions pass. Live/emulator verification remains pending.
- [x] Local Firebase/Prisma/fallback metric fixtures verify Super Admin school/student/teacher totals, role scoping, no duplicate counting, and archived exclusion.
- [ ] Compare metric outputs against an approved non-production database tenant; live data not inspected.
- [ ] Verify consolidated pricing/subscription management and Paystack-only provider controls function beyond source assertions.

## Subscription, Payment, and Payment-Status Consistency
- [x] Local mocked tests cover authoritative server-side plan amount, transaction verification fields, webhook signature, unknown/cross-tenant reference rejection, duplicate-event retry after partial entitlement-write failure, and preserving operational suspension on payment activation.
- [x] Local paid expiry enforcement: elapsed tenant `expiresAt` derives expired status despite stale `subscriptionStatus: active`; guarded school API/file access returns 403; tests cover future expiry and data preservation.
- [x] Source-of-truth policy documented: tenant operational/subscription status plus tenant `expiresAt` controls access. Separate Firebase `subscriptions` docs are written on activation but have no authorization/status readers; stale status cannot grant access. No migration or mass update is warranted locally.
- [x] Expired paid tenants, including persisted `subscriptionStatus: expired`, may authenticate for renewal; expired trials and operational suspension remain blocked. Tenant-protected data stays gated. Pending/failed verification does not activate, and verified renewal updates entitlement only after backend validation.
- [x] Super Admin activation is operational-only and does not change subscription status/expiry. School roles cannot self-edit subscription lifecycle fields through the generic school update route.
- [ ] Verify expired-tenant checkout and verified renewal with an approved non-production Firebase/Firestore and Paystack test setup.
- [ ] Verify trial duration and trial expiry, paid activation, expiry, renewal, suspension/reactivation policy, and consistent payment/subscription/tenant records.
- [ ] Confirm backend is authoritative; frontend success alone must never grant access.
- [ ] Live Paystack initialization, verification, webhook delivery, activation, and cancellation/refund behavior remain unverified. Do not initiate real payments or modify real subscriptions.

## Production Environment, Deployment, Smoke, and Rollback
- [ ] Verify production Firebase/Firestore/Auth/Storage configuration in the secret manager without printing secret values.
- [ ] Verify production R2 and Paystack keys/webhook configuration through approved secret-management checks.
- [ ] Verify production domain, TLS, CORS, webhook reachability, monitoring, and deployment configuration.
- [ ] Run approved production smoke tests for each role, tenant isolation, photos, subscription/payment status, and dashboards.
- [ ] Document and test rollback plan; verify data backup/restore and retention expectations.
- [ ] Obtain explicit release approval before commit, push, deployment, real payment, subscription mutation, or destructive live operation.

## Explicitly Not Verified Live
- Cloudflare R2 upload and retrieval.
- Firebase Auth/Firestore/Storage production behavior and tenant isolation.
- Paystack live payment, webhook, subscription activation/expiry/renewal, or refund behavior.
- Production subscription/document consistency and renewal flow; local policy and mocks are not live verification.
- Real database deletion (intentionally not performed).
- Production deployment, domain/TLS smoke tests, monitoring, backup/restore, and rollback.

## Assessment 2026-10-23 — Historical Snapshot

- **Verdict: NOT READY FOR DEPLOYMENT.**
- Branch `main`, HEAD `e077b8751b95f7137775e08188f1ac6c0d9154c1`; worktree has 51 modified tracked files and 12 untracked files. Git history has no commit after the 2026-10-08 baseline to attribute local edits by author.
- Protected local data was not opened or changed. Metadata-only diffs: `backend/data/audit-logs.json` 1,302 additions / 89 deletions; `backend/data/schools.json` 8 additions / 8 deletions; pricing plans unchanged. Reconcile with the owner before packaging.
- `git diff --check` passed with CRLF warnings. Syntax checks passed for 44 changed tracked JavaScript files and the new trial-period module. One safe trial-period Jest suite passed; the broader selected Jest runs stalled and were stopped. Four frontend suites reported at least six assertion failures; the full suite is not verified.
- Teacher result projection scoping was closed in the 2026-10-31 local changes: reads require an authorized student/class scope and an assigned subject, with regression coverage for mismatched scope.
- Current profile-photo gap: upload helper stores a one-hour signed URL and does not persist the stable path returned by `/files/upload`; no refresh/remove/old-image cleanup was verified. Profile features can be deferred only if explicitly excluded from this release.
- Real Firebase/Auth/Firestore, R2, Paystack, Render deployment, tenant-isolation smoke, production configuration, domain/TLS, monitoring, backup/restore, and rollback remain unverified. No live service or browser authentication was performed in this assessment; shared browser read timed out.
- No `.env`/secret values or protected JSON contents were read. No application behavior, data, account, school, payment, production setting, or deployment was changed.
- Remaining actions: (1) owner review and approval of release contents while excluding protected local data; (2) identify an approved existing non-production environment and verify Firebase/R2/Paystack workflows; (3) resolve signed-path/cleanup and profile identity behavior or explicitly exclude those features; (4) run the remaining safe regression checks and then production smoke/rollback checks.

## Verdict
NOT READY for production. Local expiry/access policy is verified, but live Firebase/Paystack behavior, approved renewal smoke tests, R2, production configuration, and deployment operations remain outstanding. No commit, push, deploy, real payment, live subscription mutation, or destructive operation was performed.

## Subscription Checkpoint (2026-10-18 historical)
Local verification: 7 focused suites / 93 tests passed; `npm run build` passed; `git diff --check` exited 0 with only existing Windows line-ending warnings. This task made no edits to `backend/data/schools.json` or `backend/data/audit-logs.json`; their pre-existing worktree numstats stayed at 8/8 and 104/89.

Confirmed fixes: persisted expired paid accounts can authenticate to renew without unlocking protected APIs; verified activation retries repair partially written subscription/tenant state on duplicate signed webhooks. Pending/failed and invalid/cross-tenant references do not activate. The tests are local mocks/fixtures, not live verification.

Blocker and next action: obtain explicit approval and an isolated non-production Firebase/Firestore plus Paystack test-mode setup; then verify one fixture-only expired-tenant renewal and compare the resulting tenant, payment, and subscription records. No credentials were inspected, and no real payment or production mutation occurred.

## Client-Readiness Audit 2026-10-18
Confirmed local fix: duplicate school fee-payment references previously produced a second receipt and reused a payment ID. Same-school repeated references are now rejected, and payment IDs advance from the payment collection. The in-memory school-archive suite passed 32/32 tests; `npm run build` passed; `git diff --check` exited 0. No pricing, school, or audit JSON data was changed.

Not live-verified: Firebase/Firestore/Auth, R2 photo upload/retrieval, Paystack, Render, cross-process payment idempotency, and production tenant isolation. No credentials or live records were accessed. Next action: obtain explicit approval and an existing dedicated non-production test tenant/environment, then execute one controlled end-to-end client workflow smoke. Do not create accounts/schools or initiate payment without authorization.

## Safe Client-Readiness Smoke Check 2026-10-18
- No explicit approval or already-existing dedicated non-production tenant/environment is evidenced by this checkout. No external endpoint or credential was inspected or contacted; no tenant/account or payment was created.
- Local test batch: 12/13 suites passed (120/121 tests). The sole failure is a stale source-string assertion in `tests/frontend-login-experience.test.js` for `remoteUrl`; current source uses `uploadedPhoto.url` and persists `uploadedPhoto.path`. Other selected auth/role/session, file route, fee, subscription, logout, and navigation assertions passed. Exact command and full result are recorded in `WORKLOG.md`.
- `npm run build` passed. `git diff --check` exited 0 with existing Windows JSON line-ending warnings. Protected school/audit JSON numstats stayed at 8/8 and 104/89.
- External smoke items still open: deployed login/roles and logout/session revocation; cross-tenant read/write; student/teacher management persistence; authenticated photo upload/retrieval; fee persistence and duplicate behavior on the approved active adapter; and payment-provider-backed expiry/renewal consistency.
- Fee duplicate-reference implementation is sequential, not concurrency-safe. Firebase document `set`, Prisma tenant `update`, and fallback JSON aggregate writes do not atomically combine reference checking, ID allocation, and recording. Do not represent this as idempotent under concurrent requests. Evaluate an adapter-native transaction plus unique school/reference key (Firestore deterministic document + transaction; Prisma unique constraint + transaction). JSON fallback can only use a process-local guard and cannot guarantee multi-process uniqueness.
- Next action: secure explicit approval and identify an existing isolated non-production environment; then run the synthetic, reversible workflow smoke. No creation of test accounts/schools, real payment, production mutation, commit, push, or deployment is authorized here.

## Follow-Up Findings 2026-10-18
- Failing test confirmed stale: update its exact-string expectations from `remoteUrl` to `uploadedPhoto.url` and assert `uploadedPhoto.path` is persisted. This is test-only; current app behavior is internally consistent with the stable photo-path design.
- Production is code-configured to use Firebase. Fee-reference checking and ID allocation must be moved into a Firestore transaction on the tenant document before claiming concurrency safety. Current Prisma schema has neither fee fields nor payment model; add normalized reference uniqueness and transaction-backed identifiers before treating Prisma as supported. JSON fallback is not safe across multiple processes.
- Before any external smoke, obtain approval naming the existing non-production project/tenant(s), app endpoint, test bucket, pre-provisioned role accounts, allowed reversible mutations and cleanup owner, and Paystack test-mode transaction procedure. Do not request or expose credentials; use approved secret management. No external check is authorized by this finding alone.

## Firebase Fee Concurrency 2026-10-18
- [x] Firebase fee reference validation, ID allocation, and payment/receipt append now run in one tenant-document Firestore transaction; blank references remain allowed.
- [x] Mock-backed focused tests: 5/5 pass for sequential duplicate, concurrent duplicate retry, unique concurrent IDs, distinct sequential IDs, and blank-reference cash payments. Existing school-archive suite passes in combined run: 2 suites / 37 tests.
- [x] `npm run build` passed; `git diff --check` exited 0 with existing Windows JSON line-ending warnings.
- [ ] Validate Firestore transaction behavior in a local emulator or approved non-production Firebase project before external release. Repository emulator config and Firebase CLI exist, but local run is currently blocked by missing Java, emulator artifact, and `FIRESTORE_EMULATOR_HOST`; no service was started or contacted.
- [ ] Monitor/revisit tenant document size: this minimal change preserves payment/receipt arrays embedded in the Firestore tenant document, which remains subject to Firestore's document-size limit.
- Prisma and JSON paths were not changed and must not be described as concurrency-safe.
- Review rerun: focused Firebase fee plus school-archive tests passed 2 suites / 37 tests; `git diff --check` exited 0. Transaction errors are propagated unchanged by the controller. Emulator/live Firestore behavior and tenant-document size headroom remain open risks.
- Emulator readiness check: `firebase.json` defines Firestore on port 8080 and CLI 15.28.0 is present; root lockfile has rules-unit-testing but no firebase-tools dependency. Current machine has no Java on PATH, no emulator artifact in checked standard caches, no `FIRESTORE_EMULATOR_HOST`, and no port-8080 listener. Obtain approval for a compatible local Java runtime and CLI emulator-artifact download, then run only against the existing demo project ID. No production credentials are needed for that local path.

## Phase 1 Application Audit 2026-10-18
- [ ] Scope report cards in student and teacher school-detail projections; add cross-student disclosure regressions.
- [ ] Restrict generic School Authority/School Head school updates so payments/receipts cannot bypass the validated fee endpoint.
- [ ] Require both assigned student and authorized class for teacher exam-result writes.
- [ ] Implement Firebase-backed password change/reset/recovery for production; verify reset-required users can complete first login.
- [ ] Add Firebase persistence or explicit production unavailability for assignments, lessons, and messaging; current services use disabled JSON fallback.
- [ ] Reject expired assignment submissions using server time; ignore caller-provided `submittedAt`.
- [ ] Enforce maintenance mode server-side while preserving Super Admin emergency access.
- [ ] Align School Authority attendance action with backend policy; current generic PUT is rejected for this role.
- [ ] Route all payment UI entry points through the dedicated fee endpoint; generic array updates bypass duplicate/receipt validation.
- Audit evidence: safe local/mock batch passed 12 suites / 107 tests; no app code changed. Full suite and file-mutating fallback academic/workspace tests were not run. No Firebase emulator, external service, secret, production data, or payment was accessed.
