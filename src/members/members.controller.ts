import { Controller, Delete, Get, Param, UseGuards } from '@nestjs/common';
import { MembersService } from './members.service';
import { ResourcesService } from '../resources/resources.service';
import { SupabaseJwtGuard } from '../auth/supabase-jwt.guard';
import { CurrentUser } from '../auth/current-user-decorator';
import type { AuthUser } from '../auth/auth-user-type';

@Controller('members')
export class MembersController {
  constructor(
    private readonly membersService: MembersService,
    private readonly resourcesService: ResourcesService,
  ) {}

  @UseGuards(SupabaseJwtGuard)
  @Get()
  async getMembers(@CurrentUser() user: AuthUser) {
    const members = await this.membersService.getMembersForTrainer(user.id);
    return { members };
  }

  /** Documents shared with the authenticated member (must be declared before :memberId). */
  @UseGuards(SupabaseJwtGuard)
  @Get('me/resources')
  async listMyResources(@CurrentUser() user: AuthUser) {
    return this.resourcesService.listForMember(user.id);
  }

  @UseGuards(SupabaseJwtGuard)
  @Get('me/resources/:resourceId/download-url')
  async myResourceDownloadUrl(
    @CurrentUser() user: AuthUser,
    @Param('resourceId') resourceId: string,
  ) {
    return this.resourcesService.getMemberDownloadUrl(user.id, resourceId);
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
   * Trainer unlink: remove a member from the relationship (trainerId=authUser).
   * Also cancels (archives) all pending assignments for the pair.
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
   * Member unlink: remove a trainer (trainerId=param) from the relationship (memberId=authUser).
   * Also cancels (archives) all pending assignments for the pair.
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
