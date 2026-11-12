ALTER TABLE "Class"
  ADD COLUMN IF NOT EXISTS "section" TEXT,
  ADD COLUMN IF NOT EXISTS "academicYearId" TEXT,
  ADD COLUMN IF NOT EXISTS "teacherIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

UPDATE "Class"
SET "teacherIds" = ARRAY["teacherId"]
WHERE "teacherId" IS NOT NULL
  AND cardinality("teacherIds") = 0;

CREATE INDEX IF NOT EXISTS "Class_tenantId_academicYearId_name_idx"
  ON "Class" ("tenantId", "academicYearId", "name");
