# Roadmap

## Release-preparation update — 2026-10-31

Teacher exam-result scope and isolated QA/Firebase boundaries are locally addressed and covered by focused tests. Production readiness still depends on a reviewed safe release contents list, remaining targeted/full regression checks, and approved Render/Firebase/R2/Paystack, backup, and rollback verification.

## Release gate — 2026-10-23 (historical snapshot)

The latest assessment is **NOT READY for deployment**. This checkpoint supersedes older local-completion claims where current code or current verification differs.

1. **P0 — Teacher assessment data scope: CLOSED LOCALLY (2026-10-31).** `getTeacherSchoolView` now requires an authorized student/class scope as well as an assigned subject; focused regressions cover out-of-scope students, classes, and subjects. Production behavior remains unverified.
2. **P0 — Reconcile protected local data and release contents.** The current uncommitted diff includes 1,302 added / 89 deleted audit-log lines and 8 added / 8 deleted school-data lines. Contents were intentionally not read. Have the owner explain and approve these local-data changes before packaging; do not reset or overwrite them.
3. **P0 — Obtain approved deployment evidence.** Verify Firebase Auth/Firestore, R2, Paystack test-mode workflow, Render configuration, production domain/TLS, monitoring, backup/restore, and rollback in an approved non-production setup. No live check was performed in this assessment.
4. **P1 — Repair photo persistence before relying on profile images.** Persist the uploaded tenant-relative object path, refresh signed URLs at display time, enforce identity/role scope for photo access, and implement safe replacement/removal cleanup. The current upload helper ignores the returned path; the API caps signed URLs at one hour.
5. **P1 — Resolve profile identity behavior.** Teacher email is editable through profile UI, but the corresponding Firebase Auth identity update and verification path was not found. Either make it immutable in profile editing or define a safe verified identity-change workflow.
6. **P1 — Restore a safe, current build/test gate.** Current syntax checks and `git diff --check` passed. The selected Jest batch stalled and revealed stale source assertions; full tests are not verified. The existing build script removes `dist` before rebuilding, and `dist` already exists, so do not run it until the user approves replacing that output or the build can be isolated safely.

Profile editing and image upload remain partial and are not, by themselves, assumed to block a release if explicitly excluded. Protected-data review and missing deployment integration evidence still block a production-readiness assessment.

Effort estimates are local engineering estimates, not commitments. Order respects the requested mobile recovery first, then the release-critical subscription finding. Do not access live credentials or data without approved operational conditions.

## P0: Continue from Recovery Checkpoint

### 1. Finish School Authority mobile usability — COMPLETE LOCALLY (2026-10-17)
Evidence: shared responsive shell/drawer, responsive dashboard spacing, and horizontally scrollable student/teacher tables. Focused tests pass; built app was checked at 390x844, 768x1024, and 1280x800. Drawer open/close, background inertness, Tab wrapping, Escape, focus restoration, and Students route were exercised. No horizontal page overflow was observed.
Dependencies/blockers: production/device QA remains pending; browser preview used a static server, so API requests returned expected 404s and no live data was checked.
Acceptance: local behavior and layout acceptance met. Keep production verification on release checklist.

### 2. Enforce paid subscription expiry — COMPLETE LOCALLY (2026-10-17)
Evidence: `resolveSchoolLifecycleStatus` derives `expired` from elapsed tenant `expiresAt`, even when tenant `subscriptionStatus` remains `active`; shared tenant middleware denies school API and file upload/retrieval. Future-dated paid plans remain allowed. Renewal login remains available while protected school/file access is denied. Regressions cover data preservation, payment outcomes, renewal, and operational suspension.
Source of truth: tenant operational status, subscription status, and `expiresAt` determine access. Separate Firebase `subscriptions` docs are written on activation but have no authorization or dashboard readers; stale status there cannot grant access. No migration or mass rewrite is needed.
Dependencies/blockers: production validation remains pending. Super Admin activation is operational-only and does not renew a plan.
Acceptance: local effective access and displayed tenant status meet criteria. Live behavior remains under roadmap item 12.

