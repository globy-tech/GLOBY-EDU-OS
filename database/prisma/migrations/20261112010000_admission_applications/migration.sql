CREATE TABLE "AdmissionApplication" (
  "id" TEXT NOT NULL,
  "applicationNumber" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "studentData" JSONB NOT NULL,
  "history" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "submittedBy" TEXT,
  "reviewedBy" TEXT,
  "studentId" TEXT,
  "classId" TEXT,
  "academicYearId" TEXT,
  "tenantId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "AdmissionApplication_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AdmissionApplication_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "AdmissionApplication_tenantId_applicationNumber_key"
  ON "AdmissionApplication"("tenantId", "applicationNumber");
CREATE UNIQUE INDEX "AdmissionApplication_tenantId_studentId_key"
  ON "AdmissionApplication"("tenantId", "studentId");
CREATE INDEX "AdmissionApplication_tenantId_status_createdAt_idx"
  ON "AdmissionApplication"("tenantId", "status", "createdAt");
