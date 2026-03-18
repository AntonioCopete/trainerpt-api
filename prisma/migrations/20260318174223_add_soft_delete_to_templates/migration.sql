-- DropIndex
DROP INDEX "FormTemplate_trainerId_isArchived_idx";

-- AlterTable
ALTER TABLE "FormTemplate" ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "FormTemplate_trainerId_isArchived_deletedAt_idx" ON "FormTemplate"("trainerId", "isArchived", "deletedAt");
