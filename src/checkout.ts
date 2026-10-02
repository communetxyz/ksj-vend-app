import {
  createPublicClient,
  createWalletClient,
  custom,
  http,
  parseAbi,
  decodeEventLog,
  isAddress,
  type Address,
  type Hash,
  type EIP1193Provider,
} from "viem";
import { sepolia } from "viem/chains";
import { z } from "zod";
export const abi = parseAbi([
  "function COMPARTMENTS() view returns (uint8)",
  "function paymentToken() view returns (address)",
  "function owner() view returns (address)",
  "function getSlots() view returns ((string name,uint256 price,bool available)[4])",
  "function configure(uint8 compartment,string name,uint256 price,bool available)",
  "function purchase(uint8 compartment,uint256 expectedPrice) returns (uint256)",
  "function refund(uint256 id)",
  "function orders(uint256 id) view returns (address buyer,uint8 compartment,uint256 amount,bool refunded)",
  "event Purchased(uint256 indexed orderId,address indexed buyer,uint8 indexed compartment,uint256 amount)",
]);
export const tokenAbi = parseAbi([
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
  "function faucet()",
]);
export const client = createPublicClient({
  chain: sepolia,
  transport: http("https://ethereum-sepolia-rpc.publicnode.com", {
    timeout: 15000,
    retryCount: 1,
  }),
});
const address = z
  .string()
  .refine((v): boolean => isAddress(v), "Enter an Ethereum contract address.");
export const configSchema = z.object({
  contract: address,
  bluetoothName: z.string().min(1).max(120),
  channels: z
    .array(z.number().int().min(1).max(12))
    .length(4)
    .refine(
      (v) => new Set(v).size === 4,
      "Each compartment needs a distinct channel.",
    ),
  f0MeansOpen: z.boolean(),
  encoding: z.enum(["pdf", "apk"]),
  name: z.string().min(1).max(80),
});
export type ShopConfig = z.infer<typeof configSchema>;
export type Product = { name: string; price: bigint; available: boolean };
export const positions = [
  "Left · tall",
  "Right · top",
  "Right · middle",
  "Right · bottom",
];
export function getConfig(): ShopConfig | null {
  const url = new URL(location.href);
  const shared = url.searchParams.get("machine");
  const raw = shared || localStorage.getItem("ksj-shop-config");
  if (!raw) return null;
  return configSchema.parse(JSON.parse(raw));
}
export function saveConfig(config: ShopConfig) {
  localStorage.setItem(
    "ksj-shop-config",
    JSON.stringify(configSchema.parse(config)),
  );
}
export function shareUrl(config: ShopConfig) {
  const u = new URL(location.href);
  u.search = "";
  u.hash = "";
  u.searchParams.set("machine", JSON.stringify(configSchema.parse(config)));
  return u.href;
}
export async function wallet() {
  const provider = (window as unknown as { ethereum?: EIP1193Provider })
    .ethereum;
  if (!provider)
    throw new Error(
      "Open this page in desktop Chrome with a wallet extension such as MetaMask. The combined wallet + Bluetooth test needs both in the same browser.",
    );
  const w = createWalletClient({ chain: sepolia, transport: custom(provider) });
  const [account] = await w.requestAddresses();
  if (!account) throw new Error("No wallet account selected.");
  await w.switchChain({ id: sepolia.id });
  if ((await w.getChainId()) !== sepolia.id)
    throw new Error("Switch the wallet to Sepolia.");
  return { w, account };
}
export async function catalog(config: ShopConfig) {
  const address = config.contract as Address;
  if (
    (await client.readContract({
      address,
      abi,
      functionName: "COMPARTMENTS",
    })) !== 4
  )
    throw new Error("This is not a KSJ four-compartment V2 contract.");
  const [slots, token, owner] = await Promise.all([
    client.readContract({ address, abi, functionName: "getSlots" }),
    client.readContract({ address, abi, functionName: "paymentToken" }),
    client.readContract({ address, abi, functionName: "owner" }),
  ]);
  const [decimals, symbol] = await Promise.all([
    client.readContract({
      address: token,
      abi: tokenAbi,
      functionName: "decimals",
    }),
    client.readContract({
      address: token,
      abi: tokenAbi,
      functionName: "symbol",
    }),
  ]);
  return { slots: [...slots], token, owner, decimals, symbol };
}
export type ReceiptOrder = {
  hash: Hash;
  buyer: Address;
  contract: Address;
  slot: number;
  price: string;
  product: string;
  phase:
    | "submitted"
    | "paid"
    | "opening"
    | "opened"
    | "collected"
    | "unknown"
    | "reverted"
    | "refunded";
  orderId?: string;
  note?: string;
};
const orderSchema = z.object({
  hash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  buyer: address,
  contract: address,
  slot: z.number().int().min(0).max(3),
  price: z.string().regex(/^\d+$/),
  product: z.string(),
  phase: z.enum([
    "submitted",
    "paid",
    "opening",
    "opened",
    "collected",
    "unknown",
    "reverted",
    "refunded",
  ]),
  orderId: z.string().optional(),
  note: z.string().optional(),
});
export function recordOrder(order: ReceiptOrder) {
  orderSchema.parse(order);
  localStorage.setItem("ksj-current-order", JSON.stringify(order));
}
export function restoreOrder(): ReceiptOrder | null {
  const raw = localStorage.getItem("ksj-current-order");
  if (!raw) return null;
  const o = orderSchema.parse(JSON.parse(raw)) as ReceiptOrder;
  return o.phase === "opening"
    ? {
        ...o,
        phase: "unknown",
        note: "Browser closed during an unlock. Ask the operator to inspect the compartment; do not pay again.",
      }
    : o;
}
export function matchPurchase(
  logs: readonly { address: string; data: Hash; topics: readonly Hash[] }[],
  order: ReceiptOrder,
) {
  for (const log of logs) {
    if (log.address.toLowerCase() !== order.contract.toLowerCase()) continue;
    try {
      const event = decodeEventLog({
        abi,
        eventName: "Purchased",
        data: log.data,
        topics: log.topics as [Hash, ...Hash[]],
      });
      const a = event.args;
      if (
        a.buyer.toLowerCase() === order.buyer.toLowerCase() &&
        a.compartment === order.slot &&
        a.amount === BigInt(order.price)
      )
        return a.orderId.toString();
    } catch {
      /* Ignore other events. */
    }
  }
  throw new Error(
    "The receipt does not contain the expected purchase. No compartment will open.",
  );
}
export class RevertedPayment extends Error {}
export class RefundedPayment extends Error {}
export async function verifyPayment(order: ReceiptOrder) {
  const receipt = await client.waitForTransactionReceipt({
    hash: order.hash,
    confirmations: 2,
    timeout: 180000,
  });
  if (receipt.status !== "success")
    throw new RevertedPayment("Purchase reverted. No compartment will open.");
  const orderId = matchPurchase(receipt.logs, order);
  const onchain = await client.readContract({
    address: order.contract,
    abi,
    functionName: "orders",
    args: [BigInt(orderId)],
  });
  if (onchain[3])
    throw new RefundedPayment(
      "This purchase has been refunded. No compartment will open.",
    );
  return { ...order, orderId, phase: "paid" as const };
}
