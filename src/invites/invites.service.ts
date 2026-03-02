import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateInviteDto } from './dto/create-invite.dto';
import { RedeemInviteDto } from './dto/redeem-invite.dto';
import { randomBytes } from 'crypto';

const INVITE_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

@Injectable()
export class InvitesService {
  constructor(private readonly prisma: PrismaService) {}

  private generateCode(length = 8) {
    const bytes = randomBytes(length);
    let code = '';

    for (let i = 0; i < length; i++) {
      const index = bytes[i] % INVITE_CODE_ALPHABET.length;
      code += INVITE_CODE_ALPHABET[index];
    }

    return code;
  }

  async createInvite(trainerId: string, dto: CreateInviteDto) {
    const trainer = await this.prisma.user.findUnique({
      where: { id: trainerId },
      select: { id: true, role: true },
    });

    if (!trainer) {
      throw new BadRequestException('Trainer not found');
    }

    // Límite: máximo 100 invites pendientes por trainer
    const pendingInvitesCount = await this.prisma.trainerInvite.count({
      where: {
        trainerId,
        status: 'pending',
      },
    });

    if (pendingInvitesCount >= 100) {
      throw new BadRequestException(
        'Maximum pending invites limit reached (100)',
      );
    }

    const code = this.generateCode();

    const invite = await this.prisma.trainerInvite.create({
      data: {
        trainerId,
        email: dto.email ? dto.email.toLowerCase() : null,
        code,
      },
      select: {
        id: true,
        trainerId: true,
        email: true,
        code: true,
        status: true,
        expiresAt: true,
        createdAt: true,
      },
    });

    return invite;
  }

  async redeemInvite(memberId: string, dto: RedeemInviteDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: memberId },
    });

    if (!user) {
      throw new BadRequestException('User not found');
    }

    const invite = await this.prisma.trainerInvite.findUnique({
      where: { code: dto.code },
    });

    if (!invite) {
      throw new BadRequestException('Invite not found');
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const currentInvite = await tx.trainerInvite.findUnique({
        where: { id: invite.id },
      });

      if (!currentInvite || currentInvite.status !== 'pending') {
        throw new BadRequestException('Invite is invalid or already used');
      }

      const existingLink = await tx.trainerMemberLink.findUnique({
        where: {
          trainerId_memberId: {
            trainerId: invite.trainerId,
            memberId,
          },
        },
      });

      if (!existingLink) {
        await tx.trainerMemberLink.create({
          data: {
            trainerId: invite.trainerId,
            memberId,
          },
        });
      }

      if (user.role === null) {
        await tx.user.update({
          where: { id: memberId },
          data: { role: 'member' },
        });
      }

      const updatedInvite = await tx.trainerInvite.update({
        where: { id: invite.id },
        data: {
          status: 'accepted',
          memberId,
        },
        select: {
          id: true,
          trainerId: true,
          memberId: true,
          email: true,
          status: true,
          code: true,
          createdAt: true,
          acceptedAt: true,
        },
      });

      return updatedInvite;
    });

    return result;
  }
}
