import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthUser } from './auth-user-type';

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => {
    const req = ctx.switchToHttp().getRequest();
    return req.user as AuthUser;
  },
);
