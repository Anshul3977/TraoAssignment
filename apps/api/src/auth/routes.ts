import { Router } from "express";
import { z } from "zod";
import {
  SESSION_COOKIE,
  sessionCookieOptions,
  signSessionToken,
} from "./jwt.js";
import { hashPassword, verifyPassword } from "./password.js";
import type { UserStore } from "./store.js";
import { toPublicUser } from "./store.js";
import { sendError } from "../errors.js";
import { requireAuth } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";

const credentialsSchema = z.object({
  email: z.string().trim().email().max(320),
  password: z.string().min(8).max(200),
});

export function createAuthRouter(store: UserStore): Router {
  const router = Router();

  router.post(
    "/register",
    validate("body", credentialsSchema),
    async (req, res) => {
      const { email, password } = req.body as z.infer<typeof credentialsSchema>;
      const existing = await store.findByEmail(email);
      if (existing) {
        sendError(res, 409, "EMAIL_TAKEN", "An account with this email already exists.");
        return;
      }
      const passwordHash = await hashPassword(password);
      let user;
      try {
        user = await store.create(email, passwordHash);
      } catch (err) {
        if (err instanceof Error && err.message === "EMAIL_TAKEN") {
          sendError(res, 409, "EMAIL_TAKEN", "An account with this email already exists.");
          return;
        }
        throw err;
      }
      const token = signSessionToken({ sub: user.id, email: user.email });
      res.cookie(SESSION_COOKIE, token, sessionCookieOptions());
      res.status(201).json({ user: toPublicUser(user) });
    },
  );

  router.post(
    "/login",
    validate("body", credentialsSchema),
    async (req, res) => {
      const { email, password } = req.body as z.infer<typeof credentialsSchema>;
      const user = await store.findByEmail(email);
      if (!user || !(await verifyPassword(password, user.passwordHash))) {
        sendError(res, 401, "INVALID_CREDENTIALS", "Email or password is incorrect.");
        return;
      }
      const token = signSessionToken({ sub: user.id, email: user.email });
      res.cookie(SESSION_COOKIE, token, sessionCookieOptions());
      res.status(200).json({ user: toPublicUser(user) });
    },
  );

  router.post("/logout", (_req, res) => {
    res.clearCookie(SESSION_COOKIE, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
    });
    res.status(204).send();
  });

  router.get("/me", requireAuth, (req, res) => {
    res.status(200).json({ user: req.user });
  });

  return router;
}
