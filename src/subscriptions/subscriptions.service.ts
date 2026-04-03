import {
  Injectable,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
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
  status: string; // Stripe subscription status: 'active', 'canceled', 'incomplete', 'past_due', etc.
  metadata?: Record<string, string | null>;
  cancel_at_period_end?: boolean;
  canceled_at?: number | null;
  current_period_end?: number;
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
    // First, expire any canceled subscriptions that passed their endsAt date
    await this.expireCanceledSubscriptions(userId);

    return this.prisma.subscription.findFirst({
      where: {
        userId,
        OR: [
          // Active subscription
          {
            status: SubscriptionStatus.ACTIVE,
          },
          // Canceled but still valid until endsAt
          {
            status: SubscriptionStatus.CANCELED,
            endsAt: { gt: new Date() }, // Comparison in UTC
          },
        ],
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  private async expireCanceledSubscriptions(userId: string): Promise<void> {
    const expiredSubs = await this.prisma.subscription.findMany({
      where: {
        userId,
        status: SubscriptionStatus.CANCELED,
        endsAt: {
          lte: new Date(), // Comparison in UTC (new Date() is always UTC internally)
        },
      },
    });

    if (expiredSubs.length > 0) {
      // Mark as expired
      await this.prisma.subscription.updateMany({
        where: {
          userId,
          status: SubscriptionStatus.CANCELED,
          endsAt: {
            lte: new Date(), // UTC comparison
          },
        },
        data: {
          status: SubscriptionStatus.EXPIRED,
        },
      });

      // Create FREE subscription if user doesn't have an active one
      const hasActiveSub = await this.prisma.subscription.findFirst({
        where: {
          userId,
          status: SubscriptionStatus.ACTIVE,
        },
      });

      if (!hasActiveSub) {
        await this.prisma.subscription.create({
          data: {
            userId,
            plan: SubscriptionPlan.FREE,
            status: SubscriptionStatus.ACTIVE,
          },
        });
      }
    }
  }

  async getSubscriptionWithUsage(
    userId: string,
  ): Promise<SubscriptionWithUsageDto> {
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

  async createCheckoutSession(
    userId: string,
    plan: SubscriptionPlan,
  ): Promise<string> {
    if (plan === SubscriptionPlan.FREE) {
      throw new BadRequestException(
        'Cannot create checkout session for FREE plan',
      );
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

    const webUrl =
      this.configService.get<string>('WEB_URL') || 'http://localhost:3000';

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

    const webUrl =
      this.configService.get<string>('WEB_URL') || 'http://localhost:3000';

    const session = await this.stripe.billingPortal.sessions.create({
      customer: subscription.stripeCustomerId,
      return_url: `${webUrl}/trainer/billing`,
    });

    return session.url;
  }

  async handleWebhookEvent(event: StripeEvent): Promise<void> {
    console.log('[Webhook] Received event:', {
      id: event.id,
      type: event.type,
    });

    // Check for duplicate events
    const existingEvent = await this.prisma.subscription.findFirst({
      where: { stripeEventId: event.id },
    });

    if (existingEvent) {
      console.log('[Webhook] Event already processed, skipping:', event.id);
      // Already processed, skip
      return;
    }

    console.log('[Webhook] Processing new event:', event.type);

    switch (event.type) {
      case 'checkout.session.completed':
        await this.handleCheckoutCompleted(
          event.data.object as StripeCheckoutSession,
          event.id,
        );
        break;

      case 'customer.subscription.updated':
        await this.handleSubscriptionUpdated(
          event.data.object as StripeSubscription,
          event.id,
        );
        break;

      case 'customer.subscription.deleted':
        await this.handleSubscriptionDeleted(
          event.data.object as StripeSubscription,
          event.id,
        );
        break;

      case 'invoice.payment_failed':
        await this.handlePaymentFailed(
          event.data.object as StripeInvoice,
          event.id,
        );
        break;

      default:
        console.log('[Webhook] Unhandled event type:', event.type);
        // Unhandled event type
        break;
    }

    console.log('[Webhook] Event processing complete:', event.id);
  }

  private async handleCheckoutCompleted(
    session: StripeCheckoutSession,
    eventId: string,
  ): Promise<void> {
    const userId = session.metadata?.userId;
    const plan = session.metadata?.plan as SubscriptionPlan;

    if (!userId || !plan) {
      return;
    }

    const stripeSubscriptionId = session.subscription as string;
    const stripeCustomerId = session.customer as string;

    await this.transitionSubscription(
      userId,
      plan,
      stripeCustomerId,
      stripeSubscriptionId,
      eventId,
    );
  }

  private async handleSubscriptionUpdated(
    subscription: StripeSubscription,
    eventId: string,
  ): Promise<void> {
    console.log('[Webhook] handleSubscriptionUpdated called', {
      subscriptionId: subscription.id,
      stripeStatus: subscription.status,
      cancel_at_period_end: subscription.cancel_at_period_end,
      canceled_at: subscription.canceled_at,
      current_period_end: subscription.current_period_end,
    });

    // Find current subscription by Stripe subscription ID
    const currentSub = await this.prisma.subscription.findFirst({
      where: { stripeSubscriptionId: subscription.id },
    });

    console.log(
      '[Webhook] Found subscription in DB:',
      currentSub
        ? {
            id: currentSub.id,
            plan: currentSub.plan,
            status: currentSub.status,
            stripeSubscriptionId: currentSub.stripeSubscriptionId,
          }
        : 'NOT FOUND',
    );

    if (!currentSub) {
      console.log('[Webhook] No subscription found in DB, skipping update');
      return;
    }

    // Map Stripe status to our status
    let newStatus: SubscriptionStatus | null = null;
    let canceledAt: Date | null = null;
    let endsAt: Date | null = null;

    // Stripe status: 'active' can mean two things:
    // 1. Active and will renew (cancel_at_period_end = false)
    // 2. Active but will cancel at period end (cancel_at_period_end = true)
    if (subscription.status === 'active') {
      if (subscription.cancel_at_period_end) {
        // User requested cancellation, but subscription is still active until period end
        console.log(
          '[Webhook] Subscription is active but will cancel at period end',
        );
        newStatus = SubscriptionStatus.CANCELED;

        if (subscription.canceled_at) {
          canceledAt = new Date(subscription.canceled_at * 1000);
        }

        if (subscription.current_period_end) {
          endsAt = new Date(subscription.current_period_end * 1000);
        } else if (!endsAt) {
          // Fetch from Stripe as fallback
          console.log(
            '[Webhook] Fetching subscription details from Stripe for endsAt...',
          );
          try {
            const stripeSubscription = await this.stripe.subscriptions.retrieve(
              subscription.id,
            );
            if (stripeSubscription.current_period_end) {
              endsAt = new Date(stripeSubscription.current_period_end * 1000);
            }
          } catch (error) {
            console.error(
              '[Webhook] Failed to fetch subscription from Stripe:',
              error,
            );
          }
        }
      } else {
        // Subscription is active and will renew
        console.log('[Webhook] Subscription is active and will renew');
        newStatus = SubscriptionStatus.ACTIVE;
        canceledAt = null;
        endsAt = null;
      }
    }
    // Stripe status: 'canceled' means the subscription has ended
    else if (subscription.status === 'canceled') {
      console.log('[Webhook] Subscription is canceled (ended)');
      newStatus = SubscriptionStatus.EXPIRED;
      endsAt = new Date(); // Already ended
    }
    // Stripe status: 'past_due' means payment failed
    else if (subscription.status === 'past_due') {
      console.log('[Webhook] Subscription is past due');
      newStatus = SubscriptionStatus.PAST_DUE;
    }
    // Other statuses (incomplete, trialing, etc.) - keep current status
    else {
      console.log('[Webhook] Unhandled Stripe status:', subscription.status);
      return;
    }

    // Only update if status changed
    if (newStatus && newStatus !== currentSub.status) {
      console.log(
        `[Webhook] Updating subscription from ${currentSub.status} to ${newStatus}`,
        {
          canceledAt: canceledAt?.toISOString(),
          endsAt: endsAt?.toISOString(),
        },
      );

      await this.prisma.subscription.update({
        where: { id: currentSub.id },
        data: {
          status: newStatus,
          canceledAt,
          endsAt,
          stripeEventId: eventId,
        },
      });

      console.log('[Webhook] Subscription updated successfully');
    } else {
      console.log('[Webhook] No status change needed');
    }
  }

  private async handleSubscriptionDeleted(
    subscription: StripeSubscription,
    eventId: string,
  ): Promise<void> {
    console.log('[Webhook] handleSubscriptionDeleted called', {
      subscriptionId: subscription.id,
      eventId,
    });

    const currentSub = await this.prisma.subscription.findFirst({
      where: { stripeSubscriptionId: subscription.id },
    });

    console.log('[Webhook] Found subscription to delete:', currentSub ? {
      id: currentSub.id,
      plan: currentSub.plan,
      status: currentSub.status,
      userId: currentSub.userId,
    } : 'NOT FOUND');

    if (currentSub) {
      console.log('[Webhook] Marking subscription as EXPIRED and creating FREE plan...');

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

      console.log('[Webhook] Subscription marked as EXPIRED and FREE plan created');
    } else {
      console.log('[Webhook] No subscription found, skipping');
    }
  }

  private async handlePaymentFailed(
    invoice: StripeInvoice,
    eventId: string,
  ): Promise<void> {
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

    // Fetch subscription details from Stripe to get current_period_end
    let endsAt: Date | undefined;
    try {
      const stripeSubscription =
        await this.stripe.subscriptions.retrieve(stripeSubscriptionId);
      if (stripeSubscription.current_period_end) {
        endsAt = new Date(stripeSubscription.current_period_end * 1000);
        console.log(
          '[Subscription] Got period end from Stripe:',
          endsAt.toISOString(),
        );
      }
    } catch (error) {
      console.error(
        '[Subscription] Failed to fetch subscription from Stripe:',
        error,
      );
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
        ...(endsAt && { endsAt }),
      },
    });
  }

  verifyWebhookSignature(payload: Buffer, signature: string): StripeEvent {
    const webhookSecret = this.configService.get<string>(
      'STRIPE_WEBHOOK_SECRET',
    );

    if (!webhookSecret) {
      throw new Error('STRIPE_WEBHOOK_SECRET is not configured');
    }

    try {
      return this.stripe.webhooks.constructEvent(
        payload,
        signature,
        webhookSecret,
      );
    } catch (err) {
      throw new BadRequestException(
        `Webhook signature verification failed: ${err.message}`,
      );
    }
  }
}
