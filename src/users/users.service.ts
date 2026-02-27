import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from 'src/auth/auth-user-type';
import { UpdateMeDto } from './dto/update-me-dto';
import { UserRole } from 'generated/prisma/enums';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async getMeById(id: string) {
    const user = await this.prisma.user.findFirst({
      where: { id },
      select: {
        id: true,
        email: true,
        fullName: true,
        role: true,
        auth_provider: true,
      },
    });

    // if (!user) throw new NotFoundException('User not found');
    return user;
  }

  // Alternativa: si tu auth te da email en vez de id
  async getMeByEmail(email: string) {
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        fullName: true,
        role: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    // if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async createUser(user: AuthUser) {
    const createdUser = await this.prisma.user.create({
      data: {
        id: user.id,
        email: user.email,
        auth_provider: user.auth_provider,
        fullName: user.fullName ?? null,
        role: null,
      },
      select: {
        id: true,
        email: true,
        fullName: true,
        role: true,
        auth_provider: true,
      },
    });
    return createdUser;
  }

  async updateUser(id: string, dto: UpdateMeDto) {
    const updatedUser = await this.prisma.user.update({
      where: { id },
      data: {
        fullName: dto.fullName ?? null,
        role: (dto.role as UserRole) ?? null,
      },
    });
    return updatedUser;
  }
}
