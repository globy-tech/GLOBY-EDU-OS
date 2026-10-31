# Remaining Deployment Checklist

Evidence updated after reviewing the local `backend/.env` without displaying secret values. It is a development configuration (`NODE_ENV=development`, `APP_URL=http://localhost:4000`); its credentials do not establish what is configured in the production host. Production Firebase, Paystack, DNS/TLS, and deployment status require verification in the respective provider consoles.

| # | Area | Status | Evidence / remaining work |
|---:|---|---|---|
| 1 | Firebase configuration | PARTIAL | Local development has `DATA_STORE_MODE=firebase`, a project ID, public web config, and Firebase Admin service-account fields configured. Production-host values and connectivity are not verified. |
| 2 | Firebase Authentication | BLOCKED | Login and token verification paths are implemented. The local Firebase project configuration is present, but production Auth settings and deployed behavior have not been verified. |
| 3 | Firestore | BLOCKED | Local Firebase data mode and Admin credentials are configured, but production Firestore access, rules, indexes, and persistence have not been verified. |
| 4 | Firebase Storage | BLOCKED | Local Firebase Admin fields are configured, but the production bucket, permissions, and deployed Storage behavior have not been verified. |
| 5 | Google Sign-In | BLOCKED | The optional tenant-scoped Google flow is implemented, but the actual Firebase provider and production Auth configuration are not available for live verification. |
| 6 | Super Admin authentication | PASS | Separate password login route and role enforcement are implemented and covered by existing tests. Google is not exposed from the dedicated Super Admin page. |
| 7 | School Authority authentication | PASS | School ID + email + password contract is implemented and covered by auth tests. |
| 8 | Teacher authentication | PASS | School ID + Teacher ID + password contract is implemented and covered by tenant-scoped auth tests. |
| 9 | Student authentication | PASS | School ID + Student ID + password contract is implemented; normal login does not require name/class/email and is covered by tests. |
| 10 | Password reset/recovery | BLOCKED | Reset/change flows exist, but neither Brevo nor Resend is configured locally, and production email delivery has not been verified. Signup currently rolls back when verification mail cannot be delivered. |
| 11 | Temporary passwords/forced change | PASS | Signed reset flag, forced-change middleware, and focused security tests pass. |
| 12 | Session persistence | PARTIAL | JWT/refresh rotation and frontend remember/session state exist; fallback sessions are not persisted and browser QA is pending. |
| 13 | Cookies | PARTIAL | Refresh tokens are now issued through an HttpOnly cookie with production Secure/SameSite settings and frontend credentialed requests; HTTPS browser verification and migration away from response-body compatibility tokens remain. |
| 14 | JWT/refresh-token security | PARTIAL | Signed access tokens, expiry, rotation, authenticated logout, hashed/revoked Prisma refresh tokens, and cookie delivery exist; Firebase-mode refresh persistence and full browser/session verification remain. |
| 15 | CORS | PARTIAL | Allowlist and credentials are configured; production origin configuration remains external/manual and secure-header coverage is limited. |
| 16 | Rate limiting | PASS | Login rate limiting is implemented and covered by focused tests. |
| 17 | Tenant isolation | PASS | Tenant middleware, Firebase Google matching, Firebase claims, and service authorization reject cross-school access; automated workspace/auth tests pass. |
| 18 | Role authorization | PASS | Backend role middleware and service-level role checks exist and are tested. |
| 19 | Audit/login activity | PASS | Login, password, lifecycle, and management audit paths exist; audit integration tests pass. |
| 20 | Secrets/environment variables | BLOCKED | Local development contains Firebase Admin and Paystack fields, and the public Paystack key is live-prefixed, but `APP_URL` is localhost. No transactional email provider is configured. Production-host secrets and values remain unverified and must be managed in the host, not copied from the local file. |
| 21 | Privacy Policy | PASS | Public page exists and is linked; this is a verified local/static legal page. |
| 22 | Terms of Service | PASS | Public page exists and is valid for the current local app state. |
| 23 | Cookie Policy | PASS | Public page exists and reflects the current local session/cookie model. |
| 24 | Payment & Refund Policy | PASS | Public page exists with the current refund rules and acceptance flow. |
| 25 | Paystack | PARTIAL | Local environment has Paystack public, secret, and webhook fields configured; the public key is live-prefixed. This does not confirm that production-host keys match, that a live webhook is registered, or that live payment flows work. |
| 26 | Production domain/subdomains | BLOCKED | The app routes are prepared for subdomain handling, but the live `globyedu.com`, `admin.globyedu.com`, `api.globyedu.com`, and school subdomain environment is not configured here. |
| 27 | Production deployment | BLOCKED | Local build and code verification are green, but live deployment requires real Firebase, Paystack, domain, and HTTPS configuration outside this workspace. |
| 28 | Local browser QA | PASS | Local app routes and core pages were verified in the VS Code browser without console or network errors. |
| 29 | Final production browser QA | BLOCKED | Requires the real production deployment and live credentials before it can be considered valid. |

## Code-complete in repository (verified logic, not live deployment)

