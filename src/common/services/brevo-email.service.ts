import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const BREVO_SMTP_URL = 'https://api.brevo.com/v3/smtp/email';

export type SendTransactionalEmailParams = {
  to: string;
  subject: string;
  html: string;
  text?: string;
};

@Injectable()
export class BrevoEmailService {
  private readonly logger = new Logger(BrevoEmailService.name);

  constructor(private readonly config: ConfigService) {}

  /**
   * POST https://api.brevo.com/v3/smtp/email
   * Requires BREVO_API_KEY, BREVO_SENDER_EMAIL; optional BREVO_SENDER_NAME.
   */
  async sendTransactional(params: SendTransactionalEmailParams): Promise<void> {
    const apiKey = this.config.get<string>('BREVO_API_KEY');
    const senderEmail = this.config.get<string>('BREVO_SENDER_EMAIL');
    const senderName =
      this.config.get<string>('BREVO_SENDER_NAME')?.trim() || 'TrainerPT';

    if (!apiKey?.trim()) {
      throw new Error('BREVO_API_KEY is not configured');
    }
    if (!senderEmail?.trim()) {
      throw new Error('BREVO_SENDER_EMAIL is not configured');
    }

    const body: Record<string, unknown> = {
      sender: { name: senderName, email: senderEmail.trim() },
      to: [{ email: params.to.trim() }],
      subject: params.subject,
      htmlContent: params.html,
    };
    if (params.text?.trim()) {
      body.textContent = params.text.trim();
    }

    const res = await fetch(BREVO_SMTP_URL, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'api-key': apiKey.trim(),
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text();
      this.logger.warn(
        `Brevo send failed: ${res.status} ${res.statusText} ${errText}`,
      );
      throw new Error(
        `Brevo API error: ${res.status} ${res.statusText} — ${errText}`,
      );
    }
  }
}
