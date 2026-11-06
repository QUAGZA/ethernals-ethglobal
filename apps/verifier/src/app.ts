import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import express, { type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import {
  ESCROW_CHAIN_ID,
  verifyReceiptIntegrity,
  type CalibrationRequest,
  type Hex,
  type HiddenTestsBundle,
  type RevealedTests,
  type VerifierEvent,
  type VerifierHealth,
  type VerifyJob,
  type VerifyRequest,
} from "@ethernals/shared";
import { calibrationIdOf, runCalibration } from "./calibrate";
import type { PipelineDeps } from "./pipeline";
import { runJob } from "./pipeline";
import { MAX_PATCH_BYTES, testsHash as hashTests, validateBundle } from "./hashing";

export interface AppDeps {
  pipeline: PipelineDeps;
  token: string;
  validator: Hex;
  escrow: Hex | null;
  /** Reads the anchored hash for GET /receipts/:jobId/verify. */
  concurrency?: number;
}

const verifySchema = z.object({
  taskId: z.string().min(1).max(100),
  chainTaskId: z.string().regex(/^\d+$/),
  repoUrl: z.string().max(300),
  baseCommit: z.string().regex(/^[0-9a-f]{40}$/),
  patch: z.string().max(MAX_PATCH_BYTES),
  testsId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  testsHash: z.string().regex(/^0x[0-9a-f]{64}$/),
  testCommand: z.string().max(200).optional(),
  erc8004RequestHash: z.string().regex(/^0x[0-9a-f]{64}$/).optional(),
  specialistAgentId: z.string().max(100).optional(),
});

const calibrationSchema = z.object({
  repoUrl: z.string().max(300),
  baseCommit: z.string().regex(/^[0-9a-f]{40}$/),
  testsId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  testsHash: z.string().regex(/^0x[0-9a-f]{64}$/),
  testCommand: z.string().max(200).optional(),
  referencePatch: z.string().max(MAX_PATCH_BYTES).optional(),
  naivePatch: z.string().max(MAX_PATCH_BYTES).optional(),
});

export function createApp(deps: AppDeps) {
  const { store } = deps.pipeline;
  const bus = new EventEmitter();
  bus.setMaxListeners(100);
  const pipeline: PipelineDeps = { ...deps.pipeline, emit: (e) => { deps.pipeline.emit(e); bus.emit(e.jobId, e); } };

  const app = express();
  app.use(express.json({ limit: "1mb" }));

  const requireToken = (req: Request, res: Response, next: NextFunction) => {
    const sent = String(req.header("x-verifier-token") ?? "");
    const a = Buffer.from(sent);
    const b = Buffer.from(deps.token);
    if (!deps.token || a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      res.status(401).json({ error: "bad or missing x-verifier-token" });
      return;
    }
    next();
  };

  // concurrency-limited queue
  let running = 0;
  const waiting: (() => void)[] = [];
  const limit = deps.concurrency ?? 2;
  const schedule = (fn: () => Promise<unknown>) => {
    const go = () => {
      running++;
      void fn().finally(() => {
        running--;
        waiting.shift()?.();
      });
    };
    if (running < limit) go();
    else waiting.push(go);
  };

  app.get("/health", (_req, res) => {
    const h: VerifierHealth = {
      ok: true,
      mode: pipeline.mode,
      dockerAvailable: pipeline.mode === "docker",
      image: pipeline.image,
      validator: deps.validator,
      escrow: deps.escrow,
      escrowChain: ESCROW_CHAIN_ID,
      paidVerify: null,
    };
    res.json(h);
  });

  app.post("/tests", requireToken, (req, res) => {
    const bundle = req.body as HiddenTestsBundle;
    const err = validateBundle(bundle);
    if (err) { res.status(400).json({ error: err }); return; }
    const hash = hashTests(bundle);
    const testsId = hash.slice(2, 26);
    store.putTests(testsId, bundle);
    res.json({ testsId, testsHash: hash });
  });

  const calibrating = new Set<string>();

  /** Runs the tests against the unfixed code and any supplied patches. A failed check runs again, since tests can be flaky. */
  app.post("/calibrations", requireToken, (req, res) => {
    const parsed = calibrationSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message ?? "bad request" }); return; }
    const body = parsed.data as CalibrationRequest;
    const bundle = store.getTests(body.testsId);
    if (!bundle || hashTests(bundle) !== body.testsHash) { res.status(400).json({ error: "unknown testsId" }); return; }
    const calibrationId = calibrationIdOf(body);
    if (!calibrating.has(calibrationId) && !store.getCalibration(calibrationId)?.report?.ok) {
      calibrating.add(calibrationId);
      store.putCalibration({ calibrationId, status: "queued", report: null, error: null });
      schedule(() => runCalibration(pipeline, calibrationId, body).finally(() => calibrating.delete(calibrationId)));
    }
    res.status(202).json({ calibrationId });
  });

  app.get("/calibrations/:id", requireToken, (req, res) => {
    const calibration = store.getCalibration(String(req.params.id));
    if (!calibration) { res.status(404).json({ error: "not found" }); return; }
    res.json(calibration);
  });

  app.post("/verify", requireToken, (req, res) => {
    const parsed = verifySchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message ?? "bad request" }); return; }
    const body = parsed.data as VerifyRequest;
    if (!store.getTests(body.testsId)) { res.status(400).json({ error: "unknown testsId" }); return; }
    const jobId = crypto.randomBytes(8).toString("hex");
    const job: VerifyJob = {
      jobId, taskId: body.taskId, chainTaskId: body.chainTaskId, status: "queued",
      createdAt: new Date().toISOString(), startedAt: null, finishedAt: null, result: null, resultHash: null,
      resultUrl: null, settleTxHash: null, erc8004TxHash: null, error: null, logTail: [],
    };
    store.putJob(job);
    store.appendEvent(jobId, { jobId, at: job.createdAt, type: "status", status: "queued" });
    schedule(() => runJob(pipeline, jobId, body));
    res.status(202).json({ jobId });
  });

  app.get("/jobs/:jobId", requireToken, (req, res) => {
    const job = store.getJob(String(req.params.jobId));
    if (!job) { res.status(404).json({ error: "not found" }); return; }
    res.json(job);
  });

  app.get("/jobs/:jobId/events", requireToken, (req, res) => {
    const jobId = String(req.params.jobId);
    if (!store.getJob(jobId)) { res.status(404).json({ error: "not found" }); return; }
    res.set({ "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", connection: "keep-alive" });
    res.flushHeaders();
    const send = (e: VerifierEvent) => res.write(`data: ${JSON.stringify(e)}\n\n`);
    for (const e of store.readEvents(jobId)) send(e);
    bus.on(jobId, send);
    const hb = setInterval(() => res.write(": keep-alive\n\n"), 20_000);
    req.on("close", () => { clearInterval(hb); bus.off(jobId, send); });
  });

  /** The tests, once this job's outcome is on-chain. Token-gated: the server also holds them back while another task shares them. */
  app.get("/jobs/:jobId/tests", requireToken, (req, res) => {
    const job = store.getJob(String(req.params.jobId));
    if (!job?.result) { res.status(404).json({ error: "not found" }); return; }
    if (!job.settleTxHash) { res.status(409).json({ error: "not settled yet" }); return; }
    const testsId = job.result.testsHash.slice(2, 26);
    const bundle = store.getTests(testsId);
    if (!bundle) { res.status(404).json({ error: "not found" }); return; }
    const revealed: RevealedTests = { testsId, testsHash: job.result.testsHash, files: bundle.files };
    res.json(revealed);
  });

  app.get("/results/:file", (req, res) => {
    const id = String(req.params.file).replace(/\.json$/, "");
    const r = store.getResult(id);
    if (!r) { res.status(404).json({ error: "not found" }); return; }
    res.json(r);
  });

  /** Public: the validation receipt and its canonical hash (the stored copy; no secrets inside). */
  app.get("/receipts/:file", (req, res) => {
    const id = String(req.params.file).replace(/\.json$/, "");
    const r = store.getReceipt(id);
    if (!r) { res.status(404).json({ error: "not found" }); return; }
    res.json(r);
  });

  /** Plan §5.4: recompute the hash, compare with the stored one, then compare with the on-chain commitment. */
  app.get("/receipts/:jobId/verify", async (req, res) => {
    const r = store.getReceipt(String(req.params.jobId));
    if (!r) { res.status(404).json({ error: "not found" }); return; }
    let anchored: Hex | null = null;
    try {
      if (pipeline.chain) anchored = (await pipeline.chain.getTask(BigInt(r.receipt.chain_task_id))).resultHash;
    } catch { /* chain unreachable: report as unanchored */ }
    res.json(verifyReceiptIntegrity(r.receipt, r.receiptHash, anchored));
  });

  return app;
}