### 3. Build/test/review gate — COMPLETE LOCALLY (2026-10-17)
Evidence: seven focused suites passed (89 tests), `npm run build` succeeded, and `git diff --check` exited 0. Existing JSON line-ending warnings remain. The full suite was not run.
Dependencies: approved non-production Firebase/Firestore and Paystack test environment for live-path verification.
Acceptance: local targeted gates pass; worktree remains user-modified and must be reviewed without discarding changes.

## P1: Client Workflow Readiness

### 4. Photo upload and retrieval — PARTIAL (2026-10-23 reassessment)
Evidence: profile gallery/camera UI, tenant-scoped upload route, size/type validation, and mocked route tests exist. The current frontend helper discards the stable tenant-relative path returned by upload and persists only the signed URL; `/files` caps URL lifetime at 3,600 seconds. Current frontend refresh from a persisted path and old-object cleanup were not found. Older local tests/build results are historical and do not verify the current upload-to-display flow.
Dependencies/blockers: production R2 configuration and an approved test account/bucket for live verification; credentials are not to be requested or exposed here. Stable-path persistence, authorized refresh, and replacement/removal cleanup need implementation or explicit release exclusion.
Acceptance: current frontend regression proves path persistence and signed-URL refresh at display time; replacement/removal does not expose other users' files or orphan old objects; approved live test proves retrieval. Record mocked versus live distinctly.

### 5. Permanent school deletion protection — COMPLETE LOCALLY (2026-10-17; live destructive check blocked)
Evidence: Super Admin endpoint requires archived target; Firebase root/subcollection checks, fallback dependency checks, mocked Prisma tenant counts, Prisma foreign-key rejection, and controller/audit behavior are covered. Focused deletion batch passed 3 suites / 51 tests. The Prisma empty-tenant case uses mocks only; no school record was deleted.
Dependencies/blockers: no real deletion without explicit approval and a dedicated test school; never use the two prohibited schools.
Acceptance: local tests cover non-archived refusal, dependency refusal, empty archived fixture deletion, audit behavior, and tenant/data-store adapters. Met locally. Live destructive behavior remains unverified unless separately approved.

### 6. Dashboard headers, profile/account actions, responsive navigation — COMPLETE LOCALLY (2026-10-17; backend/live behavior pending)
Evidence: all four roles render the expected shared shell at 390px and 1280px without horizontal overflow. Profile/settings routes and menu expansion were checked. Help/messages/notifications/logout routes were not all exercised; API-backed actions remain unverified.
Dependencies/blockers: local static preview has no backend; use role-safe mocked APIs or dedicated browser tests for remaining actions.
Acceptance: four-role local shell checks pass; notifications/messages/help/profile/settings resolve to the expected role route; mocked logout clears local auth and selects the appropriate login portal. Backend-backed actions and production device QA remain outstanding.

### 7. Loading, error, and duplicate-submission handling — PARTIAL (critical local cases covered; 2026-10-18)
Evidence: admin school create/edit/reset forms use a form-scoped busy guard and aria-busy state. The generic finance modal blocks concurrent submit events. Backend `createFeePayment` rejects repeated nonblank references and generates payment IDs from payment IDs. The Firebase path now performs duplicate detection, ID/receipt allocation, and both appends in one tenant-document transaction. Mock regressions verify same-reference concurrent rejection and distinct-reference concurrent ID allocation after retries. Prisma/JSON paths remain unchanged.
Dependencies/blockers: Firebase emulator and live persistence semantics remain unverified; tenant-embedded arrays remain subject to Firestore document-size limits. Prisma/JSON concurrency is not proven and is not claimed safe. Preserve backend-authoritative payment validation.
Acceptance: Firebase transaction logic locally prevents concurrent duplicate recording and lost array updates under the conflict/retry mock; distinct payments receive unique IDs. Broader upload/save error and duplicate-submission handling remains unverified.

### 8. Accessible interaction audit — PARTIAL (30-60 min)
Evidence: some ARIA labels, expanded states, focus states and 44px touch targets exist.
Dependencies/blockers: shared shell mobile work.
Acceptance: interactive controls work by keyboard and touch, focus is visible and sensibly managed, drawer/menu close behavior is predictable, and responsive touch targets meet the local design standard.

