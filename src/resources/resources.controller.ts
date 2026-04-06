import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ResourcesService } from './resources.service';
import { SupabaseJwtGuard } from '../auth/supabase-jwt.guard';
import { CurrentUser } from '../auth/current-user-decorator';
import type { AuthUser } from '../auth/auth-user-type';
import { CreateResourceDto } from './dto/create-resource.dto';
import { ResourceUploadUrlDto } from './dto/resource-upload-url.dto';
import { PatchResourceSharesDto } from './dto/patch-resource-shares.dto';

@Controller('resources')
export class ResourcesController {
  constructor(private readonly resourcesService: ResourcesService) {}

  @UseGuards(SupabaseJwtGuard)
  @Post()
  async create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateResourceDto,
  ) {
    return this.resourcesService.create(user.id, dto);
  }

  @UseGuards(SupabaseJwtGuard)
  @Get()
  async list(
    @CurrentUser() user: AuthUser,
    @Query('resourceType') resourceType?: string,
  ) {
    return this.resourcesService.listForTrainer(user.id, resourceType);
  }

  @UseGuards(SupabaseJwtGuard)
  @Delete(':resourceId')
  async remove(
    @CurrentUser() user: AuthUser,
    @Param('resourceId') resourceId: string,
  ) {
    return this.resourcesService.deleteResource(user.id, resourceId);
  }

  @UseGuards(SupabaseJwtGuard)
  @Patch(':resourceId/shares')
  async patchShares(
    @CurrentUser() user: AuthUser,
    @Param('resourceId') resourceId: string,
    @Body() dto: PatchResourceSharesDto,
  ) {
    return this.resourcesService.patchShares(
      user.id,
      resourceId,
      dto.memberIds,
    );
  }

  @UseGuards(SupabaseJwtGuard)
  @Post(':resourceId/upload-url')
  async uploadUrl(
    @CurrentUser() user: AuthUser,
    @Param('resourceId') resourceId: string,
    @Body() dto: ResourceUploadUrlDto,
  ) {
    return this.resourcesService.requestUploadUrl(user.id, resourceId, dto);
  }

  @UseGuards(SupabaseJwtGuard)
  @Get(':resourceId/download-url')
  async trainerDownloadUrl(
    @CurrentUser() user: AuthUser,
    @Param('resourceId') resourceId: string,
  ) {
    return this.resourcesService.getTrainerDownloadUrl(user.id, resourceId);
  }
}
