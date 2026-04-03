import { SetMetadata } from '@nestjs/common';

export const CHECK_SUBSCRIPTION_LIMIT_KEY = 'checkSubscriptionLimit';

export interface SubscriptionLimitMetadata {
  resource: string;
  action: string;
}

export const CheckSubscriptionLimit = (resource: string, action: string = 'create') => 
  SetMetadata(CHECK_SUBSCRIPTION_LIMIT_KEY, { resource, action } as SubscriptionLimitMetadata);
