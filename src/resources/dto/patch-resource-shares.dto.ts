import { IsArray, IsUUID } from 'class-validator';

export class PatchResourceSharesDto {
  @IsArray()
  @IsUUID('4', { each: true })
  memberIds: string[];
}
