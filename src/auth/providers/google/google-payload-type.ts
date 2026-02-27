export type GoogleIdTokenPayload = {
  iss: string;
  sub: string;
  email?: string;
  email_verified?: boolean;
  name: string;
  picture: string;
  //   aud?: string;
  //   exp?: number;
};
