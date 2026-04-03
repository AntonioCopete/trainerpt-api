import { Module } from '@nestjs/common';
import { InvitesService } from './invites.service';
import { InvitesController } from './invites.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';

@Module({
  imports: [PrismaModule, SubscriptionsModule],
  controllers: [InvitesController],
  providers: [InvitesService],
  exports: [InvitesService],
})
export class InvitesModule {}
