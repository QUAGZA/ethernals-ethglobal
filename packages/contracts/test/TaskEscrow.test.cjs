const assert = require("node:assert/strict");
const { ethers } = require("hardhat");

const U = (n) => BigInt(Math.round(n * 1e6));
const h = (s) => ethers.id(s);
const Status = { None: 0n, Open: 1n, Accepted: 2n, Submitted: 3n, Passed: 4n, Failed: 5n, Refunded: 6n };

async function now() {
  return (await ethers.provider.getBlock("latest")).timestamp;
}
async function warp(to) {
  await ethers.provider.send("evm_setNextBlockTimestamp", [to]);
  await ethers.provider.send("evm_mine", []);
}

describe("TaskEscrow", function () {
  let usdc, escrow, client, spec, other, validator, deadline;

  beforeEach(async function () {
    [, client, spec, other, validator] = await ethers.getSigners();
    usdc = await (await ethers.getContractFactory("MockUSDC")).deploy();
    escrow = await (await ethers.getContractFactory("TaskEscrow")).deploy(await usdc.getAddress(), validator.address);
    await usdc.mint(client.address, U(100));
    await usdc.connect(client).approve(await escrow.getAddress(), U(100));
    deadline = (await now()) + 3600;
  });

  const create = (specialist = ethers.ZeroAddress, bounty = U(2)) =>
    escrow.connect(client).createTask(bounty, deadline, specialist, h("spec"), h("tests"), "ipfs://spec");

  async function toSubmitted(specialist = spec.address) {
    await create(specialist);
    await escrow.connect(spec).acceptTask(1);
    await escrow.connect(spec).submitResult(1, h("patch"), "patch://1");
  }

  it("happy path: PASS pays the specialist and stores the receipt hash", async function () {
    await toSubmitted();
    assert.equal(await usdc.balanceOf(await escrow.getAddress()), U(2));
    await escrow.connect(validator).settle(1, true, h("receipt"), "https://v/r.json");
    assert.equal(await usdc.balanceOf(spec.address), U(2));
    assert.equal(await usdc.balanceOf(await escrow.getAddress()), 0n);
    const t = await escrow.getTask(1);
    assert.equal(t.status, Status.Passed);
    assert.equal(t.resultHash, h("receipt"));
  });

  it("FAIL refunds the client and the specialist gets nothing", async function () {
    await toSubmitted();
    await escrow.connect(validator).settle(1, false, h("receipt"), "u");
    assert.equal(await usdc.balanceOf(client.address), U(100));
    assert.equal(await usdc.balanceOf(spec.address), 0n);
    assert.equal((await escrow.getTask(1)).status, Status.Failed);
  });

  it("open tasks can be accepted by anyone; directed tasks reject others", async function () {
    await create();
    await escrow.connect(other).acceptTask(1);
    assert.equal((await escrow.getTask(1)).specialist, other.address);
    await create(spec.address);
    await assert.rejects(escrow.connect(other).acceptTask(2), /NotSpecialist/);
    await escrow.connect(spec).acceptTask(2);
  });

  it("only the validator settles, and only once", async function () {
    await toSubmitted();
    await assert.rejects(escrow.connect(client).settle(1, true, h("r"), "u"), /NotValidator/);
    await escrow.connect(validator).settle(1, true, h("r"), "u");
    await assert.rejects(escrow.connect(validator).settle(1, true, h("r"), "u"), /BadStatus/);
  });

  it("refund timing, including the 30-minute verification grace", async function () {
    await create();
    await assert.rejects(escrow.connect(client).refund(1), /TooEarly/);
    await warp(deadline + 1);
    await assert.rejects(escrow.connect(other).refund(1), /NotClient/);
    await escrow.connect(client).refund(1);
    assert.equal(await usdc.balanceOf(client.address), U(100));
    await assert.rejects(escrow.connect(client).refund(1), /BadStatus/);

    deadline = (await now()) + 3600;
    await create(spec.address);
    await escrow.connect(spec).acceptTask(2);
    await escrow.connect(spec).submitResult(2, h("p"), "u");
    await warp(deadline + 60);
    await assert.rejects(escrow.connect(client).refund(2), /TooEarly/);
    await warp(deadline + 31 * 60);
    await escrow.connect(client).refund(2);
    await assert.rejects(escrow.connect(validator).settle(2, true, h("r"), "u"), /BadStatus/);
  });

  it("submit after the deadline reverts", async function () {
    await create(spec.address);
    await escrow.connect(spec).acceptTask(1);
    await warp(deadline + 1);
    await assert.rejects(escrow.connect(spec).submitResult(1, h("p"), "u"), /DeadlinePassed/);
  });

  it("only the accepted specialist can submit; zero bounty rejected", async function () {
    await create(spec.address);
    await escrow.connect(spec).acceptTask(1);
    await assert.rejects(escrow.connect(other).submitResult(1, h("p"), "u"), /NotSpecialist/);
    await assert.rejects(create(ethers.ZeroAddress, 0n), /ZeroValue/);
  });

  it("MockUSDC mint is capped at 1,000 tUSDC", async function () {
    await usdc.mint(other.address, 1_000_000_000n);
    await assert.rejects(usdc.mint(other.address, 1_000_000_001n), /MintCapExceeded/);
  });
});
