import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';

@Injectable()
export class InternalJobAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const authHeader = req.headers['authorization'] as string | undefined;
    const expected = process.env.CRON_SECRET_TOKEN;

    if (!expected) {
      throw new UnauthorizedException('CRON_SECRET_TOKEN is not configured');
    }

    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing bearer token');
    }

    const token = authHeader.slice('Bearer '.length);
    if (token !== expected) {
      throw new UnauthorizedException('Invalid token');
    }

    return true;
  }
}
