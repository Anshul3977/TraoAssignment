import { describe, expect, it } from "vitest";
import { PACKAGE_NAME } from "./index.js";

describe("scaffold", () => {
  it("exports the core package name", () => {
    expect(PACKAGE_NAME).toBe("@prep/core");
  });
});