### 9. Super Admin metrics and tenant-scoped counts — COMPLETE LOCALLY (2026-10-17)
Evidence: role records use populated student/teacher aggregates with user-role fallback when empty; duplicate sources are not summed; archived entries are excluded. Firebase, fallback, and Prisma summary tests cover expected school-scoped totals. Prisma query now includes nested role records.
Dependencies/blockers: production database aggregate behavior remains unverified.
Acceptance: local fixture criteria pass. Live aggregate comparison remains a release checklist item.

### 10. Consolidated subscription/pricing management — PARTIAL (30-60 min)
Evidence: “Plans & subscriptions” renderer and legacy subscriptions route are wired; source assertion exists.
Dependencies/blockers: backend pricing APIs and admin authorization.
Acceptance: one admin workflow reads/updates authoritative pricing, legacy route remains functional, access is Super Admin-only, errors/loading are visible, and API/UI behavior has tests.

### 11. Paystack-only provider UI — COMPLETE LOCALLY, live integration unverified (10-20 min)
Evidence: UI filters provider configuration to Paystack; backend integration remains.
Dependencies/blockers: live credentials/webhook and explicit release approval.
Acceptance: no unsupported provider can be selected; tests confirm Paystack UI and backend flow; never run a real charge during local verification.

### 12. Subscription lifecycle and payment integrity — PARTIAL (local policy/tests complete; live verification blocked)
Evidence: backend validates plan amount, reference, amount, currency, tenant, plan metadata, webhook signature, and idempotent activation. Tenant `expiresAt` controls paid expiry; school/file access denies expired or suspended tenants. Pending/failed payments do not activate. Unknown and cross-school references are rejected before Paystack verification. Verified renewal updates entitlement; payment does not lift operational suspension. If a trusted activation delivery fails after marking payment activated, a duplicate now replays the idempotent subscription/tenant writes rather than returning early. Persisted expired paid tenants may authenticate for renewal; expired trials and operational suspension remain blocked. School roles cannot edit subscription lifecycle fields through generic school update.
Source-of-truth decision: tenant operational/subscription fields determine access. Separate Firebase `subscriptions` documents are written on verified activation but have no authorization readers; stale `active` values are non-authoritative. No expiry migration or mass update is required.
Dependencies/blockers: no approved non-production Firebase/Firestore project or Paystack test-mode setup was provided. No live credentials were inspected and no external call, payment, or mutation was attempted.
Acceptance: local lifecycle policy and regressions pass: 7 focused suites / 93 tests, production build, and `git diff --check`. Live expiry, renewal, and persisted cross-record consistency still require an explicitly approved isolated non-production run before release. Precise next action: obtain that approval/environment, execute one fixture-only expired-tenant renewal, and verify the tenant entitlement plus matching payment/subscription records.

### 13. Documentation and release notes — PARTIAL (30-60 min)
Evidence: the project-progress folder exists and is being established as the status source; historical docs contain stale claims.
Dependencies/blockers: verified implementation and release scope.
Acceptance: status/roadmap/worklog/checklist match actual code and results; update changelog/release notes only for verified, approved release content; no claim is based solely on older documentation.

## P2: Production Gate (External; not safely finishable from this local audit alone)

### 14. Production configuration, deployment, smoke and rollback — BLOCKED (external operations)
Dependencies: approved production owner, deployment access, verified Firebase/Firestore/Auth/Storage configuration, R2 and Paystack secrets in the production secret store, domain/TLS, monitoring, approved test tenant, rollback procedure.
Acceptance: configuration verified without exposing secrets; deployment and HTTPS smoke tests succeed; role/tenant isolation and payment webhook are checked in approved test mode; rollback is documented and tested; release explicitly approved. No commit, push, deploy, or live destructive action is authorized by this roadmap.

