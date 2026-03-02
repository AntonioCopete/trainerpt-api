import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { InvitesService } from './invites.service';
import { SupabaseJwtGuard } from '../auth/supabase-jwt.guard';
import { CurrentUser } from '../auth/current-user-decorator';
import type { AuthUser } from '../auth/auth-user-type';
import { CreateInviteDto } from './dto/create-invite.dto';
import { RedeemInviteDto } from './dto/redeem-invite.dto';

@Controller('invites')
export class InvitesController {
  constructor(private readonly invitesService: InvitesService) {}

  // POST /invites → crea una invitación
  @UseGuards(SupabaseJwtGuard)
  @Post()
  async createInvite(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateInviteDto,
  ) {
    const invite = await this.invitesService.createInvite(user.id, dto);
    const inviteUrl = `${process.env.WEB_URL}/join?code=${invite.code}`;
    return { url: inviteUrl };
  }

  // POST /invites/redeem → canjea el código para el usuario autenticado
  @UseGuards(SupabaseJwtGuard)
  @Post('redeem')
  async redeemInvite(
    @CurrentUser() user: AuthUser,
    @Body() dto: RedeemInviteDto,
  ) {
    const invite = await this.invitesService.redeemInvite(user.id, dto);
    return { invite };
  }
}
