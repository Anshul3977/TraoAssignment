import jwt from "jsonwebtoken";
import type { JwtPayload } from "./types.js";

export const SESSION_COOKIE = "session";
/** 7 days in seconds */
export const SESSION_MAX_AGE_SEC = 7 * 24 * 60 * 60;

export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.trim() === "") {
    throw new Error("JWT_SECRET is required");
  }
  return secret;
}

export function signSessionToken(payload: JwtPayload): string {
  return jwt.sign(payload, getJwtSecret(), {
    expiresIn: SESSION_MAX_AGE_SEC,
  });
}

export type VerifyResult =
  | { ok: true; payload: JwtPayload }
  | { ok: false; reason: "expired" | "invalid" };

export function verifySessionToken(token: string): VerifyResult {
  try {
    const decoded = jwt.verify(token, getJwtSecret());
    if (
      typeof decoded !== "object" ||
      decoded === null ||
      typeof (decoded as JwtPayload).sub !== "string" ||
      typeof (decoded as JwtPayload).email !== "string"
    ) {
      return { ok: false, reason: "invalid" };
    }
    return {
      ok: true,
      payload: {
        sub: (decoded as JwtPayload).sub,
        email: (decoded as JwtPayload).email,
      },
    };
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      return { ok: false, reason: "expired" };
    }
    return { ok: false, reason: "invalid" };
  }
}

export function sessionCookieOptions(): {
  httpOnly: true;
  secure: boolean;
  sameSite: "lax";
  maxAge: number;
  path: string;
} {
  return {
    httpOnly: true,
    // Secure in production so local http://localhost + Next rewrites still work.
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: SESSION_MAX_AGE_SEC * 1000,
    path: "/",
  };
}
