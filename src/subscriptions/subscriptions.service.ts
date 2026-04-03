import { Injectable, ForbiddenException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import Stripe from 'stripe';
import { SubscriptionPlan, SubscriptionStatus } from 'generated/prisma/enums';
import { SubscriptionWithUsageDto } from './dto/subscription-with-usage.dto';

// Type helpers to work around nodenext module resolution issues with Stripe types
interface StripeEvent {
  id: string;
  type: string;
  data: {
    object: any;
  };
}

interface StripeCheckoutSession {
  metadata?: Record<string, string | null>;
  subscription?: string | null;
  customer?: string | null;
}

interface StripeSubscription {
  id: string;
  metadata?: Record<string, string | null>;
}

interface StripeInvoice {
  id: string;
  subscription?: string | null;
}

@Injectable()
export class SubscriptionsService {
  private stripe: any;
  private readonly planLimits: Record<SubscriptionPlan, number | null> = {
    FREE: 3,
    STARTER: 15,
    PRO: 40,
    ELITE: null, // unlimited
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {
    const stripeSecretKey = this.configService.get<string>('STRIPE_SECRET_KEY');
    if (!stripeSecretKey) {
      throw new Error('STRIPE_SECRET_KEY is not configured');
    }
    this.stripe = new (Stripe as any)(stripeSecretKey, {
      apiVersion: '2025-01-27.acacia',
    });
  }

  async getCurrentSubscription(userId: string) {
    return this.prisma.subscription.findFirst({
      where: {
        userId,
        status: SubscriptionStatus.ACTIVE,
        OR: [
          { endsAt: null },
          { endsAt: { gt: new Date() } },
        ],
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getSubscriptionWithUsage(userId: string): Promise<SubscriptionWithUsageDto> {
    const subscription = await this.getCurrentSubscription(userId);
    
    if (!subscription) {
      throw new BadRequestException('No active subscription found');
    }

    const clientCount = await this.getClientCount(userId);
    const clientLimit = this.planLimits[subscription.plan];

    return {
      id: subscription.id,
      plan: subscription.plan,
      status: subscription.status,
      clientCount,
      clientLimit,
      stripeCustomerId: subscription.stripeCustomerId,
      startedAt: subscription.startedAt,
      endsAt: subscription.endsAt,
      canceledAt: subscription.canceledAt,
    };
  }

  async getSubscriptionHistory(userId: string) {
    return this.prisma.subscription.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getClientCount(userId: string): Promise<number> {
    return this.prisma.trainerMemberLink.count({
      where: { trainerId: userId },
    });
  }

  async createCheckoutSession(userId: string, plan: SubscriptionPlan): Promise<string> {
    if (plan === SubscriptionPlan.FREE) {
      throw new BadRequestException('Cannot create checkout session for FREE plan');
    }

    const priceIdKey = `STRIPE_PRICE_ID_${plan}`;
    const priceId = this.configService.get<string>(priceIdKey);

    if (!priceId) {
      throw new Error(`${priceIdKey} is not configured`);
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });

    if (!user) {
      throw new BadRequestException('User not found');
    }

    const currentSubscription = await this.getCurrentSubscription(userId);
    let customerId = currentSubscription?.stripeCustomerId;

    // Create or retrieve Stripe customer
    if (!customerId) {
      const customer = await this.stripe.customers.create({
        email: user.email,
        metadata: { userId },
      });
      customerId = customer.id;
    }

    const webUrl = this.configService.get<string>('WEB_URL') || 'http://localhost:3000';

    const session = await this.stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card'],
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      mode: 'subscription',
      success_url: `${webUrl}/trainer/billing?success=true`,
      cancel_url: `${webUrl}/trainer/billing?canceled=true`,
      metadata: {
        userId,
        plan,
      },
    });

    return session.url!;
  }

  async createPortalSession(userId: string): Promise<string> {
    const subscription = await this.getCurrentSubscription(userId);

    if (!subscription?.stripeCustomerId) {
      throw new BadRequestException('No Stripe customer found');
    }

    const webUrl = this.configService.get<string>('WEB_URL') || 'http://localhost:3000';

    const session = await this.stripe.billingPortal.sessions.create({
      customer: subscription.stripeCustomerId,
      return_url: `${webUrl}/trainer/billing`,
    });

    return session.url;
  }

  async handleWebhookEvent(event: StripeEvent): Promise<void> {
    // Check for duplicate events
    const existingEvent = await this.prisma.subscription.findFirst({
      where: { stripeEventId: event.id },
    });

    if (existingEvent) {
      // Already processed, skip
      return;
    }

    switch (event.type) {
      case 'checkout.session.completed':
        await this.handleCheckoutCompleted(event.data.object as StripeCheckoutSession, event.id);
        break;

      case 'customer.subscription.updated':
        await this.handleSubscriptionUpdated(event.data.object as StripeSubscription, event.id);
        break;

      case 'customer.subscription.deleted':
        await this.handleSubscriptionDeleted(event.data.object as StripeSubscription, event.id);
        break;

      case 'invoice.payment_failed':
        await this.handlePaymentFailed(event.data.object as StripeInvoice, event.id);
        break;

      default:
        // Unhandled event type
        break;
    }
  }

  private async handleCheckoutCompleted(session: StripeCheckoutSession, eventId: string): Promise<void> {
    const userId = session.metadata?.userId;
    const plan = session.metadata?.plan as SubscriptionPlan;

    if (!userId || !plan) {
      return;
    }

    const stripeSubscriptionId = session.subscription as string;
    const stripeCustomerId = session.customer as string;

    await this.transitionSubscription(userId, plan, stripeCustomerId, stripeSubscriptionId, eventId);
  }

  private async handleSubscriptionUpdated(subscription: StripeSubscription, eventId: string): Promise<void> {
    const userId = subscription.metadata?.userId;

    if (!userId) {
      return;
    }

    // Handle subscription changes (e.g., plan upgrades/downgrades)
    // This could be extended to handle more complex scenarios
  }

  private async handleSubscriptionDeleted(subscription: StripeSubscription, eventId: string): Promise<void> {
    const currentSub = await this.prisma.subscription.findFirst({
      where: { stripeSubscriptionId: subscription.id },
    });

    if (currentSub) {
      await this.prisma.subscription.update({
        where: { id: currentSub.id },
        data: {
          status: SubscriptionStatus.EXPIRED,
          endsAt: new Date(),
          stripeEventId: eventId,
        },
      });

      // Create new FREE subscription
      await this.prisma.subscription.create({
        data: {
          userId: currentSub.userId,
          plan: SubscriptionPlan.FREE,
          status: SubscriptionStatus.ACTIVE,
          startedAt: new Date(),
        },
      });
    }
  }

  private async handlePaymentFailed(invoice: StripeInvoice, eventId: string): Promise<void> {
    const stripeSubscriptionId = invoice.subscription as string;

    if (!stripeSubscriptionId) {
      return;
    }

    const currentSub = await this.prisma.subscription.findFirst({
      where: { stripeSubscriptionId },
    });

    if (currentSub) {
      await this.prisma.subscription.update({
        where: { id: currentSub.id },
        data: {
          status: SubscriptionStatus.PAST_DUE,
          stripeEventId: eventId,
        },
      });
    }
  }

  private async transitionSubscription(
    userId: string,
    newPlan: SubscriptionPlan,
    stripeCustomerId: string,
    stripeSubscriptionId: string,
    eventId: string,
  ): Promise<void> {
    // Mark current subscription as inactive
    const currentSub = await this.getCurrentSubscription(userId);

    if (currentSub) {
      await this.prisma.subscription.update({
        where: { id: currentSub.id },
        data: {
          status: SubscriptionStatus.INACTIVE,
          endsAt: new Date(),
        },
      });
    }

    // Create new subscription
    await this.prisma.subscription.create({
      data: {
        userId,
        plan: newPlan,
        status: SubscriptionStatus.ACTIVE,
        stripeCustomerId,
        stripeSubscriptionId,
        stripeEventId: eventId,
        startedAt: new Date(),
      },
    });
  }

  verifyWebhookSignature(payload: Buffer, signature: string): StripeEvent {
    const webhookSecret = this.configService.get<string>('STRIPE_WEBHOOK_SECRET');

    if (!webhookSecret) {
      throw new Error('STRIPE_WEBHOOK_SECRET is not configured');
    }

    try {
      return this.stripe.webhooks.constructEvent(payload, signature, webhookSecret);
    } catch (err) {
      throw new BadRequestException(`Webhook signature verification failed: ${err.message}`);
    }
  }
}
