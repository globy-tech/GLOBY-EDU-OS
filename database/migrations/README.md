# Migrations

Version-controlled Prisma migrations are under `database/prisma/migrations/`. Keep migrations reviewable and safe to validate without connecting to production.

The class year and multiple-teacher assignment migration is `20261111120000_class_year_and_teacher_assignments`. It adds optional `academicYearId` and `section` columns and a `teacherIds` array. Existing `teacherId` values are copied into an empty `teacherIds` array. This migration has not been applied.

Safe schema checks:

```text
npx prisma validate --schema database/prisma/schema.prisma
npx prisma migrate status --schema database/prisma/schema.prisma
```

Run `prisma migrate dev` only with an intentionally provisioned isolated development database. Never run a production migration from this workspace without explicit release-owner review and a tested backup/rollback plan. Never run `prisma migrate reset` against production.
