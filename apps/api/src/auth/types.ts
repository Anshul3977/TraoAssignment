export type AuthUser = {
  id: string;
  email: string;
  passwordHash: string;
  createdAt: string;
};

export type PublicUser = {
  id: string;
  email: string;
};

export type JwtPayload = {
  sub: string;
  email: string;
};

declare global {
  namespace Express {
    interface Request {
      user?: PublicUser;
      /** Set when a cookie was present but JWT verify failed (expired/invalid). */
      sessionExpired?: boolean;
    }
  }
}

export {};
