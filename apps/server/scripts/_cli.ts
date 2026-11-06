/** Tiny helpers shared by the ops scripts: argument parsing and friendly error output. */
import { ConfigError } from "../src/config";

export function parseArgs(argv = process.argv.slice(2)): { flags: Record<string, string | true>; positional: string[] } {
  const flags: Record<string, string | true> = {};
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--") continue; // `pnpm script -- --flag` passes a bare "--"
    if (arg.startsWith("--")) {
      const [key, inline] = arg.slice(2).split("=", 2);
      if (inline !== undefined) flags[key] = inline;
      else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith("--")) flags[key] = argv[++i];
      else flags[key] = true;
    } else {
      positional.push(arg);
    }
  }
  return { flags, positional };
}

export const ok = (msg: string) => console.log(`  \x1b[32m✔\x1b[0m ${msg}`);
export const bad = (msg: string) => console.log(`  \x1b[31m✖\x1b[0m ${msg}`);
export const warn = (msg: string) => console.log(`  \x1b[33m!\x1b[0m ${msg}`);
export const info = (msg: string) => console.log(`  ${msg}`);
export const title = (msg: string) => console.log(`\n\x1b[1m${msg}\x1b[0m`);

/** Runs a script body and prints plain-English errors instead of stack traces. */
export function run(main: () => Promise<void>): void {
  main()
    .then(() => process.exit(0))
    .catch((err: unknown) => {
      console.log("");
      if (err instanceof ConfigError) {
        bad(err.message);
      } else {
        bad((err as Error)?.message ?? String(err));
        if (process.env.DEBUG) console.error(err);
      }
      console.log("\n  Need help? See SETUP.md, or run: pnpm check-setup\n");
      process.exit(1);
    });
}
