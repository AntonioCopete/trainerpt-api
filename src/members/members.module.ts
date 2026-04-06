import { Module } from '@nestjs/common';
import { MembersService } from './members.service';
import { MembersController } from './members.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { ResourcesModule } from '../resources/resources.module';

@Module({
  imports: [PrismaModule, ResourcesModule],
  controllers: [MembersController],
  providers: [MembersService],
})
export class MembersModule {}
