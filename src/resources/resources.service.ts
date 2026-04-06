import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { S3UploadService } from '../forms/s3-upload.service';
import { ResourceType } from 'generated/prisma/enums';
import { CreateResourceDto } from './dto/create-resource.dto';
import { ResourceUploadUrlDto } from './dto/resource-upload-url.dto';

const ALLOWED_RESOURCE_CONTENT_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
]);

const MAX_RESOURCE_BYTES = 30 * 1024 * 1024;

@Injectable()
export class ResourcesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: S3UploadService,
  ) {}

  private assertAllowedContentType(contentType: string) {
    const ct = (contentType || '').split(';')[0].trim().toLowerCase();
    if (!ALLOWED_RESOURCE_CONTENT_TYPES.has(ct)) {
      throw new BadRequestException(
        `Tipo de archivo no permitido. Usa PDF o imagen (JPEG, PNG).`,
      );
    }
  }

  private assertSize(size?: number | null) {
    if (size == null) return;
    if (size > MAX_RESOURCE_BYTES) {
      throw new BadRequestException(
        `El archivo supera el tamaño máximo (${MAX_RESOURCE_BYTES / 1024 / 1024} MB).`,
      );
    }
  }

  private async assertMembersBelongToTrainer(
    trainerId: string,
    memberIds: string[],
  ) {
    const unique = [...new Set(memberIds)];
    if (unique.length === 0) return;
    const count = await this.prisma.trainerMemberLink.count({
      where: {
        trainerId,
        memberId: { in: unique },
      },
    });
    if (count !== unique.length) {
      throw new BadRequestException(
        'Uno o más clientes no pertenecen a tu cartera o no existen.',
      );
    }
  }

  async create(trainerId: string, dto: CreateResourceDto) {
    this.assertAllowedContentType(dto.contentType);
    this.assertSize(dto.size ?? null);

    const resource = await this.prisma.resource.create({
      data: {
        trainerId,
        title: dto.title.trim(),
        description: dto.description.trim(),
        resourceType: dto.resourceType,
        filename: dto.filename,
        contentType: dto.contentType,
        size: dto.size ?? null,
      },
      include: { shares: true },
    });

    return { resource: this.toTrainerResource(resource) };
  }

  async listForTrainer(trainerId: string, resourceTypeFilter?: string) {
    let resourceType: ResourceType | undefined;
    if (resourceTypeFilter != null && resourceTypeFilter !== '') {
      const allowed = Object.values(ResourceType) as string[];
      if (!allowed.includes(resourceTypeFilter)) {
        throw new BadRequestException('resourceType inválido');
      }
      resourceType = resourceTypeFilter as ResourceType;
    }

    const rows = await this.prisma.resource.findMany({
      where: {
        trainerId,
        ...(resourceType ? { resourceType } : {}),
      },
      include: { shares: true },
      orderBy: { createdAt: 'desc' },
    });

    return { resources: rows.map((r) => this.toTrainerResource(r)) };
  }

  async deleteResource(trainerId: string, resourceId: string) {
    const resource = await this.prisma.resource.findFirst({
      where: { id: resourceId, trainerId },
    });
    if (!resource) throw new NotFoundException('Recurso no encontrado');

    if (resource.storageKey) {
      await this.storage.deleteObject(resource.storageKey);
    }

    await this.prisma.resource.delete({ where: { id: resourceId } });
    return { deleted: true };
  }

  async patchShares(
    trainerId: string,
    resourceId: string,
    memberIds: string[],
  ) {
    const resource = await this.prisma.resource.findFirst({
      where: { id: resourceId, trainerId },
    });
    if (!resource) throw new NotFoundException('Recurso no encontrado');

    const uniqueMemberIds = [...new Set(memberIds)];
    await this.assertMembersBelongToTrainer(trainerId, uniqueMemberIds);

    await this.prisma.$transaction(async (tx) => {
      await tx.resourceShare.deleteMany({ where: { resourceId } });
      if (uniqueMemberIds.length > 0) {
        await tx.resourceShare.createMany({
          data: uniqueMemberIds.map((memberId) => ({ resourceId, memberId })),
          skipDuplicates: true,
        });
      }
    });

    const updated = await this.prisma.resource.findUniqueOrThrow({
      where: { id: resourceId },
      include: { shares: true },
    });
    return { resource: this.toTrainerResource(updated) };
  }

  async requestUploadUrl(
    trainerId: string,
    resourceId: string,
    dto: ResourceUploadUrlDto,
  ) {
    const resource = await this.prisma.resource.findFirst({
      where: { id: resourceId, trainerId },
    });
    if (!resource) throw new NotFoundException('Recurso no encontrado');

    this.assertAllowedContentType(dto.contentType);

    if (resource.storageKey) {
      await this.storage.deleteObject(resource.storageKey);
    }

    const { uploadUrl, key } = await this.storage.getResourcePresignedUploadUrl(
      trainerId,
      resourceId,
      dto.filename,
      dto.contentType,
    );

    if (!this.storage.isResourceStorageKey(key, trainerId, resourceId)) {
      throw new BadRequestException('Clave de almacenamiento inválida');
    }

    await this.prisma.resource.update({
      where: { id: resourceId },
      data: {
        storageKey: key,
        filename: dto.filename,
        contentType: dto.contentType,
      },
    });

    return { uploadUrl, key };
  }

  async getTrainerDownloadUrl(trainerId: string, resourceId: string) {
    const resource = await this.prisma.resource.findFirst({
      where: { id: resourceId, trainerId },
    });
    if (!resource) throw new NotFoundException('Recurso no encontrado');
    if (!resource.storageKey) {
      throw new BadRequestException(
        'El archivo aún no se ha subido. Solicita upload-url y completa el PUT a GCS.',
      );
    }
    const { url } = await this.storage.getPresignedReadUrl(resource.storageKey);
    return { url };
  }

  async listForMember(memberId: string) {
    const rows = await this.prisma.resource.findMany({
      where: {
        shares: { some: { memberId } },
      },
      include: { shares: { where: { memberId } } },
      orderBy: { createdAt: 'desc' },
    });

    return {
      resources: rows.map((r) => this.toMemberResource(r)),
    };
  }

  async getMemberDownloadUrl(memberId: string, resourceId: string) {
    const share = await this.prisma.resourceShare.findFirst({
      where: { memberId, resourceId },
      include: { resource: true },
    });
    if (!share) throw new ForbiddenException('No tienes acceso a este recurso');
    if (!share.resource.storageKey) {
      throw new BadRequestException('El archivo aún no está disponible.');
    }
    const { url } = await this.storage.getPresignedReadUrl(
      share.resource.storageKey,
    );
    return { url };
  }

  private toTrainerResource(
    r: {
      id: string;
      title: string;
      description: string | null;
      resourceType: ResourceType;
      filename: string;
      contentType: string;
      size: number | null;
      storageKey: string | null;
      createdAt: Date;
      updatedAt: Date;
      shares: { memberId: string }[];
    },
  ) {
    return {
      id: r.id,
      title: r.title,
      description: r.description,
      resourceType: r.resourceType,
      filename: r.filename,
      contentType: r.contentType,
      size: r.size,
      storageKey: r.storageKey,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
      sharedMemberIds: r.shares.map((s) => s.memberId),
    };
  }

  private toMemberResource(r: {
    id: string;
    title: string;
    description: string | null;
    resourceType: ResourceType;
    filename: string;
    contentType: string;
    createdAt: Date;
  }) {
    return {
      id: r.id,
      title: r.title,
      description: r.description,
      resourceType: r.resourceType,
      filename: r.filename,
      contentType: r.contentType,
      createdAt: r.createdAt.toISOString(),
    };
  }
}
