import { IsString, MaxLength } from 'class-validator';

export class ResourceUploadUrlDto {
  @IsString()
  @MaxLength(512)
  filename: string;

  @IsString()
  @MaxLength(200)
  contentType: string;
}
