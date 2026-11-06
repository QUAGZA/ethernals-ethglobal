import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export interface RunOptions {
  mode: "docker" | "local";
  image: string;
  repoDir: string;
  outDir: string;
  jobId: string;
  testCommand: string;
  timeoutSeconds: number;
  onLine: (line: string) => void;
}

export interface RunOutcome {
  exitCode: number | null;
  timedOut: boolean;
  junitXml: string | null;
}

const ANSI = /\u001b\[[0-9;]*[A-Za-z]/g;
const MAX_LINE = 500;

export const cleanLine = (l: string) => l.replace(ANSI, "").replace(/\r/g, "").slice(0, MAX_LINE);

/** Only simple test commands are accepted: letters, digits, spaces and a few flag characters. */
export function isSafeTestCommand(cmd: string): boolean {
  return /^[A-Za-z0-9_./=:,\- ]{1,200}$/.test(cmd);
}

export function dockerArgs(o: Pick<RunOptions, "image" | "repoDir" | "outDir" | "jobId" | "testCommand">): string[] {
  return [
    "run", "--rm", "--name", `ev-${o.jobId}`,
    "--network", "none", "--cpus", "1", "--memory", "512m", "--pids-limit", "256",
    "--security-opt", "no-new-privileges", "--cap-drop", "ALL",
    "-e", "PYTHONDONTWRITEBYTECODE=1",
    "-v", `${o.repoDir}:/work`, "-v", `${o.outDir}:/out`, "-w", "/work",
    o.image, "sh", "-c", `${o.testCommand} -p no:cacheprovider --junitxml=/out/junit.xml`,
  ];
}

export function runTests(o: RunOptions): Promise<RunOutcome> {
  if (!isSafeTestCommand(o.testCommand)) return Promise.reject(new Error("unsafe test command"));
  fs.mkdirSync(o.outDir, { recursive: true });
  const junitPath = path.join(o.outDir, "junit.xml");
  const child =
    o.mode === "docker"
      ? spawn("docker", dockerArgs(o), { windowsHide: true })
      : spawn(`${o.testCommand} -p no:cacheprovider --junitxml="${junitPath}"`, {
          cwd: o.repoDir,
          shell: true,
          windowsHide: true,
          env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
        });

  return new Promise((resolve, reject) => {
    let timedOut = false;
    let lines = 0;
    const timer = setTimeout(() => {
      timedOut = true;
      if (o.mode === "docker") spawn("docker", ["kill", `ev-${o.jobId}`], { windowsHide: true });
      child.kill("SIGKILL");
    }, o.timeoutSeconds * 1000);

    const feed = (buf: Buffer) => {
      for (const raw of buf.toString("utf8").split("\n")) {
        if (raw === "") continue;
        if (lines++ < 2000) o.onLine(cleanLine(raw));
      }
    };
    child.stdout.on("data", feed);
    child.stderr.on("data", feed);
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const junitXml = fs.existsSync(junitPath) ? fs.readFileSync(junitPath, "utf8") : null;
      resolve({ exitCode: code, timedOut, junitXml });
    });
  });
}
