import { UnauthorizedException } from '@nestjs/common';
import { GoogleIdTokenPayload } from './google-payload-type';
import { AuthUser } from '../../auth-user-type';

export function googleToAuthUser(p: GoogleIdTokenPayload): AuthUser {
  const email = p.email;
  const verified = Boolean(p.email_verified);

  if (!p.sub) throw new UnauthorizedException('Google token missing sub');
  if (!email) throw new UnauthorizedException('Google token missing email');
  if (!verified) throw new UnauthorizedException('Google email not verified');

  return {
    role: null,
    auth_provider: 'google',
    id: p.sub,
    email,
    fullName: p.name,
    avatar_url: p.picture,
  };
}
