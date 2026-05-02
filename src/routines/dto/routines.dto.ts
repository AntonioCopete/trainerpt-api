import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  IsUrl,
  MaxLength,
  ValidateIf,
} from 'class-validator';

export class CreateRoutineTemplateDto {
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

export class DuplicateRoutineTemplateDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  description!: string;
}

export class UpdateRoutineTemplateDto {
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

export class AssignRoutineTemplateDto {
  @IsUUID()
  memberId!: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'startDate must be a date in YYYY-MM-DD format',
  })
  startDate!: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'endDate must be a date in YYYY-MM-DD format',
  })
  endDate!: string;
}

export class CreateCustomRoutineAssignmentDto {
  @IsUUID()
  memberId!: string;

  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsNotEmpty()
  description!: string;

  @IsArray()
  @IsNotEmpty()
  schema!: Array<any>;

  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'startDate must be a date in YYYY-MM-DD format',
  })
  startDate!: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'endDate must be a date in YYYY-MM-DD format',
  })
  endDate!: string;
}

export class CreateCustomExerciseDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  categoryName?: string;

  @IsOptional()
  @IsUrl()
  imageUrl?: string;

  @IsOptional()
  @IsUrl()
  videoUrl?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(1)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  primaryMuscleIds?: string[];

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  secondaryMuscleIds?: string[];
}

export class UpdateCustomExerciseDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  categoryName?: string;

  @IsOptional()
  @ValidateIf((_, v) => typeof v === 'string' && v.trim().length > 0)
  @IsUrl()
  imageUrl?: string;

  @IsOptional()
  @ValidateIf((_, v) => typeof v === 'string' && v.trim().length > 0)
  @IsUrl()
  videoUrl?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(1)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  primaryMuscleIds?: string[];

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  secondaryMuscleIds?: string[];
}

