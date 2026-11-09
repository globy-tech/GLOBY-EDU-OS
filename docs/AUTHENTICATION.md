# GlobyEdu OS — Authentication & Authorization Overview

This document describes the authentication, multi-tenant, and RBAC architecture implemented in the repository.

Key components
- Backend: Express routes and middleware under `backend/`.
- Production data: Firebase Admin SDK and Firestore; production file storage uses Cloudflare R2.
- Tokens: short-lived JWT access tokens and rotating refresh tokens. Production refresh sessions are stored in Firestore with hashed tokens; the Prisma adapter also stores refresh-token hashes when that adapter is selected.

Flow summary
- Login uses the role-appropriate auth endpoint; the server validates the account and returns an access token and refresh token.
- Protected API requests use the access token. Refresh rotates the refresh token and persists the new hash for revocation.
- Logout revokes the associated session and clears the refresh cookie.
- Password recovery uses a one-time email token.

Multi-tenant
- School records, users, and other tenant data are associated with a school/tenant identifier. Backend authentication and tenant middleware enforce the caller's school scope.

RBAC
- Role checks are enforced by backend authentication and role middleware. Firebase claims and frontend routing alone do not grant platform-admin access.

Security notes
- Passwords are hashed with `bcrypt` (configurable rounds).
- Tokens are signed using secrets from environment variables found in `backend/config/auth.config.js`.
- Transactional email uses Brevo when configured, otherwise Resend. If neither is configured, sending is skipped and reported as a failure.

## Production Configuration

Set production values through the deployment secret manager; do not copy local
credentials. Production requires `NODE_ENV=production`,
`DATA_STORE_MODE=firebase`, `FIREBASE_PROJECT_ID`, and Firebase Admin service
account fields `FIREBASE_CLIENT_EMAIL` plus `FIREBASE_PRIVATE_KEY`, or explicitly
provisioned Application Default Credentials. It also requires distinct,
strong, non-default `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` values and a
canonical HTTPS `APP_URL`.

The browser Firebase configuration (`FIREBASE_API_KEY`, `FIREBASE_AUTH_DOMAIN`,
`FIREBASE_PROJECT_ID`, `FIREBASE_APP_ID`) is public configuration, not an Admin
credential. `CORS_ORIGINS` is needed for browser origins outside the built-in
GlobyEdu domain allowlist. `COOKIE_DOMAIN` is optional; the production refresh
cookie is HttpOnly, Secure, and SameSite=Strict, so the browser app and API must
be same-site.

Production file uploads require `CLOUDFLARE_R2_ACCOUNT_ID`,
`CLOUDFLARE_R2_ENDPOINT`, `CLOUDFLARE_R2_ACCESS_KEY_ID`,
`CLOUDFLARE_R2_SECRET_ACCESS_KEY`, and `CLOUDFLARE_R2_BUCKET`.
`CLOUDFLARE_R2_PUBLIC_URL` is optional because private assets use signed URLs.

Transactional and contact email use the shared provider service. Brevo is first
when `BREVO_API_KEY` and `BREVO_SENDER_EMAIL` are configured; Resend uses
`RESEND_API_KEY` and `RESEND_FROM_EMAIL` as the configured alternative and
fallback for Brevo client rejections, not ambiguous server/network failures.
The Contact form also requires `CONTACT_EMAIL`. Contact requests are limited
in-process to five per client IP per 15 minutes; multi-instance deployments
should add edge-level rate limiting. Provider acceptance does not verify inbox
delivery. The domain owner must provide verified sender identities and DNS
records; none should be invented or committed here.

## Current development login flow

- The marketing SPA keeps the role-selection experience for Super Admin, School Authority, Teacher, and Student.
- Existing development email/password logins use `/api/v1/auth/platform-login` for Super Admin and `/api/v1/auth/school-login` for school users.
- JSON fallback authentication is for local development and isolated QA only; production requires the configured Firebase data store.
- The frontend stores the returned access token for the current development architecture. Passwords are never stored by the frontend.

## Teacher invitations

- The School Authority Teachers section offers an invitation form for Firebase-backed schools. It creates a Firebase Authentication account with a random temporary password and tenant-linked `users` and `teachers` records; the temporary password is never returned to the frontend.
- The setup email contains a Firebase email-verification link and a short-lived, single-use password-setup link. The setup token is stored by hash and bound to the teacher, school, Firebase UID, and email. Resending revokes the previous unused token.
- Invitation state is stored on both tenant-linked records. A successful provider response is recorded as `provider_accepted` with delivery `unconfirmed`; it does not claim that the message reached the recipient. Provider errors are recorded as failed, and the saved account remains available for a safe retry through **Resend invite**.
- Duplicate school emails and emails already present in Firebase Authentication are rejected. Invitation creation and resend are restricted to the authenticated school tenant and School Authority role; cross-tenant operations are rejected.
- Teacher invitations require Firebase-backed school storage. In JSON fallback mode, the dashboard reports that invitations are unavailable and does not send an email. Teacher password sign-in also requires the Firebase authentication path; local JSON QA data alone does not enable it.

