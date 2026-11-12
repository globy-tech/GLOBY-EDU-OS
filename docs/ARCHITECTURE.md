# Architecture Overview

GlobyEdu OS is a monorepo with a browser-based dashboard, an Express API, and adapters for tenant data. The implementation is incremental: Firebase Core is the production tenant-record path when enabled, Prisma models cover relational school records, and the JSON adapter is restricted to local/QA workflows.

## Request and persistence flow

```text
Browser dashboard
    -> frontend/marketing/src/api/school.js
    -> authenticated Express school routes
    -> tenant middleware (tenant match, lifecycle state)
    -> backend/modules/school/school.service.js
    -> Firebase Core / Prisma / isolated QA JSON adapter
```

School-owned data must stay within the authenticated tenant. The school service applies role and assignment scope to entity lists and teacher workspaces. File uploads additionally bind the file path to a tenant and an authorized record; production uploads use Cloudflare R2.

## Academic records

- Academic years and terms are school-owned records.
- Class identity uses the academic year when available, grade/name, section, and stream. Explicit alias mappings in `Tenant.academicStructure.classAliases` allow a school to map names such as JHS 1 and Basic 7; the application does not globally merge those labels.
- Classes can have multiple teacher IDs. Legacy `teacherId` data remains supported during migration.
- Student creation and class placement use the tenant-scoped student entity endpoint. Teacher access is limited to assigned classes. The class list serves as the roster source for teacher views.
- Academic progression is a separate preview/confirm service. Configured `academicStructure.progressionPaths`, explicit cross-level `progression` mappings, `graduationClasses`, and tenant class aliases determine recommended placement; missing rules require manual placement rather than guessing by numeric grade. Graduation is explicit and is not inferred from the end of a path.
- Promotion, repeat, manual placement, graduation, transfer, and withdrawal update the same student identity. Previous enrollment rows are closed and class/progression snapshots are retained in student metadata; historical attendance and results are left unchanged. Operation IDs and active-enrollment checks make confirmation retry-safe. Firebase Core commits the student, class rosters, and enrollment changes in one Firestore transaction with source-placement and target-enrollment revalidation.
- Attendance is stored with date/class/student identity and correction metadata; teachers may submit for assigned rosters while School Authority reviews the records.

## Deliberate current limits

Persisted holiday/closure declarations and automated attendance-task workflows are not implemented. Historical academic progression is implemented using the existing enrollment and metadata structures; it does not introduce a new Prisma model or migration.

The Prisma class migration adds year/section and multiple-teacher fields but was not applied. Production validation, Firebase/R2 service checks, and any migration rollout require environment-specific approval and an isolated preproduction target.
