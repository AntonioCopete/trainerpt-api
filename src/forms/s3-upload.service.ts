import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  PutObjectCommand,
  GetObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const PRESIGNED_UPLOAD_EXPIRES_IN = 60 * 15; // 15 min
const PRESIGNED_READ_EXPIRES_IN = 60 * 60; // 1 h

@Injectable()
export class S3UploadService {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly region: string;

  constructor(private readonly config: ConfigService) {
    this.region = this.config.get<string>('AWS_S3_REGION') ?? 'eu-west-1';
    this.bucket = this.config.get<string>('AWS_S3_BUCKET') ?? '';

    this.client = new S3Client({
      region: this.region,
      credentials: {
        accessKeyId: this.config.get<string>('AWS_S3_ACCESS_KEY_ID') ?? '',
        secretAccessKey:
          this.config.get<string>('AWS_S3_SECRET_ACCESS_KEY') ?? '',
      },
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    });
  }

  /**
   * Returns a presigned PUT URL for uploading a photo, and the permanent fileUrl
   * to store in FormResponse.answers (use this URL when displaying the image;
   * if bucket is private, use GET /forms/photo-url?key=... for a presigned read).
   */
  async getPresignedUploadUrl(
    assignmentId: string,
    memberId: string,
    filename: string,
    contentType: string,
  ): Promise<{ uploadUrl: string; fileUrl: string; key: string }> {
    const lastDot = filename.lastIndexOf('.');
    const baseName = lastDot > 0 ? filename.slice(0, lastDot) : filename;
    const ext = lastDot > 0 ? filename.slice(lastDot + 1) : 'jpg';
    const safeName = baseName
      .replace(/[^a-zA-Z0-9.-]/g, '_')
      .slice(0, 80);
    const key = `${assignmentId}/${memberId}/${crypto.randomUUID()}-${safeName}.${ext}`;

    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: contentType,
    });

    const uploadUrl = await getSignedUrl(this.client, command, {
      expiresIn: PRESIGNED_UPLOAD_EXPIRES_IN,
    });
    const fileUrl = `https://${this.bucket}.s3.${this.region}.amazonaws.com/${key}`;
    return { uploadUrl, fileUrl, key };
  }

  /**
   * Returns a presigned GET URL to read a photo by key (for private buckets).
   * Caller must ensure the key belongs to an assignment/response they can access.
   */
  async getPresignedReadUrl(key: string): Promise<{ url: string }> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });
    const url = await getSignedUrl(this.client, command, {
      expiresIn: PRESIGNED_READ_EXPIRES_IN,
    });
    return { url };
  }

  /** Key must be assignmentId/memberId/filename (at least 3 path segments). */
  isAllowedKey(key: string): boolean {
    return key.split('/').length >= 3;
  }
}
