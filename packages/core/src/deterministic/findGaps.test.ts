import { describe, expect, it } from "vitest";
import { findGaps, type GapQuestion, type GapRequirement } from "./findGaps.js";

function req(
  id: string,
  priority: GapRequirement["priority"],
): GapRequirement {
  return { id, priority };
}

function q(...requirement_ids: string[]): GapQuestion {
  return { requirement_ids };
}

describe("findGaps", () => {
  it("omits requirements that a question covers", () => {
    const requirements = [
      req("r1", "must"),
      req("r2", "must"),
      req("r3", "nice"),
    ];
    const questions = [q("r1", "r3")];

    expect(findGaps(requirements, questions)).toEqual(["r2"]);
  });

  it("lists must gaps before nice gaps", () => {
    const requirements = [
      req("r1", "nice"),
      req("r2", "must"),
      req("r3", "nice"),
      req("r4", "must"),
    ];
    const questions: GapQuestion[] = [];

    expect(findGaps(requirements, questions)).toEqual([
      "r2",
      "r4",
      "r1",
      "r3",
    ]);
  });

  it("returns every requirement id when questions are empty", () => {
    const requirements = [
      req("r1", "must"),
      req("r2", "nice"),
      req("r3", "must"),
    ];

    expect(findGaps(requirements, [])).toEqual(["r1", "r3", "r2"]);
  });

  it("returns empty when every requirement is covered", () => {
    const requirements = [req("r1", "must"), req("r2", "nice")];
    const questions = [q("r1"), q("r2")];

    expect(findGaps(requirements, questions)).toEqual([]);
  });

  it("treats a requirement covered by any one of several questions", () => {
    const requirements = [
      req("r1", "must"),
      req("r2", "must"),
      req("r3", "nice"),
    ];
    const questions = [q("r2"), q("r1", "r3")];

    expect(findGaps(requirements, questions)).toEqual([]);
  });

  it("ignores question requirement_ids that are not in the requirements list", () => {
    const requirements = [req("r1", "must"), req("r2", "nice")];
    const questions = [q("r999", "r1")];

    expect(findGaps(requirements, questions)).toEqual(["r2"]);
  });
});
