-- CreateEnum
CREATE TYPE "ResourceType" AS ENUM ('diet', 'routine', 'general');

-- CreateTable
CREATE TABLE "Resource" (
    "id" UUID NOT NULL,
    "trainerId" UUID NOT NULL,
    "title" VARCHAR(500) NOT NULL,
    "description" VARCHAR(2000),
    "resourceType" "ResourceType" NOT NULL,
    "filename" VARCHAR(512) NOT NULL,
    "contentType" VARCHAR(200) NOT NULL,
    "size" INTEGER,
    "storageKey" VARCHAR(1024),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Resource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResourceShare" (
    "id" UUID NOT NULL,
    "resourceId" UUID NOT NULL,
    "memberId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResourceShare_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Resource_trainerId_resourceType_idx" ON "Resource"("trainerId", "resourceType");

-- CreateIndex
CREATE INDEX "Resource_trainerId_createdAt_idx" ON "Resource"("trainerId", "createdAt");

-- CreateIndex
CREATE INDEX "ResourceShare_memberId_idx" ON "ResourceShare"("memberId");

-- CreateIndex
CREATE UNIQUE INDEX "ResourceShare_resourceId_memberId_key" ON "ResourceShare"("resourceId", "memberId");

-- AddForeignKey
ALTER TABLE "Resource" ADD CONSTRAINT "Resource_trainerId_fkey" FOREIGN KEY ("trainerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResourceShare" ADD CONSTRAINT "ResourceShare_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "Resource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResourceShare" ADD CONSTRAINT "ResourceShare_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
