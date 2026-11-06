/** REST + SSE API used by the web app and the buyer CLI (types in @ethernals/shared/api). */
import { Router, type Request, type Response } from "express";
import { verifyMessage } from "viem";
import { z } from "zod";
import {
  ESCROW_CHAIN_ID,
  formatUnits6,
  type ArenaState,
  type HireResponse,
  type MeResponse,
  type PublicConfig,
  type SpendStateView,
  type StatsResponse,
  type TryOverspendResponse,
} from "@ethernals/shared";
import { createSellerAgent, ensureBuyerAgent } from "./agents";
import { getArenaState, runEthernalsAttack, runOpenAttack } from "./arena";
import { agentReceipts, brainView, resolveModel } from "./brain";
import { hireAsAgent } from "./buyer";
import { config } from "./config";
import { createSessionToken, randomId, readSessionToken } from "./crypto";
import {
  countHires,
  deleteSpendAccount,
  findPersonByHandle,
  findPersonByNullifier,
  getAgent,
  getAgentByEnsName,
  getAgentByLabel,
  getDuel,
  getHire,
  getPerson,
  getTask,
  insertPerson,
  listAgents,
  listAgentsOfPerson,
  listHiresByBuyer,
  listSpendEvents,
  listTasks,
  setCredentialExpiry,
  upsertSpendAccount,
  type PersonRow,
} from "./db";
import { AppError, badRequest, conflict, forbidden, notFound, unauthorized } from "./errors";
import { emit, log, recentEvents, subscribe } from "./events";
import { getBalances } from "./hedera";
import { createRpContext, verifyWorldProof } from "./identity";
import { buildNameraGuard, encryptNameraKey, guardFor, spendEventView } from "./spend";
import { connectNameraSchema, createDuelSchema, createTaskSchema, hireForTaskSchema } from "./task-schemas";
import { clientBuyer, createDuel, createTask, hireSpecialist, refundTask, tryOverspend } from "./task-service";
import { submitRating } from "./verifier";
import { verifierHealth } from "./verifier-client";
import { agentDetail, agentView, duelView, hireView, personView, taskView } from "./views";

const COOKIE = "ethernals_session";
const HANDLE_REGEX = /^[a-z0-9](?:[a-z0-9-]{0,22}[a-z0-9])?$/;

function cookieValue(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

function setSession(res: Response, personId: string): void {
  const secure = config.publicBaseUrl.startsWith("https://") ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `${COOKIE}=${encodeURIComponent(createSessionToken(personId))}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${3 * 24 * 3600}${secure}`,
  );
}

function sessionPerson(req: Request): PersonRow | null {
  const id = readSessionToken(cookieValue(req, COOKIE));
  return id ? (getPerson(id) ?? null) : null;
}

function requirePerson(req: Request): PersonRow {
  const person = sessionPerson(req);
  if (!person) throw unauthorized("Please sign in with World ID first.", "Open /signup.");
  return person;
}

const buyerCreation = new Map<string, Promise<unknown>>();
function startBuyerCreation(person: PersonRow): void {
  if (buyerCreation.has(person.id)) return;
  const p = ensureBuyerAgent(person)
    .catch((err) => {
      log.error(`buyer agent for ${person.handle} failed`, err);
      emit("info", { message: `Could not create ${person.handle}'s buyer agent: ${(err as Error).message}` });
    })
    .finally(() => buyerCreation.delete(person.id));
  buyerCreation.set(person.id, p);
}

async function meResponse(person: PersonRow | null): Promise<MeResponse> {
  if (!person) return { person: null, buyerAgent: null, agents: [], hires: [] };
  const mine = listAgentsOfPerson(person.id).filter((a) => !a.arena_role);
  const buyer = mine.find((a) => a.kind === "buyer");
  let buyerAgent: MeResponse["buyerAgent"] = null;
  if (buyer) {
    const balances = await getBalances(buyer.hedera_account_id).catch(() => null);
    buyerAgent = {
      ...(await agentView(buyer)),
      usdcBalance: balances ? formatUnits6(balances.usdcUnits) : "?",
      hbarBalance: balances?.hbar ?? "?",
      budgetRemaining: formatUnits6(BigInt(buyer.budget_remaining)),
    };
  }
  return {
    person: personView(person),
    buyerAgent,
    agents: await Promise.all(mine.filter((a) => a.kind === "seller").map(agentView)),
    hires: buyer ? listHiresByBuyer(buyer.key, 50).map(hireView) : [],
  };
}

function agentByName(name: string) {
  const agent = getAgentByLabel(name) ?? getAgentByEnsName(name);
  if (!agent) throw notFound(`No agent named ${name}.`);
  return agent;
}

function taskById(id: string) {
  const task = getTask(id);
  if (!task) throw notFound("Unknown task.");
  return task;
}

