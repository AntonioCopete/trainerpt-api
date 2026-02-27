-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('trainer', 'member');

-- CreateEnum
CREATE TYPE "AssignmentStatus" AS ENUM ('pending', 'completed', 'archived');

-- CreateEnum
CREATE TYPE "RepeatCadence" AS ENUM ('none', 'weekly', 'monthly');

-- CreateEnum
CREATE TYPE "TrainerInviteStatus" AS ENUM ('pending', 'accepted', 'cancelled', 'expired');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "fullName" VARCHAR(255),
    "role" "UserRole",
    "avatarUrl" VARCHAR(1024),
    "auth_provider" VARCHAR(50) NOT NULL,
    "deleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainerInvite" (
    "id" UUID NOT NULL,
    "trainerId" UUID NOT NULL,
    "memberId" UUID,
    "email" VARCHAR(255),
    "code" VARCHAR(32) NOT NULL,
    "status" "TrainerInviteStatus" NOT NULL DEFAULT 'pending',
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedAt" TIMESTAMP(3),

    CONSTRAINT "TrainerInvite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainerMemberLink" (
    "id" UUID NOT NULL,
    "trainerId" UUID NOT NULL,
    "memberId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrainerMemberLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FormTemplate" (
    "id" UUID NOT NULL,
    "trainerId" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "description" VARCHAR(256) NOT NULL,
    "schema" JSONB NOT NULL,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FormTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FormAssignment" (
    "id" UUID NOT NULL,
    "trainerId" UUID NOT NULL,
    "memberId" UUID NOT NULL,
    "templateId" UUID,
    "schemaSnapshot" JSONB NOT NULL,
    "status" "AssignmentStatus" NOT NULL DEFAULT 'pending',
    "dueAt" TIMESTAMP(3),
    "repeat" "RepeatCadence" NOT NULL DEFAULT 'none',
    "nextDueAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FormAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FormResponse" (
    "id" UUID NOT NULL,
    "assignmentId" UUID NOT NULL,
    "memberId" UUID NOT NULL,
    "answers" JSONB NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FormResponse_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_id_idx" ON "User"("id");

-- CreateIndex
CREATE UNIQUE INDEX "TrainerInvite_code_key" ON "TrainerInvite"("code");

-- CreateIndex
CREATE INDEX "TrainerInvite_trainerId_status_idx" ON "TrainerInvite"("trainerId", "status");

-- CreateIndex
CREATE INDEX "TrainerInvite_email_status_idx" ON "TrainerInvite"("email", "status");

-- CreateIndex
CREATE INDEX "TrainerMemberLink_trainerId_idx" ON "TrainerMemberLink"("trainerId");

-- CreateIndex
CREATE INDEX "TrainerMemberLink_memberId_idx" ON "TrainerMemberLink"("memberId");

-- CreateIndex
CREATE UNIQUE INDEX "TrainerMemberLink_trainerId_memberId_key" ON "TrainerMemberLink"("trainerId", "memberId");

-- CreateIndex
CREATE INDEX "FormTemplate_trainerId_isArchived_idx" ON "FormTemplate"("trainerId", "isArchived");

-- CreateIndex
CREATE INDEX "FormTemplate_trainerId_idx" ON "FormTemplate"("trainerId");

-- CreateIndex
CREATE UNIQUE INDEX "FormTemplate_trainerId_name_key" ON "FormTemplate"("trainerId", "name");

-- CreateIndex
CREATE INDEX "FormAssignment_memberId_status_idx" ON "FormAssignment"("memberId", "status");

-- CreateIndex
CREATE INDEX "FormAssignment_trainerId_createdAt_idx" ON "FormAssignment"("trainerId", "createdAt");

-- CreateIndex
CREATE INDEX "FormAssignment_templateId_idx" ON "FormAssignment"("templateId");

-- CreateIndex
CREATE INDEX "FormResponse_assignmentId_submittedAt_idx" ON "FormResponse"("assignmentId", "submittedAt");

-- CreateIndex
CREATE INDEX "FormResponse_memberId_submittedAt_idx" ON "FormResponse"("memberId", "submittedAt");

-- AddForeignKey
ALTER TABLE "TrainerInvite" ADD CONSTRAINT "TrainerInvite_trainerId_fkey" FOREIGN KEY ("trainerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainerInvite" ADD CONSTRAINT "TrainerInvite_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainerMemberLink" ADD CONSTRAINT "TrainerMemberLink_trainerId_fkey" FOREIGN KEY ("trainerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainerMemberLink" ADD CONSTRAINT "TrainerMemberLink_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormTemplate" ADD CONSTRAINT "FormTemplate_trainerId_fkey" FOREIGN KEY ("trainerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormAssignment" ADD CONSTRAINT "FormAssignment_trainerId_fkey" FOREIGN KEY ("trainerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormAssignment" ADD CONSTRAINT "FormAssignment_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormAssignment" ADD CONSTRAINT "FormAssignment_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "FormTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormResponse" ADD CONSTRAINT "FormResponse_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "FormAssignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormResponse" ADD CONSTRAINT "FormResponse_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