Client-readiness audit (2026-10-18): one confirmed finance-integrity defect was fixed locally. Registration/login, role checks, tenant-scoped school/file gates, student/teacher profile flows, and core school entity rules were inspected alongside existing tests; no additional local defect was confirmed in this bounded pass. Live Firebase, R2, Paystack, Render, and cross-process payment idempotency remain unverified. Next action: secure explicit approval and an existing dedicated non-production tenant/environment, then execute a fixture-only end-to-end client smoke without creating accounts/schools or initiating charges absent approval.

Client-readiness smoke check (2026-10-18): no approved existing dedicated non-production environment is evidenced in this checkout, so no external requests or mutations were attempted. Local selected tests produced 12 passing suites / 120 passing tests and one failure in `tests/frontend-login-experience.test.js`: a stale exact-string assertion expects `remoteUrl`; the current upload handler persists `uploadedPhoto.url` and `uploadedPhoto.path`. Production build passed; `git diff --check` exited 0 with existing JSON line-ending warnings. Protected school/audit data remained at 8/8 and 104/89 numstats. Fee-reference duplicate rejection remains sequential only: the Firebase aggregate write, Prisma tenant update, and JSON fallback have no atomic uniqueness guarantee in this path. Keep the task blocked on explicit approval plus identification of an already-existing isolated test tenant/environment; do not create one. Afterward execute only synthetic, reversible role/isolation, management, photo, fee, expiry/renewal, and logout checks.

Follow-up verification (2026-10-18): the failing login-experience assertion is confirmed stale against `main.js`; smallest safe test-only edit is to expect `uploadedPhoto.url` for the local-storage and `profilePhoto` assertions and additionally assert `profilePhotoPath: uploadedPhoto.path`. Production mode is code-enforced as Firebase. For fee references and sequential IDs, use one Firestore transaction on the tenant document so both competing requests conflict/retry and duplicate-reference rejection plus allocation happen against fresh arrays; no external transaction test is authorized until the non-production setup is approved. Prisma has no fee-payment schema fields/model and must not be considered a supported fee-persistence adapter until schema, uniqueness, and transaction handling are added. Fallback JSON serialization would protect one process only.

Firebase fee concurrency fix (2026-10-18): production Firebase fee recording now runs the duplicate-reference check, payment/receipt ID allocation, and both tenant-array appends within one Firestore transaction. Five focused mock regressions passed, including simulated competing commits, retry, duplicate rejection, unique payment IDs, and blank cash references; the existing school-archive suite also passed (2 suites / 37 tests combined). Build and `git diff --check` passed. `firebase.json` configures the Firestore emulator and Firebase CLI 15.28.0 is installed, but emulator execution is not ready locally: Java is absent from PATH, no cached emulator artifact was found in checked standard locations, the emulator host is unset, and port 8080 is not listening. No emulator was started and no Firebase project was contacted. Tenant-embedded payment history still has Firestore document-size limits; Prisma and JSON branches remain unchanged and are not claimed concurrency-safe.

## Phase 1 Audit Priorities 2026-10-18
1. Prevent report-card disclosure by scoping both student and teacher detail projections; add unit and route assertions using two synthetic students.
2. Close School Authority/School Head generic-write bypasses for payments/receipts and require teacher exam results to match the same authorized student and class; test mismatched pairs and verify no persisted mutation.
3. Add Firebase-backed password change/reset/recovery because production disables Prisma; preserve current reset-required middleware and Firestore session revocation behavior.
4. Implement/explicitly gate production assignment, lesson, and message persistence instead of calling disabled JSON fallback; retain current recipient authorization and do not redesign messaging.
5. Enforce deadlines server-side using server time, ignore client `submittedAt`, and reject late submissions; test exact deadline boundary and late requests.
6. Make maintenance mode authoritative in backend middleware with an explicit Super Admin/recovery allow path; test blocked roles and recovery access.
7. Align School Authority attendance UI with controller policy, and route every payment UI action through the validated fee endpoint.

Evidence: read-only Phase 1 source audit plus 12 safe local/mock suites / 107 tests passed. No production integration or fallback file-mutating academic suites were run. Highest-priority first fix is report-card projection scoping.
