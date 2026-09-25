import { randomUUID } from "node:crypto";
import type { AuthUser, PublicUser } from "./types.js";

/** In-memory user store (tests / optional inject). Production uses Mongoose (T17b). */
export type UserStore = {
  create(email: string, passwordHash: string): Promise<AuthUser>;
  findByEmail(email: string): Promise<AuthUser | null>;
  findById(id: string): Promise<AuthUser | null>;
  clear(): void;
};

export function createMemoryUserStore(): UserStore {
  const byId = new Map<string, AuthUser>();
  const byEmail = new Map<string, string>();

  return {
    async create(email, passwordHash) {
      const normalised = email.trim().toLowerCase();
      if (byEmail.has(normalised)) {
        throw new Error("EMAIL_TAKEN");
      }
      const user: AuthUser = {
        id: randomUUID(),
        email: normalised,
        passwordHash,
        createdAt: new Date().toISOString(),
      };
      byId.set(user.id, user);
      byEmail.set(normalised, user.id);
      return user;
    },
    async findByEmail(email) {
      const id = byEmail.get(email.trim().toLowerCase());
      return id ? (byId.get(id) ?? null) : null;
    },
    async findById(id) {
      return byId.get(id) ?? null;
    },
    clear() {
      byId.clear();
      byEmail.clear();
    },
  };
}

export function toPublicUser(user: AuthUser): PublicUser {
  return { id: user.id, email: user.email };
}
