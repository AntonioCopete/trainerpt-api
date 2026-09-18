export type SupabaseJwtPayload = {
  iss: string;
  sub: string; // Supabase user id
  email?: string;
  email_confirmed_at?: string; // sometimes 'email_verified' depending on setup
  aud?: string;
  exp?: number;
};
