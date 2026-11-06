import { encryptSecret } from "../src/crypto";
import { insertAgent, insertPerson, insertTask, type AgentRow, type PersonRow, type TaskRow } from "../src/db";

let n = 0;
const next = () => ++n;

export function person(handle = `person-${next()}`): PersonRow {
  return insertPerson({ id: `person_${handle}`, world_nullifier: null, handle, mode: "dev", credential_expires_at: null });
}

export function agent(owner: PersonRow, fields: Partial<AgentRow> = {}): AgentRow {
  const i = next();
  return insertAgent({
    key: `0x${String(i).padStart(64, "0")}`,
    ens_name: `agent-${i}.ethernals-test.eth`,
    label: `agent-${i}`,
    kind: "seller",
    person_id: owner.id,
    hedera_account_id: `0.0.${i}`,
    evm_address: `0x${String(i).padStart(40, "0")}`,
    enc_private_key: encryptSecret(`0x${"2".repeat(64)}`),
    base_price: "50000",
    task_type: "code-fix",
    description: "test agent",
    budget_remaining: "1000000",
    ledger_registered: 1,
    ens_registered: 1,
    erc8004_agent_id: null,
    arena_role: null,
    ...fields,
  });
}

export function task(client: PersonRow, buyer: AgentRow, fields: Partial<TaskRow> = {}): TaskRow {
  return insertTask({
    id: `task_${next()}`,
    chain_task_id: "1",
    duel_id: null,
    client_person_id: client.id,
    client_agent_key: buyer.key,
    specialist_agent_key: null,
    template: null,
    spec_json: JSON.stringify({ version: 1, kind: "code-fix", language: "python", title: "t", repoUrl: "https://github.com/a/b", baseCommit: "a".repeat(40), issue: "i" }),
    spec_hash: `0x${"a".repeat(64)}`,
    tests_id: "tests",
    tests_hash: `0x${"b".repeat(64)}`,
    calibration_json: null,
    bounty: "2000000",
    deadline: new Date(Date.now() + 3600_000).toISOString(),
    status: "verifying",
    patch: null,
    patch_hash: null,
    explanation: null,
    verify_job_id: "job",
    result_json: null,
    hire_id: null,
    rating_submitted: 0,
    create_tx: null,
    accept_tx: null,
    submit_tx: null,
    settle_tx: null,
    refund_tx: null,
    erc8004_request_hash: null,
    erc8004_request_tx: null,
    erc8004_response_tx: null,
    error: null,
    ...fields,
  });
}
