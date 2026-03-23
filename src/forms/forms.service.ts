import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateFormTemplateDto,
  AssignFormTemplateDto,
  UpdateFormTemplateDto,
  SubmitAssignmentDto,
  PresignedUploadUrlDto,
} from './dto/create-form-template.dto';
import { S3UploadService } from './s3-upload.service';
import { Prisma } from 'generated/prisma/client';
import { TranslationService } from '../common/services/translation.service';

@Injectable()
export class FormsService {
  // Tiempo previo (en horas) durante el cual el member puede empezar a responder.
  // Interpretamos dueAt como fin de día UTC; por eso usamos UTC y un intervalo fijo en horas.
  private readonly RESPONSE_WINDOW_MS = 72 * 60 * 60 * 1000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly s3Upload: S3UploadService,
    private readonly translationService: TranslationService,
  ) {}

  async getTemplates(trainerId: string) {
    const templates = await this.prisma.formTemplate.findMany({
      where: {
        trainerId,
        isArchived: false,
        deletedAt: null,
      },
    });
    return templates;
  }

  async getArchivedTemplates(trainerId: string) {
    const templates = await this.prisma.formTemplate.findMany({
      where: {
        trainerId,
        isArchived: true,
        deletedAt: null,
      },
      orderBy: {
        updatedAt: 'desc',
      },
    });
    return templates;
  }

  async getTemplate(trainerId: string, templateId: string) {
    const template = await this.prisma.formTemplate.findFirst({
      where: {
        trainerId,
        id: templateId,
        deletedAt: null,
      },
    });
    return template;
  }

  async createTemplate(trainerId: string, dto: CreateFormTemplateDto) {
    const template = await this.prisma.formTemplate.create({
      data: {
        trainerId,
        name: dto.name,
        description: dto.description,
        schema: dto.schema as any,
      },
    });

    return template;
  }

  async duplicateTemplate(trainerId: string, templateId: string) {
    const existing = await this.prisma.formTemplate.findFirst({
      where: {
        id: templateId,
        trainerId,
        deletedAt: null,
      },
    });

    if (!existing) {
      return null;
    }

    // Buscar cuántas copias existen ya con este nombre base (excluyendo borradas)
    const existingCopies = await this.prisma.formTemplate.count({
      where: {
        trainerId,
        deletedAt: null,
        name: {
          startsWith: `${existing.name} (copia`,
        },
      },
    });

    // También verificar si existe el nombre base + " (copia)"
    const exactCopy = await this.prisma.formTemplate.findFirst({
      where: {
        trainerId,
        deletedAt: null,
        name: `${existing.name} (copia)`,
      },
    });

    let newName: string;
    if (!exactCopy && existingCopies === 0) {
      newName = `${existing.name} (copia)`;
    } else {
      newName = `${existing.name} (copia ${existingCopies + 1})`;
    }

    const duplicated = await this.prisma.formTemplate.create({
      data: {
        trainerId,
        name: newName,
        description: existing.description,
        schema: existing.schema as any,
      },
    });

    return duplicated;
  }

  async archiveTemplate(trainerId: string, templateId: string) {
    const template = await this.prisma.formTemplate.findFirst({
      where: {
        id: templateId,
        trainerId,
        deletedAt: null,
        isArchived: false, // Solo archivar si no está ya archivada
      },
    });

    if (!template) {
      throw new NotFoundException('Template not found or already archived');
    }

    return await this.prisma.formTemplate.update({
      where: { id: templateId },
      data: { isArchived: true },
    });
  }

  async restoreTemplate(trainerId: string, templateId: string) {
    const template = await this.prisma.formTemplate.findFirst({
      where: {
        id: templateId,
        trainerId,
        deletedAt: null,
        isArchived: true, // Solo restaurar si está archivada
      },
    });

    if (!template) {
      throw new NotFoundException('Template not found or not archived');
    }

    return await this.prisma.formTemplate.update({
      where: { id: templateId },
      data: { isArchived: false },
    });
  }

  async deleteTemplate(trainerId: string, templateId: string) {
    const template = await this.prisma.formTemplate.findFirst({
      where: {
        id: templateId,
        trainerId,
        deletedAt: null,
        isArchived: true,
      },
    });

    if (!template) {
      throw new NotFoundException('Template not found or already deleted');
    }

    return await this.prisma.formTemplate.update({
      where: { id: templateId },
      data: { deletedAt: new Date() },
    });
  }

  async updateTemplate(
    trainerId: string,
    templateId: string,
    dto: UpdateFormTemplateDto,
  ) {
    const existing = await this.prisma.formTemplate.findFirst({
      where: {
        id: templateId,
        trainerId,
        deletedAt: null,
      },
    });

    if (!existing) {
      throw new NotFoundException('Template not found');
    }

    const data: any = {};

    if (dto.name !== undefined) data.name = dto.name;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.schema !== undefined) data.schema = dto.schema as any;

    return await this.prisma.formTemplate.update({
      where: { id: templateId },
      data,
    });
  }

  async assignTemplate(
    trainerId: string,
    templateId: string,
    dto: AssignFormTemplateDto,
  ) {
    const template = await this.prisma.formTemplate.findFirst({
      where: {
        id: templateId,
        trainerId,
        isArchived: false,
        deletedAt: null,
      },
    });

    if (!template) {
      throw new NotFoundException('Template not found');
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

    // Verificar si ya existe un assignment pendiente del mismo template
    const existingPending = await this.prisma.formAssignment.findFirst({
      where: {
        trainerId,
        memberId: dto.memberId,
        templateId: template.id,
        status: 'pending',
      },
    });

    if (existingPending) {
      throw new ForbiddenException(
        'Member already has a pending assignment for this template',
      );
    }

    const dueAt = dto.dueAt ? this.toUtcEndOfDay(dto.dueAt) : null;
    if (dueAt) {
      const now = new Date();
      if (dueAt.getTime() < now.getTime()) {
        throw new BadRequestException('dueAt must be today or a future date');
      }
    }
    const windowStart = dueAt
      ? new Date(dueAt.getTime() - this.RESPONSE_WINDOW_MS)
      : // 72 hours before
        null;

    const assignment = await this.prisma.formAssignment.create({
      data: {
        trainerId,
        memberId: dto.memberId,
        templateId: template.id,
        schemaSnapshot: template.schema as any,
        dueAt,
        windowStart,
        repeat: dto.repeat || 'none',
      },
    });

    return assignment;
  }

  /**
   * Get assignments:
   * - templateId: trainer view → assignments for that template (trainerId + templateId).
   * - memberId: trainer view → assignments for that member (trainerId + memberId).
   * - neither: member view → current user's assignments (memberId = userId).
   */
  async getAssignments(userId: string, memberId?: string, templateId?: string) {
    const includeTemplate = {
      template: {
        select: { id: true, name: true, description: true },
      },
    };

    if (templateId) {
      const template = await this.prisma.formTemplate.findFirst({
        where: { id: templateId, trainerId: userId },
      });
      if (!template) {
        throw new NotFoundException('Template not found');
      }
      const where: {
        trainerId: string;
        templateId: string;
        memberId?: string;
      } = { trainerId: userId, templateId };
      if (memberId) where.memberId = memberId;
      return this.prisma.formAssignment.findMany({
        where,
        include: {
          ...includeTemplate,
          member: { select: { id: true, fullName: true, email: true } },
        },
        orderBy: { createdAt: 'desc' },
      });
    }

    if (memberId) {
      const link = await this.prisma.trainerMemberLink.findUnique({
        where: {
          trainerId_memberId: { trainerId: userId, memberId },
        },
      });
      if (!link) {
        throw new ForbiddenException('Member is not linked to trainer');
      }
      return this.prisma.formAssignment.findMany({
        where: { trainerId: userId, memberId },
        include: includeTemplate,
        orderBy: { createdAt: 'desc' },
      });
    }

    // Caso "member view": no viene `memberId` ni `templateId` en query,
    // así que asumimos que el usuario actual es el member.
    // En esa vista ocultamos assignments cancelados (`archived`).
    return this.prisma.formAssignment.findMany({
      where: { memberId: userId, status: { not: 'archived' } },
      include: includeTemplate,
      orderBy: { createdAt: 'desc' },
    });
  }

  async getAssignment(userId: string, assignmentId: string) {
    const assignment = await this.prisma.formAssignment.findUnique({
      where: { id: assignmentId },
      include: {
        template: {
          select: { id: true, name: true, description: true },
        },
        responses: {
          orderBy: { submittedAt: 'desc' },
        },
      },
    });
    if (!assignment) {
      throw new NotFoundException('Assignment not found');
    }

    const isMember = assignment.memberId === userId;
    const isTrainer = assignment.trainerId === userId;

    if (!isMember && !isTrainer) {
      throw new ForbiddenException(
        'You are not allowed to access this assignment',
      );
    }

    // Si el usuario es el member y el trainer lo canceló, ocultamos el assignment.
    if (isMember && assignment.status === 'archived') {
      throw new NotFoundException('Assignment not found');
    }

    return assignment;
  }

  async cancelAssignment(
    trainerId: string,
    assignmentId: string,
  ): Promise<{ cancelledCount: number }> {
    const assignment = await this.prisma.formAssignment.findUnique({
      where: { id: assignmentId },
      select: {
        id: true,
        trainerId: true,
        memberId: true,
        templateId: true,
      },
    });

    if (!assignment) {
      throw new NotFoundException('Assignment not found');
    }

    if (assignment.trainerId !== trainerId) {
      throw new ForbiddenException(
        'You are not allowed to cancel this assignment',
      );
    }

    if (!assignment.templateId) {
      throw new BadRequestException(
        'Cannot cancel this assignment because it is missing templateId',
      );
    }

    // Cancelamos el pending actual para ese member + plantilla.
    // Esto evita:
    // - que el member pueda enviar (bloqueo por status archived)
    // - que el cron o el flujo recurrente creen el siguiente (porque no habrá pending)
    const res = await this.prisma.formAssignment.updateMany({
      where: {
        trainerId,
        memberId: assignment.memberId,
        templateId: assignment.templateId,
        status: 'pending',
      },
      data: { status: 'archived' },
    });

    return { cancelledCount: res.count };
  }

  async submitAssignment(
    memberId: string,
    assignmentId: string,
    dto: SubmitAssignmentDto,
  ) {
    const result = await this.prisma.$transaction(async (tx) => {
      const assignment = await tx.formAssignment.findUnique({
        where: { id: assignmentId, memberId },
      });

      if (!assignment) {
        throw new NotFoundException('Assignment not found');
      }

      // Seguridad de flujo:
      // Si el member se desvinculó del trainer, no permitir enviar
      // ni disparar la creación del "siguiente" recurrente.
      const link = await tx.trainerMemberLink.findUnique({
        where: {
          trainerId_memberId: {
            trainerId: assignment.trainerId,
            memberId,
          },
        },
      });
      if (!link) {
        throw new ForbiddenException(
          'Member is not linked to this trainer anymore',
        );
      }

      const now = new Date();

      // Validar ventana de respuesta
      if (assignment.windowStart && now < assignment.windowStart) {
        throw new ForbiddenException(
          'Cannot submit assignment before window start',
        );
      }

      // Validar deadline
      if (assignment.dueAt && now > assignment.dueAt) {
        throw new ForbiddenException('Assignment deadline has passed');
      }

      // Validar estado
      if (assignment.status === 'completed') {
        throw new ForbiddenException('Assignment already completed');
      }

      if (assignment.status === 'missed') {
        throw new ForbiddenException('Assignment already missed');
      }

      if (assignment.status === 'archived') {
        throw new ForbiddenException('Assignment has been cancelled');
      }

      // Evitar carreras: solo uno debe poder marcar como completed.
      const completionUpdate = await tx.formAssignment.updateMany({
        where: { id: assignmentId, memberId, status: 'pending' },
        data: { status: 'completed' },
      });

      if (completionUpdate.count !== 1) {
        throw new ForbiddenException(
          'Assignment already processed by another request',
        );
      }

      const response = await tx.formResponse.create({
        data: {
          assignmentId,
          memberId,
          answers: dto.answers as any,
        },
      });

      // 🔥 HÍBRIDO: Si es recurrente, crear el siguiente inmediatamente
      if (assignment.repeat !== 'none') {
        await this.createNextRecurringAssignment(tx, assignment);
      }

      return response;
    });

    return result;
  }

  private async createNextRecurringAssignment(
    tx: any,
    parent: any,
  ): Promise<void> {
    if (!parent.dueAt || parent.repeat === 'none') {
      return;
    }

    // Seguridad de flujo: si el member se desvinculó del trainer,
    // no crear el siguiente recurrente.
    const link = await tx.trainerMemberLink.findUnique({
      where: {
        trainerId_memberId: {
          trainerId: parent.trainerId,
          memberId: parent.memberId,
        },
      },
    });
    if (!link) {
      return;
    }

    // Idempotencia ante pings/requests repetidos: no creemos otro hijo
    // si ya existe uno para esta instancia (parentAssignmentId).
    const existingChild = await tx.formAssignment.findFirst({
      where: { parentAssignmentId: parent.id },
      select: { id: true },
    });
    if (existingChild) {
      return;
    }

    const nextDueAt = this.calculateNextDueAt(parent.dueAt, parent.repeat);
    const windowStart = new Date(nextDueAt.getTime() - this.RESPONSE_WINDOW_MS);

    await tx.formAssignment.create({
      data: {
        trainerId: parent.trainerId,
        memberId: parent.memberId,
        templateId: parent.templateId,
        schemaSnapshot: parent.schemaSnapshot,
        repeat: parent.repeat,
        dueAt: nextDueAt,
        windowStart,
        parentAssignmentId: parent.id,
        status: 'pending',
      },
    });
  }

  private toUtcEndOfDay(dateStr: string): Date {
    // Frontend envia YYYY-MM-DD. Lo interpretamos como UTC "fin de día".
    const [yyyy, mm, dd] = dateStr.split('-').map((v) => Number(v));
    return new Date(Date.UTC(yyyy, mm - 1, dd, 23, 59, 59, 999));
  }

  private calculateNextDueAt(currentDueAt: Date, repeat: string): Date {
    // Trabajar en UTC para evitar problemas de zona horaria
    const current = new Date(currentDueAt.toISOString());

    if (repeat === 'weekly') {
      current.setUTCDate(current.getUTCDate() + 7);
    } else if (repeat === 'monthly') {
      current.setUTCMonth(current.getUTCMonth() + 1);
    }

    // Garantizar que siempre sea "fin de día" (para que el vencimiento sea por fecha)
    current.setUTCHours(23, 59, 59, 999);
    return current;
  }

  async getPresignedUploadUrl(
    memberId: string,
    assignmentId: string,
    dto: PresignedUploadUrlDto,
  ) {
    const assignment = await this.prisma.formAssignment.findUnique({
      where: { id: assignmentId, memberId },
    });
    if (!assignment) {
      throw new NotFoundException('Assignment not found');
    }
    if (assignment.status === 'completed' || assignment.status === 'archived') {
      throw new ForbiddenException(
        'Cannot upload files to a completed or cancelled assignment',
      );
    }
    return this.s3Upload.getPresignedUploadUrl(
      assignmentId,
      memberId,
      dto.filename,
      dto.contentType,
    );
  }

  async getPresignedReadUrl(userId: string, key: string) {
    if (!this.s3Upload.isAllowedKey(key)) {
      throw new ForbiddenException('Invalid photo key');
    }
    const parts = key.split('/');
    const assignmentId = parts[0];
    if (!assignmentId) {
      throw new ForbiddenException('Invalid photo key');
    }
    const assignment = await this.prisma.formAssignment.findUnique({
      where: { id: assignmentId },
    });
    if (!assignment) {
      throw new NotFoundException('Assignment not found');
    }
    const canRead =
      assignment.memberId === userId || assignment.trainerId === userId;
    if (!canRead) {
      throw new ForbiddenException('You cannot access this photo');
    }
    return this.s3Upload.getPresignedReadUrl(key);
  }

  /**
   * Cron job endpoint to process overdue assignments
   * This should be called by Cloud Scheduler daily
   */
  async processOverdueAssignments() {
    // Obtener timestamp actual en UTC
    // Nota: new Date() siempre devuelve UTC internamente,
    // pero lo hacemos explícito para claridad
    const now = new Date();

    console.log(
      `[CRON] Processing overdue assignments at ${now.toISOString()}`,
    );

    // Find all pending assignments that are overdue (one-off + recurring)
    const overdueAssignments = await this.prisma.formAssignment.findMany({
      where: {
        status: 'pending',
        dueAt: { lt: now }, // Prisma compara UTC con UTC automáticamente
      },
    });

    console.log(
      `[CRON] Found ${overdueAssignments.length} overdue assignments`,
    );

    const results: Array<{
      id: string;
      status: string;
      error?: string;
    }> = [];

    for (const assignment of overdueAssignments) {
      try {
        await this.prisma.$transaction(async (tx) => {
          // Idempotencia / anti-race:
          // Solo avanzamos si este assignment sigue exactamente en pending.
          const missedUpdate = await tx.formAssignment.updateMany({
            where: {
              id: assignment.id,
              status: 'pending',
              dueAt: { lt: now },
            },
            data: { status: 'missed' },
          });

          if (missedUpdate.count !== 1) {
            return;
          }

          // Re-leer el parent dentro del tx para no depender de un snapshot viejo.
          const parent = await tx.formAssignment.findUnique({
            where: { id: assignment.id },
            select: {
              id: true,
              dueAt: true,
              repeat: true,
              trainerId: true,
              memberId: true,
              templateId: true,
              schemaSnapshot: true,
            },
          });

          if (!parent) {
            return;
          }

          // Create next recurring assignment only for recurring cadence
          if (parent.repeat !== 'none') {
            await this.createNextRecurringAssignment(tx, parent);
          }
        });

        results.push({ id: assignment.id, status: 'processed' });
      } catch (error: any) {
        results.push({
          id: assignment.id,
          status: 'error',
          error: error.message,
        });
      }
    }

    return {
      processed: results.filter((r) => r.status === 'processed').length,
      results,
      timestamp: now.toISOString(), // Devolver en formato ISO UTC para claridad
    };
  }
  async syncExercisesFromFreeDb() {
    type FreeExerciseItem = {
      id?: string;
      name?: string;
      category?: string | null;
      equipment?: string | null;
      force?: string | null;
      level?: string | null;
      mechanic?: string | null;
      primaryMuscles?: string[];
      secondaryMuscles?: string[];
      instructions?: string[];
      images?: string[];
    };

    const datasetUrl =
      process.env.FREE_EXERCISE_DB_URL ||
      'https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/dist/exercises.json';
    const imageBaseUrl =
      process.env.FREE_EXERCISE_DB_IMAGE_BASE_URL ||
      'https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises/';
    const maxItems = Number(process.env.EXERCISE_SYNC_MAX_ITEMS || 0);

    const res = await fetch(datasetUrl);
    if (!res.ok) {
      const body = await res.text();
      throw new BadRequestException(
        `Free exercise DB sync failed: ${res.status} ${res.statusText} - ${body}`,
      );
    }

    const data = (await res.json()) as unknown;
    if (!Array.isArray(data)) {
      throw new BadRequestException(
        'Free exercise DB payload must be an array',
      );
    }

    const allItems = data as FreeExerciseItem[];
    const items =
      Number.isFinite(maxItems) && maxItems > 0
        ? allItems.slice(0, maxItems)
        : allItems;
    let totalFetched = 0;
    let totalUpserted = 0;
    let totalSkipped = 0;
    const skippedByReason: Record<string, number> = {};
    const translationCache = new Map<string, string | null>();

    const normalizeEsText = (value: string | null): string | null => {
      if (!value) return null;
      const trimmed = value.trim();
      if (!trimmed) return null;
      const lowered = trimmed.toLowerCase();
      if (lowered === 'null' || lowered === 'undefined' || lowered === 'n/a') {
        return null;
      }
      return trimmed;
    };

    const capitalizeFirst = (value: string): string =>
      value.length > 0 ? value.charAt(0).toUpperCase() + value.slice(1) : value;

    const sanitizeEsArray = (values: string[] | null): string[] | null => {
      if (!values || values.length === 0) return null;
      const cleaned = values
        .map((v) => normalizeEsText(v))
        .filter((v): v is string => Boolean(v))
        .map((v) => v.toLowerCase());
      return cleaned.length > 0 ? cleaned : null;
    };

    // Traducciones canónicas de anatomía fitness (evita errores del traductor general).
    const muscleMap: Record<string, string> = {
      abdominals: 'abdominales',
      abductors: 'abductores',
      adductors: 'aductores',
      biceps: 'bíceps',
      calves: 'pantorrillas',
      chest: 'pecho',
      forearms: 'antebrazos',
      glutes: 'glúteos',
      hamstrings: 'isquiotibiales',
      lats: 'dorsales',
      'lower back': 'lumbar',
      quadriceps: 'cuádriceps',
      shoulders: 'hombros',
      triceps: 'tríceps',
      traps: 'trapecios',
    };

    const translateMuscleTerm = async (term: string): Promise<string> => {
      const normalized = term.trim().toLowerCase();
      if (!normalized) return term;
      const canonical = muscleMap[normalized];
      if (canonical) return canonical;
      const translated = await translateCached(term);
      return (translated || term).toLowerCase();
    };

    const translateCached = async (text: string): Promise<string | null> => {
      const normalized = text.trim();
      if (!normalized) return null;
      const cacheKey = normalized.toLowerCase();
      if (translationCache.has(cacheKey)) {
        return translationCache.get(cacheKey) ?? null;
      }

      const translated = await this.translationService.translateText(
        normalized,
        {
          to: 'es',
        },
      );
      const trimmed = normalizeEsText(translated?.trim() || null);
      const isSame =
        trimmed !== null &&
        trimmed.localeCompare(normalized, undefined, {
          sensitivity: 'base',
        }) === 0;
      const finalText = !trimmed || isSame ? null : trimmed;

      translationCache.set(cacheKey, finalText);
      return finalText;
    };

    const toStablePositiveInt = (value: string) => {
      let hash = 0;
      for (let i = 0; i < value.length; i += 1) {
        hash = (hash * 31 + value.charCodeAt(i)) | 0;
      }
      return Math.abs(hash) || 1;
    };

    for (const item of items) {
      totalFetched += 1;
      const name = item.name?.trim() || '';
      const category = item.category?.trim() || null;
      const instructions = Array.isArray(item.instructions)
        ? item.instructions
            .map((step) => (typeof step === 'string' ? step.trim() : ''))
            .filter((step) => step.length > 0)
        : [];

      if (!name || !item.id) {
        totalSkipped += 1;
        const reason = !name ? 'invalid_name' : 'missing_id';
        skippedByReason[reason] = (skippedByReason[reason] || 0) + 1;
        continue;
      }

      const translatedNameRaw = await translateCached(name);
      const translatedName = translatedNameRaw
        ? capitalizeFirst(translatedNameRaw)
        : null;

      const translatedInstructionsRaw = await Promise.all(
        instructions.map((step) => translateCached(step)),
      );
      const hasAnyInstructionTranslation = translatedInstructionsRaw.some((v) =>
        Boolean(v),
      );
      const translatedInstructions = hasAnyInstructionTranslation
        ? instructions.map(
            (step, idx) => translatedInstructionsRaw[idx] || step,
          )
        : [];
      const description = instructions.length > 0 ? instructions : null;
      const translatedDescription = hasAnyInstructionTranslation
        ? translatedInstructions.length > 0
          ? translatedInstructions
          : null
        : description;
      const legacyDescriptionText = description ? description.join('\n') : null;

      const imageUrls = Array.isArray(item.images)
        ? item.images
            .map((path) => `${imageBaseUrl}${String(path).replace(/^\/+/, '')}`)
            .filter(Boolean)
        : [];

      const equipment = item.equipment ? [item.equipment] : [];
      const muscles = Array.isArray(item.primaryMuscles)
        ? item.primaryMuscles
        : [];
      const musclesSecondary = Array.isArray(item.secondaryMuscles)
        ? item.secondaryMuscles
        : [];
      const categoryNameEsRaw = category
        ? await translateCached(category)
        : null;
      const categoryNameEs = categoryNameEsRaw
        ? categoryNameEsRaw.toLowerCase()
        : null;

      const equipmentEsRaw =
        equipment.length > 0
          ? await Promise.all(equipment.map((value) => translateCached(value)))
          : [];
      const hasAnyEquipmentTranslation = equipmentEsRaw.some((v) => Boolean(v));
      const rawEquipmentEs = hasAnyEquipmentTranslation
        ? equipment.map((value, idx) => {
            const translated = normalizeEsText(equipmentEsRaw[idx] || null);
            const finalValue = translated || value;
            return finalValue.toLowerCase();
          })
        : null;
      const equipmentEs = sanitizeEsArray(rawEquipmentEs);

      const musclesEsRaw =
        muscles.length > 0
          ? await Promise.all(
              muscles.map((value) => translateMuscleTerm(value)),
            )
          : [];
      const hasAnyMuscleTranslation = musclesEsRaw.some((v) => Boolean(v));
      const rawMusclesEs = hasAnyMuscleTranslation
        ? muscles.map((value, idx) => {
            const translated = normalizeEsText(musclesEsRaw[idx] || null);
            const finalValue = translated || value;
            return finalValue.toLowerCase();
          })
        : null;
      const musclesEs = sanitizeEsArray(rawMusclesEs);

      const musclesSecondaryEsRaw =
        musclesSecondary.length > 0
          ? await Promise.all(
              musclesSecondary.map((value) => translateMuscleTerm(value)),
            )
          : [];
      const hasAnySecondaryMuscleTranslation = musclesSecondaryEsRaw.some((v) =>
        Boolean(v),
      );
      const rawMusclesSecondaryEs = hasAnySecondaryMuscleTranslation
        ? musclesSecondary.map((value, idx) => {
            const translated = normalizeEsText(
              musclesSecondaryEsRaw[idx] || null,
            );
            const finalValue = translated || value;
            return finalValue.toLowerCase();
          })
        : null;
      const musclesSecondaryEs = sanitizeEsArray(rawMusclesSecondaryEs);
      const equipmentEsValue = equipmentEs
        ? (equipmentEs as Prisma.InputJsonValue)
        : Prisma.DbNull;
      const musclesEsValue = musclesEs
        ? (musclesEs as Prisma.InputJsonValue)
        : Prisma.DbNull;
      const musclesSecondaryEsValue = musclesSecondaryEs
        ? (musclesSecondaryEs as Prisma.InputJsonValue)
        : Prisma.DbNull;

      const externalId = toStablePositiveInt(item.id);

      const baseRaw = {
        source: 'free-exercise-db',
        author: 'free-exercise-db',
        force: item.force ?? null,
        level: item.level ?? null,
        mechanic: item.mechanic ?? null,
        original: item,
      } as Prisma.InputJsonValue;

      try {
        await this.prisma.exercise.upsert({
          where: {
            source_externalId: {
              source: 'free_exercise_db' as any,
              externalId,
            },
          },
          create: {
            source: 'free_exercise_db' as any,
            externalId,
            externalUuid: item.id,
            name,
            nameEs: translatedName,
            description: description as Prisma.InputJsonValue | null,
            descriptionEs:
              translatedDescription as Prisma.InputJsonValue | null,
            categoryId: null,
            categoryName: category,
            categoryNameEs: categoryNameEs ?? null,
            equipment: equipment as Prisma.InputJsonValue,
            equipmentEs: equipmentEsValue,
            muscles: muscles as Prisma.InputJsonValue,
            musclesEs: musclesEsValue,
            musclesSecondary: musclesSecondary as Prisma.InputJsonValue,
            musclesSecondaryEs: musclesSecondaryEsValue,
            images: imageUrls.map((url) => ({
              image: url,
            })) as Prisma.InputJsonValue,
            videos: [] as Prisma.InputJsonValue,
            license: Prisma.JsonNull,
            lastUpdateAt: null,
            lastUpdateGlobal: null,
            raw: baseRaw,
            isArchived: false,
            deletedAt: null,
          } as any,
          update: {
            externalUuid: item.id,
            name,
            nameEs: translatedName,
            description: description as Prisma.InputJsonValue | null,
            descriptionEs:
              translatedDescription as Prisma.InputJsonValue | null,
            categoryId: null,
            categoryName: category,
            categoryNameEs: categoryNameEs ?? null,
            equipment: equipment as Prisma.InputJsonValue,
            equipmentEs: equipmentEsValue,
            muscles: muscles as Prisma.InputJsonValue,
            musclesEs: musclesEsValue,
            musclesSecondary: musclesSecondary as Prisma.InputJsonValue,
            musclesSecondaryEs: musclesSecondaryEsValue,
            images: imageUrls.map((url) => ({
              image: url,
            })) as Prisma.InputJsonValue,
            videos: [] as Prisma.InputJsonValue,
            license: Prisma.JsonNull,
            lastUpdateAt: null,
            lastUpdateGlobal: null,
            raw: baseRaw,
            isArchived: false,
            deletedAt: null,
          } as any,
        });
      } catch (error) {
        const errorName =
          typeof error === 'object' && error !== null && 'name' in error
            ? String((error as { name?: unknown }).name || '')
            : '';
        const errorMessage =
          typeof error === 'object' && error !== null && 'message' in error
            ? String((error as { message?: unknown }).message || '')
            : '';

        const isDescriptionStringMismatch =
          (errorName === 'PrismaClientValidationError' ||
            errorMessage.includes('PrismaClientValidationError')) &&
          errorMessage.includes(
            'Argument `description`: Invalid value provided',
          );
        const isMissingColumn =
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2022';
        if (!isMissingColumn && !isDescriptionStringMismatch) throw error;

        // Fallback para bases desalineadas: escribimos un subconjunto de columnas.
        const existing = await this.prisma.exercise.findFirst({
          where: { source: 'free_exercise_db' as any, externalId },
          select: { id: true },
        });
        if (existing) {
          await this.prisma.exercise.update({
            where: { id: existing.id },
            data: {
              name,
              description: legacyDescriptionText,
              categoryName: category,
              images: imageUrls.map((url) => ({
                image: url,
              })) as Prisma.InputJsonValue,
              videos: [] as Prisma.InputJsonValue,
              raw: baseRaw,
              isArchived: false,
              deletedAt: null,
            } as any,
          });
        } else {
          await this.prisma.exercise.create({
            data: {
              source: 'free_exercise_db' as any,
              externalId,
              name,
              description: legacyDescriptionText,
              categoryName: category,
              images: imageUrls.map((url) => ({
                image: url,
              })) as Prisma.InputJsonValue,
              videos: [] as Prisma.InputJsonValue,
              raw: baseRaw,
              isArchived: false,
              deletedAt: null,
            } as any,
          });
        }
      }
      totalUpserted += 1;
    }

    return {
      ok: true,
      source: 'free-exercise-db',
      fetched: totalFetched,
      upserted: totalUpserted,
      skipped: totalSkipped,
      skippedByReason,
      maxItems: maxItems > 0 ? maxItems : null,
      syncedAt: new Date().toISOString(),
    };
  }
}
