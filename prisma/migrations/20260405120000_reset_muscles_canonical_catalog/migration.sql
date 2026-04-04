-- Replace all Muscle rows: the original seed used a cartesian join between
-- musclesEs[] and muscles[], pairing every Spanish entry with every English one,
-- so name/nameEs were wrong (e.g. quadriceps -> abdominales). Exercise JSON does
-- not reference Muscle.id, only text labels — safe to truncate.

TRUNCATE TABLE "Muscle";

INSERT INTO "Muscle" ("id", "name", "nameEs", "order", "createdAt", "updatedAt")
SELECT gen_random_uuid(), v.name, v.name_es, v.sort_ord, NOW(), NOW()
FROM (
  VALUES
    ('abdominals', 'abdominales', 1),
    ('abductors', 'abductores', 2),
    ('adductors', 'aductores', 3),
    ('biceps', 'bíceps', 4),
    ('triceps', 'tríceps', 5),
    ('forearms', 'antebrazos', 6),
    ('chest', 'pectorales', 7),
    ('deltoids', 'deltoides', 8),
    ('traps', 'trapecios', 9),
    ('lats', 'dorsales', 10),
    ('upper back', 'espalda alta', 11),
    ('middle back', 'espalda media', 12),
    ('lower back', 'lumbar', 13),
    ('glutes', 'glúteos', 14),
    ('quadriceps', 'cuádriceps', 15),
    ('hamstrings', 'isquiotibiales', 16),
    ('calves', 'gemelos', 17)
) AS v(name, name_es, sort_ord);