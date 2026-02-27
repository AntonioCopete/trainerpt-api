import { UserRole } from 'generated/prisma/enums';

export type AuthProvider = 'google' | 'magiclink';

export type AuthUser = {
  role: UserRole | null;
  auth_provider: AuthProvider;
  id: string;
  email: string;
  fullName?: string;
  avatar_url?: string;
};
