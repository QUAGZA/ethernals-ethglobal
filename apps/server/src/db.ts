/**
 * SQLite storage via Node's built-in `node:sqlite` (Node 22.13+), so there are no native modules to build.
 * The database stores metadata only — never task content (PRD SEC-5).
 */
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
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
  `);
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
export function insertAgent(a: Omit<AgentRow, "created_at">): AgentRow {
  getDb()
    .prepare(
      `INSERT INTO agents (key, ens_name, label, kind, person_id, hedera_account_id, evm_address, enc_private_key,
        base_price, task_type, description, budget_remaining, ledger_registered, ens_registered, erc8004_agent_id, arena_role, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      a.key, a.ens_name, a.label, a.kind, a.person_id, a.hedera_account_id, a.evm_address, a.enc_private_key,
      a.base_price, a.task_type, a.description, a.budget_remaining, a.ledger_registered, a.ens_registered,
      a.erc8004_agent_id, a.arena_role, now(),
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
    .prepare("SELECT * FROM hires WHERE status = 'delivered' AND payment_tx_id IS NOT NULL AND created_at < ?")
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

/** Wipes hires, mandates and agents (keeps persons). Used by `pnpm demo:reset`. */
export function resetDemoData(): void {
  getDb().exec("DELETE FROM mandates; DELETE FROM hires; DELETE FROM agents; DELETE FROM arena_wallets; DELETE FROM kv;");
}
