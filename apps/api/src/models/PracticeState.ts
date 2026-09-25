import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

const practiceCardSchema = new Schema(
  {
    flashcardId: { type: String, required: true },
    /** Leitner box 1–5 (T20). */
    box: { type: Number, required: true, min: 1, max: 5, default: 1 },
    lastConfidence: { type: Number, required: false, min: 1, max: 5 },
    lastSeenAt: { type: Date, required: false },
  },
  { _id: false },
);

/**
 * Per-user practice progress for one kit. Enough to reopen and continue (§13).
 */
const practiceStateSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    kitId: {
      type: Schema.Types.ObjectId,
      ref: "Kit",
      required: true,
      index: true,
    },
    cards: { type: [practiceCardSchema], default: [] },
  },
  { timestamps: true },
);

practiceStateSchema.index({ userId: 1, kitId: 1 }, { unique: true });

export type PracticeStateDocument = InferSchemaType<typeof practiceStateSchema> & {
  _id: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
};

export const PracticeStateModel: Model<PracticeStateDocument> =
  (mongoose.models.PracticeState as Model<PracticeStateDocument> | undefined) ??
  mongoose.model<PracticeStateDocument>("PracticeState", practiceStateSchema);
