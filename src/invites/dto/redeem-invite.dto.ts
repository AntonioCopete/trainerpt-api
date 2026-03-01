import { IsString } from 'class-validator';

export class RedeemInviteDto {
  @IsString()
  code!: string;
}
