import { Injectable, Logger } from '@nestjs/common';

type TranslateOptions = {
  from?: string;
  to: string;
};

/** Timeout for translate.googleapis.com requests (ms). */
const TRANSLATION_REQUEST_TIMEOUT_MS = 5000;

@Injectable()
export class TranslationService {
  private readonly logger = new Logger(TranslationService.name);

  /**
   * Translates via the public Google Translate endpoint (no API key).
   */
  async translateText(
    text: string,
    options: TranslateOptions,
  ): Promise<string | null> {
    if (!text?.trim()) {
      return null;
    }

    try {
      const params = new URLSearchParams({
        client: 'gtx',
        sl: options.from || 'auto',
        tl: options.to,
        dt: 't',
        q: text,
      });
      const endpoint = `https://translate.googleapis.com/translate_a/single?${params.toString()}`;

      const res = await fetch(endpoint, {
        signal: AbortSignal.timeout(TRANSLATION_REQUEST_TIMEOUT_MS),
      });
      if (!res.ok) return null;

      const data = (await res.json()) as unknown;
      if (!Array.isArray(data) || !Array.isArray(data[0])) return null;

      const chunks = data[0] as unknown[];
      const translated = chunks
        .map((chunk) =>
          Array.isArray(chunk) && typeof chunk[0] === 'string' ? chunk[0] : '',
        )
        .join('')
        .trim();

      return translated || null;
    } catch (error) {
      this.logger.warn(
        `Translation request failed: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
      return null;
    }
  }
}
