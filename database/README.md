# Database and Persistence

The Prisma schema is maintained at `database/prisma/schema.prisma`. Versioned changes live under `database/prisma/migrations/`; the migration directory is the source of truth for relational schema evolution.

The `Tenant` record defines the school boundary. Academic years, terms, classes, and enrollments are tenant-scoped. The class model includes optional academic-year and section values and supports multiple teacher IDs while retaining the legacy single `teacherId`.

The system also has Firebase Core tenant document persistence. Local JSON persistence is a QA/development adapter and must use the configured isolated data-file paths when running in test mode. Never use repository data stores as test fixtures.

The `AdmissionApplication` model stores pending school applications separately from the authoritative student roster. It carries applicant data, decision history, class placement, and same-tenant enrollment metadata, and is validated through the school admissions API before a student record is created or linked.

Academic progression reuses the existing `Enrollment` model and the student `metadata` JSON. Prior enrollment rows are retained with `isCurrent=false` and a terminal/completed status; the current enrollment is created or updated for the target-year class. Class and progression history snapshots remain with the authoritative student record. No additional Prisma schema change or migration is required for promotion, repeat, manual placement, graduation, transfer, or withdrawal.

## Safe schema checks

Set `DATABASE_URL` and `DIRECT_URL` to an isolated non-production database URL (or non-secret placeholder values for schema-only validation) before running:

```text
npx prisma validate --schema database/prisma/schema.prisma
npx prisma migrate status --schema database/prisma/schema.prisma
```

Migration `20261111120000_class_year_and_teacher_assignments` adds class year/section and multi-teacher fields and backfills existing single-teacher assignments. It is prepared but unapplied. Review it and test against an isolated preproduction database before any production rollout. No production migration should be run from a development session.
