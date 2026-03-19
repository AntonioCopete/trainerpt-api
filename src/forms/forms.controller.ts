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
import { FormsService } from './forms.service';
import {
  CreateFormTemplateDto,
  AssignFormTemplateDto,
  UpdateFormTemplateDto,
  SubmitAssignmentDto,
  PresignedUploadUrlDto,
} from './dto/create-form-template.dto';
import { SupabaseJwtGuard } from '../auth/supabase-jwt.guard';
import { CurrentUser } from '../auth/current-user-decorator';
import type { AuthUser } from '../auth/auth-user-type';
import { CronAuthGuard } from '../common/guards/cron-auth.guard';

@Controller('forms')
export class FormsController {
  constructor(private readonly formsService: FormsService) {}

  @UseGuards(SupabaseJwtGuard)
  @Get('template')
  async getTemplates(@CurrentUser() user: AuthUser) {
    const templates = await this.formsService.getTemplates(user.id);
    return { templates };
  }

  @UseGuards(SupabaseJwtGuard)
  @Get('template/archived')
  async getArchivedTemplates(@CurrentUser() user: AuthUser) {
    const templates = await this.formsService.getArchivedTemplates(user.id);
    return { templates };
  }

  @UseGuards(SupabaseJwtGuard)
  @Get('template/:templateId')
  async getTemplate(
    @CurrentUser() user: AuthUser,
    @Param('templateId') templateId: string,
  ) {
    const template = await this.formsService.getTemplate(user.id, templateId);
    return { template };
  }

  @UseGuards(SupabaseJwtGuard)
  @Post('template')
  async createTemplate(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateFormTemplateDto,
  ) {
    const template = await this.formsService.createTemplate(user.id, dto);
    return { template };
  }

  @UseGuards(SupabaseJwtGuard)
  @Post('template/:templateId/duplicate')
  async duplicateTemplate(
    @CurrentUser() user: AuthUser,
    @Param('templateId') templateId: string,
  ) {
    const template = await this.formsService.duplicateTemplate(
      user.id,
      templateId,
    );
    return { template };
  }

  @UseGuards(SupabaseJwtGuard)
  @Patch('template/:templateId/archive')
  async archiveTemplate(
    @CurrentUser() user: AuthUser,
    @Param('templateId') templateId: string,
  ) {
    const template = await this.formsService.archiveTemplate(
      user.id,
      templateId,
    );
    return { template };
  }

  @UseGuards(SupabaseJwtGuard)
  @Delete('template/:templateId')
  async deleteTemplate(
    @CurrentUser() user: AuthUser,
    @Param('templateId') templateId: string,
  ) {
    const template = await this.formsService.deleteTemplate(
      user.id,
      templateId,
    );
    return { template };
  }

  @UseGuards(SupabaseJwtGuard)
  @Patch('template/:templateId/restore')
  async restoreTemplate(
    @CurrentUser() user: AuthUser,
    @Param('templateId') templateId: string,
  ) {
    const template = await this.formsService.restoreTemplate(
      user.id,
      templateId,
    );
    return { template };
  }

  @UseGuards(SupabaseJwtGuard)
  @Patch('template/:templateId/update')
  async updateTemplate(
    @CurrentUser() user: AuthUser,
    @Param('templateId') templateId: string,
    @Body() dto: UpdateFormTemplateDto,
  ) {
    const template = await this.formsService.updateTemplate(
      user.id,
      templateId,
      dto,
    );
    return { template };
  }

  @UseGuards(SupabaseJwtGuard)
  @Get('assignments')
  async getAssignments(
    @CurrentUser() user: AuthUser,
    @Query('memberId') memberId?: string,
    @Query('templateId') templateId?: string,
  ) {
    const assignments = await this.formsService.getAssignments(
      user.id,
      memberId,
      templateId,
    );
    return { assignments };
  }

  @UseGuards(SupabaseJwtGuard)
  @Get('assignments/:assignmentId')
  async getAssignment(
    @CurrentUser() user: AuthUser,
    @Param('assignmentId') assignmentId: string,
  ) {
    const assignment = await this.formsService.getAssignment(
      user.id,
      assignmentId,
    );
    return { assignment };
  }

  @UseGuards(SupabaseJwtGuard)
  @Post('assignments/:assignmentId/upload-url')
  async getUploadUrl(
    @CurrentUser() user: AuthUser,
    @Param('assignmentId') assignmentId: string,
    @Body() dto: PresignedUploadUrlDto,
  ) {
    const result = await this.formsService.getPresignedUploadUrl(
      user.id,
      assignmentId,
      dto,
    );
    return result;
  }

  @UseGuards(SupabaseJwtGuard)
  @Get('photo-url')
  async getPhotoUrl(@CurrentUser() user: AuthUser, @Query('key') key: string) {
    const result = await this.formsService.getPresignedReadUrl(user.id, key);
    return result;
  }

  @UseGuards(SupabaseJwtGuard)
  @Post('assignments/:assignmentId/submit')
  async submitAssignment(
    @CurrentUser() user: AuthUser,
    @Param('assignmentId') assignmentId: string,
    @Body() dto: SubmitAssignmentDto,
  ) {
    const response = await this.formsService.submitAssignment(
      user.id,
      assignmentId,
      dto,
    );
    return { response };
  }

  @UseGuards(SupabaseJwtGuard)
  @Post('template/:templateId/assign')
  async assignTemplate(
    @CurrentUser() user: AuthUser,
    @Param('templateId') templateId: string,
    @Body() dto: AssignFormTemplateDto,
  ) {
    const assignment = await this.formsService.assignTemplate(
      user.id,
      templateId,
      dto,
    );
    return { assignment };
  }

  @UseGuards(SupabaseJwtGuard)
  @Patch('assignments/:assignmentId/cancel')
  async cancelAssignment(
    @CurrentUser() user: AuthUser,
    @Param('assignmentId') assignmentId: string,
  ) {
    const result = await this.formsService.cancelAssignment(
      user.id,
      assignmentId,
    );
    return result;
  }

  /**
   * Internal cron endpoint to process overdue recurring assignments
   * This should be called by Cloud Scheduler daily
   * Protected by CRON_SECRET_TOKEN environment variable
   */
  @UseGuards(CronAuthGuard)
  @Post('internal/cron/process-overdue')
  async processOverdueAssignments() {
    const result = await this.formsService.processOverdueAssignments();
    return result;
  }
}