## Isolated local QA

- This section is for local development only and is not part of production startup or deployment.
- The tracked `scripts/start-local-qa.ps1` launcher runs the isolated JSON QA server on port 4001. It requires QA data under `%LOCALAPPDATA%\\GlobyEdu-QA` or an explicit `GLOBY_QA_HOME`; provision that data with the repository's existing `npm run qa:provision` command before starting the server.
- The launcher requires data paths inside the external QA home, refuses an occupied port, and clears external Firebase and email configuration for the QA process. Local QA cannot verify real Firebase teacher sign-in or email delivery.
- Do not use repository data or production services for local QA. Do not interpret local QA results as production verification.

## Firebase readiness

- Firebase web configuration is loaded at runtime from `GET /config/firebase.js`, using only public web configuration values.
- Firebase Admin uses `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, and `FIREBASE_PRIVATE_KEY` on the backend only. The private key is never sent to the browser.
- Optional Firebase email/password and Google client helpers already exist in `frontend/marketing/src/firebase/firebase-client.js`; Google sign-in remains opt-in and is not forced into the existing role forms.
- `POST /api/v1/auth/firebase-login` verifies the Firebase ID token server-side, then maps the Firebase email to an existing active server-side user and its stored role. Firebase claims and frontend routes cannot grant Super Admin access.
- Protected API routes continue to use JWT or development mock tokens, and now accept verified Firebase bearer tokens when Firebase Admin is configured.
- The browser Firebase client uses Firebase Authentication only; structured data and files are accessed through backend APIs. `firestore.rules` denies direct client access to private data and `storage.rules` denies direct client access to all Firebase Storage objects. Backend Firebase Admin SDK operations bypass these client rules, while production files use Cloudflare R2.
- Permanent account deletion requires the exact account identifier for Firebase, JSON-fallback, and Prisma storage. Firebase deletion records a retryable Firestore cleanup job before deactivating the account, removing sessions, deleting the Auth identity, and deleting account records. Failures leave the job in progress so an authorized retry can resume. Referenced R2/Firebase Storage objects are retained for every storage provider; deletion responses return the retained file paths, `fileRetentionStatus: "retained_pending_policy"`, and `completeErasure: false`. This describes completed account-record cleanup, not complete data erasure. A data-protection owner must approve a retention period and cleanup process before retained files are removed or complete erasure is claimed.

## One-time production Super Admin bootstrap

The repository does not seed production Super Admins. To initialize the first Firebase-backed platform administrator, provide these backend environment variables through the deployment secret manager or a secured operator shell:

- `DATA_STORE_MODE=firebase`
- `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, and `FIREBASE_PRIVATE_KEY` (or an explicitly provisioned Application Default Credential)
- `INITIAL_SUPER_ADMIN_EMAIL`
- `INITIAL_SUPER_ADMIN_PASSWORD` (at least 12 characters with uppercase, lowercase, number, and symbol)
- `INITIAL_SUPER_ADMIN_BOOTSTRAP_SECRET` (at least 32 characters and different from the password)
- Optional `INITIAL_SUPER_ADMIN_NAME`

After checking that no Super Admin exists, an operator must manually run `npm run bootstrap:super-admin -- --confirm` from the project root. The command is not run at server startup and is not exposed over HTTP. It creates the Firebase Authentication account, assigns `super_admin` claims, writes the matching Firestore user and audit record in a transaction, and removes the Auth account on a failed Firestore commit when cleanup is possible. If rollback cannot be confirmed, it leaves a recovery lock and exits with an error. After successful initialization, remove the bootstrap variables from the environment and rotate/remove the bootstrap secret. The bootstrap cannot be repeated after completion.

For one orphaned platform administrator, the separate `npm run recover:orphaned-super-admin -- --email=admin@example.com --confirm-orphan-recovery` command requires an authorized operator to configure `ORPHANED_SUPER_ADMIN_RECOVERY_SECRET` (at least 32 characters, distinct from the bootstrap secret and administrator password), `INITIAL_SUPER_ADMIN_PASSWORD`, and the Firebase production settings through the deployment secret manager. The email must exactly match the sole existing platform-level Firestore admin record, and the password must verify against its existing hash; recovery never changes that hash. It refuses ambiguous records, tenant-assigned records, conflicting Auth identities, other claimed Super Admins, and replay locks. It updates the existing record, repairs platform claims, writes an audit event, and rolls back or leaves a recovery-required lock on uncertain failures. It is operator-invoked only and is never run at server startup. Do not run it before an authorized operator verifies the target identity.

Copy `.env.example` to `.env` and provide the Firebase values before enabling Firebase authentication. Leave them blank during local fallback development.

Developer notes
- Prisma client is wrapped at `backend/config/prisma.client.js` and gracefully falls back if `@prisma/client` is not installed.
- Migrations are not applied automatically; copy `database/prisma/.env.example` to set up local DB.
