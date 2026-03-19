import { Controller, Delete, Get, Param, UseGuards } from '@nestjs/common';
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

  /**
   * Trainer unlink: desvincula un member de la relación (trainerId=authUser).
   * También cancela (archiva) todas las assignments pendientes del par.
   */
  @UseGuards(SupabaseJwtGuard)
  @Delete(':memberId/unlink')
  async unlinkMember(
    @CurrentUser() user: AuthUser,
    @Param('memberId') memberId: string,
  ) {
    const result = await this.membersService.unlinkMemberForTrainer(
      user.id,
      memberId,
    );
    return result;
  }

  /**
   * Member unlink: desvincula un trainer (trainerId=param) de la relación (memberId=authUser).
   * También cancela (archiva) todas las assignments pendientes del par.
   */
  @UseGuards(SupabaseJwtGuard)
  @Delete('unlink/:trainerId')
  async unlinkTrainer(
    @CurrentUser() user: AuthUser,
    @Param('trainerId') trainerId: string,
  ) {
    const result = await this.membersService.unlinkTrainerForMember(
      user.id,
      trainerId,
    );
    return result;
  }
}
