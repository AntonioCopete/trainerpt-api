-- CreateEnum
CREATE TYPE "RoutineAssignmentStatus" AS ENUM ('scheduled', 'active', 'expired', 'archived');

-- CreateEnum
CREATE TYPE "ExerciseSource" AS ENUM ('wger', 'free_exercise_db', 'custom');

-- CreateTable
CREATE TABLE "RoutineTemplate" (
    "id" UUID NOT NULL,
    "trainerId" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "description" VARCHAR(256) NOT NULL,
    "schema" JSONB NOT NULL,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RoutineTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoutineAssignment" (
    "id" UUID NOT NULL,
    "trainerId" UUID NOT NULL,
    "memberId" UUID NOT NULL,
    "templateId" UUID,
    "schemaSnapshot" JSONB NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "status" "RoutineAssignmentStatus" NOT NULL DEFAULT 'scheduled',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RoutineAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Exercise" (
    "id" UUID NOT NULL,
    "source" "ExerciseSource" NOT NULL,
    "externalId" INTEGER,
    "trainerId" UUID,
    "externalUuid" VARCHAR(64),
    "name" VARCHAR(255) NOT NULL,
    "nameEs" VARCHAR(255),
    "description" JSONB,
    "descriptionEs" JSONB,
    "categoryId" INTEGER,
    "categoryName" VARCHAR(120),
    "categoryNameEs" VARCHAR(120),
    "equipment" JSONB,
    "equipmentEs" JSONB,
    "muscles" JSONB,
    "musclesEs" JSONB,
    "musclesSecondary" JSONB,
    "musclesSecondaryEs" JSONB,
    "images" JSONB,
    "videos" JSONB,
    "license" JSONB,
    "lastUpdateAt" TIMESTAMP(3),
    "lastUpdateGlobal" TIMESTAMP(3),
    "raw" JSONB NOT NULL,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Exercise_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RoutineTemplate_trainerId_isArchived_deletedAt_idx" ON "RoutineTemplate"("trainerId", "isArchived", "deletedAt");

-- CreateIndex
CREATE INDEX "RoutineTemplate_trainerId_idx" ON "RoutineTemplate"("trainerId");

-- CreateIndex
CREATE INDEX "RoutineAssignment_memberId_status_startDate_endDate_idx" ON "RoutineAssignment"("memberId", "status", "startDate", "endDate");

-- CreateIndex
CREATE INDEX "RoutineAssignment_trainerId_memberId_startDate_endDate_idx" ON "RoutineAssignment"("trainerId", "memberId", "startDate", "endDate");

-- CreateIndex
CREATE INDEX "RoutineAssignment_templateId_idx" ON "RoutineAssignment"("templateId");

-- CreateIndex
CREATE INDEX "Exercise_name_idx" ON "Exercise"("name");

-- CreateIndex
CREATE INDEX "Exercise_categoryName_idx" ON "Exercise"("categoryName");

-- CreateIndex
CREATE INDEX "Exercise_trainerId_idx" ON "Exercise"("trainerId");

-- CreateIndex
CREATE INDEX "Exercise_source_externalId_idx" ON "Exercise"("source", "externalId");

-- CreateIndex
CREATE INDEX "Exercise_isArchived_deletedAt_idx" ON "Exercise"("isArchived", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Exercise_source_externalId_key" ON "Exercise"("source", "externalId");

-- AddForeignKey
ALTER TABLE "RoutineTemplate" ADD CONSTRAINT "RoutineTemplate_trainerId_fkey" FOREIGN KEY ("trainerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoutineAssignment" ADD CONSTRAINT "RoutineAssignment_trainerId_fkey" FOREIGN KEY ("trainerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoutineAssignment" ADD CONSTRAINT "RoutineAssignment_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoutineAssignment" ADD CONSTRAINT "RoutineAssignment_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "RoutineTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Exercise" ADD CONSTRAINT "Exercise_trainerId_fkey" FOREIGN KEY ("trainerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