| Area | Status | Notes |
|---|---|---|
| Authentication | PASS | Role-scoped school/teacher/student auth and forced reset flows are implemented and tested. |
| Tenant isolation | PASS | School data and access checks remain scoped to the correct tenant and role. |
| Pricing authority | PASS | Backend pricing plan selection is authoritative and ignores a client-provided amount. |
| Paystack checkout init | PASS | Backend initializes Paystack from server-side pricing and amount calculation. |
| Payment verification logic | PASS | Payment verification validates reference, amount, currency, tenant, and plan metadata. |
| Webhook signature validation | PASS | Invalid signatures are rejected and duplicate success events do not create duplicate subscriptions. |
| Refund policy recording | PASS | Out-of-window refund requests are recorded with a rejected decision rather than a fake processed refund. |
| Build | PASS | Production frontend build succeeds. |
| Local browser QA | PASS | Home, login, and legal/privacy routing were verified in the VS Code integrated browser with no console or request failures. |

## Requires real production credentials / deployment

| Area | Status | Notes |
|---|---|---|
| Firebase production config | BLOCKED | Local Admin fields and `DATA_STORE_MODE=firebase` are configured, but production-host values, service-account permissions, and deployed data access are not verified. |
| Firestore persistence | BLOCKED | Local Firebase configuration is present; production Firestore permissions, rules, indexes, and persistent reads/writes remain unverified. |
| Firebase Storage | BLOCKED | Local Admin fields are present; production bucket identity, permissions, and upload/retrieval remain unverified. |
| Firebase Auth | BLOCKED | Local Firebase project configuration is present; production Auth provider settings and deployed sign-in/verification behavior remain unverified. |
| Google Sign-In | BLOCKED | Provider configuration remains external to this workspace and is not production-verified. |
| Paystack live credentials | BLOCKED | Local Paystack fields are configured, and the public key is live-prefixed; production-host values are not accessible/verified from this workspace. |
| Paystack checkout live verification | BLOCKED | Real backend-to-Paystack initialization cannot be proven without live credentials and HTTPS deployment. |
| Paystack webhook live verification | BLOCKED | Production webhook URL, HTTPS reachability, and live signature secret are still required. |
| Subscription activation in production | BLOCKED | Live activation must be confirmed against the real deployed environment. |
| Refund automation | BLOCKED | Real Paystack refund processing is not configured; any live refund must be reviewed by an authorized party. |
| Production domain / HTTPS | BLOCKED | Live DNS, TLS, and HTTP-to-HTTPS enforcement are external deployment prerequisites. |
| Final browser QA | BLOCKED | Requires running production deployment and browser/device verification against live hosts. |

## Quick deployment checklist (current status)

| Area | Status | Notes |
|---|---|---|
| Google Sign-In | PARTIAL | Optional tenant-scoped login exists; live provider configuration is not production-verified. |
| Authentication | PASS | Role-scoped school/teacher/student auth and forced reset flows are implemented and tested. |
| Cookies | PARTIAL | HttpOnly refresh cookie flow exists; HTTPS/browser verification and live cookie migration remain. |
| Privacy Policy | PARTIAL | Public page exists and is linked; legal review and live policy versioning remain. |
| Terms | PARTIAL | Public page exists; professional legal review remains. |
| Cookie Policy | PARTIAL | Policy page exists; browser verification is pending. |
| Payment & Refund Policy | PARTIAL | Policy exists with the 14-day rule and review model; refund workflow is recorded but live refund processing is not configured. |
| Paystack Checkout | PARTIAL | Backend-authoritative checkout is implemented and uses current pricing; live credential verification is still required. |
| Payment Verification | PARTIAL | Server-side verification is implemented; live Paystack verification against production credentials remains pending. |
| Paystack Webhook | PARTIAL | Signature validation and duplicate protection are present; webhook secret and live deployment verification still remain. |
| Subscription Activation | PARTIAL | Verified payments activate the school subscription in the backend; live production activation remains unverified. |
| Refund Workflow | PARTIAL | Request recording and out-of-window rejection are implemented; admin processing and automated Paystack refund integration are not live-configured. |
| Production Domain | PARTIAL | Domain setup and TLS are outside this workspace; live DNS verification remains. |
| Deployment | BLOCKED | Production deployment and live Firebase/Paystack credentials are not confirmed in this workspace. |
| Final Full-Project QA | BLOCKED | Live browser, auth, payment, and production configuration QA are still required on the real production deployment. |

## Final status report

- Tests: PASS
- Build: PASS
- Local browser QA: PASS (home, login, and core role routes checked in the VS Code browser without console or network errors)
- Local Firebase Admin configuration: PRESENT (values not displayed); local mode is `firebase`
- Production Firebase configuration: UNVERIFIED
- Local Paystack fields: PRESENT (values not displayed); public key is live-prefixed
- Production Paystack credentials and registered webhook: UNVERIFIED
- Transactional email provider: MISSING (signup verification cannot complete)
- Production `APP_URL`: UNVERIFIED; local value points to `http://localhost:4000`
- Production domain / HTTPS: BLOCKED
- Remaining genuine blockers: verify/provision Firebase and Paystack settings in the production host, configure transactional email and a production `APP_URL`, verify DNS/TLS for `globyedu.com` and subdomains, and complete final production browser QA.

## Highest-priority work

1. Verify or configure production Firebase Admin credentials, `DATA_STORE_MODE=firebase`, Firebase Auth settings, Firestore rules/indexes, and Storage bucket permissions in the production host.
2. Verify the production Paystack public/secret/webhook settings and registered webhook before accepting real subscriptions; do not copy local keys blindly.
3. Configure a verified transactional email provider and production `APP_URL`; test verification and password-reset delivery before creating production accounts.
4. Verify DNS/TLS, then complete browser QA for login, checkout, payment verification, policy acceptance, and subscription activation on the real production domain.
5. Confirm refund policy handling with the business owner before enabling any live refund processing or payout automation.
