import { Injectable } from '@nestjs/common';
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
}
