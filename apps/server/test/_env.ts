/** Test environment. Import through vi.hoisted before any app module, so config sees these values. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function setTestEnv(name: string): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `ethernals-${name}-`));
  Object.assign(process.env, {
    DATABASE_PATH: path.join(dir, "test.db"),
    PERSON_HASH_SECRET: "test-person-secret",
    KEYSTORE_SECRET: "test-keystore-secret",
    SESSION_SECRET: "test-session-secret",
    ZG_ENABLED: "true",
    ZG_ROUTER_BASE_URL: "https://router.test/v1",
    ZG_API_KEY: "sk-shared",
    ZG_MANAGEMENT_KEY: "",
    ZG_MODEL: "",
    ZG_SEED_CREDIT_NEURON: "1000",
    ZG_MIN_CREDIT_NEURON: "100",
    ZG_NEURON_PER_USDC: "2000000",
    TASK_ESCROW_ADDRESS: "0x00000000000000000000000000000000000000e1",
    MOCK_USDC_ADDRESS: "0x00000000000000000000000000000000000000e2",
    SEPOLIA_RPC_URL: "https://sepolia.test",
    SEPOLIA_PRIVATE_KEY: `0x${"1".repeat(64)}`,
    ENS_PARENT_NAME: "ethernals-test.eth",
    VERIFIER_TOKEN: "test-token",
    PUBLIC_BASE_URL: "https://app.test",
  });
}
