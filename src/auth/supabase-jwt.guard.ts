import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { createRemoteJWKSet, jwtVerify, type JWTVerifyOptions } from 'jose';
import { ConfigService } from '@nestjs/config';
import { AuthUser } from './auth-user-type';

function getBearer(req: Request): string | null {
  const auth = req.headers.authorization;
  if (!auth) return null;
  const [type, token] = auth.split(' ');
  if (type?.toLowerCase() !== 'bearer' || !token) return null;
  return token;
}

@Injectable()
export class SupabaseJwtGuard implements CanActivate {
  private jwks: ReturnType<typeof createRemoteJWKSet>;
  private verifyOptions: JWTVerifyOptions;

  constructor(private readonly config: ConfigService) {
    const issuer = this.config.get<string>('SUPABASE_JWT_ISSUER');

    const audience =
      this.config.get<string>('SUPABASE_JWT_AUDIENCE') ?? 'authenticated';

    if (!issuer) {
      throw new Error('Missing SUPABASE_JWT_ISSUER');
    }

    this.jwks = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
    this.verifyOptions = { issuer, audience };
  }

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request & { user?: any }>();
    const token = getBearer(req);
    if (!token) throw new UnauthorizedException('Missing Bearer token');

    try {
      const { payload } = await jwtVerify(token, this.jwks, this.verifyOptions);
      req.user = {
        id: payload?.sub as string,
        email: (payload as any)?.email,
        avatar_url: (payload as any)?.avatar_url,
        auth_provider: (payload as any)?.app_metadata?.provider,
        fullName: (payload as any)?.user_metadata?.name,
      } as AuthUser;
      return true;
    } catch (e: any) {
      throw new UnauthorizedException(e?.message ?? 'Invalid token');
    }
  }
}
