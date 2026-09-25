import mongoose from "mongoose";
import { UserModel } from "../models/User.js";
import type { AuthUser } from "./types.js";
import type { UserStore } from "./store.js";

function toAuthUser(doc: {
  _id: mongoose.Types.ObjectId;
  email: string;
  passwordHash: string;
  createdAt: Date;
}): AuthUser {
  return {
    id: String(doc._id),
    email: doc.email,
    passwordHash: doc.passwordHash,
    createdAt: doc.createdAt.toISOString(),
  };
}

/** Mongoose-backed UserStore (T17b). */
export function createMongooseUserStore(): UserStore {
  return {
    async create(email, passwordHash) {
      const normalised = email.trim().toLowerCase();
      try {
        const doc = await UserModel.create({
          email: normalised,
          passwordHash,
        });
        return toAuthUser(doc);
      } catch (err: unknown) {
        if (
          err &&
          typeof err === "object" &&
          "code" in err &&
          (err as { code: number }).code === 11000
        ) {
          throw new Error("EMAIL_TAKEN");
        }
        throw err;
      }
    },
    async findByEmail(email) {
      const doc = await UserModel.findOne({
        email: email.trim().toLowerCase(),
      }).exec();
      return doc ? toAuthUser(doc) : null;
    },
    async findById(id) {
      if (!mongoose.Types.ObjectId.isValid(id)) return null;
      const doc = await UserModel.findById(id).exec();
      return doc ? toAuthUser(doc) : null;
    },
    clear() {
      // No-op for mongoose; tests drop the database instead.
    },
  };
}
