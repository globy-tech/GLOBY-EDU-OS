# GlobyEdu OS — Authentication & Authorization Overview

This document describes the authentication, multi-tenant, and RBAC architecture implemented in the repository.

Key components
- Backend: existing Express server (non-destructive). New auth module under `backend/modules/auth/`.
- Database: Prisma schema located at `database/prisma/schema.prisma` (auth models only).
- Tokens: JWT access tokens + refresh tokens; refresh tokens are stored hashed in the database.

Flow summary
- Login: user submits credentials to `/api/v1/auth/login` -> server validates -> returns `accessToken` and `refreshToken`.
- Access token: short-lived JWT used for protected endpoints.
- Refresh token: long-lived token rotated on use; stored hashed in DB to allow revocation.
- Forgot/Reset: `forgot-password` creates email token; `reset-password` consumes it.

Multi-tenant
- Each `User` references a `Tenant` using `tenantId`. `Tenant` stores `schoolId`, `name`, `timezone`, `branding`, and `status`.

RBAC
- Declarative roles and permissions stored using `Role`, `Permission`, `RolePermission`, and `UserRole` tables.
- Guard middleware `role.middleware.js` provides role checks; `auth.middleware.js` verifies JWTs.

Security notes
- Passwords are hashed with `bcrypt` (configurable rounds).
- Tokens are signed using secrets from environment variables found in `backend/config/auth.config.js`.
- Transactional email uses Brevo when configured, otherwise Resend. If neither is configured, sending is skipped and reported as a failure.

## Current development login flow

- The marketing SPA keeps the role-selection experience for Super Admin, School Authority, Teacher, and Student.
- Existing development email/password logins use `/api/v1/auth/platform-login` for Super Admin and `/api/v1/auth/school-login` for school users.
- The fallback development tenant is persisted in `backend/data/schools.json`; its accounts remain available when Firebase is not configured.
- The frontend stores the returned access token for the current development architecture. Passwords are never stored by the frontend.

## Teacher invitations

- The School Authority Teachers section offers an invitation form for Firebase-backed schools. It creates a Firebase Authentication account with a random temporary password and tenant-linked `users` and `teachers` records; the temporary password is never returned to the frontend.
- The setup email contains a Firebase email-verification link and a short-lived, single-use password-setup link. The setup token is stored by hash and bound to the teacher, school, Firebase UID, and email. Resending revokes the previous unused token.
- Invitation state is stored on both tenant-linked records. A successful provider response is recorded as `provider_accepted` with delivery `unconfirmed`; it does not claim that the message reached the recipient. Provider errors are recorded as failed, and the saved account remains available for a safe retry through **Resend invite**.
- Duplicate school emails and emails already present in Firebase Authentication are rejected. Invitation creation and resend are restricted to the authenticated school tenant and School Authority role; cross-tenant operations are rejected.
- Teacher invitations require Firebase-backed school storage. In JSON fallback mode, invitations are unavailable and no email is sent. Teacher password sign-in requires Firebase authentication.
## Firebase readiness

- Firebase web configuration is loaded at runtime from `GET /config/firebase.js`, using only public web configuration values.
- Firebase Admin uses `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, and `FIREBASE_PRIVATE_KEY` on the backend only. The private key is never sent to the browser.
- Optional Firebase email/password and Google client helpers already exist in `frontend/marketing/src/firebase/firebase-client.js`; Google sign-in remains opt-in and is not forced into the existing role forms.
- `POST /api/v1/auth/firebase-login` verifies the Firebase ID token server-side, then maps the Firebase email to an existing active server-side user and its stored role. Firebase claims and frontend routes cannot grant Super Admin access.
- Protected API routes continue to use JWT or development mock tokens, and now accept verified Firebase bearer tokens when Firebase Admin is configured.

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
