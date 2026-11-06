/**
 * pnpm dev:public — runs the app behind a Cloudflare quick tunnel so other people can reach it.
 *  1. starts `cloudflared tunnel` to the web app (port 3000, which proxies /api and /a to the server);
 *  2. writes the tunnel URL to PUBLIC_BASE_URL in .env;
 *  3. starts `pnpm dev`;
 *  4. once the server answers, runs `pnpm ens:sync` so every agent's ENS endpoint record points at the tunnel.
 * A quick tunnel gets a new URL on every run, so ens:sync runs every time (one Sepolia transaction per agent).
 * Set SKIP_ENS_SYNC=1 to skip step 4. Pass --prod to serve a production build (faster and smoother through the tunnel).
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROD = process.argv.includes("--prod");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envFile = path.join(root, ".env");

function findCloudflared() {
  const probe = spawnSync(process.platform === "win32" ? "where" : "which", ["cloudflared"], { encoding: "utf8" });
  if (probe.status === 0) return probe.stdout.split(/\r?\n/)[0].trim();
  for (const p of ["C:\\Program Files (x86)\\cloudflared\\cloudflared.exe", "C:\\Program Files\\cloudflared\\cloudflared.exe", "/usr/local/bin/cloudflared"]) {
    if (existsSync(p)) return p;
  }
  console.error("cloudflared not found. Install it: winget install Cloudflare.cloudflared");
  process.exit(1);
}

function setEnv(key, value) {
  const text = readFileSync(envFile, "utf8");
  const line = `${key}=${value}`;
  const re = new RegExp(`^${key}=.*$`, "m");
  writeFileSync(envFile, re.test(text) ? text.replace(re, line) : `${text.replace(/\s*$/, "\n")}${line}\n`);
}

const children = [];
function shutdown(code = 0) {
  for (const c of children) {
    try {
      if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(c.pid), "/T", "/F"]);
      else c.kill("SIGTERM");
    } catch {
      /* already gone */
    }
  }
  process.exit(code);
}
process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

const tunnel = spawn(findCloudflared(), ["tunnel", "--no-autoupdate", "--url", "http://localhost:3000"], { stdio: ["ignore", "pipe", "pipe"] });
children.push(tunnel);
tunnel.on("exit", (code) => {
  console.error(`[tunnel] cloudflared exited (${code}). Stopping.`);
  shutdown(1);
});

let started = false;
function onTunnelOutput(chunk) {
  const text = chunk.toString();
  const match = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
  if (!match || started) return;
  started = true;
  const url = match[0];
  console.log(`\n[tunnel] public URL: ${url}\n`);
  setEnv("PUBLIC_BASE_URL", url);

  let command = ["dev"];
  if (PROD) {
    // Production build: small minified bundles, much faster through a tunnel than the dev server.
    console.log("[tunnel] building the web app for production (about a minute)...");
    const build = spawnSync("pnpm", ["--filter", "@ethernals/web", "build"], { cwd: root, stdio: "inherit", shell: true });
    if (build.status !== 0) {
      console.error("[tunnel] web build failed; fix the build or run without --prod.");
      shutdown(1);
    }
    command = ["start"];
  }
  const dev = spawn("pnpm", command, { cwd: root, stdio: "inherit", shell: true });
  children.push(dev);
  dev.on("exit", (code) => shutdown(code ?? 0));

  if (process.env.SKIP_ENS_SYNC === "1") return;
  void (async () => {
    for (let i = 0; i < 120; i++) {
      try {
        const res = await fetch("http://127.0.0.1:4000/api/config");
        if (res.ok) break;
      } catch {
        /* server not up yet */
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
    console.log("[tunnel] server is up, pointing every agent's ENS endpoint at the tunnel...");
    const sync = spawn("pnpm", ["ens:sync"], { cwd: root, stdio: "inherit", shell: true });
    sync.on("exit", (code) => console.log(code === 0 ? "[tunnel] ENS endpoints updated." : `[tunnel] ens:sync failed (${code}); run pnpm ens:sync again.`));
  })();
}
tunnel.stdout.on("data", onTunnelOutput);
tunnel.stderr.on("data", onTunnelOutput);
