// Builds the sandbox image. Plain Node so it works the same on Windows, macOS and Linux.
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const image = process.env.VERIFIER_IMAGE || "ethernals-pytest:latest";
const r = spawnSync("docker", ["build", "-t", image, path.join(here, "..", "sandbox")], { stdio: "inherit" });
process.exit(r.status ?? 1);
