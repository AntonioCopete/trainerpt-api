export type SupabaseJwtPayload = {
  iss: string;
  sub: string; // user id en supabase
  email?: string;
  email_confirmed_at?: string; // o a veces 'email_verified' según setup
  aud?: string;
  exp?: number;
};
