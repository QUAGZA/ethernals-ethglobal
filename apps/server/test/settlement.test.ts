import { beforeEach, describe, expect, it, vi } from "vitest";

await vi.hoisted(async () => {
  const { setTestEnv } = await import("./_env");
  setTestEnv("settlement");
});

const mocks = vi.hoisted(() => ({ getTaskOnChain: vi.fn(), submitRating: vi.fn(), getVerifyJob: vi.fn() }));
vi.mock("../src/escrow", async (original) => ({ ...(await original<object>()), getTaskOnChain: mocks.getTaskOnChain }));
vi.mock("../src/verifier", async (original) => ({ ...(await original<object>()), submitRating: mocks.submitRating }));
vi.mock("../src/verifier-client", async (original) => ({ ...(await original<object>()), getVerifyJob: mocks.getVerifyJob }));
vi.mock("../src/ledger", async (original) => ({ ...(await original<object>()), getStats: vi.fn().mockResolvedValue({ scoreX1e6: 3_000_000n }) }));

const { clearTaskData, getBrain, getTask, insertHire, kvGet, listStaleUnratedHires, updateHire, updateTask, upsertBrain } = await import("../src/db");
const { emit, recentEvents } = await import("../src/events");
const { pollEscrow, ratingFor } = await import("../src/settlement");
const { agent, person, task } = await import("./_fixtures");

let hireCount = 0;
function scenario(overrides: Parameters<typeof task>[2] = {}, payment: string | null | undefined = undefined) {
  const client = person();
  const buyer = agent(client, { kind: "buyer", task_type: null });
  const seller = agent(person());
  upsertBrain({ agent_key: seller.key, api_key_enc: null, key_label: null, model: "m", credit_neuron: "1000", spent_neuron: "0", earned_units: "0", credited_from_earnings_neuron: "0", last_request_id: null });
  const hireId = `hire_${++hireCount}`;
  const paymentTxId = payment === undefined ? `0.0.5-1700000000-${String(hireCount).padStart(9, "0")}` : payment;
  insertHire({ id: hireId, agent_key: seller.key, buyer_agent_key: buyer.key, quoted_price: "50000", paid_amount: null, payment_tx_id: paymentTxId, input_hash: "h", output_hash: null, mandate_id: null, rating: null, rated_at: null, counted: null, reason: null, status: "delivered", ledger_tx_hash: null, ens_tx_hash: null, parent_hire_id: null, arena: 0 });
  const row = task(client, buyer, { specialist_agent_key: seller.key, hire_id: hireId, ...overrides });
  return { row, seller, hireId };
}

const job = (passed: boolean) => ({ settleTxHash: `0x${"5".repeat(64)}`, erc8004TxHash: `0x${"6".repeat(64)}`, resultUrl: "http://verifier/results/j.json", result: { passed, failureReason: passed ? null : "tests_failed" } });
const settled = (taskId: string) => recentEvents().filter((e) => e.type === "task.settled" && e.data.taskId === taskId);

beforeEach(() => {
  clearTaskData();
  vi.clearAllMocks();
  mocks.getTaskOnChain.mockResolvedValue({ status: "Submitted" });
  mocks.submitRating.mockImplementation(async ({ hireId }: { hireId: string }) => {
    emit("hire.recorded", { hireId, score: "3.25", price: "0.054" });
  });
});

