import { SubscriptionPlan, SubscriptionStatus } from 'generated/prisma/enums';

export class SubscriptionWithUsageDto {
  id: string;
  plan: SubscriptionPlan;
  status: SubscriptionStatus;
  clientCount: number;
  clientLimit: number | null;
  stripeCustomerId?: string | null;
  startedAt: Date;
  endsAt?: Date | null;
  canceledAt?: Date | null;
}
