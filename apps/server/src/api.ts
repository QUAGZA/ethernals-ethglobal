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
import { agentReceipts, brainSettingsView, brainView, currentModelId, updateBrainSettings } from "./brain";
import { assertPublicUrl, listMcpTools } from "./agent-tools";
import { adoptAgentsFor } from "./adopt";
import { chainTasks } from "./chain-tasks";
import { ensureHandleClaim, publishHandleClaim, readHandleClaim } from "./people";
import { publishEndpoint, queueConfigPublish } from "./ens";
import { hireAsAgent } from "./buyer";
import { config } from "./config";
import { createSessionToken, encryptSecret, nullifierHash, randomId, readSessionToken } from "./crypto";
import {
  countHires,
  deleteAgentTool,
  getChainAgent,
  listChainAgents,
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
  insertAgentTool,
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
import { listRunViews, runView, startRun, startRunSchema, stopRun } from "./agent-sandbox";
import { buildNameraGuard, encryptNameraKey, guardFor, spendEventView } from "./spend";
import { connectNameraSchema, createDuelSchema, createTaskSchema, draftTestsSchema, hireForTaskSchema } from "./task-schemas";
import { draftTests } from "./test-writer";
import { clientBuyer, createDuel, createTask, hireSpecialist, loadTemplate, publishedTests, refundTask, tryOverspend } from "./task-service";
import { capabilitiesOf, getProofView, listProofViews, runDemoProof, runSubcontract } from "./proofs";
import { submitRating } from "./verifier";
import { verifierHealth } from "./verifier-client";
import { agentDetail, agentView, duelView, hireView, personView, remoteAgentDetail, remoteAgentView, taskView } from "./views";

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

/** Display-only balances for /api/me: cached 10 s and capped at 3 s, so a slow mirror node never stalls every page. */
const balanceCache = new Map<string, { at: number; value: Awaited<ReturnType<typeof getBalances>> }>();
async function displayBalances(accountId: string) {
  const cached = balanceCache.get(accountId);
  if (cached && Date.now() - cached.at < 10_000) return cached.value;
  const fetchFresh = getBalances(accountId).then((value) => {
    balanceCache.set(accountId, { at: Date.now(), value });
    return value;
  });
  fetchFresh.catch(() => undefined);
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000));
  return (await Promise.race([fetchFresh.catch(() => null), timeout])) ?? cached?.value ?? null;
}

