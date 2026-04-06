import {
  ArrayMaxSize,
  IsArray,
  Matches,
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

/** Máximo de claves por petición (evita abuso y muchas firmas GCS). */
export const PHOTO_URLS_BATCH_MAX = 48;

export class PhotoUrlsBatchDto {
  @IsArray()
  @ArrayMaxSize(PHOTO_URLS_BATCH_MAX)
  @IsString({ each: true })
  keys!: string[];
}

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

  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'dueAt must be a date in YYYY-MM-DD format',
  })
  dueAt!: string;

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
