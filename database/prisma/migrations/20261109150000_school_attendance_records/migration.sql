ALTER TABLE "Tenant"
ADD COLUMN IF NOT EXISTS "attendanceRecords" JSONB NOT NULL DEFAULT '[]'::jsonb;
