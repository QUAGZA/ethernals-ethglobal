const assert = require("node:assert/strict");
const { ethers } = require("hardhat");

const REASON = {
  COUNTED: 0n,
  COUNTED_REPLACED_VOTE: 1n,
  SAME_PERSON: 2n,
  UNVERIFIED_BUYER: 3n,
  DUPLICATE_PAYMENT: 4n,
  NO_RATING: 5n,
  INVALID_RATING: 6n,
  UNKNOWN_AGENT: 7n,
};

const ZERO = ethers.ZeroHash;
const id = (s) => ethers.id(s); // keccak256(utf8)
const BASE = 100000n; // 0.10 USDC

let txCounter = 0;
function hire(agentKey, buyerPersonHash, rating, overrides = {}) {
  const paymentTxId = overrides.paymentTxId ?? `0.0.1001-1700000000-${String(++txCounter).padStart(9, "0")}`;
  return {
    agentKey,
    buyerPersonHash,
    paymentRef: id(paymentTxId),
    paymentTxId,
    amountPaid: overrides.amountPaid ?? BASE,
    rating,
    consentHash: overrides.consentHash ?? ZERO,
    parentHireRef: overrides.parentHireRef ?? ZERO,
  };
}

async function recordAndParse(ledger, input) {
  const tx = await ledger.recordHire(input);
  const receipt = await tx.wait();
  const log = receipt.logs.map((l) => ledger.interface.parseLog(l)).find((p) => p && p.name === "HireRecorded");
  return log.args;
}

describe("HireLedger", function () {
  let ledger, owner, other;
  const agent = id("summarize.ethernals.eth");
  const alice = id("alice@summarize");
  const bob = id("bob@summarize");
  const dave = id("dave@summarize");
  const erin = id("erin@summarize");

  beforeEach(async function () {
    [owner, other] = await ethers.getSigners();
    const Factory = await ethers.getContractFactory("HireLedger");
    ledger = await Factory.deploy(ethers.ZeroAddress);
    await ledger.waitForDeployment();
    await (await ledger.registerAgent(agent, id("provider:alice"), alice, BASE)).wait();
  });

  it("starts a new agent at score 3.00 and its base price", async function () {
    assert.equal(await ledger.scoreOf(agent), 3_000_000n);
    assert.equal(await ledger.priceOf(agent), BASE);
  });

  it("follows the PRD worked example exactly", async function () {
    let e = await recordAndParse(ledger, hire(agent, alice, 5));
    assert.equal(e.reason, REASON.SAME_PERSON);
    assert.equal(e.counted, false);
    assert.equal(e.newScoreX1e6, 3_000_000n);
    assert.equal(e.newPrice, 100000n);

    e = await recordAndParse(ledger, hire(agent, bob, 5));
    assert.equal(e.reason, REASON.COUNTED);
    assert.equal(e.newScoreX1e6, 3_500_000n);
    assert.equal(e.newPrice, 116666n);

    e = await recordAndParse(ledger, hire(agent, dave, 5));
    assert.equal(e.newScoreX1e6, 3_800_000n);
    assert.equal(e.newPrice, 126666n);

    e = await recordAndParse(ledger, hire(agent, bob, 4));
    assert.equal(e.reason, REASON.COUNTED_REPLACED_VOTE);
    assert.equal(e.newScoreX1e6, 3_600_000n);
    assert.equal(e.newPrice, 120000n);

    e = await recordAndParse(ledger, hire(agent, erin, 5));
    assert.equal(e.reason, REASON.COUNTED);
    assert.equal(e.newScoreX1e6, 3_833_333n);
    assert.equal(e.newPrice, 127777n);

    const stats = await ledger.statsOf(agent);
    assert.equal(stats.votes, 3n);
    assert.equal(stats.sumVotes, 14n);
    assert.equal(stats.hiresTotal, 5n);
    assert.equal(stats.hiresCounted, 4n);
  });

  it("refuses unverified buyers, missing and invalid ratings", async function () {
    assert.equal((await recordAndParse(ledger, hire(agent, ZERO, 5))).reason, REASON.UNVERIFIED_BUYER);
    assert.equal((await recordAndParse(ledger, hire(agent, bob, 0))).reason, REASON.NO_RATING);
    assert.equal((await recordAndParse(ledger, hire(agent, bob, 6))).reason, REASON.INVALID_RATING);
    assert.equal(await ledger.scoreOf(agent), 3_000_000n);
  });

  it("refuses a replayed payment, even one first used by a refused hire", async function () {
    const first = hire(agent, alice, 5, { paymentTxId: "0.0.1001-1700000000-000000777" });
    assert.equal((await recordAndParse(ledger, first)).reason, REASON.SAME_PERSON);
    const replay = hire(agent, bob, 5, { paymentTxId: "0.0.1001-1700000000-000000777" });
    assert.equal((await recordAndParse(ledger, replay)).reason, REASON.DUPLICATE_PAYMENT);
    assert.equal(await ledger.scoreOf(agent), 3_000_000n);
  });

  it("reports unknown agents without changing state", async function () {
    const e = await recordAndParse(ledger, hire(id("nobody.eth"), bob, 5));
    assert.equal(e.reason, REASON.UNKNOWN_AGENT);
    assert.equal(e.newScoreX1e6, 0n);
  });

  it("records a farm of 20 same-person hires in one batch, none counted", async function () {
    const batch = Array.from({ length: 20 }, () => hire(agent, alice, 5));
    const receipt = await (await ledger.recordHires(batch)).wait();
    const events = receipt.logs.map((l) => ledger.interface.parseLog(l)).filter((p) => p && p.name === "HireRecorded");
    assert.equal(events.length, 20);
    assert.ok(events.every((e) => e.args.reason === REASON.SAME_PERSON && e.args.counted === false));
    const stats = await ledger.statsOf(agent);
    assert.equal(stats.hiresTotal, 20n);
    assert.equal(stats.hiresCounted, 0n);
    assert.equal(await ledger.scoreOf(agent), 3_000_000n);
  });

  it("gives a different person with 20 agents only one vote", async function () {
    const mallory = id("mallory@summarize");
    const batch = Array.from({ length: 20 }, () => hire(agent, mallory, 5));
    await (await ledger.recordHires(batch)).wait();
    const stats = await ledger.statsOf(agent);
    assert.equal(stats.votes, 1n);
    assert.equal(stats.hiresCounted, 20n);
    assert.equal(await ledger.scoreOf(agent), 3_500_000n);
  });

  it("only lets the verifier write and the owner change the verifier", async function () {
    await assert.rejects(ledger.connect(other).recordHire(hire(agent, bob, 5)), /NotVerifier/);
    await assert.rejects(ledger.connect(other).registerAgent(id("x"), ZERO, bob, BASE), /NotVerifier/);
    await assert.rejects(ledger.connect(other).setVerifier(other.address), /NotOwner/);
    await (await ledger.setVerifier(other.address)).wait();
    assert.equal(await ledger.verifier(), other.address);
  });

  it("rejects bad registrations", async function () {
    await assert.rejects(ledger.registerAgent(agent, ZERO, alice, BASE), /AgentAlreadyRegistered/);
    await assert.rejects(ledger.registerAgent(id("y"), ZERO, alice, 0n), /InvalidBasePrice/);
    await assert.rejects(ledger.registerAgent(id("z"), ZERO, ZERO, BASE), /InvalidProvider/);
  });
});
