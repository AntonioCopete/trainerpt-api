-- AlterEnum
ALTER TYPE "AssignmentStatus" ADD VALUE 'missed';

-- AlterTable
ALTER TABLE "FormAssignment" ADD COLUMN     "parentAssignmentId" UUID,
ADD COLUMN     "windowStart" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "FormAssignment_status_dueAt_idx" ON "FormAssignment"("status", "dueAt");

-- AddForeignKey
ALTER TABLE "FormAssignment" ADD CONSTRAINT "FormAssignment_parentAssignmentId_fkey" FOREIGN KEY ("parentAssignmentId") REFERENCES "FormAssignment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
