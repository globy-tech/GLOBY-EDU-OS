# Migrations

Purpose: Version-controlled Prisma migration files. Keep each migration idempotent and reversible where possible.

Status: Initial schema, pricing, school archival, and school finance migrations are versioned. Do not run a production migration until the target Supabase database is intentionally provisioned and the migration has been reviewed.

Safe preparation commands:

```text
npx prisma validate --schema database/prisma/schema.prisma
npx prisma migrate dev --schema database/prisma/schema.prisma --name initial_schema
```

Never run `prisma migrate reset` against production.
