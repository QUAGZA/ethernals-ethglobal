import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

await vi.hoisted(async () => {
  const { setTestEnv } = await import("./_env");
  setTestEnv("quote");
});

const getPrice = vi.hoisted(() => vi.fn());
vi.mock("../src/ledger", async (original) => ({ ...(await original<object>()), getPrice }));

const { invalidatePrice, quoteUnits } = await import("../src/payments");
const { agent, person } = await import("./_fixtures");

const registered = () => agent(person(), { base_price: "10000", ledger_registered: 1 });

beforeEach(() => {
  getPrice.mockReset();
  process.env.HIRE_LEDGER_ADDRESS = "0x9be8b979a36273af58f6f35191c1e9f11a19f634";
  vi.useFakeTimers();
});

afterEach(() => vi.useRealTimers());

describe("quoting a price while the Hedera RPC is down", () => {
  it("keeps the last price read from the ledger", async () => {
    const seller = registered();
    getPrice.mockResolvedValueOnce(25000n);
    expect(await quoteUnits(seller)).toBe(25000n);
    vi.advanceTimersByTime(3000);
    getPrice.mockRejectedValueOnce(new Error("HTTP request failed."));
    expect(await quoteUnits(seller)).toBe(25000n);
  });

  it("uses the base price if the ledger was never read", async () => {
    getPrice.mockRejectedValueOnce(new Error("HTTP request failed."));
    expect(await quoteUnits(registered())).toBe(10000n);
  });

  it("asks once during an outage, not on every quote", async () => {
    const seller = registered();
    getPrice.mockRejectedValue(new Error("HTTP request failed."));
    await quoteUnits(seller);
    vi.advanceTimersByTime(10_000);
    await quoteUnits(seller);
    expect(getPrice).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(21_000);
    await quoteUnits(seller);
    expect(getPrice).toHaveBeenCalledTimes(2);
  });

  it("reads again straight after a new rating, even mid-outage", async () => {
    const seller = registered();
    getPrice.mockRejectedValueOnce(new Error("HTTP request failed."));
    await quoteUnits(seller);
    invalidatePrice(seller.key);
    getPrice.mockResolvedValueOnce(30000n);
    expect(await quoteUnits(seller)).toBe(30000n);
  });
});
