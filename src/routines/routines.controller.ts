import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { RoutinesService } from './routines.service';
import type { AuthUser } from '../auth/auth-user-type';
import { CurrentUser } from '../auth/current-user-decorator';
import { SupabaseJwtGuard } from '../auth/supabase-jwt.guard';
import {
  AssignRoutineTemplateDto,
  CreateCustomExerciseDto,
  CreateCustomRoutineAssignmentDto,
  CreateRoutineTemplateDto,
  UpdateCustomExerciseDto,
  UpdateRoutineTemplateDto,
} from './dto/routines.dto';

@Controller('routines')
export class RoutinesController {
  constructor(private readonly routinesService: RoutinesService) {}

  @UseGuards(SupabaseJwtGuard)
  @Get('muscles')
  async getMuscles(@CurrentUser() _user: AuthUser) {
    const muscles = await this.routinesService.listMusclesCatalog();
    return { muscles };
  }

  @UseGuards(SupabaseJwtGuard)
  @Get('exercises')
  async getExercises(
    @CurrentUser() user: AuthUser,
    @Query('q') q?: string,
  ) {
    const exercises = await this.routinesService.getExercises(user.id, q);
    return { exercises };
  }

  @UseGuards(SupabaseJwtGuard)
  @Post('exercises/custom')
  async createCustomExercise(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateCustomExerciseDto,
  ) {
    const exercise = await this.routinesService.createCustomExercise(user.id, dto);
    return { exercise };
  }

  @UseGuards(SupabaseJwtGuard)
  @Get('exercises/custom')
  async listTrainerCustomExercises(
    @CurrentUser() user: AuthUser,
    @Query('q') q?: string,
  ) {
    const exercises = await this.routinesService.listTrainerCustomExercises(
      user.id,
      q,
    );
    return { exercises };
  }

  @UseGuards(SupabaseJwtGuard)
  @Get('exercises/custom/:exerciseId')
  async getCustomExerciseForEdit(
    @CurrentUser() user: AuthUser,
    @Param('exerciseId') exerciseId: string,
  ) {
    const exercise = await this.routinesService.getCustomExerciseForEdit(
      user.id,
      exerciseId,
    );
    return { exercise };
  }

  @UseGuards(SupabaseJwtGuard)
  @Patch('exercises/:exerciseId')
  async updateCustomExercise(
    @CurrentUser() user: AuthUser,
    @Param('exerciseId') exerciseId: string,
    @Body() dto: UpdateCustomExerciseDto,
  ) {
    const exercise = await this.routinesService.updateCustomExercise(
      user.id,
      exerciseId,
      dto,
    );
    return { exercise };
  }

  @UseGuards(SupabaseJwtGuard)
  @Get('templates')
  async getTemplates(@CurrentUser() user: AuthUser) {
    const templates = await this.routinesService.getTemplates(user.id);
    return { templates };
  }

  @UseGuards(SupabaseJwtGuard)
  @Get('templates/archived')
  async getArchivedTemplates(@CurrentUser() user: AuthUser) {
    const templates = await this.routinesService.getArchivedTemplates(user.id);
    return { templates };
  }

  @UseGuards(SupabaseJwtGuard)
  @Post('templates')
  async createTemplate(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateRoutineTemplateDto,
  ) {
    const template = await this.routinesService.createTemplate(user.id, dto);
    return { template };
  }

  @UseGuards(SupabaseJwtGuard)
  @Patch('templates/:templateId')
  async updateTemplate(
    @CurrentUser() user: AuthUser,
    @Param('templateId') templateId: string,
    @Body() dto: UpdateRoutineTemplateDto,
  ) {
    const template = await this.routinesService.updateTemplate(
      user.id,
      templateId,
      dto,
    );
    return { template };
  }

  @UseGuards(SupabaseJwtGuard)
  @Patch('templates/:templateId/archive')
  async archiveTemplate(
    @CurrentUser() user: AuthUser,
    @Param('templateId') templateId: string,
  ) {
    const template = await this.routinesService.archiveTemplate(user.id, templateId);
    return { template };
  }

  @UseGuards(SupabaseJwtGuard)
  @Patch('templates/:templateId/restore')
  async restoreTemplate(
    @CurrentUser() user: AuthUser,
    @Param('templateId') templateId: string,
  ) {
    const template = await this.routinesService.restoreTemplate(user.id, templateId);
    return { template };
  }

  @UseGuards(SupabaseJwtGuard)
  @Patch('templates/:templateId/delete')
  async deleteTemplate(
    @CurrentUser() user: AuthUser,
    @Param('templateId') templateId: string,
  ) {
    const template = await this.routinesService.deleteTemplate(user.id, templateId);
    return { template };
  }

  @UseGuards(SupabaseJwtGuard)
  @Post('templates/:templateId/assign')
  async assignTemplate(
    @CurrentUser() user: AuthUser,
    @Param('templateId') templateId: string,
    @Body() dto: AssignRoutineTemplateDto,
  ) {
    const assignment = await this.routinesService.assignTemplate(
      user.id,
      templateId,
      dto,
    );
    return { assignment };
  }

  @UseGuards(SupabaseJwtGuard)
  @Post('assignments/custom')
  async createCustomAssignment(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateCustomRoutineAssignmentDto,
  ) {
    const assignment = await this.routinesService.createCustomAssignment(
      user.id,
      dto,
    );
    return { assignment };
  }

  @UseGuards(SupabaseJwtGuard)
  @Get('assignments')
  async getAssignments(
    @CurrentUser() user: AuthUser,
    @Query('memberId') memberId?: string,
    @Query('templateId') templateId?: string,
  ) {
    const assignments = await this.routinesService.getAssignments(
      user.id,
      memberId,
      templateId,
    );
    return { assignments };
  }

  @UseGuards(SupabaseJwtGuard)
  @Get('assignments/trainer')
  async getTrainerAssignments(
    @CurrentUser() user: AuthUser,
    @Query('memberId') memberId?: string,
    @Query('status') status?: 'scheduled' | 'active' | 'expired' | 'archived',
  ) {
    const assignments = await this.routinesService.getTrainerAssignments(
      user.id,
      memberId,
      status,
    );
    return { assignments };
  }

  @UseGuards(SupabaseJwtGuard)
  @Get('assignments/trainer/:assignmentId')
  async getTrainerAssignmentById(
    @CurrentUser() user: AuthUser,
    @Param('assignmentId') assignmentId: string,
  ) {
    const assignment = await this.routinesService.getTrainerAssignmentById(
      user.id,
      assignmentId,
    );
    return { assignment };
  }

  @UseGuards(SupabaseJwtGuard)
  @Get('my-active')
  async getMyActive(@CurrentUser() user: AuthUser) {
    const assignment = await this.routinesService.getMyActive(user.id);
    return { assignment };
  }

  @UseGuards(SupabaseJwtGuard)
  @Get('my-history')
  async getMyHistory(@CurrentUser() user: AuthUser) {
    const assignments = await this.routinesService.getMyHistory(user.id);
    return { assignments };
  }
}

