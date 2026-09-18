import { UnauthorizedException } from '@nestjs/common';
import { AuthUser } from '../../auth-user-type';
import { SupabaseJwtPayload } from './magiclink-payload-type';

export function supabaseToAuthUser(p: SupabaseJwtPayload): AuthUser {
  if (!p.sub) throw new UnauthorizedException('Supabase token missing sub');
  if (!p.email) throw new UnauthorizedException('Supabase token missing email');

  // Adjust this check depending on your Supabase auth config
  const emailVerified = Boolean(p.email_confirmed_at);

  if (!emailVerified)
    throw new UnauthorizedException('Supabase email not verified');

  return {
    role: null,
    auth_provider: 'magiclink',
    id: p.sub,
    email: p.email,
    // name: null,
  };
}
