import { Controller, Get, Post, Body, UseGuards, Req } from '@nestjs/common';
import { SubscriptionsService } from './subscriptions.service';
import { SupabaseJwtGuard } from '../auth/supabase-jwt.guard';
import { CurrentUser } from '../auth/current-user-decorator';
import type { AuthUser } from '../auth/auth-user-type';
import { CreateCheckoutSessionDto } from './dto/create-checkout-session.dto';

@Controller('subscriptions')
@UseGuards(SupabaseJwtGuard)
export class SubscriptionsController {
  constructor(private readonly subscriptionsService: SubscriptionsService) {}

  @Get('me')
  async getMySubscription(@CurrentUser() user: AuthUser) {
    return this.subscriptionsService.getSubscriptionWithUsage(user.id);
  }

  @Get('history')
  async getMyHistory(@CurrentUser() user: AuthUser) {
    return this.subscriptionsService.getSubscriptionHistory(user.id);
  }

  @Post('checkout')
  async createCheckoutSession(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateCheckoutSessionDto,
  ) {
    const url = await this.subscriptionsService.createCheckoutSession(
      user.id,
      dto.plan,
    );
    return { url };
  }

  @Post('portal')
  async createPortalSession(@CurrentUser() user: AuthUser) {
    const url = await this.subscriptionsService.createPortalSession(user.id);
    return { url };
  }
}