const verifySchema = z.object({ handle: z.string(), proof: z.unknown() });
const createAgentSchema = z.object({
  label: z.string().min(1),
  taskType: z.enum(["summarize", "translate", "code-fix"]),
  basePrice: z.string().min(1),
  description: z.string().max(200).optional(),
});
const hireSchema = z.object({
  agent: z.string().min(1),
  input: z.string().min(1).max(8000),
  translateTo: z.enum(["hi", "mr"]).nullish(),
  consent: z.object({ forward: z.boolean(), subBudget: z.string() }),
});
const rateSchema = z.object({
  rating: z.number().int().min(1).max(5),
  signature: z.string().optional(),
  paymentTxId: z.string().optional(),
});

export function createApi(): Router {
  const r = Router();

  r.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });

  r.get("/api/config", async (_req, res) => {
    const body: PublicConfig = {
      appName: config.appName,
      ensParent: config.ens.parentOrNull() ?? "",
      publicBaseUrl: config.publicBaseUrl,
      world: {
        appId: config.world.appId,
        rpId: config.world.rpId,
        action: config.world.action,
        env: config.world.env,
        humanMode: config.world.humanMode,
        allowLegacyProofs: ["1", "true", "yes"].includes((process.env.WORLD_ALLOW_LEGACY_PROOFS ?? "").toLowerCase()),
      },
      devFakePersons: config.devFakePersons,
      demoMode: config.demoMode,
      hederaNetwork: "testnet",
      paymentAsset: config.hedera.paymentAsset,
      ledgerAddress: config.hedera.ledgerAddressOrNull(),
      zeroG: { enabled: config.zeroG.enabled(), network: config.zeroG.network(), model: config.zeroG.model() ?? (await resolveModel().then((m) => m.id, () => "")) },
      namera: { enabled: config.namera.enabled() },
      escrow: { address: config.escrow.addressOrNull(), token: config.escrow.tokenOrNull(), chainId: ESCROW_CHAIN_ID },
      sepoliaRpcUrl: config.sepolia.publicRpcUrl,
      ensUniversalResolver: config.ens.universalResolver,
    };
    res.json(body);
  });

  r.get("/api/stats", (_req, res) => {
    const counts = countHires();
    const body: StatsResponse = { agents: listAgents("seller").filter((a) => !a.arena_role).length, hires: counts.total, counted: counts.counted };
    res.json(body);
  });

  // ------------------------------------------------------------------ auth
  r.get("/api/auth/world/rp-context", (_req, res) => {
    res.json(createRpContext());
  });

  r.post("/api/auth/world/verify", async (req, res) => {
    const { handle: rawHandle, proof } = verifySchema.parse(req.body);
    const handle = rawHandle.trim().toLowerCase();
    const { nullifier } = await verifyWorldProof(proof);
    const existing = findPersonByNullifier(nullifier);
    if (existing) {
      setSession(res, existing.id);
      startBuyerCreation(existing);
      res.json({ ...(await meResponse(existing)), notice: `This World ID is already registered as "${existing.handle}". You are signed in.` });
      return;
    }
    if (!HANDLE_REGEX.test(handle)) throw badRequest("Handles use 1-24 lowercase letters, digits or hyphens.");
    if (findPersonByHandle(handle) || getAgentByLabel(`${handle}-buyer`)) throw conflict(`The handle "${handle}" is taken.`);
    const person = insertPerson({
      id: randomId("person"),
      world_nullifier: nullifier,
      handle,
      mode: config.world.humanMode,
      credential_expires_at: null,
    });
    setSession(res, person.id);
    startBuyerCreation(person);
    res.json(await meResponse(person));
  });

  r.post("/api/auth/dev", async (req, res) => {
    if (!config.devFakePersons) throw forbidden("Dev login is off. Sign in with World ID.");
    const handle = String(req.body?.handle ?? "").trim().toLowerCase();
    if (!HANDLE_REGEX.test(handle)) throw badRequest("Handles use 1-24 lowercase letters, digits or hyphens.");
    const person =
      findPersonByHandle(handle) ??
      insertPerson({ id: randomId("person"), world_nullifier: null, handle, mode: "dev", credential_expires_at: null });
    setSession(res, person.id);
    startBuyerCreation(person);
    res.json(await meResponse(person));
  });

  r.post("/api/auth/logout", (_req, res) => {
    res.setHeader("Set-Cookie", `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
    res.json({ ok: true });
  });

  // ------------------------------------------------------------------ me
  r.get("/api/me", async (req, res) => {
    res.json(await meResponse(sessionPerson(req)));
  });

  r.post("/api/me/buyer", async (req, res) => {
    const person = requirePerson(req);
    await ensureBuyerAgent(person);
    res.json(await meResponse(person));
  });

  r.post("/api/me/expire-pass", async (req, res) => {
    if (!config.demoMode) throw forbidden("Demo controls are off (DEMO_MODE=false).");
    const person = requirePerson(req);
    setCredentialExpiry(person.id, new Date(Date.now() - 1000).toISOString());
    emit("info", { message: `${person.handle}'s human credential expired (demo control)` });
    res.json(await meResponse(getPerson(person.id)!));
  });

  r.post("/api/me/restore-pass", async (req, res) => {
    if (!config.demoMode) throw forbidden("Demo controls are off (DEMO_MODE=false).");
    const person = requirePerson(req);
    setCredentialExpiry(person.id, null);
    res.json(await meResponse(getPerson(person.id)!));
  });

  r.get("/api/me/hires", async (req, res) => {
    const person = requirePerson(req);
    const buyer = listAgentsOfPerson(person.id).find((a) => a.kind === "buyer" && !a.arena_role);
    res.json(buyer ? listHiresByBuyer(buyer.key).map(hireView) : []);
  });

  // ------------------------------------------------------------------ spending controls
  r.get("/api/me/spend", async (req, res) => {
    const person = requirePerson(req);
    const guard = await guardFor(person, clientBuyer(person));
    const body: SpendStateView = {
      guard: guard.kind,
      policy: await guard.policy().catch(() => null),
      recent: listSpendEvents(person.id, 10).map(spendEventView),
    };
    res.json(body);
  });

  r.post("/api/me/spend/connect", async (req, res) => {
    const person = requirePerson(req);
    const body = connectNameraSchema.parse(req.body);
    if (!config.namera.enabled()) throw conflict("Namera is turned off on this server (NAMERA_ENABLED=false).");
    const guard = await buildNameraGuard({ apiKey: body.apiKey.trim(), walletId: body.walletId.trim(), sessionKeyId: body.sessionKeyId.trim() });
    let policy;
    try {
      policy = await guard.policy();
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw badRequest("Namera did not accept those details.", "Check the API key, wallet id and session key id in your Namera dashboard.");
    }
    upsertSpendAccount({
      person_id: person.id,
      api_key_enc: encryptNameraKey(body.apiKey),
      wallet_id: body.walletId.trim(),
      session_key_id: body.sessionKeyId.trim(),
      wallet_address: policy.accountAddress,
    });
    res.json(policy);
  });

  r.delete("/api/me/spend", (req, res) => {
    deleteSpendAccount(requirePerson(req).id);
    res.json({ ok: true });
  });

  r.post("/api/me/spend/try-overspend", async (req, res) => {
    if (!config.demoMode) throw forbidden("Demo controls are off (DEMO_MODE=false).");
    const person = requirePerson(req);
    const body: TryOverspendResponse = { event: await tryOverspend(person, await guardFor(person, clientBuyer(person))) };
    res.json(body);
  });

  // ------------------------------------------------------------------ agents
  r.get("/api/agents", async (_req, res) => {
    const sellers = listAgents("seller").filter((a) => !a.arena_role);
    res.json(await Promise.all(sellers.map(agentView)));
  });

  r.get("/api/agents/:label", async (req, res) => {
    const label = String(req.params.label);
    const agent = getAgentByLabel(label) ?? getAgentByEnsName(label);
    if (!agent) throw notFound(`No agent named ${label}.`);
    res.json(await agentDetail(agent));
  });

  r.get("/api/agents/:label/brain", (req, res) => {
    res.json(brainView(agentByName(String(req.params.label))));
  });

  r.get("/api/agents/:label/inference", (req, res) => {
    res.json(agentReceipts(agentByName(String(req.params.label))));
  });

  r.post("/api/agents", async (req, res) => {
    const person = requirePerson(req);
    const body = createAgentSchema.parse(req.body);
    const agent = await createSellerAgent(person, body);
    res.json(await agentView(agent));
  });

  // ------------------------------------------------------------------ hires
  r.post("/api/hires", async (req, res) => {
    const person = requirePerson(req);
    const body = hireSchema.parse(req.body);
    const buyer = listAgentsOfPerson(person.id).find((a) => a.kind === "buyer" && !a.arena_role);
    if (!buyer) throw new AppError(409, "Your buyer agent is still being created.", "Wait a few seconds and try again, or open /me.");
    const target = body.agent.includes(".") ? body.agent : `${body.agent}.${config.ens.parent()}`;
    const result = await hireAsAgent({
      buyer,
      targetEnsName: target,
      input: body.input,
      translateTo: body.translateTo ?? null,
      consent: body.consent,
    });
    const response: HireResponse = {
      hireId: result.hireId,
      result: result.result,
      quotedPrice: result.quotedPrice,
      paymentTxId: result.paymentTxId,
      paymentUrl: result.paymentUrl,
      subHire: result.subHire,
    };
    res.json(response);
  });

  r.post("/api/hires/:id/rate", async (req, res) => {
    const hire = getHire(String(req.params.id));
    if (!hire) throw notFound("Unknown hire.");
    const body = rateSchema.parse(req.body);
    const buyer = getAgent(hire.buyer_agent_key)!;
    if (body.signature) {
      const message = `${hire.id}:${body.rating}:${body.paymentTxId ?? ""}`;
      const ok = await verifyMessage({ address: buyer.evm_address as `0x${string}`, message, signature: body.signature as `0x${string}` });
      if (!ok) throw forbidden("The rating signature does not match the buyer agent.");
    } else {
      const person = requirePerson(req);
      if (buyer.person_id !== person.id) throw forbidden("Only the person who paid for this hire can rate it.");
    }
    const updated = await submitRating({ hireId: hire.id, rating: body.rating, paymentTxId: body.paymentTxId });
    res.json({ hire: hireView(updated) });
  });

  r.get("/api/hires/:id", (req, res) => {
    const hire = getHire(String(req.params.id));
    if (!hire) throw notFound("Unknown hire.");
    res.json(hireView(hire));
  });

  // ------------------------------------------------------------------ proof-of-work tasks
  r.get("/api/tasks", (_req, res) => {
    res.json(listTasks().map(taskView));
  });

  r.post("/api/tasks", async (req, res) => {
    const person = requirePerson(req);
    res.json(taskView(await createTask(person, createTaskSchema.parse(req.body))));
  });

  r.get("/api/tasks/:id/spec.json", (req, res) => {
    // Exactly the bytes that were hashed into specHash.
    res.type("application/json").send(taskById(String(req.params.id)).spec_json);
  });

  r.get("/api/tasks/:id/patch.diff", (req, res) => {
    const task = taskById(String(req.params.id));
    if (!task.patch) throw notFound("No patch was submitted for this task.");
    res.type("text/plain").send(task.patch);
  });

  r.get("/api/tasks/:id", (req, res) => {
    res.json(taskView(taskById(String(req.params.id))));
  });

  r.post("/api/tasks/:id/hire", async (req, res) => {
    const person = requirePerson(req);
    const body = hireForTaskSchema.parse(req.body);
    res.json(taskView(await hireSpecialist(person, String(req.params.id), body.specialist)));
  });

  r.post("/api/tasks/:id/refund", async (req, res) => {
    res.json(taskView(await refundTask(requirePerson(req), String(req.params.id))));
  });

  r.post("/api/duels", async (req, res) => {
    const person = requirePerson(req);
    const duel = await createDuel(person, createDuelSchema.parse(req.body));
    res.json(duelView(duel.id));
  });

  r.get("/api/duels/:id", (req, res) => {
    const id = String(req.params.id);
    if (!getDuel(id)) throw notFound("Unknown duel.");
    res.json(duelView(id));
  });

  r.get("/api/verifier/health", async (_req, res) => {
    res.json(await verifierHealth());
  });

  // ------------------------------------------------------------------ events (SSE)
  r.get("/api/events", (req, res) => {
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    const since = Number(req.query.since ?? req.headers["last-event-id"] ?? 0) || 0;
    const send = (m: { id: number }) => res.write(`id: ${m.id}\ndata: ${JSON.stringify(m)}\n\n`);
    recentEvents(since).forEach(send);
    const unsubscribe = subscribe(send);
    const heartbeat = setInterval(() => res.write(": ping\n\n"), 20_000);
    req.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  });

  // ------------------------------------------------------------------ arena
  r.get("/api/arena/state", async (_req, res) => {
    const state: ArenaState = await getArenaState();
    res.json(state);
  });

  r.post("/api/arena/open/run", async (_req, res) => {
    runOpenAttack();
    res.json(await getArenaState());
  });

  r.post("/api/arena/ethernals/run", async (req, res) => {
    const attacker = req.body?.attacker === "other" ? "other" : "provider";
    runEthernalsAttack(attacker);
    res.json(await getArenaState());
  });

  // ------------------------------------------------------------------ admin (demo)
  r.post("/api/admin/expire-pass", (req, res) => {
    if (!config.demoMode) throw forbidden("Demo controls are off.");
    const token = config.secrets.admin();
    if (!token || req.headers["x-admin-token"] !== token) throw forbidden("Wrong or missing x-admin-token.");
    const handle = String(req.body?.handle ?? "");
    const person = findPersonByHandle(handle);
    if (!person) throw notFound(`No person "${handle}".`);
    setCredentialExpiry(person.id, req.body?.restore ? null : new Date(Date.now() - 1000).toISOString());
    res.json({ ok: true });
  });

  return r;
}
