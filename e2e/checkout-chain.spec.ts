import { test, expect } from "@playwright/test";
import {
  createPublicClient,
  createWalletClient,
  http,
  parseEther,
  type Address,
} from "viem";
import { sepolia } from "viem/chains";
import { readFileSync } from "node:fs";
const tokenArtifact = JSON.parse(
  readFileSync(
    new URL("../src/contracts/KSJTestToken.json", import.meta.url),
    "utf8",
  ),
);
const machineArtifact = JSON.parse(
  readFileSync(
    new URL("../src/contracts/KSJVendV2.json", import.meta.url),
    "utf8",
  ),
);
import { abi, tokenAbi } from "../src/checkout";
const rpc = "http://127.0.0.1:8547";
const p = createPublicClient({
  chain: sepolia,
  transport: http(rpc),
  pollingInterval: 200,
});
const w = createWalletClient({ chain: sepolia, transport: http(rpc) });
async function send(args: any) {
  const hash = await w.writeContract(args);
  const r = await p.waitForTransactionReceipt({ hash });
  expect(r.status).toBe("success");
  return r;
}
test("local EVM payment, matching receipt, mapped BLE unlock and reload without replay", async ({
  page,
}) => {
  const [account] = await w.getAddresses();
  await fetch(rpc, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "anvil_setIntervalMining",
      params: [1],
    }),
  });
  const deploy = async (artifact: any, args: any[]) => {
    const hash = await w.deployContract({
      account,
      abi: artifact.abi,
      bytecode: artifact.bytecode,
      args,
    });
    return (await p.waitForTransactionReceipt({ hash })).contractAddress!;
  };
  const token = await deploy(tokenArtifact, []);
  const machine = await deploy(machineArtifact, [token, account]);
  await send({
    account,
    address: token,
    abi: tokenAbi,
    functionName: "faucet",
  });
  await send({
    account,
    address: machine,
    abi,
    functionName: "configure",
    args: [0, "Local chain care kit", parseEther("2"), true],
  });
  await page.route(
    "https://ethereum-sepolia-rpc.publicnode.com/**",
    async (route) => {
      const r = await route.fetch({ url: rpc });
      await route.fulfill({
        response: r,
        headers: { ...r.headers(), "access-control-allow-origin": "*" },
      });
    },
  );
  await page.addInitScript(
    ({ account, machine }) => {
      localStorage.setItem(
        "ksj-shop-config",
        JSON.stringify({
          contract: machine,
          name: "Local chain test",
          bluetoothName: "KSJ-chain-test",
          channels: [3, 1, 4, 2],
          f0MeansOpen: true,
          encoding: "pdf",
        }),
      );
      Object.defineProperty(window, "ethereum", {
        value: {
          request: async ({ method, params }: any) => {
            if (method === "eth_requestAccounts" || method === "eth_accounts")
              return [account];
            if (method === "wallet_switchEthereumChain") return null;
            const r = await fetch(
              "https://ethereum-sepolia-rpc.publicnode.com/",
              {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                  jsonrpc: "2.0",
                  id: 1,
                  method,
                  params: params || [],
                }),
              },
            );
            const d = await r.json();
            if (d.error) throw d.error;
            return d.result;
          },
        },
      });
      const states = Array(12).fill(0x0f);
      (window as any).__unlocks = [];
      const rx = Object.assign(new EventTarget(), {
        value: undefined as DataView | undefined,
        startNotifications: async () => {},
      });
      const emit = (bytes: number[]) =>
        setTimeout(() => {
          rx.value = new DataView(Uint8Array.from(bytes).buffer);
          rx.dispatchEvent(new Event("characteristicvaluechanged"));
        }, 5);
      const tx = {
        properties: { write: true },
        writeValueWithResponse: async (bytes: Uint8Array) => {
          if (bytes[0] === 0x8e) emit([0xe8, 0xf0, 0, 0, 0, 0x8e]);
          if (bytes[0] === 0x66 && bytes[1] === 0xf0)
            emit([0x77, 2, 1, 80, 0x51, 0x48, 0x4c, 0x66]);
          if (bytes[0] === 0x66 && bytes[1] === 0xf1)
            emit([0x1e, ...states, 0x1b]);
          if (bytes[0] === 0xff) {
            (window as any).__unlocks.push(bytes[6]);
            states[bytes[6] - 1] = 0xf0;
            emit([0x1c, ...states, 0x1b]);
          }
        },
      };
      const device = Object.assign(new EventTarget(), {
        name: "KSJ-chain-test",
        gatt: {
          connected: true,
          connect: async () => ({
            getPrimaryService: async () => ({
              getCharacteristic: async (id: number) =>
                id === 0xffc1 ? tx : rx,
            }),
          }),
          disconnect: () => {},
        },
      });
      Object.defineProperty(navigator, "bluetooth", {
        value: { requestDevice: async () => device },
        configurable: true,
      });
    },
    { account, machine },
  );
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Local chain care kit", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Choose", exact: true })
    .first()
    .click();
  await page.getByRole("button", { name: "Connect this machine" }).click();
  await page
    .getByLabel("I’m beside this machine and can collect this item now.")
    .check();
  await page.getByRole("button", { name: "Pay 2 TEST", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Open my compartment" }),
  ).toBeVisible({ timeout: 60000 });
  expect(await page.evaluate(() => (window as any).__unlocks)).toEqual([]);
  expect(
    await p.readContract({
      address: token,
      abi: tokenAbi,
      functionName: "balanceOf",
      args: [account],
    }),
  ).toBe(parseEther("98"));
  await page.getByRole("button", { name: "Open my compartment" }).click();
  await expect(
    page.getByRole("button", { name: "I collected my item" }),
  ).toBeVisible();
  expect(await page.evaluate(() => (window as any).__unlocks)).toEqual([3]);
  await page.getByRole("button", { name: "I collected my item" }).click();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Open my compartment" }),
  ).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__unlocks)).toEqual([]);
  expect(
    (
      await p.readContract({ address: machine, abi, functionName: "getSlots" })
    )[0].available,
  ).toBe(false);
});
