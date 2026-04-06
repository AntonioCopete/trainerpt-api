import { Module } from '@nestjs/common';
import { FormsController } from './forms.controller';
import { FormsService } from './forms.service';
import { S3UploadService } from './s3-upload.service';
import { TranslationService } from '../common/services/translation.service';
import { BrevoEmailService } from '../common/services/brevo-email.service';

@Module({
  controllers: [FormsController],
  providers: [
    FormsService,
    S3UploadService,
    TranslationService,
    BrevoEmailService,
  ],
  exports: [S3UploadService],
})
export class FormsModule {}
