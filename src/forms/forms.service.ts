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

type FormField =
  | { type: 'number'; label: string; required: boolean }
  | { type: 'photo'; label: string; required: boolean };

@Injectable()
export class FormsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly s3Upload: S3UploadService,
  ) {}

  private readonly requiredFormFields: FormField[] = [
    { type: 'number', label: 'Peso', required: true },
    { type: 'number', label: 'Edad', required: true },

    { type: 'number', label: 'Hombros', required: true },
    { type: 'number', label: 'Pecho', required: true },
    { type: 'number', label: 'Pecho', required: true },
    { type: 'number', label: 'Bíceps', required: true },
    { type: 'number', label: 'Cintura', required: true },
    { type: 'number', label: 'Cadera', required: true },
    { type: 'number', label: 'Cuádriceps', required: true },
    { type: 'number', label: 'Gemelos', required: true },

    { type: 'photo', label: 'Foto frontal', required: true },
    { type: 'photo', label: 'Foto lateral', required: true },
  ];

  async getTemplates(trainerId: string) {
    const templates = await this.prisma.formTemplate.findMany({
      where: {
        trainerId,
        isArchived: false,
      },
    });
    return templates;
  }

  async getTemplate(trainerId: string, templateId: string) {
    const template = await this.prisma.formTemplate.findFirst({
      where: {
        trainerId,
        id: templateId,
      },
    });
    return template;
  }

  async createTemplate(trainerId: string, dto: CreateFormTemplateDto) {
    const formFields: FormField[] = [
      ...this.requiredFormFields,
      ...(dto.customFields ?? []),
    ];

    const template = await this.prisma.formTemplate.create({
      data: {
        trainerId,
        name: dto.name,
        description: dto.description,
        schema: formFields as any,
      },
    });

    return template;
  }

  async duplicateTemplate(trainerId: string, templateId: string) {
    const existing = await this.prisma.formTemplate.findFirst({
      where: {
        id: templateId,
        trainerId,
      },
    });

    if (!existing) {
      return null;
    }

    const duplicated = await this.prisma.formTemplate.create({
      data: {
        trainerId,
        name: `${existing.name} (copy ${Date.now()})`,
        description: existing.description,
        schema: existing.schema as any,
      },
    });

    return duplicated;
  }

  async archiveTemplate(trainerId: string, templateId: string) {
    const template = await this.prisma.formTemplate.updateMany({
      where: {
        id: templateId,
        trainerId,
      },
      data: {
        isArchived: true,
      },
    });

    return template;
  }

  async updateTemplate(
    trainerId: string,
    templateId: string,
    dto: UpdateFormTemplateDto,
  ) {
    const data: any = {};

    if (dto.name !== undefined) data.name = dto.name;
    if (dto.description !== undefined) data.description = dto.description;

    if (dto.customFields !== undefined) {
      const formFields: FormField[] = [
        ...this.requiredFormFields,
        ...(dto.customFields ?? []),
      ];
      data.schema = formFields as any;
    }

    const template = await this.prisma.formTemplate.updateMany({
      where: {
        id: templateId,
        trainerId,
      },
      data,
    });

    return template;
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

    const assignment = await this.prisma.formAssignment.create({
      data: {
        trainerId,
        memberId: dto.memberId,
        templateId: template.id,
        schemaSnapshot: template.schema as any,
        dueAt: dto.dueAt ? new Date(dto.dueAt) : null,
      },
    });

    return assignment;
  }

  /**
   * Get assignments for the current user as member (no memberId),
   * or for a specific member when current user is their trainer (memberId in query).
   */
  async getAssignments(userId: string, memberId?: string) {
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
        include: {
          template: {
            select: { id: true, name: true, description: true },
          },
        },
        orderBy: { createdAt: 'desc' },
      });
    }

    return this.prisma.formAssignment.findMany({
      where: { memberId: userId },
      include: {
        template: {
          select: { id: true, name: true, description: true },
        },
      },
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
    const assignment = await this.prisma.formAssignment.findUnique({
      where: { id: assignmentId, memberId },
    });
    if (!assignment) {
      throw new NotFoundException('Assignment not found');
    }

    const [response] = await this.prisma.$transaction([
      this.prisma.formResponse.create({
        data: {
          assignmentId,
          memberId,
          answers: dto.answers as any,
        },
      }),
      this.prisma.formAssignment.update({
        where: { id: assignmentId },
        data: { status: 'completed' },
      }),
    ]);

    return response;
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
}
