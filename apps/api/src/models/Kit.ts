import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

/**
 * Persisted prep kit. `kit` holds the Appendix A document; `researchBundle`
 * is kept so regenerate (T19b) can skip a re-crawl. Every query must filter
 * by `userId` (§1 own kits only).
 */
const kitSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    /** Optimistic concurrency for PATCH (T19b). */
    version: { type: Number, required: true, default: 1, min: 1 },
    /** Denormalised label for list/reopen UI. */
    title: { type: String, required: true, default: "Untitled kit" },
    input: {
      jd: { type: String, required: true },
      company_url: { type: String, required: true },
      days: { type: Number, required: true, min: 1 },
    },
    /** Full Appendix A kit (plus optional extensions). */
    kit: { type: Schema.Types.Mixed, required: true },
    /** Crawl/search bundle for section regenerate without re-fetch. */
    researchBundle: { type: Schema.Types.Mixed, required: false },
    /** User STAR stories (T26 Story Bank). Not part of Appendix A. */
    storyBank: { type: Schema.Types.Mixed, required: false },
  },
  { timestamps: true },
);

kitSchema.index({ userId: 1, updatedAt: -1 });

export type KitDocument = InferSchemaType<typeof kitSchema> & {
  _id: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
};

export const KitModel: Model<KitDocument> =
  (mongoose.models.Kit as Model<KitDocument> | undefined) ??
  mongoose.model<KitDocument>("Kit", kitSchema);
