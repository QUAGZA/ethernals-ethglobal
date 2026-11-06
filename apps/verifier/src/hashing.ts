import { keccak256, toBytes } from "viem";
import { canonicalJson, type HiddenTestsBundle, type Hex } from "@ethernals/shared";

export const MAX_TEST_FILES = 20;
export const MAX_TEST_BYTES = 200_000;
export const MAX_PATCH_BYTES = 200_000;

export const keccakUtf8 = (text: string): Hex => keccak256(toBytes(text));

/** A safe relative path: forward slashes, no "..", no absolute or drive paths, no empty segments. */
export function isSafeRelativePath(p: string): boolean {
  if (!p || p.length > 200 || p.includes("\\") || p.includes("\0")) return false;
  if (p.startsWith("/") || /^[a-zA-Z]:/.test(p)) return false;
  return p.split("/").every((seg) => seg !== "" && seg !== "." && seg !== "..");
}

export function validateBundle(bundle: HiddenTestsBundle): string | null {
  if (!bundle || !Array.isArray(bundle.files) || bundle.files.length === 0) return "files must be a non-empty array";
  if (bundle.files.length > MAX_TEST_FILES) return `at most ${MAX_TEST_FILES} files`;
  let bytes = 0;
  const seen = new Set<string>();
  for (const f of bundle.files) {
    if (typeof f?.path !== "string" || typeof f?.content !== "string") return "each file needs path and content strings";
    if (!isSafeRelativePath(f.path)) return `unsafe path: ${f.path}`;
    if (seen.has(f.path)) return `duplicate path: ${f.path}`;
    seen.add(f.path);
    bytes += Buffer.byteLength(f.content);
  }
  if (bytes > MAX_TEST_BYTES) return `bundle larger than ${MAX_TEST_BYTES} bytes`;
  return null;
}

/** testsHash = keccak256(utf8(canonicalJson({ files: sortedByPath }))). */
export function testsHash(bundle: HiddenTestsBundle): Hex {
  const files = [...bundle.files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return keccakUtf8(canonicalJson({ files }));
}
