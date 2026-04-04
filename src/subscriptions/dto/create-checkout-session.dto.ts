import { IsEnum, IsNotEmpty } from 'class-validator';
import { SubscriptionPlan } from 'generated/prisma/enums';

export class CreateCheckoutSessionDto {
  @IsNotEmpty()
  @IsEnum(SubscriptionPlan)
  plan: SubscriptionPlan;
}
