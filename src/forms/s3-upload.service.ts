import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Storage } from '@google-cloud/storage';

const PRESIGNED_UPLOAD_EXPIRES_IN = 60 * 15 * 1000; // 15 min in ms
const PRESIGNED_READ_EXPIRES_IN = 60 * 60 * 1000; // 1 h in ms

@Injectable()
export class S3UploadService {
  private readonly storage: Storage;
  private readonly bucket: string;

  constructor(private readonly config: ConfigService) {
    this.bucket = this.config.get<string>('GCS_BUCKET') ?? '';

    // Local: GOOGLE_APPLICATION_CREDENTIALS (JSON)
    // Cloud Run: Workload Identity (Application Default Credentials)
    const keyFilename = this.config.get<string>(
      'GOOGLE_APPLICATION_CREDENTIALS',
    );
    this.storage = new Storage(keyFilename ? { keyFilename } : {});
  }

  /**
   * Returns a signed URL for uploading a photo to Google Cloud Storage, and the permanent fileUrl
   * to store in FormResponse.answers (use this URL when displaying the image;
   * if bucket is private, use GET /forms/photo-url?key=... for a signed read).
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
    const safeName = baseName.replace(/[^a-zA-Z0-9.-]/g, '_').slice(0, 80);

    const key = `${assignmentId}/${memberId}/${crypto.randomUUID()}-${safeName}.${ext}`;

    const file = this.storage.bucket(this.bucket).file(key);

    const [uploadUrl] = await file.getSignedUrl({
      version: 'v4',
      action: 'write',
      expires: Date.now() + PRESIGNED_UPLOAD_EXPIRES_IN,
      contentType,
    });

    const fileUrl = `https://storage.googleapis.com/${this.bucket}/${encodeURIComponent(
      key,
    )}`;

    return { uploadUrl, fileUrl, key };
  }

  /**
   * Returns a signed GET URL to read a photo by key (for private buckets).
   * Caller must ensure the key belongs to an assignment/response they can access.
   */
  async getPresignedReadUrl(key: string): Promise<{ url: string }> {
    const file = this.storage.bucket(this.bucket).file(key);
    const [url] = await file.getSignedUrl({
      version: 'v4',
      action: 'read',
      expires: Date.now() + PRESIGNED_READ_EXPIRES_IN,
    });
    return { url };
  }

  /** Key must be assignmentId/memberId/filename (at least 3 path segments). */
  isAllowedKey(key: string): boolean {
    return key.split('/').length >= 3;
  }

  /**
   * Trainer catalog files: resources/{trainerId}/{resourceId}/{uuid}-{safeName}.ext
   */
  async getResourcePresignedUploadUrl(
    trainerId: string,
    resourceId: string,
    filename: string,
    contentType: string,
  ): Promise<{ uploadUrl: string; key: string }> {
    const lastDot = filename.lastIndexOf('.');
    const baseName = lastDot > 0 ? filename.slice(0, lastDot) : filename;
    const ext = lastDot > 0 ? filename.slice(lastDot + 1) : 'bin';
    const safeName = baseName.replace(/[^a-zA-Z0-9.-]/g, '_').slice(0, 80);

    const key = `resources/${trainerId}/${resourceId}/${crypto.randomUUID()}-${safeName}.${ext}`;

    const file = this.storage.bucket(this.bucket).file(key);

    const [uploadUrl] = await file.getSignedUrl({
      version: 'v4',
      action: 'write',
      expires: Date.now() + PRESIGNED_UPLOAD_EXPIRES_IN,
      contentType,
    });

    return { uploadUrl, key };
  }

  isResourceStorageKey(key: string, trainerId: string, resourceId: string): boolean {
    const prefix = `resources/${trainerId}/${resourceId}/`;
    return key.startsWith(prefix);
  }

  async deleteObject(key: string): Promise<void> {
    if (!key?.trim() || !this.bucket) return;
    try {
      await this.storage.bucket(this.bucket).file(key).delete({ ignoreNotFound: true });
    } catch {
      // ignore cleanup failures
    }
  }
}
