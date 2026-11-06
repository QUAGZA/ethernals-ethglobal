/**
 * SQLite storage via Node's built-in `node:sqlite` (Node 22.13+), so there are no native modules to build.
 * The database stores metadata only — never task content (PRD SEC-5).
 */
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { SpendGuardKind, TaskStatus } from "@ethernals/shared";
import { config } from "./config";

export interface PersonRow {
  id: string;
  world_nullifier: string | null;
  handle: string;
  mode: "idkit" | "agentkit" | "dev";
  credential_expires_at: string | null;
  created_at: string;
}

export interface AgentRow {
  key: string;
  ens_name: string;
  label: string;
  kind: "seller" | "buyer";
  person_id: string;
  hedera_account_id: string;
  evm_address: string;
  enc_private_key: string;
  base_price: string; // atomic units
  task_type: "summarize" | "translate" | "code-fix" | null;
  description: string;
  budget_remaining: string; // atomic units (buyer agents)
  ledger_registered: number;
  ens_registered: number;
  erc8004_agent_id: string | null;
  arena_role: string | null;
  strategy: "careful" | "weak";
  created_at: string;
}

export interface HireRow {
  id: string;
  agent_key: string;
  buyer_agent_key: string;
  quoted_price: string;
  paid_amount: string | null;
  payment_tx_id: string | null;
  input_hash: string;
  output_hash: string | null;
  mandate_id: string | null;
  rating: number | null;
  rated_at: string | null;
  counted: number | null;
  reason: string | null;
  status: string;
  ledger_tx_hash: string | null;
  ens_tx_hash: string | null;
  parent_hire_id: string | null;
  arena: number;
  created_at: string;
}

export interface TaskRow {
  id: string;
  chain_task_id: string | null;
  duel_id: string | null;
  client_person_id: string;
  client_agent_key: string;
  specialist_agent_key: string | null;
  template: string | null;
  spec_json: string;
  spec_hash: string | null;
  tests_id: string | null;
  tests_hash: string | null;
  bounty: string; // atomic tUSDC
  deadline: string;
  status: TaskStatus;
  patch: string | null;
  patch_hash: string | null;
  explanation: string | null;
  verify_job_id: string | null;
  result_json: string | null;
  hire_id: string | null;
  rating_submitted: number;
  create_tx: string | null;
  accept_tx: string | null;
  submit_tx: string | null;
  settle_tx: string | null;
  refund_tx: string | null;
  erc8004_request_hash: string | null;
  erc8004_request_tx: string | null;
  erc8004_response_tx: string | null;
  error: string | null;
  created_at: string;
}

export interface BrainRow {
  agent_key: string;
  api_key_enc: string | null;
  key_label: string | null;
  model: string;
  credit_neuron: string;
  spent_neuron: string;
  earned_units: string;
  credited_from_earnings_neuron: string;
  last_request_id: string | null;
}

export interface ReceiptRow {
  id: string;
  agent_key: string;
  task_id: string | null;
  purpose: string;
  model: string;
  request_id: string;
  provider: string | null;
  prompt_tokens: number;
  completion_tokens: number;
  cost_neuron: string;
  created_at: string;
}

export interface SpendAccountRow {
  person_id: string;
  api_key_enc: string;
  wallet_id: string;
  session_key_id: string;
  wallet_address: string | null;
  created_at: string;
}

export interface SpendEventRow {
  id: string;
  person_id: string;
  task_id: string | null;
  guard: SpendGuardKind;
  purpose: string;
  amount_units: string;
  status: "confirmed" | "blocked" | "failed";
  rule: string | null;
  reason: string | null;
  tx_hash: string | null;
  created_at: string;
}

export interface MandateRow {
  id: string;
  hire_id: string;
  forward: number;
  sub_budget: string; // atomic
  spent: string; // atomic
  expires_at: string;
}

let db: DatabaseSync | null = null;

export function getDb(): DatabaseSync {
  if (db) return db;
  fs.mkdirSync(path.dirname(config.databasePath), { recursive: true });
  db = new DatabaseSync(config.databasePath);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  migrate(db);
  return db;
}

