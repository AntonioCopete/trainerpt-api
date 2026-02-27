import { IsEnum, IsOptional, IsString, MinLength } from 'class-validator';
import { UserRole } from 'generated/prisma/enums';

export class UpdateMeDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  fullName?: string;

  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;
}
