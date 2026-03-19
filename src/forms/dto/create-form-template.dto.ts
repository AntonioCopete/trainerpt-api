import {
  IsArray,
  IsDateString,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

export class CreateFormTemplateDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsNotEmpty()
  description!: string;

  @IsArray()
  @IsNotEmpty()
  schema!: Array<any>;
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
  @IsArray()
  schema?: Array<any>;
}

export class AssignFormTemplateDto {
  @IsUUID()
  memberId!: string;

  @IsOptional()
  @IsDateString()
  dueAt?: string;

  @IsOptional()
  @IsIn(['none', 'weekly', 'monthly'])
  repeat?: 'none' | 'weekly' | 'monthly';
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
  @IsIn(['image/jpeg'], {
    message: 'Content type must be image/jpeg',
  })
  contentType!: string;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(10 * 1024 * 1024) // 10MB max
  fileSize?: number;
}
