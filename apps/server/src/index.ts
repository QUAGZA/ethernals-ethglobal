/**
 * Ethernals server: x402 seller endpoints (/a/:label/task), the verifier, and the REST/SSE API (/api/*).
 * The web app (port 3000) proxies /api and /a here, so one public URL serves everything.
 */
import express, { type NextFunction, type Request, type Response } from "express";
import { ZodError } from "zod";
import { createApi } from "./api";
import { handleSellerTask } from "./agent-runtime";
import { config, ConfigError } from "./config";
import { failInterruptedSandboxRuns, getDb, listAgents } from "./db";
import { warmStats } from "./views";
import { startChainIndexer } from "./chain-index";
import { AppError } from "./errors";
import { agentGate } from "./gate";
import { log } from "./events";
import { llmMode } from "./llm";
import { createSellerPaymentMiddleware, facilitatorSupportsHedera } from "./payments";
import { startEscrowWatcher } from "./settlement";
import { startUnratedSweeper } from "./verifier";

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", true);
// Custom tasks carry tests and patches. express.json leaves a body it has already parsed alone.
app.use("/api/tasks", express.json({ limit: "1mb" }));
app.use(express.json({ limit: "64kb" }));

app.use("/a/:label/task", agentGate);
app.use(createSellerPaymentMiddleware());
app.post("/a/:label/task", handleSellerTask);

app.use(createApi());

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof AppError) {
    res.status(err.status).json({ error: err.message, hint: err.hint, ...err.details });
    return;
  }
  if (err instanceof ConfigError) {
    res.status(503).json({ error: err.message, hint: err.hint });
    return;
  }
  if (err instanceof ZodError) {
    res.status(400).json({ error: err.issues[0]?.message ?? "Invalid request." });
    return;
  }
  log.error("unhandled error", err);
  res.status(500).json({ error: "Something went wrong on the server.", hint: (err as Error)?.message });
});

getDb();
failInterruptedSandboxRuns();
app.listen(config.serverPort, () => {
  log.info(`server listening on http://127.0.0.1:${config.serverPort} (public URL ${config.publicBaseUrl})`);
  log.info(`LLM: ${config.zeroG.enabled() ? `0G Router (${config.zeroG.network()})` : llmMode()} · World: ${config.world.env}/${config.world.humanMode} · payments: ${config.hedera.paymentAsset} on Hedera testnet`);
  if (config.devFakePersons) log.warn("DEV_FAKE_PERSONS=true: people are NOT verified. Turn this off before the demo.");
  if (!config.hedera.ledgerAddressOrNull()) log.warn("HIRE_LEDGER_ADDRESS is empty. Run: pnpm deploy:ledger");
  void facilitatorSupportsHedera().then((r) =>
    r.ok ? log.info(`facilitator OK: ${r.detail}`) : log.warn(`facilitator problem: ${r.detail}. Payments will fail; see SETUP.md Step 9.`),
  );
});
warmStats(listAgents("seller"));
startChainIndexer();
startUnratedSweeper();
startEscrowWatcher();
