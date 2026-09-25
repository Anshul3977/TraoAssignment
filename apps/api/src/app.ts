import cookieParser from "cookie-parser";
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import { createAuthRouter } from "./auth/routes.js";
import { createMemoryUserStore, type UserStore } from "./auth/store.js";
import { sendError } from "./errors.js";
import { attachSession } from "./middleware/auth.js";
import { createHealthRouter } from "./routes/health.js";

export type CreateAppOptions = {
  userStore?: UserStore;
  /** Disable rate limiting in tests. */
  disableRateLimit?: boolean;
};

export function createApp(options: CreateAppOptions = {}): {
  app: Express;
  userStore: UserStore;
} {
  const userStore = options.userStore ?? createMemoryUserStore();
  const app = express();

  app.disable("x-powered-by");
  app.use(helmet());
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());

  if (!options.disableRateLimit) {
    app.use(
      rateLimit({
        windowMs: 15 * 60 * 1000,
        max: 300,
        standardHeaders: true,
        legacyHeaders: false,
        handler: (_req, res) => {
          sendError(res, 429, "RATE_LIMITED", "Too many requests. Try again later.");
        },
      }),
    );
  }

  app.use(attachSession(userStore));
  app.use(createHealthRouter());
  app.use("/auth", createAuthRouter(userStore));

  app.use((_req, res) => {
    sendError(res, 404, "NOT_FOUND", "Route not found.");
  });

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error(err);
    if (res.headersSent) return;
    sendError(res, 500, "INTERNAL_ERROR", "An unexpected error occurred.");
  });

  return { app, userStore };
}
