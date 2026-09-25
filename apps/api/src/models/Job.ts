import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

const jobStepSchema = new Schema(
  {
    step: { type: String, required: true },
    status: {
      type: String,
      enum: ["running", "done", "skipped", "failed"],
      required: true,
    },
    detail: { type: String, required: false },
  },
  { _id: false },
);

/**
 * Generation job. Idempotency + worker progress land in T18; the shape is
 * persisted here so a restart can reopen/continue (§13).
 */
const jobSchema = new Schema(
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
      required: false,
    },
    /** sha256(userId + normalised JD + URL + days) — unique per user. */
    idempotencyKey: { type: String, required: true },
    status: {
      type: String,
      enum: ["queued", "running", "done", "failed"],
      required: true,
      default: "queued",
      index: true,
    },
    steps: { type: [jobStepSchema], default: [] },
    error: {
      code: { type: String },
      message: { type: String },
    },
    input: {
      jd: { type: String, required: true },
      company_url: { type: String, required: true },
      days: { type: Number, required: true, min: 1 },
    },
  },
  { timestamps: true },
);

jobSchema.index({ userId: 1, idempotencyKey: 1 }, { unique: true });

export type JobDocument = InferSchemaType<typeof jobSchema> & {
  _id: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
};

export const JobModel: Model<JobDocument> =
  (mongoose.models.Job as Model<JobDocument> | undefined) ??
  mongoose.model<JobDocument>("Job", jobSchema);
