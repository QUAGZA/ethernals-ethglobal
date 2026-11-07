import { describe, expect, it } from "vitest";
import { extractImages, modelTypeFor, TASK_TYPE_LABELS, TASK_TYPES } from "../src/api";

describe("task types", () => {
  it("offers the five types, each with a label", () => {
    expect(TASK_TYPES.map((t) => TASK_TYPE_LABELS[t])).toEqual(["Image gen", "Video gen", "Code gen", "Summarize", "Translate"]);
  });

  it("maps each type to its model family", () => {
    expect(TASK_TYPES.map(modelTypeFor)).toEqual(["image", "video", "text", "text", "text"]);
  });
});

describe("extractImages", () => {
  const LINK = "https://storage.example/a.jpeg?Expires=1&sig=x%2Fy";

  it("finds links and embedded data on their own lines", () => {
    expect(extractImages(`${LINK}\ndata:image/png;base64,AAAA\n`)).toEqual([LINK, "data:image/png;base64,AAAA"]);
  });

  it("finds them when a model wraps them", () => {
    expect(extractImages(`Here you go: ${LINK}`)).toEqual([LINK]);
    expect(extractImages(`![fox](${LINK})`)).toEqual([LINK]);
    expect(extractImages(JSON.stringify({ result: { image_urls: [LINK] } }))).toEqual([LINK]);
    expect(extractImages("http://storage.example/a.png")).toEqual(["http://storage.example/a.png"]);
  });

  it("lists a repeated image once and finds nothing in plain text", () => {
    expect(extractImages(`${LINK}\n${LINK}`)).toEqual([LINK]);
    expect(extractImages("no picture here")).toEqual([]);
  });
});