function migrate(d: DatabaseSync): void {
  d.exec(`
    CREATE TABLE IF NOT EXISTS persons (
      id TEXT PRIMARY KEY,
      world_nullifier TEXT UNIQUE,
      handle TEXT UNIQUE NOT NULL,
      mode TEXT NOT NULL,
      credential_expires_at TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS agents (
      key TEXT PRIMARY KEY,
      ens_name TEXT UNIQUE NOT NULL,
      label TEXT UNIQUE NOT NULL,
      kind TEXT NOT NULL,
      person_id TEXT NOT NULL REFERENCES persons(id),
      hedera_account_id TEXT NOT NULL,
      evm_address TEXT NOT NULL,
      enc_private_key TEXT NOT NULL,
      base_price TEXT NOT NULL,
      task_type TEXT,
      description TEXT NOT NULL DEFAULT '',
      budget_remaining TEXT NOT NULL DEFAULT '0',
      ledger_registered INTEGER NOT NULL DEFAULT 0,
      ens_registered INTEGER NOT NULL DEFAULT 0,
      erc8004_agent_id TEXT,
      arena_role TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS hires (
      id TEXT PRIMARY KEY,
      agent_key TEXT NOT NULL REFERENCES agents(key),
      buyer_agent_key TEXT NOT NULL REFERENCES agents(key),
      quoted_price TEXT NOT NULL,
      paid_amount TEXT,
      payment_tx_id TEXT UNIQUE,
      input_hash TEXT NOT NULL,
      output_hash TEXT,
      mandate_id TEXT,
      rating INTEGER,
      rated_at TEXT,
      counted INTEGER,
      reason TEXT,
      status TEXT NOT NULL,
      ledger_tx_hash TEXT,
      ens_tx_hash TEXT,
      parent_hire_id TEXT,
      arena INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS hires_agent ON hires(agent_key, created_at);
    CREATE INDEX IF NOT EXISTS hires_status ON hires(status);
    CREATE TABLE IF NOT EXISTS mandates (
      id TEXT PRIMARY KEY,
      hire_id TEXT NOT NULL,
      forward INTEGER NOT NULL,
      sub_budget TEXT NOT NULL,
      spent TEXT NOT NULL DEFAULT '0',
      expires_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS arena_wallets (
      address TEXT PRIMARY KEY,
      enc_private_key TEXT NOT NULL,
      side TEXT NOT NULL,
      funded INTEGER NOT NULL DEFAULT 0,
      used INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS kv (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS duels (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      chain_task_id TEXT,
      duel_id TEXT,
      client_person_id TEXT NOT NULL,
      client_agent_key TEXT NOT NULL,
      specialist_agent_key TEXT,
      template TEXT,
      spec_json TEXT NOT NULL,
      spec_hash TEXT,
      tests_id TEXT,
      tests_hash TEXT,
      bounty TEXT NOT NULL,
      deadline TEXT NOT NULL,
      status TEXT NOT NULL,
      patch TEXT,
      patch_hash TEXT,
      explanation TEXT,
      verify_job_id TEXT,
      result_json TEXT,
      hire_id TEXT,
      rating_submitted INTEGER NOT NULL DEFAULT 0,
      create_tx TEXT,
      accept_tx TEXT,
      submit_tx TEXT,
      settle_tx TEXT,
      refund_tx TEXT,
      erc8004_request_hash TEXT,
      erc8004_request_tx TEXT,
      erc8004_response_tx TEXT,
      error TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS tasks_status ON tasks(status);
    CREATE INDEX IF NOT EXISTS tasks_hire ON tasks(hire_id);
    CREATE TABLE IF NOT EXISTS agent_brain (
      agent_key TEXT PRIMARY KEY,
      api_key_enc TEXT,
      key_label TEXT,
      model TEXT NOT NULL,
      credit_neuron TEXT NOT NULL,
      spent_neuron TEXT NOT NULL DEFAULT '0',
      earned_units TEXT NOT NULL DEFAULT '0',
      credited_from_earnings_neuron TEXT NOT NULL DEFAULT '0',
      last_request_id TEXT
    );
    CREATE TABLE IF NOT EXISTS inference_receipts (
      id TEXT PRIMARY KEY,
      agent_key TEXT NOT NULL,
      task_id TEXT,
      purpose TEXT NOT NULL,
      model TEXT NOT NULL,
      request_id TEXT NOT NULL,
      provider TEXT,
      prompt_tokens INTEGER NOT NULL,
      completion_tokens INTEGER NOT NULL,
      cost_neuron TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS receipts_agent ON inference_receipts(agent_key, created_at);
    CREATE INDEX IF NOT EXISTS receipts_task ON inference_receipts(task_id);
    CREATE TABLE IF NOT EXISTS spend_accounts (
      person_id TEXT PRIMARY KEY,
      api_key_enc TEXT NOT NULL,
      wallet_id TEXT NOT NULL,
      session_key_id TEXT NOT NULL,
      wallet_address TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS spend_events (
      id TEXT PRIMARY KEY,
      person_id TEXT NOT NULL,
      task_id TEXT,
      guard TEXT NOT NULL,
      purpose TEXT NOT NULL,
      amount_units TEXT NOT NULL,
      status TEXT NOT NULL,
      rule TEXT,
      reason TEXT,
      tx_hash TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS spend_person ON spend_events(person_id, created_at);
  `);
  const agentColumns = d.prepare("PRAGMA table_info(agents)").all() as { name: string }[];
  if (!agentColumns.some((c) => c.name === "strategy")) {
    d.exec("ALTER TABLE agents ADD COLUMN strategy TEXT NOT NULL DEFAULT 'careful'");
  }
}

