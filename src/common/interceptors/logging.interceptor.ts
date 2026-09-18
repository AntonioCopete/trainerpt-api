import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const { method, url, body } = request;
    const userId = request.user?.id || 'anonymous';
    const now = Date.now();

    // Sanitize body (do not log passwords, tokens, etc.)
    const sanitizedBody = this.sanitizeBody(body);

    this.logger.log(
      `→ ${method} ${url} | User: ${userId} | Body: ${JSON.stringify(sanitizedBody)}`,
    );

    return next.handle().pipe(
      tap({
        next: () => {
          const responseTime = Date.now() - now;
          this.logger.log(
            `← ${method} ${url} | ${responseTime}ms | User: ${userId}`,
          );
        },
        error: (error) => {
          const responseTime = Date.now() - now;
          this.logger.error(
            `✗ ${method} ${url} | ${responseTime}ms | User: ${userId} | Error: ${error.message}`,
          );
        },
      }),
    );
  }

  private sanitizeBody(body: any): any {
    if (!body) return {};

    const sanitized = { ...body };
    const sensitiveFields = [
      'password',
      'token',
      'secret',
      'authorization',
      'api_key',
    ];

    for (const field of sensitiveFields) {
      if (sanitized[field]) {
        sanitized[field] = '***';
      }
    }

    return sanitized;
  }
}
