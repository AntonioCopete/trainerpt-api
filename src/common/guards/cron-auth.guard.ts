import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';

@Injectable()
export class CronAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers['authorization'];

    if (!authHeader) {
      throw new UnauthorizedException('Missing authorization header');
    }

    const token = authHeader.replace('Bearer ', '');
    const expectedToken = process.env.CRON_SECRET_TOKEN;

    if (!expectedToken) {
      throw new UnauthorizedException('CRON_SECRET_TOKEN not configured');
    }

    if (token !== expectedToken) {
      throw new UnauthorizedException('Invalid cron token');
    }

    return true;
  }
}
