import { createPublicClient, createWalletClient, http, type PrivateKeyAccount } from "viem";
import { sepolia } from "viem/chains";
import type { Hex } from "@ethernals/shared";
import { taskEscrowFullAbi } from "./generated/artifacts";

/** The slice of TaskEscrow the pipeline needs. Tests inject a fake. */
export interface OnChainTask {
  status: number; // ITaskEscrow.Status
  patchHash: Hex;
  testsHash: Hex;
  specHash: Hex;
  resultHash: Hex;
}

export interface ChainClient {
  getTask(chainTaskId: bigint): Promise<OnChainTask>;
  settle(chainTaskId: bigint, passed: boolean, resultHash: Hex, resultUri: string): Promise<Hex>;
  validationResponse(requestHash: Hex, score: number, uri: string, resultHash: Hex): Promise<Hex>;
}

const validationAbi = [
  {
    type: "function",
    name: "validationResponse",
    stateMutability: "nonpayable",
    inputs: [
      { name: "requestHash", type: "bytes32" },
      { name: "response", type: "uint8" },
      { name: "responseURI", type: "string" },
      { name: "responseHash", type: "bytes32" },
      { name: "tag", type: "string" },
    ],
    outputs: [],
  },
] as const;

/** Serial promise queue: validator writes share one nonce sequence. */
class Serial {
  private tail: Promise<unknown> = Promise.resolve();
  run<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.tail.then(fn, fn);
    this.tail = next.catch(() => undefined);
    return next;
  }
}

export function viemChain(opts: {
  rpcUrl: string;
  account: PrivateKeyAccount;
  escrow: Hex;
  validationRegistry: Hex | null;
}): ChainClient {
  const transport = http(opts.rpcUrl);
  const pub = createPublicClient({ chain: sepolia, transport });
  const wallet = createWalletClient({ chain: sepolia, transport, account: opts.account });
  const queue = new Serial();

  async function send(fn: () => Promise<Hex>): Promise<Hex> {
    let last: unknown;
    for (let i = 0; i < 3; i++) {
      try {
        const hash = await queue.run(fn);
        await pub.waitForTransactionReceipt({ hash });
        return hash;
      } catch (e) {
        last = e;
        await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
      }
    }
    throw last;
  }

  return {
    async getTask(id) {
      const t = (await pub.readContract({
        address: opts.escrow,
        abi: taskEscrowFullAbi,
        functionName: "getTask",
        args: [id],
      })) as { status: number; patchHash: Hex; testsHash: Hex; specHash: Hex; resultHash: Hex };
      return { status: Number(t.status), patchHash: t.patchHash, testsHash: t.testsHash, specHash: t.specHash, resultHash: t.resultHash };
    },
    settle: (id, passed, resultHash, uri) =>
      send(() =>
        wallet.writeContract({ address: opts.escrow, abi: taskEscrowFullAbi, functionName: "settle", args: [id, passed, resultHash, uri] }),
      ),
    validationResponse: (requestHash, score, uri, resultHash) => {
      if (!opts.validationRegistry) throw new Error("ERC8004_VALIDATION_REGISTRY is not configured");
      const registry = opts.validationRegistry;
      return send(() =>
        wallet.writeContract({
          address: registry,
          abi: validationAbi,
          functionName: "validationResponse",
          args: [requestHash, score, uri, resultHash, "hidden-tests"],
        }),
      );
    },
  };
}
