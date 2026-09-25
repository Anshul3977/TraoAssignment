/**
 * Deep imports from `@prep/core` internals. The package public entry only
 * exports schema + pipeline; T19b needs merge/allocate/LLM step helpers.
 * Paths stay relative so we do not reimplement merge logic in apps/api.
 */
export {
  allocateSchedule,
  mergeRegenerated,
  normalisePrompt,
  mapStoryBank,
  hintStoriesForFlashcard,
  assignStoryIds,
  MAX_STORIES,
  type MergeRegeneratedResult,
  type RegenerateSection,
  type StarStory,
  type StoryBankMapping,
  type StoryDraft,
  type StoryMatch,
} from "../../../../packages/core/src/deterministic/index.js";

export {
  buildBrief,
  honestEmptyBrief,
  generateTechnicalQuestions,
  generateBehaviouralQuestions,
  generateSystemDesignQuestions,
  generateCompanyFitQuestions,
  type CompanyBrief,
  type InterviewProcess,
} from "../../../../packages/core/src/steps/index.js";

export {
  createLlmClientFromEnv,
  type LlmClient,
} from "../../../../packages/core/src/llm/index.js";

export {
  crawl,
  type ResearchBundle,
} from "../../../../packages/core/src/retrieval/index.js";

import type { Kit } from "@prep/core";

export type Question = Kit["questions"][number];
export type Flashcard = Kit["flashcards"][number];
