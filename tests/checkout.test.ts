import { it, expect, vi, afterEach } from "vitest";
import {
  encodeEventTopics,
  encodeAbiParameters,
  type Address,
  type Hash,
} from "viem";
import {
  abi,
  configSchema,
  matchPurchase,
  recordOrder,
  restoreOrder,
  type ReceiptOrder,
} from "../src/checkout";
const contract = "0x1111111111111111111111111111111111111111" as Address;
const buyer = "0x2222222222222222222222222222222222222222" as Address;
const order: ReceiptOrder = {
  hash: `0x${"aa".repeat(32)}`,
  buyer,
  contract,
  slot: 0,
  price: "200",
  product: "Kit",
  phase: "submitted",
};
const log = {
  address: contract,
  data: encodeAbiParameters([{ type: "uint256" }], [200n]),
  topics: encodeEventTopics({
    abi,
    eventName: "Purchased",
    args: { orderId: 7n, buyer, compartment: 0 },
  }) as Hash[],
};
afterEach(() => vi.unstubAllGlobals());
it("requires exactly four distinct valid controller channels", () => {
  const c = {
    contract,
    bluetoothName: "KSJ",
    channels: [1, 2, 3, 4],
    f0MeansOpen: true,
    encoding: "pdf",
    name: "Machine",
  };
  expect(configSchema.parse(c).channels).toHaveLength(4);
  expect(() => configSchema.parse({ ...c, channels: [1, 1, 3, 4] })).toThrow();
  expect(() => configSchema.parse({ ...c, channels: [1, 2, 3, 13] })).toThrow();
});
it("binds receipt to the correct contract, buyer, compartment and amount", () => {
  expect(matchPurchase([log], order)).toBe("7");
  for (const patch of [
    { contract: buyer },
    { buyer: contract },
    { slot: 1 },
    { price: "201" },
  ])
    expect(() => matchPurchase([log], { ...order, ...patch })).toThrow();
});
it("does not treat unrelated or empty logs as a payment", () => {
  expect(() => matchPurchase([], order)).toThrow();
  expect(() => matchPurchase([{ ...log, topics: [] }], order)).toThrow();
});
it("restores an interrupted opening as uncertain without automatically retrying", () => {
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => storage.set(k, v),
  });
  recordOrder({ ...order, phase: "opening" });
  expect(restoreOrder()?.phase).toBe("unknown");
  recordOrder({ ...order, phase: "collected" });
  expect(restoreOrder()?.phase).toBe("collected");
});
it("rejects malformed persisted receipts", () => {
  vi.stubGlobal("localStorage", { getItem: () => '{"phase":"paid"}' });
  expect(() => restoreOrder()).toThrow();
});
