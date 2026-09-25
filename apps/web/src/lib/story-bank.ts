/**
 * Pure helpers for Story Bank drafts (T26). Mapping is computed on the API.
 */

import type { StoryDraft } from "./api";

export const MAX_STORIES = 6;

export function emptyStoryDraft(): StoryDraft {
  return {
    title: "",
    situation: "",
    task: "",
    action: "",
    result: "",
  };
}

export function isCompleteStory(draft: StoryDraft): boolean {
  return (
    draft.title.trim().length > 0 &&
    draft.situation.trim().length > 0 &&
    draft.task.trim().length > 0 &&
    draft.action.trim().length > 0 &&
    draft.result.trim().length > 0
  );
}

/** Stories ready to PUT (complete STAR sets only). */
export function completeStories(drafts: StoryDraft[]): StoryDraft[] {
  return drafts.filter(isCompleteStory).slice(0, MAX_STORIES);
}

export function storyCountHint(completeCount: number): string {
  if (completeCount === 0) {
    return "Write 4–6 reusable STAR stories. Behavioural questions reuse this set.";
  }
  if (completeCount < 4) {
    return `${completeCount} of 4–6 recommended stories saved.`;
  }
  return `${completeCount} of ${MAX_STORIES} stories.`;
}
