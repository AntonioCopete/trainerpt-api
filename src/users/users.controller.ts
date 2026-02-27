import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { SupabaseJwtGuard } from '../auth/supabase-jwt.guard';
import { CurrentUser } from '../auth/current-user-decorator';
import type { AuthUser } from '../auth/auth-user-type';
import { UsersService } from './users.service';
import { UpdateMeDto } from './dto/update-me-dto';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}
  @UseGuards(SupabaseJwtGuard)
  @Get('me')
  async me(@CurrentUser() user: AuthUser) {
    const userFromDB = await this.usersService.getMeById(user.id);

    if (userFromDB) return { user: userFromDB };

    const newUser = await this.usersService.createUser(user);
    return {
      user: newUser,
    };
  }

  @UseGuards(SupabaseJwtGuard)
  @Patch('me')
  async updateMe(@CurrentUser() user: AuthUser, @Body() dto: UpdateMeDto) {
    if (!dto.fullName && !dto.role) {
      throw new BadRequestException('Provide at least one field: name or role');
    }

    const updated = await this.usersService.updateUser(user.id, dto);
    return { user: updated };
  }
}
