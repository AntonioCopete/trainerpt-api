import { Module } from '@nestjs/common';
import { FormsController } from './forms.controller';
import { FormsService } from './forms.service';
import { S3UploadService } from './s3-upload.service';
import { TranslationService } from '../common/services/translation.service';

@Module({
  controllers: [FormsController],
  providers: [FormsService, S3UploadService, TranslationService],
})
export class FormsModule {}
