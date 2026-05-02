import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  AssignRoutineTemplateDto,
  CreateCustomExerciseDto,
  CreateCustomRoutineAssignmentDto,
  CreateRoutineTemplateDto,
  DuplicateRoutineTemplateDto,
  UpdateCustomExerciseDto,
  UpdateRoutineTemplateDto,
} from './dto/routines.dto';
import { Prisma } from 'generated/prisma/client';

type RoutineAssignmentLike = {
  status: 'scheduled' | 'active' | 'expired' | 'archived';
  startDate: Date;
  endDate: Date;
};

@Injectable()
export class RoutinesService {
  constructor(private readonly prisma: PrismaService) {}

  private nowUtc(): Date {
    // Normalizamos explícitamente a un instante UTC.
    return new Date(new Date().toISOString());
  }

  private toDescriptionArray(value?: string): string[] | null {
    if (!value) return null;
    const lines = value
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    return lines.length > 0 ? lines : null;
  }

  /** Normalize JSON muscle fields (strings, {name}, free_exercise_db raw.original, etc.) */
  private extractMuscleStrings(json: unknown): string[] {
    if (json == null) return [];
    if (Array.isArray(json)) {
      return json.flatMap((entry) => {
        if (typeof entry === 'string') {
          const t = entry.trim();
          return t ? [t] : [];
        }
        if (entry && typeof entry === 'object') {
          const o = entry as Record<string, unknown>;
          for (const key of [
            'nameEs',
            'name_es',
            'nameEn',
            'name_en',
            'name',
            'label',
            'muscleName',
          ]) {
            const v = o[key];
            if (typeof v === 'string' && v.trim()) return [v.trim()];
          }
        }
        return [];
      });
    }
    return [];
  }

  private extractMusclesFromRaw(raw: Record<string, unknown>): {
    primary: string[];
    secondary: string[];
  } {
    const original = raw?.original as Record<string, unknown> | undefined;
    const primary =
      original && Array.isArray(original.primaryMuscles)
        ? (original.primaryMuscles as unknown[]).filter(
            (x): x is string => typeof x === 'string' && x.trim().length > 0,
          )
        : [];
    const secondary =
      original && Array.isArray(original.secondaryMuscles)
        ? (original.secondaryMuscles as unknown[]).filter(
            (x): x is string => typeof x === 'string' && x.trim().length > 0,
          )
        : [];
    return { primary, secondary };
  }

