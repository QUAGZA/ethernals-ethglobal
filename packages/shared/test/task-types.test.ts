import { describe, expect, it } from "vitest";
import { modelTypeFor, TASK_TYPE_LABELS, TASK_TYPES } from "../src/api";

describe("task types", () => {
  it("offers the five types, each with a label", () => {
    expect(TASK_TYPES.map((t) => TASK_TYPE_LABELS[t])).toEqual(["Image gen", "Video gen", "Code gen", "Summarize", "Translate"]);
  });

  it("maps each type to its model family", () => {
    expect(TASK_TYPES.map(modelTypeFor)).toEqual(["image", "video", "text", "text", "text"]);
  });
});
