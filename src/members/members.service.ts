import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class MembersService {
  constructor(private readonly prisma: PrismaService) {}

  async getMembersForTrainer(trainerId: string) {
    const links = await this.prisma.trainerMemberLink.findMany({
      where: { trainerId },
      include: {
        member: {
          select: {
            id: true,
            email: true,
            fullName: true,
            role: true,
            createdAt: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    return links.map((link) => link.member);
  }

  async getMember(trainerId: string, memberId: string) {
    const member = await this.prisma.user.findUnique({
      where: { id: memberId },
      include: {
        memberLinks: {
          where: { trainerId },
        },
      },
    });
    return member;
  }

  async unlinkMemberForTrainer(
    trainerId: string,
    memberId: string,
  ): Promise<{ unlinked: boolean; cancelledCount: number }> {
    if (!memberId) {
      throw new BadRequestException('memberId is required');
    }

    return this.prisma.$transaction(async (tx) => {
      const link = await tx.trainerMemberLink.findUnique({
        where: {
          trainerId_memberId: {
            trainerId,
            memberId,
          },
        },
      });

      if (!link) {
        throw new NotFoundException('Member link not found');
      }

      await tx.trainerMemberLink.delete({
        where: {
          trainerId_memberId: {
            trainerId,
            memberId,
          },
        },
      });

      // Al desvincular, cortamos cualquier assignment pendiente del par,
      // para que no pueda continuarse la recurrencia ni enviar el member.
      const cancelled = await tx.formAssignment.updateMany({
        where: {
          trainerId,
          memberId,
          status: 'pending',
        },
        data: {
          status: 'archived',
        },
      });

      return {
        unlinked: true,
        cancelledCount: cancelled.count,
      };
    });
  }

  async unlinkTrainerForMember(
    memberId: string,
    trainerId: string,
  ): Promise<{ unlinked: boolean; cancelledCount: number }> {
    if (!trainerId) {
      throw new BadRequestException('trainerId is required');
    }

    return this.prisma.$transaction(async (tx) => {
      const link = await tx.trainerMemberLink.findUnique({
        where: {
          trainerId_memberId: {
            trainerId,
            memberId,
          },
        },
      });

      if (!link) {
        throw new NotFoundException('Member link not found');
      }

      await tx.trainerMemberLink.delete({
        where: {
          trainerId_memberId: {
            trainerId,
            memberId,
          },
        },
      });

      const cancelled = await tx.formAssignment.updateMany({
        where: {
          trainerId,
          memberId,
          status: 'pending',
        },
        data: {
          status: 'archived',
        },
      });

      return {
        unlinked: true,
        cancelledCount: cancelled.count,
      };
    });
  }
}