  private mergeUniqueMuscleLabels(...lists: string[][]): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const list of lists) {
      for (const s of list) {
        const t = s.trim();
        if (!t) continue;
        const key = t.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(t);
      }
    }
    return out;
  }

  /**
   * Una sola lengua en UI: si hay músculos en *_es, solo esos; si no, inglés + raw.
   * Evita duplicar "chest" y "pectoral" a la vez.
   */
  private buildMuscleLabels(
    esJson: unknown,
    enJson: unknown,
    fromRaw: string[],
  ): string[] {
    const es = this.extractMuscleStrings(esJson);
    if (es.length > 0) {
      return this.mergeUniqueMuscleLabels(es);
    }
    return this.mergeUniqueMuscleLabels(
      this.extractMuscleStrings(enJson),
      fromRaw,
    );
  }

  /**
   * For trainer UI: map catalog labels (ES/EN, lowercase) to Muscle.id for selects / multiselects.
   */
  private async loadMuscleLabelToIdMaps(): Promise<{
    byEs: Map<string, string>;
    byEn: Map<string, string>;
  }> {
    const rows = await this.prisma.muscle.findMany({
      orderBy: [{ order: 'asc' }, { nameEs: 'asc' }, { id: 'asc' }],
      select: { id: true, name: true, nameEs: true },
    });
    const byEs = new Map<string, string>();
    const byEn = new Map<string, string>();
    for (const r of rows) {
      const esKey = r.nameEs.trim().toLowerCase();
      if (!byEs.has(esKey)) byEs.set(esKey, r.id);
      const enKey = r.name.trim().toLowerCase();
      if (!byEn.has(enKey)) byEn.set(enKey, r.id);
    }
    return { byEs, byEn };
  }

  private labelsToMuscleIds(
    labels: string[],
    byEs: Map<string, string>,
    byEn: Map<string, string>,
  ): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const label of labels) {
      const key = label.trim().toLowerCase();
      if (!key) continue;
      const id = byEs.get(key) ?? byEn.get(key);
      if (id && !seen.has(id)) {
        seen.add(id);
        out.push(id);
      }
    }
    return out;
  }

  private descriptionJsonToPlainText(json: unknown): string {
    if (json == null) return '';
    if (Array.isArray(json)) {
      return json
        .map((x) => String(x).trim())
        .filter((line) => line.length > 0)
        .join('\n');
    }
    if (typeof json === 'string') {
      return json
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .join('\n');
    }
    return '';
  }

  /**
   * Payload for the “edit custom exercise” form (trainer-owned only).
   */
  async getCustomExerciseForEdit(trainerId: string, exerciseId: string) {
    const row = await this.prisma.exercise.findUnique({
      where: { id: exerciseId },
      select: {
        id: true,
        source: true,
        trainerId: true,
        name: true,
        nameEs: true,
        description: true,
        descriptionEs: true,
        categoryName: true,
        categoryNameEs: true,
        muscles: true,
        musclesEs: true,
        musclesSecondary: true,
        musclesSecondaryEs: true,
        images: true,
        videos: true,
      },
    });

    if (
      !row ||
      row.source !== 'custom' ||
      row.trainerId !== trainerId
    ) {
      throw new NotFoundException('Custom exercise not found');
    }

    const { byEs, byEn } = await this.loadMuscleLabelToIdMaps();

    const primEs = this.extractMuscleStrings(row.musclesEs);
    const primEn = this.extractMuscleStrings(row.muscles);
    const primaryLabels = primEs.length > 0 ? primEs : primEn;
    const primaryIds = this.labelsToMuscleIds(primaryLabels, byEs, byEn);
    const primaryMuscleId = primaryIds[0] ?? null;

    const secEs = this.extractMuscleStrings(row.musclesSecondaryEs);
    const secEn = this.extractMuscleStrings(row.musclesSecondary);
    const secondaryLabels = secEs.length > 0 ? secEs : secEn;
    let secondaryMuscleIds = this.labelsToMuscleIds(
      secondaryLabels,
      byEs,
      byEn,
    );
    if (primaryMuscleId) {
      secondaryMuscleIds = secondaryMuscleIds.filter(
        (id) => id !== primaryMuscleId,
      );
    }

    const description =
      this.descriptionJsonToPlainText(row.descriptionEs) ||
      this.descriptionJsonToPlainText(row.description);

    const images = Array.isArray(row.images)
      ? (row.images as Array<Record<string, unknown>>)
      : [];
    const videos = Array.isArray(row.videos)
      ? (row.videos as Array<Record<string, unknown>>)
      : [];
    const imageUrl =
      typeof images[0]?.image === 'string'
        ? images[0].image
        : typeof images[0]?.url === 'string'
          ? images[0].url
          : null;
    const videoUrl =
      typeof videos[0]?.video === 'string'
        ? videos[0].video
        : typeof videos[0]?.url === 'string'
          ? videos[0].url
          : null;

    return {
      id: row.id,
      name: (row.nameEs as string) || row.name,
      categoryName:
        (row.categoryNameEs as string) || row.categoryName || null,
      description,
      imageUrl,
      videoUrl,
      primaryMuscleId,
      secondaryMuscleIds,
    };
  }

  async getExercises(userId: string, search?: string) {
    const q = search?.trim();
    const narrowInMemory = Boolean(q);
    // Sin texto de búsqueda: lista inicial acotada (la UI muestra ~100).
    // Con q: cargar todo el catálogo elegible; si no, take:1000 haría
    // desaparecer coincidencias por nombre o músculo en texto fuera del primer bloque.
    const exercises = await this.prisma.exercise.findMany({
      where: {
        isArchived: false,
        deletedAt: null,
        OR: [
          { source: 'wger' },
          { source: 'free_exercise_db' as any },
          { source: 'custom', trainerId: userId },
        ],
      },
      select: {
        id: true,
        source: true,
        trainerId: true,
        externalId: true,
        name: true,
        nameEs: true,
        description: true,
        descriptionEs: true,
        categoryName: true,
        categoryNameEs: true,
        equipment: true,
        equipmentEs: true,
        muscles: true,
        musclesEs: true,
        musclesSecondary: true,
        musclesSecondaryEs: true,
        images: true,
        videos: true,
        license: true,
        raw: true,
        trainer: {
          select: {
            fullName: true,
            email: true,
          },
        },
      },
      orderBy: [{ source: 'asc' }, { name: 'asc' }],
      ...(narrowInMemory ? {} : { take: 1000 }),
    });

    const { byEs, byEn } = await this.loadMuscleLabelToIdMaps();

    let mapped = exercises.map((exercise) =>
      this.mapExerciseRowForTrainerList(exercise, byEs, byEn),
    );

    if (q) {
      const lowerQ = q.toLowerCase();
      mapped = mapped.filter((exercise) =>
        this.exerciseMatchesSearchQuery(exercise, lowerQ),
      );
      mapped = this.sortExercisesBySearchRelevance(mapped, lowerQ);
    }

    return mapped;
  }

  private mapExerciseRowForTrainerList(
    exercise: any,
    byEs: Map<string, string>,
    byEn: Map<string, string>,
  ) {
    const raw = (exercise.raw ?? {}) as Record<string, unknown>;
    const images = Array.isArray(exercise.images)
      ? (exercise.images as Array<Record<string, unknown>>)
      : [];
    const videos = Array.isArray(exercise.videos)
      ? (exercise.videos as Array<Record<string, unknown>>)
      : [];
    const esDescription = exercise.descriptionEs;
    const esCategoryName = exercise.categoryNameEs;
    const esEquipment = exercise.equipmentEs;
    const esMuscles = exercise.musclesEs;
    const esMusclesSecondary = exercise.musclesSecondaryEs;
    const esName = exercise.nameEs;

    const imageUrls = images
      .map((img) =>
        typeof img?.image === 'string'
          ? img.image
          : typeof img?.url === 'string'
            ? img.url
            : null,
      )
      .filter((value): value is string => Boolean(value));

    const videoUrls = videos
      .map((video) =>
        typeof video?.video === 'string'
          ? video.video
          : typeof video?.url === 'string'
            ? video.url
            : null,
      )
      .filter((value): value is string => Boolean(value));

    const imageUrl = imageUrls[0] ?? null;
    const videoUrl = videoUrls[0] ?? null;
    const customAuthor =
      exercise.source === 'custom'
        ? exercise.trainer?.fullName || exercise.trainer?.email || 'Trainer'
        : null;
    const datasetAuthor =
      typeof raw.author === 'string' && raw.author.trim().length > 0
        ? raw.author.trim()
        : null;

    const fromRaw = this.extractMusclesFromRaw(raw);
    const muscleLabelsPrimary = this.buildMuscleLabels(
      esMuscles,
      exercise.muscles,
      fromRaw.primary,
    );
    const muscleLabelsSecondary = this.buildMuscleLabels(
      esMusclesSecondary,
      exercise.musclesSecondary,
      fromRaw.secondary,
    );

    const primaryMuscleIds = this.labelsToMuscleIds(
      muscleLabelsPrimary,
      byEs,
      byEn,
    );
    const secondaryMuscleIds = this.labelsToMuscleIds(
      muscleLabelsSecondary,
      byEs,
      byEn,
    );

    return {
      ...exercise,
      name: esName ?? exercise.name,
      /** Nombre EN en BD (para búsqueda; `name` arriba prioriza ES) */
      listSearchNameEn:
        typeof exercise.name === 'string' ? exercise.name : undefined,
      /** Categoría EN en BD (para búsqueda) */
      listSearchCategoryEn:
        typeof exercise.categoryName === 'string'
          ? exercise.categoryName
          : undefined,
      description: esDescription ?? exercise.description,
      categoryName: esCategoryName ?? exercise.categoryName,
      equipment: esEquipment ?? exercise.equipment,
      muscles: esMuscles ?? exercise.muscles,
      musclesSecondary: esMusclesSecondary ?? exercise.musclesSecondary,
      muscleLabelsPrimary,
      muscleLabelsSecondary,
      primaryMuscleIds,
      secondaryMuscleIds,
      author: customAuthor ?? datasetAuthor,
      license: exercise.license ?? null,
      imageUrl,
      videoUrl,
      imageUrls,
      videoUrls,
    };
  }

  /** Cadenas en arrays JSON (músculos, equipo, etc.) */
  private exerciseJsonStringArrayMatches(
    value: unknown,
    lowerQ: string,
  ): boolean {
    return (
      Array.isArray(value) &&
      value.some(
        (entry) =>
          typeof entry === 'string' && entry.toLowerCase().includes(lowerQ),
      )
    );
  }

  private exerciseSearchMatchesBasic(exercise: any, lowerQ: string): boolean {
    const nameEs =
      typeof exercise.nameEs === 'string' ? exercise.nameEs.toLowerCase() : '';
    const nameEn =
      typeof exercise.listSearchNameEn === 'string'
        ? exercise.listSearchNameEn.toLowerCase()
        : '';
    const catEs =
      typeof exercise.categoryNameEs === 'string'
        ? exercise.categoryNameEs.toLowerCase()
        : '';
    const catEn =
      typeof exercise.listSearchCategoryEn === 'string'
        ? exercise.listSearchCategoryEn.toLowerCase()
        : '';
    return (
      exercise.name?.toLowerCase().includes(lowerQ) ||
      nameEs.includes(lowerQ) ||
      nameEn.includes(lowerQ) ||
      exercise.categoryName?.toLowerCase().includes(lowerQ) ||
      catEs.includes(lowerQ) ||
      catEn.includes(lowerQ) ||
      (typeof exercise.author === 'string' &&
        exercise.author.toLowerCase().includes(lowerQ))
    );
  }

  private exercisePrimaryMuscleTextMatch(
    exercise: any,
    lowerQ: string,
  ): boolean {
    const primaryHaystack = [...(exercise.muscleLabelsPrimary ?? [])]
      .join(' ')
      .toLowerCase();
    if (primaryHaystack.includes(lowerQ)) return true;
    return (
      this.exerciseJsonStringArrayMatches(exercise.muscles, lowerQ) ||
      this.exerciseJsonStringArrayMatches(exercise.musclesEs, lowerQ)
    );
  }

  private exerciseSecondaryMuscleTextMatch(
    exercise: any,
    lowerQ: string,
  ): boolean {
    const secondaryHaystack = [...(exercise.muscleLabelsSecondary ?? [])]
      .join(' ')
      .toLowerCase();
    if (secondaryHaystack.includes(lowerQ)) return true;
    return (
      this.exerciseJsonStringArrayMatches(exercise.musclesSecondary, lowerQ) ||
      this.exerciseJsonStringArrayMatches(
        exercise.musclesSecondaryEs,
        lowerQ,
      )
    );
  }

  private exerciseEquipmentTextMatch(exercise: any, lowerQ: string): boolean {
    return (
      this.exerciseJsonStringArrayMatches(exercise.equipment, lowerQ) ||
      this.exerciseJsonStringArrayMatches(exercise.equipmentEs, lowerQ)
    );
  }

  private exerciseMatchesSearchQuery(exercise: any, lowerQ: string): boolean {
    if (this.exerciseSearchMatchesBasic(exercise, lowerQ)) return true;
    if (this.exercisePrimaryMuscleTextMatch(exercise, lowerQ)) return true;
    if (this.exerciseSecondaryMuscleTextMatch(exercise, lowerQ)) return true;
    if (this.exerciseEquipmentTextMatch(exercise, lowerQ)) return true;
    return false;
  }

  /**
   * Con texto de búsqueda: nombre/categoría/autor primero; luego aciertos en
   * músculo principal; luego solo músculo secundario; luego solo equipo.
   */
  private exerciseSearchSortRank(exercise: any, lowerQ: string): number {
    if (this.exerciseSearchMatchesBasic(exercise, lowerQ)) return 0;
    if (this.exercisePrimaryMuscleTextMatch(exercise, lowerQ)) return 1;
    if (this.exerciseSecondaryMuscleTextMatch(exercise, lowerQ)) return 2;
    return 3;
  }

  private sortExercisesBySearchRelevance(
    exercises: any[],
    lowerQ: string,
  ): any[] {
    return [...exercises].sort((a, b) => {
      const ra = this.exerciseSearchSortRank(a, lowerQ);
      const rb = this.exerciseSearchSortRank(b, lowerQ);
      if (ra !== rb) return ra - rb;
      const na = String(a.name ?? '').toLowerCase();
      const nb = String(b.name ?? '').toLowerCase();
      return na.localeCompare(nb, 'es');
    });
  }

  /** Solo ejercicios custom del trainer; orden por última actualización. */
  async listTrainerCustomExercises(userId: string, search?: string) {
    const exercises = await this.prisma.exercise.findMany({
      where: {
        source: 'custom',
        trainerId: userId,
        isArchived: false,
        deletedAt: null,
      },
      select: {
        id: true,
        source: true,
        trainerId: true,
        externalId: true,
        name: true,
        nameEs: true,
        description: true,
        descriptionEs: true,
        categoryName: true,
        categoryNameEs: true,
        equipment: true,
        equipmentEs: true,
        muscles: true,
        musclesEs: true,
        musclesSecondary: true,
        musclesSecondaryEs: true,
        images: true,
        videos: true,
        license: true,
        raw: true,
        updatedAt: true,
        trainer: {
          select: {
            fullName: true,
            email: true,
          },
        },
      },
      orderBy: [{ updatedAt: 'desc' }],
      take: 500,
    });

    const { byEs, byEn } = await this.loadMuscleLabelToIdMaps();
    const mapped = exercises.map((exercise) =>
      this.mapExerciseRowForTrainerList(exercise, byEs, byEn),
    );

    const q = search?.trim();
    if (!q) return mapped;

    const lowerQ = q.toLowerCase();
    const filtered = mapped.filter((exercise) =>
      this.exerciseMatchesSearchQuery(exercise, lowerQ),
    );
    return this.sortExercisesBySearchRelevance(filtered, lowerQ);
  }

  /**
   * Catalog for trainer UI. Dedupes by Spanish label: the seed migration paired
   * each musclesEs[] element with every muscles[] entry (cartesian product), so
   * many rows can share the same nameEs with different English `name` values.
   */
  async listMusclesCatalog() {
    const rows = await this.prisma.muscle.findMany({
      orderBy: [{ order: 'asc' }, { nameEs: 'asc' }, { id: 'asc' }],
      select: { id: true, name: true, nameEs: true },
    });
    const byEsKey = new Map<
      string,
      { id: string; name: string; nameEs: string }
    >();
    for (const r of rows) {
      const key = r.nameEs.trim().toLowerCase();
      if (!byEsKey.has(key)) {
        byEsKey.set(key, { id: r.id, name: r.name, nameEs: r.nameEs });
      }
    }
    return [...byEsKey.values()].sort((a, b) =>
      a.nameEs.localeCompare(b.nameEs, 'es', { sensitivity: 'base' }),
    );
  }

  /** Resolves DB muscle UUIDs to JSON arrays (lowercase) for Exercise columns. */
  private async resolveMuscleIdsToJsonArrays(ids: string[]): Promise<{
    en: Prisma.InputJsonValue;
    es: Prisma.InputJsonValue;
  }> {
    const uniqueOrder: string[] = [];
    for (const id of ids) {
      if (!uniqueOrder.includes(id)) uniqueOrder.push(id);
    }
    if (uniqueOrder.length === 0) {
      return { en: [], es: [] };
    }
    const rows = await this.prisma.muscle.findMany({
      where: { id: { in: uniqueOrder } },
      select: { id: true, name: true, nameEs: true },
    });
    if (rows.length !== uniqueOrder.length) {
      throw new BadRequestException('Uno o más músculos no son válidos');
    }
    const byId = new Map(rows.map((r) => [r.id, r]));
    const orderedEn: string[] = [];
    const orderedEs: string[] = [];
    for (const id of uniqueOrder) {
      const r = byId.get(id);
      if (!r) {
        throw new BadRequestException('Uno o más músculos no son válidos');
      }
      orderedEn.push(r.name.toLowerCase());
      orderedEs.push(r.nameEs.toLowerCase());
    }
    return {
      en: orderedEn as Prisma.InputJsonValue,
      es: orderedEs as Prisma.InputJsonValue,
    };
  }

  async createCustomExercise(userId: string, dto: CreateCustomExerciseDto) {
    const images = dto.imageUrl ? [{ image: dto.imageUrl }] : [];
    const videos = dto.videoUrl ? [{ video: dto.videoUrl }] : [];
    const descriptionArray = this.toDescriptionArray(dto.description);

    const primaryJson =
      dto.primaryMuscleIds !== undefined
        ? await this.resolveMuscleIdsToJsonArrays(dto.primaryMuscleIds)
        : null;
    const secondaryJson =
      dto.secondaryMuscleIds !== undefined
        ? await this.resolveMuscleIdsToJsonArrays(dto.secondaryMuscleIds)
        : null;

    return this.prisma.exercise.create({
      data: {
        source: 'custom',
        trainerId: userId,
        externalId: null,
        name: dto.name,
        nameEs: dto.name,
        description: descriptionArray
          ? (descriptionArray as Prisma.InputJsonValue)
          : Prisma.DbNull,
        descriptionEs: descriptionArray
          ? (descriptionArray as Prisma.InputJsonValue)
          : Prisma.DbNull,
        categoryName: dto.categoryName ?? null,
        categoryNameEs: dto.categoryName ?? null,
        ...(primaryJson
          ? { muscles: primaryJson.en, musclesEs: primaryJson.es }
          : {}),
        ...(secondaryJson
          ? {
              musclesSecondary: secondaryJson.en,
              musclesSecondaryEs: secondaryJson.es,
            }
          : {}),
        images: images as any,
        videos: videos as any,
        raw: {
          source: 'custom',
          createdBy: userId,
        } as any,
      },
    });
  }

  async updateCustomExercise(
    userId: string,
    exerciseId: string,
    dto: UpdateCustomExerciseDto,
  ) {
    const existing = await this.prisma.exercise.findUnique({
      where: { id: exerciseId },
      select: {
        id: true,
        source: true,
        trainerId: true,
        images: true,
        videos: true,
      },
    });

    if (
      !existing ||
      existing.source !== 'custom' ||
      existing.trainerId !== userId
    ) {
      throw new NotFoundException('Custom exercise not found');
    }

    const nextImages =
      dto.imageUrl !== undefined
        ? dto.imageUrl
          ? [{ image: dto.imageUrl }]
          : []
        : existing.images;
    const nextVideos =
      dto.videoUrl !== undefined
        ? dto.videoUrl
          ? [{ video: dto.videoUrl }]
          : []
        : existing.videos;
    const descriptionArray =
      dto.description !== undefined
        ? this.toDescriptionArray(dto.description)
        : undefined;

    const primaryJson =
      dto.primaryMuscleIds !== undefined
        ? await this.resolveMuscleIdsToJsonArrays(dto.primaryMuscleIds)
        : null;
    const secondaryJson =
      dto.secondaryMuscleIds !== undefined
        ? await this.resolveMuscleIdsToJsonArrays(dto.secondaryMuscleIds)
        : null;

    await this.prisma.exercise.update({
      where: { id: exerciseId },
      data: {
        ...(dto.name !== undefined ? { name: dto.name, nameEs: dto.name } : {}),
        ...(dto.description !== undefined
          ? {
              description: descriptionArray
                ? (descriptionArray as Prisma.InputJsonValue)
                : Prisma.DbNull,
              descriptionEs: descriptionArray
                ? (descriptionArray as Prisma.InputJsonValue)
                : Prisma.DbNull,
            }
          : {}),
        ...(dto.categoryName !== undefined
          ? { categoryName: dto.categoryName, categoryNameEs: dto.categoryName }
          : {}),
        ...(primaryJson
          ? { muscles: primaryJson.en, musclesEs: primaryJson.es }
          : {}),
        ...(secondaryJson
          ? {
              musclesSecondary: secondaryJson.en,
              musclesSecondaryEs: secondaryJson.es,
            }
          : {}),
        images: nextImages as any,
        videos: nextVideos as any,
      },
    });

    return this.getCustomExerciseForEdit(userId, exerciseId);
  }

  private toUtcStartOfDay(dateStr: string): Date {
    const [yyyy, mm, dd] = dateStr.split('-').map((v) => Number(v));
    return new Date(Date.UTC(yyyy, mm - 1, dd, 0, 0, 0, 0));
  }

  private toUtcEndOfDay(dateStr: string): Date {
    const [yyyy, mm, dd] = dateStr.split('-').map((v) => Number(v));
    return new Date(Date.UTC(yyyy, mm - 1, dd, 23, 59, 59, 999));
  }

  private getComputedStatus(assignment: RoutineAssignmentLike) {
    if (assignment.status === 'archived') return 'archived' as const;

    const now = this.nowUtc();
    if (now < assignment.startDate) return 'scheduled' as const;
    if (now > assignment.endDate) return 'expired' as const;
    return 'active' as const;
  }

  private withComputedStatus<T extends RoutineAssignmentLike>(assignment: T) {
    return {
      ...assignment,
      computedStatus: this.getComputedStatus(assignment),
    };
  }

  private mapExerciseForTemplateSchema(exercise: any) {
    const raw = (exercise.raw ?? {}) as Record<string, unknown>;
    const images = Array.isArray(exercise.images)
      ? (exercise.images as Array<Record<string, unknown>>)
      : [];
    const videos = Array.isArray(exercise.videos)
      ? (exercise.videos as Array<Record<string, unknown>>)
      : [];
    const esDescription = exercise.descriptionEs;
    const esCategoryName = exercise.categoryNameEs;
    const esName = exercise.nameEs;

    const imageUrls = images
      .map((img) =>
        typeof img?.image === 'string'
          ? img.image
          : typeof img?.url === 'string'
            ? img.url
            : null,
      )
      .filter((value): value is string => Boolean(value));

    const videoUrls = videos
      .map((video) =>
        typeof video?.video === 'string'
          ? video.video
          : typeof video?.url === 'string'
            ? video.url
            : null,
      )
      .filter((value): value is string => Boolean(value));

    const customAuthor =
      exercise.source === 'custom'
        ? exercise.trainer?.fullName || exercise.trainer?.email || 'Trainer'
        : null;
    const datasetAuthor =
      typeof raw.author === 'string' && raw.author.trim().length > 0
        ? raw.author.trim()
        : null;

    return {
      name: esName ?? exercise.name,
      description: esDescription ?? exercise.description,
      categoryName: esCategoryName ?? exercise.categoryName,
      author: customAuthor ?? datasetAuthor,
      license: exercise.license ?? null,
      imageUrl: imageUrls[0] ?? null,
      videoUrl: videoUrls[0] ?? null,
      imageUrls,
      videoUrls,
      source: exercise.source,
      trainerId: exercise.trainerId,
      externalId: exercise.externalId,
    };
  }

  private async hydrateTemplateSchema(trainerId: string, schema: unknown) {
    if (!Array.isArray(schema) || schema.length === 0) return schema;

    const items = schema as Array<Record<string, unknown>>;
    const exerciseIds = Array.from(
      new Set(
        items
          .map((item) =>
            typeof item?.exerciseId === 'string' ? item.exerciseId : null,
          )
          .filter((id): id is string => Boolean(id)),
      ),
    );

    if (exerciseIds.length === 0) return schema;

    const exercises = await this.prisma.exercise.findMany({
      where: {
        id: { in: exerciseIds },
        isArchived: false,
        deletedAt: null,
        OR: [
          { source: 'wger' },
          { source: 'free_exercise_db' as any },
          { source: 'custom', trainerId },
        ],
      },
      select: {
        id: true,
        source: true,
        trainerId: true,
        externalId: true,
        name: true,
        nameEs: true,
        description: true,
        descriptionEs: true,
        categoryName: true,
        categoryNameEs: true,
        images: true,
        videos: true,
        license: true,
        raw: true,
        trainer: {
          select: {
            fullName: true,
            email: true,
          },
        },
      },
    });

    const exerciseById = new Map(
      exercises.map((exercise) => [
        exercise.id,
        this.mapExerciseForTemplateSchema(exercise),
      ]),
    );

    return items.map((item) => {
      const exerciseId =
        typeof item?.exerciseId === 'string' ? item.exerciseId : null;
      if (!exerciseId) return item;
      const hydrated = exerciseById.get(exerciseId);
      if (!hydrated) return item;
      return {
        ...item,
        ...hydrated,
      };
    });
  }

  async getTemplates(trainerId: string) {
    const templates = await this.prisma.routineTemplate.findMany({
      where: {
        trainerId,
        isArchived: false,
        deletedAt: null,
      },
      orderBy: { updatedAt: 'desc' },
    });

    return Promise.all(
      templates.map(async (template) => ({
        ...template,
        schema: await this.hydrateTemplateSchema(trainerId, template.schema),
      })),
    );
  }

  async getArchivedTemplates(trainerId: string) {
    return this.prisma.routineTemplate.findMany({
      where: {
        trainerId,
        isArchived: true,
        deletedAt: null,
      },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async archiveTemplate(trainerId: string, templateId: string) {
    const template = await this.prisma.routineTemplate.findFirst({
      where: {
        id: templateId,
        trainerId,
        deletedAt: null,
        isArchived: false,
      },
      select: { id: true },
    });
    if (!template) {
      throw new NotFoundException(
        'Routine template not found or already archived',
      );
    }
    return this.prisma.routineTemplate.update({
      where: { id: templateId },
      data: { isArchived: true },
    });
  }

  async restoreTemplate(trainerId: string, templateId: string) {
    const template = await this.prisma.routineTemplate.findFirst({
      where: {
        id: templateId,
        trainerId,
        deletedAt: null,
        isArchived: true,
      },
      select: { id: true },
    });
    if (!template) {
      throw new NotFoundException('Routine template not found or not archived');
    }
    return this.prisma.routineTemplate.update({
      where: { id: templateId },
      data: { isArchived: false },
    });
  }

  async deleteTemplate(trainerId: string, templateId: string) {
    const template = await this.prisma.routineTemplate.findFirst({
      where: {
        id: templateId,
        trainerId,
        deletedAt: null,
        isArchived: true,
      },
      select: { id: true },
    });
    if (!template) {
      throw new NotFoundException('Routine template not found or not archived');
    }
    return this.prisma.routineTemplate.update({
      where: { id: templateId },
      data: { deletedAt: this.nowUtc() },
    });
  }

  async createTemplate(trainerId: string, dto: CreateRoutineTemplateDto) {
    return this.prisma.routineTemplate.create({
      data: {
        trainerId,
        name: dto.name,
        description: dto.description,
        schema: dto.schema as any,
      },
    });
  }

  async duplicateTemplate(
    trainerId: string,
    templateId: string,
    dto: DuplicateRoutineTemplateDto,
  ) {
    const existing = await this.prisma.routineTemplate.findFirst({
      where: {
        id: templateId,
        trainerId,
        deletedAt: null,
        isArchived: false,
      },
    });
    if (!existing) {
      throw new NotFoundException(
        'Routine template not found or not available for duplication',
      );
    }

    const created = await this.prisma.routineTemplate.create({
      data: {
        trainerId,
        name: dto.name.trim(),
        description: dto.description.trim(),
        schema: existing.schema as any,
      },
    });

    return {
      ...created,
      schema: await this.hydrateTemplateSchema(trainerId, created.schema),
    };
  }

  async updateTemplate(
    trainerId: string,
    templateId: string,
    dto: UpdateRoutineTemplateDto,
  ) {
    const existing = await this.prisma.routineTemplate.findFirst({
      where: {
        id: templateId,
        trainerId,
        isArchived: false,
        deletedAt: null,
      },
    });
    if (!existing) {
      throw new NotFoundException('Routine template not found');
    }

    const data: any = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.schema !== undefined) data.schema = dto.schema as any;

    return this.prisma.routineTemplate.update({
      where: { id: templateId },
      data,
    });
  }

  async assignTemplate(
    trainerId: string,
    templateId: string,
    dto: AssignRoutineTemplateDto,
  ) {
    const template = await this.prisma.routineTemplate.findFirst({
      where: {
        id: templateId,
        trainerId,
        isArchived: false,
        deletedAt: null,
      },
    });
    if (!template) {
      throw new NotFoundException('Routine template not found');
    }

    const link = await this.prisma.trainerMemberLink.findUnique({
      where: {
        trainerId_memberId: {
          trainerId,
          memberId: dto.memberId,
        },
      },
    });
    if (!link) {
      throw new ForbiddenException('Member is not linked to trainer');
    }

    const startDate = this.toUtcStartOfDay(dto.startDate);
    const endDate = this.toUtcEndOfDay(dto.endDate);
    if (startDate > endDate) {
      throw new BadRequestException(
        'startDate must be before or equal to endDate',
      );
    }

    const overlappingAssignment = await this.prisma.routineAssignment.findFirst(
      {
        where: {
          trainerId,
          memberId: dto.memberId,
          status: { not: 'archived' },
          startDate: { lte: endDate },
          endDate: { gte: startDate },
        },
        select: { id: true },
      },
    );

    if (overlappingAssignment) {
      throw new BadRequestException(
        'Member already has a routine assignment in this period',
      );
    }

    const now = this.nowUtc();
    let status: 'scheduled' | 'active' | 'expired' = 'scheduled';
    if (now < startDate) {
      status = 'scheduled';
    } else if (now > endDate) {
      status = 'expired';
    } else {
      status = 'active';
    }

    const assignment = await this.prisma.routineAssignment.create({
      data: {
        trainerId,
        memberId: dto.memberId,
        templateId: template.id,
        schemaSnapshot: template.schema as any,
        startDate,
        endDate,
        status,
      },
      include: {
        template: {
          select: {
            id: true,
            name: true,
            description: true,
          },
        },
      },
    });

    return this.withComputedStatus(assignment);
  }

  async createCustomAssignment(
    trainerId: string,
    dto: CreateCustomRoutineAssignmentDto,
  ) {
    const link = await this.prisma.trainerMemberLink.findUnique({
      where: {
        trainerId_memberId: {
          trainerId,
          memberId: dto.memberId,
        },
      },
    });
    if (!link) {
      throw new ForbiddenException('Member is not linked to trainer');
    }

    const startDate = this.toUtcStartOfDay(dto.startDate);
    const endDate = this.toUtcEndOfDay(dto.endDate);
    if (startDate > endDate) {
      throw new BadRequestException(
        'startDate must be before or equal to endDate',
      );
    }

    const overlappingAssignment = await this.prisma.routineAssignment.findFirst(
      {
        where: {
          trainerId,
          memberId: dto.memberId,
          status: { not: 'archived' },
          startDate: { lte: endDate },
          endDate: { gte: startDate },
        },
        select: { id: true },
      },
    );

    if (overlappingAssignment) {
      throw new BadRequestException(
        'Member already has a routine assignment in this period',
      );
    }

    const now = this.nowUtc();
    let status: 'scheduled' | 'active' | 'expired' = 'scheduled';
    if (now < startDate) {
      status = 'scheduled';
    } else if (now > endDate) {
      status = 'expired';
    } else {
      status = 'active';
    }

    const assignment = await this.prisma.routineAssignment.create({
      data: {
        trainerId,
        memberId: dto.memberId,
        templateId: null,
        name: dto.name.trim(),
        description: dto.description.trim(),
        schemaSnapshot: dto.schema as any,
        startDate,
        endDate,
        status,
      },
      include: {
        template: {
          select: {
            id: true,
            name: true,
            description: true,
          },
        },
      },
    });

    return this.withComputedStatus(assignment);
  }

  async getAssignments(userId: string, memberId?: string, templateId?: string) {
    const includeTemplate = {
      template: {
        select: {
          id: true,
          name: true,
          description: true,
        },
      },
    };

    if (memberId) {
      const link = await this.prisma.trainerMemberLink.findUnique({
        where: {
          trainerId_memberId: {
            trainerId: userId,
            memberId,
          },
        },
      });
      if (!link) {
        throw new ForbiddenException('Member is not linked to trainer');
      }

      const assignments = await this.prisma.routineAssignment.findMany({
        where: {
          trainerId: userId,
          memberId,
          ...(templateId ? { templateId } : {}),
        },
        include: includeTemplate,
        orderBy: { startDate: 'desc' },
      });

      return assignments.map((a) => this.withComputedStatus(a));
    }

    if (templateId) {
      const template = await this.prisma.routineTemplate.findFirst({
        where: {
          id: templateId,
          trainerId: userId,
          deletedAt: null,
        },
      });
      if (!template) {
        throw new NotFoundException('Routine template not found');
      }
      const assignments = await this.prisma.routineAssignment.findMany({
        where: {
          trainerId: userId,
          templateId,
        },
        include: {
          ...includeTemplate,
          member: {
            select: {
              id: true,
              fullName: true,
              email: true,
            },
          },
        },
        orderBy: { startDate: 'desc' },
      });

      return assignments.map((a) => this.withComputedStatus(a));
    }

    const assignments = await this.prisma.routineAssignment.findMany({
      where: {
        memberId: userId,
        status: { not: 'archived' },
      },
      include: includeTemplate,
      orderBy: { startDate: 'desc' },
    });

    return assignments.map((a) => this.withComputedStatus(a));
  }

  async getTrainerAssignments(
    trainerId: string,
    memberId?: string,
    status?: 'scheduled' | 'active' | 'expired' | 'archived',
  ) {
    if (memberId) {
      const link = await this.prisma.trainerMemberLink.findUnique({
        where: {
          trainerId_memberId: {
            trainerId,
            memberId,
          },
        },
      });
      if (!link) {
        throw new ForbiddenException('Member is not linked to trainer');
      }
    }

    const assignments = await this.prisma.routineAssignment.findMany({
      where: {
        trainerId,
        ...(memberId ? { memberId } : {}),
      },
      include: {
        template: {
          select: {
            id: true,
            name: true,
            description: true,
          },
        },
        member: {
          select: {
            id: true,
            fullName: true,
            email: true,
          },
        },
      },
      orderBy: [{ startDate: 'desc' }, { createdAt: 'desc' }],
    });

    const withStatus = assignments.map((a) => this.withComputedStatus(a));
    if (!status) return withStatus;
    return withStatus.filter((a) => a.computedStatus === status);
  }

  async getTrainerAssignmentById(trainerId: string, assignmentId: string) {
    const assignment = await this.prisma.routineAssignment.findFirst({
      where: {
        id: assignmentId,
        trainerId,
      },
      include: {
        template: {
          select: {
            id: true,
            name: true,
            description: true,
          },
        },
        member: {
          select: {
            id: true,
            fullName: true,
            email: true,
          },
        },
      },
    });

    if (!assignment) {
      throw new NotFoundException('Routine assignment not found');
    }

    return this.withComputedStatus(assignment);
  }

  async getMyActive(memberId: string) {
    const assignments = await this.prisma.routineAssignment.findMany({
      where: {
        memberId,
        status: { not: 'archived' },
      },
      include: {
        template: {
          select: {
            id: true,
            name: true,
            description: true,
          },
        },
      },
      orderBy: { startDate: 'desc' },
    });

    const active = assignments.find(
      (assignment) => this.getComputedStatus(assignment) === 'active',
    );

    if (!active) return null;

    const hydratedSchemaSnapshot = await this.hydrateTemplateSchema(
      active.trainerId,
      active.schemaSnapshot,
    );

    return this.withComputedStatus({
      ...active,
      schemaSnapshot: hydratedSchemaSnapshot,
    });
  }

  async getMyHistory(memberId: string) {
    const assignments = await this.prisma.routineAssignment.findMany({
      where: {
        memberId,
      },
      include: {
        template: {
          select: {
            id: true,
            name: true,
            description: true,
          },
        },
      },
      orderBy: [{ startDate: 'desc' }, { createdAt: 'desc' }],
    });

    return assignments.map((a) => this.withComputedStatus(a));
  }

  /**
   * Trainer anula una asignación (error, sustitución por otra, etc.).
   * No cuenta para solapamiento de fechas; el member deja de verla como vigente.
   */
  async archiveAssignment(trainerId: string, assignmentId: string) {
    const assignment = await this.prisma.routineAssignment.findFirst({
      where: { id: assignmentId, trainerId },
      include: {
        template: {
          select: {
            id: true,
            name: true,
            description: true,
          },
        },
      },
    });

    if (!assignment) {
      throw new NotFoundException('Routine assignment not found');
    }

    if (assignment.status === 'archived') {
      throw new BadRequestException('Routine assignment is already archived');
    }

    const updated = await this.prisma.routineAssignment.update({
      where: { id: assignmentId },
      data: { status: 'archived' },
      include: {
        template: {
          select: {
            id: true,
            name: true,
            description: true,
          },
        },
      },
    });

    return this.withComputedStatus(updated);
  }
}
