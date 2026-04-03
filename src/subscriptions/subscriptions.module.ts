import { Module } from '@nestjs/common';
import { SubscriptionsController } from './subscriptions.controller';
import { StripeWebhookController } from './stripe-webhook.controller';
import { SubscriptionsService } from './subscriptions.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [SubscriptionsController, StripeWebhookController],
  providers: [SubscriptionsService],
  exports: [SubscriptionsService],
})
export class SubscriptionsModule {}
