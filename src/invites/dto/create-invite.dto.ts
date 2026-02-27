import { IsEmail, IsOptional } from 'class-validator';

export class CreateInviteDto {
  @IsOptional()
  @IsEmail()
  email?: string;
}