async function meResponse(person: PersonRow | null): Promise<MeResponse> {
  if (!person) return { person: null, buyerAgent: null, agents: [], hires: [] };
  const mine = listAgentsOfPerson(person.id).filter((a) => !a.arena_role);
  const buyer = mine.find((a) => a.kind === "buyer");
  let buyerAgent: MeResponse["buyerAgent"] = null;
  if (buyer) {
    const balances = await displayBalances(buyer.hedera_account_id);
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
  zgApiKey: z.string().trim().regex(/^sk-\S{8,}$/, "A 0G key starts with sk-.").max(300).optional(),
  modelType: z.enum(["text", "image", "decision", "embedding", "video"]).optional(),
  model: z.string().trim().max(120).optional(),
  systemPrompt: z.string().max(4000).optional(),
});
const updateConfigSchema = z.object({
  modelType: z.enum(["text", "image", "decision", "embedding", "video"]).optional(),
  model: z.string().trim().min(1).max(120).optional(),
  systemPrompt: z.string().max(4000).optional(),
  zgApiKey: z.string().trim().regex(/^sk-\S{8,}$/, "A 0G key starts with sk-.").max(300).optional(),
});
const addToolSchema = z.object({
  kind: z.enum(["mcp", "http"]),
  name: z.string().trim().min(1).max(60),
  url: z.string().trim().url().max(500),
  description: z.string().max(500).optional(),
  authHeader: z.string().max(600).optional(),
  schemaJson: z.string().max(8000).optional(),
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

  r.get("/api/config", (_req, res) => {
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
      zeroG: { enabled: config.zeroG.enabled(), network: config.zeroG.network(), model: config.zeroG.enabled() ? currentModelId() : config.llm.model },
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
      void ensureHandleClaim(existing, nullifier);
      void adoptAgentsFor(existing);
      res.json({ ...(await meResponse(existing)), notice: `This World ID is already registered as "${existing.handle}". You are signed in.` });
      return;
    }
    if (!HANDLE_REGEX.test(handle)) throw badRequest("Handles use 1-24 lowercase letters, digits or hyphens.");
    // The handle is also claimed on-chain (ENS), so it is unique across servers and the same human keeps one identity.
    let claim: Awaited<ReturnType<typeof readHandleClaim>> = null;
    try {
      claim = await readHandleClaim(handle);
    } catch (err) {
      log.warn("could not read the on-chain handle claim; continuing with local checks", { error: (err as Error).message });
    }
    if (claim && claim.nullhash !== nullifierHash(nullifier)) throw conflict(`The handle "${handle}" is already claimed by someone else.`);
    if (findPersonByHandle(handle) || getAgentByLabel(`${handle}-buyer`)) throw conflict(`The handle "${handle}" is taken.`);
    const person = insertPerson({
      id: claim?.personId && !getPerson(claim.personId) ? claim.personId : randomId("person"),
      world_nullifier: nullifier,
      handle,
      mode: config.world.humanMode,
      credential_expires_at: null,
    });
    if (!claim) publishHandleClaim(person, nullifier);
    else void adoptAgentsFor(person);
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
    const local = await Promise.all(sellers.map(agentView));
    // Agents other servers created: found on-chain (ENS + HireLedger), shown hire-only.
    const names = new Set(sellers.map((a) => a.ens_name));
    const remote = await Promise.all(listChainAgents().filter((r) => !names.has(r.name)).map(remoteAgentView));
    res.json([...local, ...remote]);
  });

  r.get("/api/agents/:label", async (req, res) => {
    const label = String(req.params.label);
    const agent = getAgentByLabel(label) ?? getAgentByEnsName(label);
    if (!agent) {
      const remote = getChainAgent(label);
      if (!remote) throw notFound(`No agent named ${label}.`);
      res.json(await remoteAgentDetail(remote));
      return;
    }
    res.json(await agentDetail(agent));
  });

  r.get("/api/agents/:label/brain", (req, res) => {
    res.json(brainView(agentByName(String(req.params.label))));
  });

  r.get("/api/agents/:label/inference", (req, res) => {
    res.json(agentReceipts(agentByName(String(req.params.label))));
  });

  // Provider-only settings: model, system prompt, own key, MCP and HTTP tools.
  const ownedAgent = (req: Request) => {
    const person = requirePerson(req);
    const agent = agentByName(String(req.params.label));
    if (agent.person_id !== person.id) throw forbidden("Only the agent's owner can change its settings.");
    return agent;
  };
  r.get("/api/agents/:label/config", (req, res) => {
    res.json(brainSettingsView(ownedAgent(req)));
  });
  r.put("/api/agents/:label/config", (req, res) => {
    const agent = ownedAgent(req);
    updateBrainSettings(agent, updateConfigSchema.parse(req.body));
    queueConfigPublish(agent);
    res.json(brainSettingsView(agent));
  });
  r.post("/api/agents/:label/tools", async (req, res) => {
    const agent = ownedAgent(req);
    const body = addToolSchema.parse(req.body);
    try {
      assertPublicUrl(body.url);
    } catch (err) {
      throw badRequest((err as Error).message);
    }
    const row = {
      id: randomId("tool"),
      agent_key: agent.key,
      kind: body.kind,
      name: body.name,
      url: body.url,
      description: body.description?.trim() ?? "",
      schema_json: body.schemaJson?.trim() || null,
      auth_enc: body.authHeader?.trim() ? encryptSecret(body.authHeader.trim()) : null,
    };
    if (body.kind === "http" && row.schema_json) {
      try {
        JSON.parse(row.schema_json);
      } catch {
        throw badRequest("The argument schema is not valid JSON.");
      }
    }
    if (body.kind === "mcp") {
      try {
        await listMcpTools(row); // prove the server answers before saving it
      } catch (err) {
        throw badRequest(`Could not reach that MCP server: ${(err as Error).message}`, "It must speak MCP over Streamable HTTP at a public URL.");
      }
    }
    insertAgentTool(row);
    queueConfigPublish(agent);
    res.json(brainSettingsView(agent));
  });
  r.delete("/api/agents/:label/tools/:id", (req, res) => {
    const agent = ownedAgent(req);
    if (!deleteAgentTool(String(req.params.id), agent.key)) throw notFound("No such tool.");
    queueConfigPublish(agent);
    res.json(brainSettingsView(agent));
  });
  // Make this server the agent's host: write its public URL into the agent's ENS endpoint record.
  r.post("/api/agents/:label/host-here", async (req, res) => {
    const agent = ownedAgent(req);
    if (/localhost|127\.0\.0\.1/.test(config.publicBaseUrl)) {
      throw badRequest("This server's PUBLIC_BASE_URL is local.", "Run pnpm dev:public so the server has a public tunnel URL first.");
    }
    await publishEndpoint(agent);
    res.json({ ok: true, endpoint: `${config.publicBaseUrl}/a/${agent.label}/task` });
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

  // Escrow tasks found on Sepolia that this server's database does not know (read-only, chain is the source of truth).
  r.get("/api/tasks/chain", async (_req, res) => {
    const known = new Set(listTasks(10_000).map((t) => t.chain_task_id).filter(Boolean));
    res.json((await chainTasks()).filter((t) => !known.has(t.chainTaskId)));
  });

  // The public part only: hidden tests stay with the verifier.
  r.get("/api/tasks/templates", async (_req, res) => {
    const slugify = await loadTemplate("slugify").then((t) => t.spec, () => null);
    res.json(slugify ? [{ id: "slugify", ...slugify }] : []);
  });

  r.post("/api/tasks", async (req, res) => {
    const person = requirePerson(req);
    res.json(taskView(await createTask(person, createTaskSchema.parse(req.body))));
  });

  r.post("/api/tasks/draft-tests", async (req, res) => {
    const person = requirePerson(req);
    res.json(await draftTests(person, draftTestsSchema.parse(req.body)));
  });

  r.get("/api/tasks/:id/tests.json", async (req, res) => {
    res.json(await publishedTests(taskById(String(req.params.id))));
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

  // ------------------------------------------------------------------ agent sandbox
  r.get("/api/sandbox/runs", (req, res) => {
    const viewer = sessionPerson(req);
    res.json(listRunViews(viewer?.id ?? null));
  });

  r.post("/api/sandbox/runs", async (req, res) => {
    const person = requirePerson(req);
    res.json(await startRun(person, startRunSchema.parse(req.body)));
  });

  r.get("/api/sandbox/runs/:id", (req, res) => {
    res.json(runView(String(req.params.id), sessionPerson(req)?.id ?? null));
  });

  r.post("/api/sandbox/runs/:id/stop", (req, res) => {
    res.json(stopRun(requirePerson(req), String(req.params.id)));
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

  // ------------------------------------------------------------------ verified work (validation receipts)
  r.post("/api/proofs/demo", async (req, res) => {
    const body = z.object({ patch: z.enum(["good", "weak"]), agent: z.string().max(32).optional() }).parse(req.body ?? {});
    res.json(await runDemoProof(body.patch, body.agent));
  });

  r.post("/api/proofs/subcontract", async (req, res) => {
    const body = z
      .object({ agent: z.string().max(32), specialist: z.string().max(32), specialistPatch: z.enum(["good", "weak"]).optional() })
      .parse(req.body ?? {});
    res.json(await runSubcontract(body.agent, body.specialist, body.specialistPatch ?? "good"));
  });

  r.get("/api/proofs", async (_req, res) => {
    res.json(await listProofViews());
  });

  r.get("/api/proofs/:id", async (req, res) => {
    res.json(await getProofView(String(req.params.id)));
  });

  r.get("/api/agents/:label/capabilities", (req, res) => {
    res.json(capabilitiesOf(String(req.params.label)));
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
