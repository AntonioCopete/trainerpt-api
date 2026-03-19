import {
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

@Injectable()
export class FormsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly s3Upload: S3UploadService,
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

    const dueAt = dto.dueAt ? new Date(dto.dueAt) : null;
    const windowStart = dueAt
      ? new Date(dueAt.getTime() - 48 * 60 * 60 * 1000) // 48 hours before
      : null;

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

    return this.prisma.formAssignment.findMany({
      where: { memberId: userId },
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

    return assignment;
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

      const response = await tx.formResponse.create({
        data: {
          assignmentId,
          memberId,
          answers: dto.answers as any,
        },
      });

      await tx.formAssignment.update({
        where: { id: assignmentId },
        data: { status: 'completed' },
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

    const nextDueAt = this.calculateNextDueAt(parent.dueAt, parent.repeat);
    const windowStart = new Date(nextDueAt.getTime() - 48 * 60 * 60 * 1000);

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

  private calculateNextDueAt(currentDueAt: Date, repeat: string): Date {
    // Trabajar en UTC para evitar problemas de zona horaria
    const current = new Date(currentDueAt.toISOString());

    if (repeat === 'weekly') {
      current.setUTCDate(current.getUTCDate() + 7);
    } else if (repeat === 'monthly') {
      current.setUTCMonth(current.getUTCMonth() + 1);
    }

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
    if (assignment.status === 'completed') {
      throw new ForbiddenException(
        'Cannot upload files to a completed assignment',
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
    const now = new Date();

    // Find all pending assignments that are overdue and recurring
    const overdueAssignments = await this.prisma.formAssignment.findMany({
      where: {
        status: 'pending',
        dueAt: { lt: now },
        repeat: { not: 'none' },
      },
    });

    const results: Array<{
      id: string;
      status: string;
      error?: string;
    }> = [];

    for (const assignment of overdueAssignments) {
      try {
        await this.prisma.$transaction(async (tx) => {
          // Mark as missed
          await tx.formAssignment.update({
            where: { id: assignment.id },
            data: { status: 'missed' },
          });

          // Create next recurring assignment
          await this.createNextRecurringAssignment(tx, assignment);
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
      processed: overdueAssignments.length,
      results,
      timestamp: new Date().toISOString(),
    };
  }
}