describe("the settlement watcher", () => {
  it("maps PASS to 5 stars and FAIL to 1", () => {
    expect(ratingFor(true)).toBe(5);
    expect(ratingFor(false)).toBe(1);
  });

  it("does nothing while the escrow is unsettled", async () => {
    const { row } = scenario();
    await pollEscrow(50);
    expect(getTask(row.id)!.status).toBe("verifying");
    expect(mocks.submitRating).not.toHaveBeenCalled();
  });

  it("settles a PASS once: 5 stars, the bounty credits the brain, the evidence is stored", async () => {
    const { row, seller, hireId } = scenario();
    mocks.getTaskOnChain.mockResolvedValue({ status: "Passed" });
    mocks.getVerifyJob.mockResolvedValue(job(true));

    await pollEscrow(50);
    await pollEscrow(50);
    await pollEscrow(50);

    expect(mocks.submitRating).toHaveBeenCalledTimes(1);
    expect(mocks.submitRating).toHaveBeenCalledWith(expect.objectContaining({ hireId, rating: 5 }));
    expect(getTask(row.id)).toMatchObject({ status: "passed", settle_tx: job(true).settleTxHash, erc8004_response_tx: job(true).erc8004TxHash, rating_submitted: 1 });
    expect(getBrain(seller.key)).toMatchObject({ earned_units: "2000000", credit_neuron: String(1000 + 4_000_000) });
    expect(settled(row.id)).toHaveLength(1);
    expect(settled(row.id)[0].data).toMatchObject({ passed: true, score: "3.25", price: "0.054" });
    expect(kvGet(`task.score.${row.id}`)).toEqual({ before: "3.00", after: "3.25" });
  });

  it("settles a FAIL with 1 star and no bounty for the specialist", async () => {
    const { row, seller, hireId } = scenario();
    mocks.getTaskOnChain.mockResolvedValue({ status: "Failed" });
    mocks.getVerifyJob.mockResolvedValue(job(false));

    await pollEscrow(50);

    expect(mocks.submitRating).toHaveBeenCalledWith(expect.objectContaining({ hireId, rating: 1 }));
    expect(getTask(row.id)!.status).toBe("failed");
    expect(getBrain(seller.key)).toMatchObject({ earned_units: "0", credit_neuron: "1000" });
  });

  it("settles once when two watchers race", async () => {
    const { row, seller } = scenario();
    mocks.getTaskOnChain.mockResolvedValue({ status: "Passed" });
    mocks.getVerifyJob.mockResolvedValue(job(true));

    await Promise.all([pollEscrow(50), pollEscrow(50)]);

    expect(mocks.submitRating).toHaveBeenCalledTimes(1);
    expect(settled(row.id)).toHaveLength(1);
    expect(getBrain(seller.key)!.earned_units).toBe("2000000");
  });

  it("retries the rating when the x402 receipt arrives after settlement, without paying twice", async () => {
    const { hireId, row, seller } = scenario({}, null);
    mocks.getTaskOnChain.mockResolvedValue({ status: "Passed" });
    mocks.getVerifyJob.mockResolvedValue(job(true));

    await pollEscrow(50);
    expect(mocks.submitRating).not.toHaveBeenCalled();
    expect(getTask(row.id)).toMatchObject({ status: "passed", rating_submitted: 0 });

    updateHire(hireId, { payment_tx_id: "0.0.5-1700000000-999999999" });
    await pollEscrow(50);
    await pollEscrow(50);

    expect(mocks.submitRating).toHaveBeenCalledTimes(1);
    expect(getBrain(seller.key)!.earned_units).toBe("2000000");
  });

  it("marks a refund and never rates it", async () => {
    const { row } = scenario();
    mocks.getTaskOnChain.mockResolvedValue({ status: "Refunded" });
    await pollEscrow(50);
    expect(getTask(row.id)!.status).toBe("refunded");
    expect(mocks.submitRating).not.toHaveBeenCalled();
    expect(recentEvents().filter((e) => e.type === "task.refunded" && e.data.taskId === row.id)).toHaveLength(1);
  });

  it("keeps watching a task when one read fails", async () => {
    const { row } = scenario();
    mocks.getTaskOnChain.mockRejectedValue(new Error("rpc down"));
    await pollEscrow(50);
    expect(getTask(row.id)!.status).toBe("verifying");
  });
});

describe("the unrated sweeper", () => {
  const future = new Date(Date.now() + 3_600_000).toISOString();

  it("never auto-rates the hire of a live task", () => {
    const { hireId } = scenario();
    expect(listStaleUnratedHires(future).map((h) => h.id)).not.toContain(hireId);
  });

  it("sweeps the hire once the task can no longer produce an outcome", () => {
    const { hireId, row } = scenario();
    updateTask(row.id, { status: "refunded" });
    expect(listStaleUnratedHires(future).map((h) => h.id)).toContain(hireId);
  });
});
