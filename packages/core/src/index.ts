/** Public entry for @prep/core. */
export const PACKAGE_NAME = "@prep/core";

export {
  KitSchema,
  BatchOutputSchema,
  BatchKitEntrySchema,
  BatchErrorSchema,
  validateKit,
  type Kit,
  type BatchOutput,
  type BatchKitEntry,
  type ValidateKitResult,
  type ValidationIssue,
} from "./schema/index.js";

export {
  runPipeline,
  PipelineError,
  isPipelineError,
  type PipelineInput,
  type PipelineOptions,
  type PipelineResult,
  type ProgressEvent,
} from "./pipeline.js";

export {
  evaluateKit,
  type KitCheck,
  type KitEvaluation,
} from "./eval/evaluateKit.js";

export {
  createLlmClientFromEnv,
  createTracingClient,
  summarizeTrace,
  type LlmCallTrace,
  type TraceSummary,
} from "./llm/index.js";
