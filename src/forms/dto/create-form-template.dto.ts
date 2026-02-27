import {
  IsDateString,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';

export class CreateFormTemplateDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsNotEmpty()
  description!: string;

  // Accepts arbitrary JSON fields definition
  @IsOptional()
  customFields?: Array<any>;
}

export class UpdateFormTemplateDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  description?: string;

  @IsOptional()
  customFields?: Array<any>;
}

export class AssignFormTemplateDto {
  @IsUUID()
  memberId!: string;

  @IsOptional()
  @IsDateString()
  dueAt?: string;
}

export class SubmitAssignmentDto {
  @IsObject()
  @IsNotEmpty()
  answers: Record<string, unknown>;
}

export class PresignedUploadUrlDto {
  @IsString()
  @IsNotEmpty()
  filename!: string;

  @IsString()
  @IsNotEmpty()
  contentType!: string;
}
