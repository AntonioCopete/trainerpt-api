import {
  Controller,
  Post,
  Req,
  Headers,
  BadRequestException,
} from '@nestjs/common';
import type { Request } from 'express';
import { SubscriptionsService } from './subscriptions.service';

@Controller('subscriptions')
export class StripeWebhookController {
  constructor(private readonly subscriptionsService: SubscriptionsService) {}

  @Post('webhook')
  async handleWebhook(
    @Req() req: Request,
    @Headers('stripe-signature') signature: string,
  ) {
    console.log('handleWebhook', req.body);
    if (!signature) {
      throw new BadRequestException('Missing stripe-signature header');
    }

    const rawBody = req.body as Buffer;

    if (!Buffer.isBuffer(rawBody)) {
      throw new BadRequestException('Request body must be raw buffer');
    }

    const event = this.subscriptionsService.verifyWebhookSignature(
      rawBody,
      signature,
    );

    await this.subscriptionsService.handleWebhookEvent(event);

    return { received: true };
  }
}
