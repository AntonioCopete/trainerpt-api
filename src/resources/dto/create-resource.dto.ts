import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { ResourceType } from 'generated/prisma/enums';

export class CreateResourceDto {
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  title: string;

  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  description: string;

  @IsEnum(ResourceType)
  resourceType: ResourceType;

  @IsString()
  @MaxLength(512)
  filename: string;

  @IsString()
  @MaxLength(200)
  contentType: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  size?: number;
}