const now = () => new Date().toISOString();

// ---------- persons ----------
export function findPersonByNullifier(nullifier: string): PersonRow | undefined {
  return getDb().prepare("SELECT * FROM persons WHERE world_nullifier = ?").get(nullifier) as PersonRow | undefined;
}
export function findPersonByHandle(handle: string): PersonRow | undefined {
  return getDb().prepare("SELECT * FROM persons WHERE handle = ?").get(handle) as PersonRow | undefined;
}
export function getPerson(id: string): PersonRow | undefined {
  return getDb().prepare("SELECT * FROM persons WHERE id = ?").get(id) as PersonRow | undefined;
}
export function insertPerson(p: Omit<PersonRow, "created_at">): PersonRow {
  getDb()
    .prepare("INSERT INTO persons (id, world_nullifier, handle, mode, credential_expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(p.id, p.world_nullifier, p.handle, p.mode, p.credential_expires_at, now());
  return getPerson(p.id)!;
}
export function setCredentialExpiry(personId: string, expiresAt: string | null): void {
  getDb().prepare("UPDATE persons SET credential_expires_at = ? WHERE id = ?").run(expiresAt, personId);
}
export function listPersons(): PersonRow[] {
  return getDb().prepare("SELECT * FROM persons ORDER BY created_at").all() as unknown as PersonRow[];
}

// ---------- agents ----------
export function insertAgent(a: Omit<AgentRow, "created_at" | "strategy"> & { strategy?: AgentRow["strategy"] }): AgentRow {
  getDb()
    .prepare(
      `INSERT INTO agents (key, ens_name, label, kind, person_id, hedera_account_id, evm_address, enc_private_key,
        base_price, task_type, description, budget_remaining, ledger_registered, ens_registered, erc8004_agent_id, arena_role, strategy, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      a.key, a.ens_name, a.label, a.kind, a.person_id, a.hedera_account_id, a.evm_address, a.enc_private_key,
      a.base_price, a.task_type, a.description, a.budget_remaining, a.ledger_registered, a.ens_registered,
      a.erc8004_agent_id, a.arena_role, a.strategy ?? "careful", now(),
    );
  return getAgent(a.key)!;
}
export function getAgent(key: string): AgentRow | undefined {
  return getDb().prepare("SELECT * FROM agents WHERE key = ?").get(key) as AgentRow | undefined;
}
export function getAgentByLabel(label: string): AgentRow | undefined {
  return getDb().prepare("SELECT * FROM agents WHERE label = ?").get(label) as AgentRow | undefined;
}
export function getAgentByEnsName(ensName: string): AgentRow | undefined {
  return getDb().prepare("SELECT * FROM agents WHERE ens_name = ?").get(ensName) as AgentRow | undefined;
}
export function getAgentByAccount(accountId: string): AgentRow | undefined {
  return getDb().prepare("SELECT * FROM agents WHERE hedera_account_id = ?").get(accountId) as AgentRow | undefined;
}
export function listAgents(kind?: "seller" | "buyer"): AgentRow[] {
  const sql = kind
    ? "SELECT * FROM agents WHERE kind = ? ORDER BY created_at"
    : "SELECT * FROM agents ORDER BY created_at";
  return (kind ? getDb().prepare(sql).all(kind) : getDb().prepare(sql).all()) as unknown as AgentRow[];
}
export function listAgentsOfPerson(personId: string): AgentRow[] {
  return getDb().prepare("SELECT * FROM agents WHERE person_id = ? ORDER BY created_at").all(personId) as unknown as AgentRow[];
}
export function listArenaAgents(role: string): AgentRow[] {
  return getDb().prepare("SELECT * FROM agents WHERE arena_role = ? ORDER BY created_at").all(role) as unknown as AgentRow[];
}
export function updateAgent(key: string, fields: Partial<Omit<AgentRow, "key" | "created_at">>): void {
  const entries = Object.entries(fields);
  if (entries.length === 0) return;
  const sets = entries.map(([k]) => `${k} = ?`).join(", ");
  getDb()
    .prepare(`UPDATE agents SET ${sets} WHERE key = ?`)
    .run(...entries.map(([, v]) => v as string | number | null), key);
}

// ---------- hires ----------
export function insertHire(h: Omit<HireRow, "created_at">): HireRow {
  getDb()
    .prepare(
      `INSERT INTO hires (id, agent_key, buyer_agent_key, quoted_price, paid_amount, payment_tx_id, input_hash, output_hash,
        mandate_id, rating, rated_at, counted, reason, status, ledger_tx_hash, ens_tx_hash, parent_hire_id, arena, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      h.id, h.agent_key, h.buyer_agent_key, h.quoted_price, h.paid_amount, h.payment_tx_id, h.input_hash, h.output_hash,
      h.mandate_id, h.rating, h.rated_at, h.counted, h.reason, h.status, h.ledger_tx_hash, h.ens_tx_hash,
      h.parent_hire_id, h.arena, now(),
    );
  return getHire(h.id)!;
}
export function getHire(id: string): HireRow | undefined {
  return getDb().prepare("SELECT * FROM hires WHERE id = ?").get(id) as HireRow | undefined;
}
export function updateHire(id: string, fields: Partial<Omit<HireRow, "id" | "created_at">>): HireRow {
  const entries = Object.entries(fields);
  if (entries.length > 0) {
    const sets = entries.map(([k]) => `${k} = ?`).join(", ");
    getDb()
      .prepare(`UPDATE hires SET ${sets} WHERE id = ?`)
      .run(...entries.map(([, v]) => v as string | number | null), id);
  }
  return getHire(id)!;
}
export function listHiresForAgent(agentKey: string, limit = 50): HireRow[] {
  return getDb()
    .prepare("SELECT * FROM hires WHERE agent_key = ? ORDER BY created_at DESC LIMIT ?")
    .all(agentKey, limit) as unknown as HireRow[];
}
export function listHiresByBuyer(buyerAgentKey: string, limit = 50): HireRow[] {
  return getDb()
    .prepare("SELECT * FROM hires WHERE buyer_agent_key = ? ORDER BY created_at DESC LIMIT ?")
    .all(buyerAgentKey, limit) as unknown as HireRow[];
}
export function listStaleUnratedHires(olderThanIso: string): HireRow[] {
  return getDb()
    .prepare(
      // A task's hire is rated by the verifier outcome, so it is only swept once the task can no longer produce one.
      `SELECT * FROM hires WHERE status = 'delivered' AND payment_tx_id IS NOT NULL AND created_at < ?
       AND id NOT IN (SELECT hire_id FROM tasks WHERE hire_id IS NOT NULL AND status NOT IN ('refunded', 'error'))`,
    )
    .all(olderThanIso) as unknown as HireRow[];
}
export function countHires(): { total: number; counted: number } {
  const row = getDb()
    .prepare("SELECT COUNT(*) AS total, COALESCE(SUM(CASE WHEN counted = 1 THEN 1 ELSE 0 END), 0) AS counted FROM hires")
    .get() as { total: number; counted: number };
  return { total: Number(row.total), counted: Number(row.counted) };
}

// ---------- mandates ----------
export function insertMandate(m: MandateRow): MandateRow {
  getDb()
    .prepare("INSERT INTO mandates (id, hire_id, forward, sub_budget, spent, expires_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(m.id, m.hire_id, m.forward, m.sub_budget, m.spent, m.expires_at);
  return m;
}
export function getMandate(id: string): MandateRow | undefined {
  return getDb().prepare("SELECT * FROM mandates WHERE id = ?").get(id) as MandateRow | undefined;
}
export function getMandateForHire(hireId: string): MandateRow | undefined {
  return getDb().prepare("SELECT * FROM mandates WHERE hire_id = ?").get(hireId) as MandateRow | undefined;
}
export function addMandateSpend(id: string, amount: bigint): void {
  const m = getMandate(id);
  if (!m) return;
  getDb().prepare("UPDATE mandates SET spent = ? WHERE id = ?").run((BigInt(m.spent) + amount).toString(), id);
}

// ---------- arena wallets ----------
export function insertArenaWallet(address: string, encKey: string, side: string): void {
  getDb().prepare("INSERT OR IGNORE INTO arena_wallets (address, enc_private_key, side) VALUES (?, ?, ?)").run(address, encKey, side);
}
export function listArenaWallets(side: string): { address: string; enc_private_key: string; funded: number; used: number }[] {
  return getDb().prepare("SELECT * FROM arena_wallets WHERE side = ? ORDER BY rowid").all(side) as unknown as {
    address: string;
    enc_private_key: string;
    funded: number;
    used: number;
  }[];
}
export function markArenaWallet(address: string, fields: { funded?: number; used?: number }): void {
  if (fields.funded !== undefined) getDb().prepare("UPDATE arena_wallets SET funded = ? WHERE address = ?").run(fields.funded, address);
  if (fields.used !== undefined) getDb().prepare("UPDATE arena_wallets SET used = ? WHERE address = ?").run(fields.used, address);
}

// ---------- kv ----------
export function kvGet<T>(key: string): T | null {
  const row = getDb().prepare("SELECT value FROM kv WHERE key = ?").get(key) as { value: string } | undefined;
  return row ? (JSON.parse(row.value) as T) : null;
}
export function kvSet(key: string, value: unknown): void {
  getDb().prepare("INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, JSON.stringify(value));
}

// ---------- tasks ----------
const TERMINAL_TASK_STATUSES: TaskStatus[] = ["passed", "failed", "refunded"];

export function insertTask(t: Omit<TaskRow, "created_at">): TaskRow {
  const row = { ...t, created_at: now() };
  const keys = Object.keys(row);
  getDb()
    .prepare(`INSERT INTO tasks (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`)
    .run(...(Object.values(row) as (string | number | null)[]));
  return getTask(t.id)!;
}
export function getTask(id: string): TaskRow | undefined {
  return getDb().prepare("SELECT * FROM tasks WHERE id = ?").get(id) as TaskRow | undefined;
}
export function updateTask(id: string, fields: Partial<Omit<TaskRow, "id" | "created_at">>): TaskRow {
  const entries = Object.entries(fields);
  if (entries.length > 0) {
    getDb()
      .prepare(`UPDATE tasks SET ${entries.map(([k]) => `${k} = ?`).join(", ")} WHERE id = ?`)
      .run(...entries.map(([, v]) => v as string | number | null), id);
  }
  return getTask(id)!;
}
/** Moves a task to a final status once. Returns false if another caller already did, so settlement runs exactly once. */
export function finishTask(id: string, status: TaskStatus, fields: Partial<Omit<TaskRow, "id" | "created_at" | "status">> = {}): boolean {
  const entries = Object.entries(fields);
  const sets = ["status = ?", ...entries.map(([k]) => `${k} = ?`)].join(", ");
  const guard = TERMINAL_TASK_STATUSES.map(() => "?").join(", ");
  const result = getDb()
    .prepare(`UPDATE tasks SET ${sets} WHERE id = ? AND status NOT IN (${guard})`)
    .run(status, ...entries.map(([, v]) => v as string | number | null), id, ...TERMINAL_TASK_STATUSES);
  return Number(result.changes) === 1;
}
export function listTasks(limit = 100): TaskRow[] {
  return getDb().prepare("SELECT * FROM tasks ORDER BY created_at DESC, rowid DESC LIMIT ?").all(limit) as unknown as TaskRow[];
}
/** Tasks the settlement watcher still has to look at. */
export function listLiveTasks(): TaskRow[] {
  return getDb()
    .prepare(
      `SELECT * FROM tasks WHERE chain_task_id IS NOT NULL AND status IN ('open', 'accepted', 'submitted', 'verifying', 'error')`,
    )
    .all() as unknown as TaskRow[];
}
/** Settled tasks whose outcome has not reached the HireLedger yet (the x402 receipt can arrive after settlement). */
export function listUnratedSettledTasks(): TaskRow[] {
  return getDb()
    .prepare("SELECT * FROM tasks WHERE status IN ('passed', 'failed') AND rating_submitted = 0 AND hire_id IS NOT NULL")
    .all() as unknown as TaskRow[];
}
export function listTasksOfDuel(duelId: string): TaskRow[] {
  return getDb().prepare("SELECT * FROM tasks WHERE duel_id = ? ORDER BY rowid").all(duelId) as unknown as TaskRow[];
}
export function countSpecialistTasks(agentKey: string): { passed: number; failed: number } {
  const row = getDb()
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN status = 'passed' THEN 1 ELSE 0 END), 0) AS passed,
              COALESCE(SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END), 0) AS failed
       FROM tasks WHERE specialist_agent_key = ?`,
    )
    .get(agentKey) as { passed: number; failed: number };
  return { passed: Number(row.passed), failed: Number(row.failed) };
}

// ---------- duels ----------
export function insertDuel(id: string): void {
  getDb().prepare("INSERT INTO duels (id, created_at) VALUES (?, ?)").run(id, now());
}
export function getDuel(id: string): { id: string; created_at: string } | undefined {
  return getDb().prepare("SELECT * FROM duels WHERE id = ?").get(id) as { id: string; created_at: string } | undefined;
}

// ---------- agent brain ----------
export function getBrain(agentKey: string): BrainRow | undefined {
  return getDb().prepare("SELECT * FROM agent_brain WHERE agent_key = ?").get(agentKey) as BrainRow | undefined;
}
export function upsertBrain(row: BrainRow): BrainRow {
  getDb()
    .prepare(
      `INSERT INTO agent_brain (agent_key, api_key_enc, key_label, model, credit_neuron, spent_neuron, earned_units,
        credited_from_earnings_neuron, last_request_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(agent_key) DO UPDATE SET api_key_enc = excluded.api_key_enc, key_label = excluded.key_label,
        model = excluded.model, credit_neuron = excluded.credit_neuron, spent_neuron = excluded.spent_neuron,
        earned_units = excluded.earned_units, credited_from_earnings_neuron = excluded.credited_from_earnings_neuron,
        last_request_id = excluded.last_request_id`,
    )
    .run(
      row.agent_key, row.api_key_enc, row.key_label, row.model, row.credit_neuron, row.spent_neuron, row.earned_units,
      row.credited_from_earnings_neuron, row.last_request_id,
    );
  return getBrain(row.agent_key)!;
}
export function resetBrainCredit(seedNeuron: bigint): void {
  getDb()
    .prepare("UPDATE agent_brain SET credit_neuron = ?, spent_neuron = '0', earned_units = '0', credited_from_earnings_neuron = '0', last_request_id = NULL")
    .run(seedNeuron.toString());
}

// ---------- inference receipts ----------
export function insertReceipt(r: Omit<ReceiptRow, "created_at">): ReceiptRow {
  const row: ReceiptRow = { ...r, created_at: now() };
  getDb()
    .prepare(
      `INSERT INTO inference_receipts (id, agent_key, task_id, purpose, model, request_id, provider, prompt_tokens,
        completion_tokens, cost_neuron, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(r.id, r.agent_key, r.task_id, r.purpose, r.model, r.request_id, r.provider, r.prompt_tokens, r.completion_tokens, r.cost_neuron, row.created_at);
  return row;
}
export function listReceipts(agentKey: string, limit = 50): ReceiptRow[] {
  return getDb()
    .prepare("SELECT * FROM inference_receipts WHERE agent_key = ? ORDER BY created_at DESC, rowid DESC LIMIT ?")
    .all(agentKey, limit) as unknown as ReceiptRow[];
}
export function listReceiptsForTask(taskId: string): ReceiptRow[] {
  return getDb().prepare("SELECT * FROM inference_receipts WHERE task_id = ? ORDER BY created_at, rowid").all(taskId) as unknown as ReceiptRow[];
}
export function countReceipts(agentKey: string): number {
  const row = getDb().prepare("SELECT COUNT(*) AS n FROM inference_receipts WHERE agent_key = ?").get(agentKey) as { n: number };
  return Number(row.n);
}

// ---------- spending controls ----------
export function getSpendAccount(personId: string): SpendAccountRow | undefined {
  return getDb().prepare("SELECT * FROM spend_accounts WHERE person_id = ?").get(personId) as SpendAccountRow | undefined;
}
export function upsertSpendAccount(a: Omit<SpendAccountRow, "created_at">): void {
  getDb()
    .prepare(
      `INSERT INTO spend_accounts (person_id, api_key_enc, wallet_id, session_key_id, wallet_address, created_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(person_id) DO UPDATE SET api_key_enc = excluded.api_key_enc, wallet_id = excluded.wallet_id,
        session_key_id = excluded.session_key_id, wallet_address = excluded.wallet_address`,
    )
    .run(a.person_id, a.api_key_enc, a.wallet_id, a.session_key_id, a.wallet_address, now());
}
export function deleteSpendAccount(personId: string): void {
  getDb().prepare("DELETE FROM spend_accounts WHERE person_id = ?").run(personId);
}
export function insertSpendEvent(e: Omit<SpendEventRow, "created_at">): SpendEventRow {
  const row: SpendEventRow = { ...e, created_at: now() };
  getDb()
    .prepare(
      `INSERT INTO spend_events (id, person_id, task_id, guard, purpose, amount_units, status, rule, reason, tx_hash, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(e.id, e.person_id, e.task_id, e.guard, e.purpose, e.amount_units, e.status, e.rule, e.reason, e.tx_hash, row.created_at);
  return row;
}
export function listSpendEvents(personId: string, limit = 10): SpendEventRow[] {
  return getDb()
    .prepare("SELECT * FROM spend_events WHERE person_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?")
    .all(personId, limit) as unknown as SpendEventRow[];
}
export function listSpendEventsForTask(taskId: string): SpendEventRow[] {
  return getDb().prepare("SELECT * FROM spend_events WHERE task_id = ? ORDER BY created_at, rowid").all(taskId) as unknown as SpendEventRow[];
}
export function countConfirmedSpends(personId: string, guard: SpendGuardKind, sinceIso: string): number {
  const row = getDb()
    .prepare("SELECT COUNT(*) AS n FROM spend_events WHERE person_id = ? AND guard = ? AND status = 'confirmed' AND created_at >= ?")
    .get(personId, guard, sinceIso) as { n: number };
  return Number(row.n);
}

/** Clears everything a demo run produces: tasks, duels, receipts and spend events. Keeps agents and brain keys. */
export function clearTaskData(): void {
  getDb().exec("DELETE FROM tasks; DELETE FROM duels; DELETE FROM inference_receipts; DELETE FROM spend_events;");
}

/** Wipes hires, mandates and agents (keeps persons). Used by `pnpm demo:reset`. */
export function resetDemoData(): void {
  clearTaskData();
  getDb().exec("DELETE FROM agent_brain; DELETE FROM mandates; DELETE FROM hires; DELETE FROM agents; DELETE FROM arena_wallets; DELETE FROM kv;");
}
