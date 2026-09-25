import type { Question, Requirement } from "../schema/kit.js";

/** User-authored STAR story. Ids are assigned in code (`s1`…). */
export type StarStory = {
  id: string;
  title: string;
  situation: string;
  task: string;
  action: string;
  result: string;
};

export type StoryDraft = Omit<StarStory, "id">;

export type StoryMatch = {
  storyId: string;
  score: number;
  overlappingTerms: string[];
};

export type RequirementStoryMapping = {
  requirementId: string;
  text: string;
  priority: string;
  candidates: StoryMatch[];
};

export type QuestionStoryMapping = {
  questionId: string;
  prompt: string;
  candidates: StoryMatch[];
};

export type UncoveredStoryRequirement = {
  requirementId: string;
  text: string;
  /** Exact demo phrasing, e.g. You have no story for 'mentoring juniors'. */
  message: string;
};

export type StoryBankMapping = {
  requirements: RequirementStoryMapping[];
  questions: QuestionStoryMapping[];
  uncovered: UncoveredStoryRequirement[];
};

export const MAX_STORIES = 6;
export const MAX_CANDIDATES = 3;

const STOPWORDS = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "of",
  "to",
  "in",
  "for",
  "with",
  "on",
  "at",
  "by",
  "from",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "you",
  "we",
  "they",
  "i",
  "it",
  "this",
  "that",
  "have",
  "has",
  "had",
  "will",
  "would",
  "can",
  "could",
  "should",
  "your",
  "our",
  "their",
  "my",
  "me",
  "as",
  "into",
  "about",
  "over",
  "than",
  "then",
  "also",
  "using",
  "use",
  "used",
  "ability",
  "strong",
  "excellent",
  "good",
  "great",
  "years",
  "year",
  "experience",
  "experienced",
  "skill",
  "skills",
  "able",
  "across",
  "within",
  "including",
  "plus",
]);

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

/** Light suffix strip so mentoring/mentored/juniors share stems. */
export function stemToken(token: string): string {
  let t = token;
  if (t.length > 5 && t.endsWith("ing")) t = t.slice(0, -3);
  else if (t.length > 4 && t.endsWith("ed")) t = t.slice(0, -2);
  else if (t.length > 4 && t.endsWith("ies")) t = `${t.slice(0, -3)}y`;
  else if (t.length > 5 && t.endsWith("ers")) t = t.slice(0, -1);
  else if (t.length > 4 && t.endsWith("s") && !t.endsWith("ss")) t = t.slice(0, -1);
  return t;
}

export function contentTokens(text: string): string[] {
  const raw = normalize(text)
    .replace(/[^a-z0-9+#.\s-]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t))
    .map(stemToken)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
  return [...new Set(raw)];
}

export function storyCorpus(story: StarStory): string {
  return [story.title, story.situation, story.task, story.action, story.result]
    .filter(Boolean)
    .join(" ");
}

export function assignStoryIds(drafts: StoryDraft[]): StarStory[] {
  return drafts.slice(0, MAX_STORIES).map((d, i) => ({
    title: d.title.trim(),
    situation: d.situation.trim(),
    task: d.task.trim(),
    action: d.action.trim(),
    result: d.result.trim(),
    id: `s${i + 1}`,
  }));
}

function scoreAgainstTokens(
  targetTokens: string[],
  story: StarStory,
): StoryMatch | null {
  if (targetTokens.length === 0) return null;
  const storyTokens = new Set(contentTokens(storyCorpus(story)));
  const overlappingTerms: string[] = [];
  for (const t of targetTokens) {
    if (storyTokens.has(t)) overlappingTerms.push(t);
  }
  if (overlappingTerms.length === 0) return null;
  const phrase = normalize(
    targetTokens.length > 0 ? targetTokens.join(" ") : "",
  );
  const corpus = normalize(storyCorpus(story));
  const phraseBonus =
    phrase.length >= 8 && corpus.includes(phrase) ? 0.25 : 0;
  const score = Math.min(
    1,
    overlappingTerms.length / targetTokens.length + phraseBonus,
  );
  return { storyId: story.id, score, overlappingTerms };
}

function rankStories(
  targetText: string,
  stories: StarStory[],
): StoryMatch[] {
  const tokens = contentTokens(targetText);
  const matches: StoryMatch[] = [];
  for (const story of stories) {
    const hit = scoreAgainstTokens(tokens, story);
    if (hit) matches.push(hit);
  }
  matches.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.storyId.localeCompare(b.storyId, "en");
  });
  return matches.slice(0, MAX_CANDIDATES);
}

export function uncoveredMessage(requirementText: string): string {
  return `You have no story for '${requirementText.trim()}'`;
}

/**
 * Map STAR stories onto behavioural requirements and questions via
 * deterministic keyword overlap. No LLM.
 */
export function mapStoryBank(
  stories: StarStory[],
  requirements: Pick<Requirement, "id" | "text" | "kind" | "priority">[],
  questions: Pick<
    Question,
    "id" | "prompt" | "answer_outline" | "category" | "requirement_ids"
  >[],
): StoryBankMapping {
  const behaviouralReqs = requirements.filter((r) => r.kind === "behavioural");
  const reqById = new Map(requirements.map((r) => [r.id, r]));

  const reqMappings: RequirementStoryMapping[] = behaviouralReqs.map((r) => ({
    requirementId: r.id,
    text: r.text,
    priority: r.priority,
    candidates: rankStories(r.text, stories),
  }));

  const uncovered: UncoveredStoryRequirement[] = reqMappings
    .filter((m) => m.candidates.length === 0)
    .map((m) => ({
      requirementId: m.requirementId,
      text: m.text,
      message: uncoveredMessage(m.text),
    }));

  const behaviouralQs = questions.filter((q) => q.category === "behavioural");
  const questionMappings: QuestionStoryMapping[] = behaviouralQs.map((q) => {
    const linkedText = q.requirement_ids
      .map((id) => reqById.get(id))
      .filter((r): r is NonNullable<typeof r> => r != null)
      .map((r) => r.text)
      .join(" ");
    const blob = `${q.prompt} ${q.answer_outline} ${linkedText}`;
    return {
      questionId: q.id,
      prompt: q.prompt,
      candidates: rankStories(blob, stories),
    };
  });

  return {
    requirements: reqMappings,
    questions: questionMappings,
    uncovered,
  };
}

/**
 * Stories to show as a practice hint for a flashcard: union of matches on
 * linked behavioural requirements, then the card front/back text.
 */
export function hintStoriesForFlashcard(
  stories: StarStory[],
  mapping: StoryBankMapping,
  flashcard: { front: string; back: string; requirement_ids: string[] },
): StoryMatch[] {
  const byId = new Map(stories.map((s) => [s.id, s]));
  const seen = new Set<string>();
  const out: StoryMatch[] = [];

  function add(matches: StoryMatch[]) {
    for (const m of matches) {
      if (seen.has(m.storyId) || !byId.has(m.storyId)) continue;
      seen.add(m.storyId);
      out.push(m);
    }
  }

  for (const rid of flashcard.requirement_ids) {
    const row = mapping.requirements.find((r) => r.requirementId === rid);
    if (row) add(row.candidates);
  }

  add(rankStories(`${flashcard.front} ${flashcard.back}`, stories));
  return out.slice(0, MAX_CANDIDATES);
}
