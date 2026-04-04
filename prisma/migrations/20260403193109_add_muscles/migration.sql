-- CreateTable
CREATE TABLE "Muscle" (
    "id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "nameEs" VARCHAR(100) NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Muscle_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Muscle_name_key" ON "Muscle"("name");

-- CreateIndex
CREATE INDEX "Muscle_name_idx" ON "Muscle"("name");

-- CreateIndex
CREATE INDEX "Muscle_nameEs_idx" ON "Muscle"("nameEs");

-- Seed: Extract and normalize muscles from existing exercises
-- This extracts unique muscle names from the Exercise table's JSON fields
INSERT INTO "Muscle" ("id", "name", "nameEs", "order", "createdAt", "updatedAt")
SELECT 
  gen_random_uuid(),
  muscle_name_en,
  muscle_name_es,
  ROW_NUMBER() OVER (ORDER BY muscle_name_es) as order,
  NOW(),
  NOW()
FROM (
  -- Extract from musclesEs (primary muscles, Spanish)
  SELECT DISTINCT
    COALESCE(
      TRIM(muscle_data->>'name'),
      TRIM(muscle_data::text, '"')
    ) as muscle_name_es,
    COALESCE(
      TRIM(muscle_data_en->>'name'),
      TRIM(muscle_data_en::text, '"'),
      TRIM(muscle_data->>'name'),
      TRIM(muscle_data::text, '"')
    ) as muscle_name_en
  FROM "Exercise",
       jsonb_array_elements(COALESCE("musclesEs", '[]'::jsonb)) as muscle_data
       LEFT JOIN LATERAL jsonb_array_elements(COALESCE("muscles", '[]'::jsonb)) as muscle_data_en ON true
  WHERE "musclesEs" IS NOT NULL
    AND jsonb_array_length("musclesEs") > 0

  UNION

  -- Extract from musclesSecondaryEs (secondary muscles, Spanish)
  SELECT DISTINCT
    COALESCE(
      TRIM(muscle_data->>'name'),
      TRIM(muscle_data::text, '"')
    ) as muscle_name_es,
    COALESCE(
      TRIM(muscle_data_en->>'name'),
      TRIM(muscle_data_en::text, '"'),
      TRIM(muscle_data->>'name'),
      TRIM(muscle_data::text, '"')
    ) as muscle_name_en
  FROM "Exercise",
       jsonb_array_elements(COALESCE("musclesSecondaryEs", '[]'::jsonb)) as muscle_data
       LEFT JOIN LATERAL jsonb_array_elements(COALESCE("musclesSecondary", '[]'::jsonb)) as muscle_data_en ON true
  WHERE "musclesSecondaryEs" IS NOT NULL
    AND jsonb_array_length("musclesSecondaryEs") > 0

  UNION

  -- Fallback: Extract from muscles (English) if no Spanish version
  SELECT DISTINCT
    COALESCE(
      TRIM(muscle_data->>'name'),
      TRIM(muscle_data::text, '"')
    ) as muscle_name_es,
    COALESCE(
      TRIM(muscle_data->>'name'),
      TRIM(muscle_data::text, '"')
    ) as muscle_name_en
  FROM "Exercise",
       jsonb_array_elements(COALESCE("muscles", '[]'::jsonb)) as muscle_data
  WHERE "muscles" IS NOT NULL
    AND jsonb_array_length("muscles") > 0
    AND ("musclesEs" IS NULL OR jsonb_array_length("musclesEs") = 0)
) as all_muscles
WHERE muscle_name_es IS NOT NULL
  AND muscle_name_es != ''
  AND LENGTH(muscle_name_es) > 1
ON CONFLICT (name) DO NOTHING;
