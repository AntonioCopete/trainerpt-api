import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SubscriptionsService } from '../subscriptions.service';
import { CHECK_SUBSCRIPTION_LIMIT_KEY, SubscriptionLimitMetadata } from '../decorators/check-subscription-limit.decorator';

@Injectable()
export class SubscriptionLimitsGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private subscriptionsService: SubscriptionsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const limitMetadata = this.reflector.get<SubscriptionLimitMetadata>(
      CHECK_SUBSCRIPTION_LIMIT_KEY,
      context.getHandler(),
    );

    if (!limitMetadata) {
      // No limit check required
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user) {
      throw new ForbiddenException('User not authenticated');
    }

    // Currently only supports 'clients' resource limit
    if (limitMetadata.resource === 'clients' && limitMetadata.action === 'create') {
      const subscription = await this.subscriptionsService.getSubscriptionWithUsage(user.id);
      
      if (subscription.clientLimit !== null && subscription.clientCount >= subscription.clientLimit) {
        throw new ForbiddenException(
          `You have reached the limit of ${subscription.clientLimit} clients for your ${subscription.plan} plan. Please upgrade to add more clients.`
        );
      }
    }

    return true;
  }
}
