import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { MembersService } from './members.service';
import { SupabaseJwtGuard } from '../auth/supabase-jwt.guard';
import { CurrentUser } from '../auth/current-user-decorator';
import type { AuthUser } from '../auth/auth-user-type';

@Controller('members')
export class MembersController {
  constructor(private readonly membersService: MembersService) {}

  @UseGuards(SupabaseJwtGuard)
  @Get()
  async getMembers(@CurrentUser() user: AuthUser) {
    const members = await this.membersService.getMembersForTrainer(user.id);
    return { members };
  }

  @UseGuards(SupabaseJwtGuard)
  @Get(':memberId')
  async getMember(
    @CurrentUser() user: AuthUser,
    @Param('memberId') memberId: string,
  ) {
    const member = await this.membersService.getMember(user.id, memberId);
    return { member };
  }
}
