/** Public entry for @prep/core. Pipeline modules land here in later tasks. */
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
