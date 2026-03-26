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
  CreateRoutineTemplateDto,
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

  async getExercises(userId: string, search?: string) {
    const q = search?.trim();
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
      take: 1000,
    });

    const mapped = exercises.map((exercise) => {
      const raw = (exercise.raw ?? {}) as Record<string, unknown>;
      const images = Array.isArray(exercise.images)
        ? (exercise.images as Array<Record<string, unknown>>)
        : [];
      const videos = Array.isArray(exercise.videos)
        ? (exercise.videos as Array<Record<string, unknown>>)
        : [];
      const esDescription = (exercise as any).descriptionEs;
      const esCategoryName = (exercise as any).categoryNameEs;
      const esEquipment = (exercise as any).equipmentEs;
      const esMuscles = (exercise as any).musclesEs;
      const esMusclesSecondary = (exercise as any).musclesSecondaryEs;
      const esName = (exercise as any).nameEs;

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

      return {
        ...exercise,
        // Priorizar columnas *_es, pero mantener key names estándar para el frontend.
        name: esName ?? exercise.name,
        description: esDescription ?? exercise.description,
        categoryName: esCategoryName ?? exercise.categoryName,
        equipment: esEquipment ?? (exercise as any).equipment,
        muscles: esMuscles ?? (exercise as any).muscles,
        musclesSecondary:
          esMusclesSecondary ?? (exercise as any).musclesSecondary,
        author: customAuthor ?? datasetAuthor,
        license: exercise.license ?? null,
        imageUrl,
        videoUrl,
        imageUrls,
        videoUrls,
      };
    });

    if (!q) return mapped;

    const query = q.toLowerCase();
    const includesQuery = (value: unknown): boolean =>
      typeof value === 'string' && value.toLowerCase().includes(query);

    const includesQueryInArray = (value: unknown): boolean =>
      Array.isArray(value) &&
      value.some(
        (entry) =>
          typeof entry === 'string' && entry.toLowerCase().includes(query),
      );

    return mapped.filter((exercise) => {
      return (
        includesQuery(exercise.name) ||
        includesQuery((exercise as any).nameEs) ||
        includesQuery(exercise.categoryName) ||
        includesQuery((exercise as any).categoryNameEs) ||
        includesQuery((exercise as any).author) ||
        includesQueryInArray((exercise as any).muscles) ||
        includesQueryInArray((exercise as any).musclesEs) ||
        includesQueryInArray((exercise as any).musclesSecondary) ||
        includesQueryInArray((exercise as any).musclesSecondaryEs) ||
        includesQueryInArray((exercise as any).equipment) ||
        includesQueryInArray((exercise as any).equipmentEs) ||
        includesQueryInArray((exercise as any).description) ||
        includesQueryInArray((exercise as any).descriptionEs)
      );
    });
  }

  async createCustomExercise(userId: string, dto: CreateCustomExerciseDto) {
    const images = dto.imageUrl ? [{ image: dto.imageUrl }] : [];
    const videos = dto.videoUrl ? [{ video: dto.videoUrl }] : [];
    const descriptionArray = this.toDescriptionArray(dto.description);

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

    return this.prisma.exercise.update({
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
        images: nextImages as any,
        videos: nextVideos as any,
      },
    });
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
      throw new NotFoundException('Routine template not found or already archived');
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
}
