import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Button, Logo } from "@decentralpark/ui";
import {
  ArrowUpRight,
  ArrowLeft,
  Check,
  Bluetooth,
  Wallet,
  Package,
  ShoppingBag,
  Leaf,
  ChevronRight,
  RefreshCw,
  Download,
} from "lucide-react";
import { formatUnits, parseUnits, type Address } from "viem";
import {
  abi,
  tokenAbi,
  client,
  wallet,
  catalog,
  getConfig,
  saveConfig,
  shareUrl,
  positions,
  recordOrder,
  restoreOrder,
  verifyPayment,
  RevertedPayment,
  RefundedPayment,
  configSchema,
  type ShopConfig,
  type Product,
  type ReceiptOrder,
} from "./checkout";
import { MachineController } from "./controller";
import { WebBluetoothTransport, SimulatedTransport } from "./transport";
import { download } from "./storage";
import "./shop.css";
const ctrl = new MachineController();
const examples: Product[] = [
  { name: "Toothbrush kit", price: 2n * 10n ** 18n, available: true },
  { name: "Earplugs", price: 1n * 10n ** 18n, available: true },
  { name: "Period care", price: 2n * 10n ** 18n, available: true },
  { name: "Tissues", price: 1n * 10n ** 18n, available: true },
];
const explain = (e: unknown) => (e instanceof Error ? e.message : String(e));
export default function Shop() {
  const [configError, setConfigError] = useState("");
  const [config, setConfig] = useState<ShopConfig | null>(() => {
    try {
      return getConfig();
    } catch {
      return null;
    }
  });
  const [demo, setDemo] = useState(!config);
  const [items, setItems] = useState<Product[]>(config ? [] : examples);
  const [token, setToken] = useState<Address>();
  const [decimals, setDecimals] = useState(18);
  const [symbol, setSymbol] = useState("TEST");
  const [account, setAccount] = useState<Address>();
  const [selected, setSelected] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [stage, setStage] = useState("");
  const [setup, setSetup] = useState(
    new URLSearchParams(location.search).has("setup"),
  );
  const [order, setOrder] = useState<ReceiptOrder | null>(() => {
    try {
      return restoreOrder();
    } catch {
      return null;
    }
  });
  const [practiceStage, setPracticeStage] = useState("");
  const [checked, setChecked] = useState(false);
  const snap = useSyncExternalStore(
    ctrl.subscribe,
    ctrl.getSnapshot,
    ctrl.getSnapshot,
  );
  const ready = snap.status === "ready";
  useEffect(() => {
    try {
      getConfig();
    } catch (e) {
      setConfigError("Machine link is invalid. " + explain(e));
    }
  }, []);
  useEffect(() => {
    if (config && !demo) void refresh();
    return () => ctrl.disconnect();
  }, [config, demo]);
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => {
      if (lock.current || snap.busy) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [snap.busy]);
  async function action(fn: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(explain(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function refresh() {
    if (!config) return;
    try {
      const c = await catalog(config);
      setItems(c.slots);
      setToken(c.token);
      setDecimals(c.decimals);
      setSymbol(c.symbol);
    } catch (e) {
      setItems([]);
      setError(explain(e));
    }
  }
  function store(o: ReceiptOrder) {
    recordOrder(o);
    setOrder(o);
  }
  async function connect() {
    await action(async () => {
      await ctrl.connect(
        demo
          ? new SimulatedTransport()
          : new WebBluetoothTransport(true, config!.bluetoothName),
        config?.f0MeansOpen ?? true,
      );
      setMessage(
        demo
          ? "Practice machine connected. No real door can open."
          : "Machine connected. Choose a product to continue.",
      );
    });
  }
  async function connectWallet() {
    await action(async () => {
      const { account: a } = await wallet();
      setAccount(a);
    });
  }
  async function purchase() {
    if (selected === null || !ready || !checked || (!demo && !config) || busy)
      return;
    const slot = selected;
    const item = items[slot];
    await action(async () => {
      if (demo) {
        setPracticeStage("paid");
        setMessage("Practice payment complete. No wallet or money was used.");
        return;
      }
      if (!config || !token)
        throw new Error("Machine configuration is missing.");
      if (order && !["collected", "reverted", "refunded"].includes(order.phase))
        throw new Error("Resolve the existing purchase before paying again.");
      // Verify hardware is ready before any payment prompt; connection can still fail later.
      await ctrl.refresh();
      const channel = config.channels[slot];
      if (ctrl.getSnapshot().doors[channel - 1] !== "closed")
        throw new Error(
          "This compartment is not confirmed closed. Ask the operator to check it.",
        );
      const { w, account: a } = await wallet();
      setAccount(a);
      const c = await catalog(config);
      const current = c.slots[slot];
      if (!current.available || current.price !== item.price)
        throw new Error(
          "Availability or price changed. Refresh the shop before paying.",
        );
      if (
        (await client.readContract({
          address: token,
          abi: tokenAbi,
          functionName: "balanceOf",
          args: [a],
        })) < item.price
      )
        throw new Error(
          "Not enough test tokens. In Machine setup, use Get test credits.",
        );
      // Probe persistent storage before asking the wallet to submit payment.
      localStorage.setItem("ksj-storage-check", "ok");
      const allowance = await client.readContract({
        address: token,
        abi: tokenAbi,
        functionName: "allowance",
        args: [a, config.contract as Address],
      });
      if (allowance < item.price) {
        setStage("Approve the exact token amount in your wallet");
        const hash = await w.writeContract({
          account: a,
          address: token,
          abi: tokenAbi,
          functionName: "approve",
          args: [config.contract as Address, item.price],
        });
        const receipt = await client.waitForTransactionReceipt({
          hash,
          timeout: 180000,
        });
        if (receipt.status !== "success")
          throw new Error("Token approval reverted.");
      }
      if (ctrl.getSnapshot().status !== "ready")
        throw new Error(
          "Machine disconnected before payment. Reconnect first.",
        );
      await ctrl.refresh();
      if (ctrl.getSnapshot().doors[channel - 1] !== "closed")
        throw new Error(
          "Compartment is no longer closed. No purchase was sent.",
        );
      setStage("Confirm purchase in your wallet");
      const simulation = await client.simulateContract({
        account: a,
        address: config.contract as Address,
        abi,
        functionName: "purchase",
        args: [slot, item.price],
      });
      const hash = await w.writeContract(simulation.request);
      const pending: ReceiptOrder = {
        hash,
        buyer: a,
        contract: config.contract as Address,
        slot,
        product: item.name,
        price: item.price.toString(),
        phase: "submitted",
      };
      setOrder(pending);
      recordOrder(pending);
      setStage("Waiting for two Sepolia confirmations");
      const paid = await checkPayment(pending);
      store(paid);
      setStage("");
      setMessage("Payment confirmed. Your compartment has not opened yet.");
      await refresh();
    });
  }
  async function checkPayment(current: ReceiptOrder) {
    try {
      const paid = await verifyPayment(current);
      store(
        ["unknown", "opening", "opened"].includes(current.phase)
          ? { ...paid, phase: current.phase }
          : paid,
      );
      return paid;
    } catch (e) {
      if (e instanceof RevertedPayment)
        store({ ...current, phase: "reverted", note: e.message });
      if (e instanceof RefundedPayment)
        store({ ...current, phase: "refunded", note: e.message });
      throw e;
    }
  }
  async function openPaid() {
    await action(async () => {
      if (demo) {
        if (practiceStage !== "paid" || selected === null) return;
        await ctrl.open(selected + 1, "pdf");
        setPracticeStage("opened");
        return;
      }
      if (
        !order ||
        !config ||
        order.phase !== "paid" ||
        order.contract.toLowerCase() !== config.contract.toLowerCase()
      )
        throw new Error("No matching paid order is ready to open.");
      const paid = await verifyPayment(order);
      store({ ...paid, phase: "opening" });
      try {
        await ctrl.open(config.channels[order.slot], config.encoding);
        store({ ...paid, phase: "opened" });
      } catch (e) {
        store({ ...paid, phase: "unknown", note: explain(e) });
        throw new Error(
          "Payment is recorded, but pickup is uncertain. Do not pay again. Ask the operator to inspect the compartment.",
        );
      }
    });
  }
  const active =
    order &&
    !["collected", "reverted", "refunded"].includes(order.phase) &&
    !demo;
  const currentIndex = active ? order.slot : selected;
  const current = currentIndex !== null ? items[currentIndex] : null;
  return (
    <div className="shop-shell">
      <header className="shop-header">
        <a className="shop-brand" href="./">
          <Logo size={38} color="pine" />
          <span>
            mutual vend<span className="brand-dot">.</span>
          </span>
        </a>
        <nav aria-label="Shop navigation">
          <a href="./setup-guide.html">
            Setup guide <ArrowUpRight size={15} />
          </a>
          <button onClick={() => setSetup(true)}>Machine setup</button>
          <button
            className="wallet-button"
            disabled={busy}
            onClick={connectWallet}
          >
            <Wallet size={17} />
            {account
              ? `${account.slice(0, 6)}…${account.slice(-4)}`
              : "Connect wallet"}
          </button>
        </nav>
      </header>
      <main className="shop-main">
        <div className="pilot-line">
          <span>
            {demo ? "PREVIEW · NO PAYMENT" : "SEPOLIA PILOT · TEST TOKENS ONLY"}
          </span>
          <span>KSJ · 4 compartments</span>
        </div>
        <section className="shop-hero">
          <div>
            <p className="shop-eyebrow">A LITTLE HELP, RIGHT HERE</p>
            <h1>
              Something you need.
              <br />
              <em>Within reach.</em>
            </h1>
            <p className="shop-intro">
              Pick an essential. Pay with your wallet. Open its compartment and
              take your item.
            </p>
            <div className="shop-steps">
              <span>01 Choose</span>
              <ChevronRight size={15} />
              <span>02 Pay</span>
              <ChevronRight size={15} />
              <span>03 Collect</span>
            </div>
          </div>
          <div
            className="shop-cabinet"
            aria-label="Four-compartment cabinet: left tall, top right, middle right, bottom right"
          >
            {(items.length === 4 ? items : examples).map((item, i) => (
              <button
                key={i}
                className={`shop-door door-${i} ${currentIndex === i ? "selected" : ""}`}
                disabled={(!demo && !items.length) || busy || !!active}
                onClick={() => {
                  setSelected(i);
                  setPracticeStage("");
                }}
              >
                <span className="compartment-label">
                  {String.fromCharCode(65 + i)}
                  <small>{positions[i]}</small>
                </span>
                <Package size={i === 0 ? 49 : 25} />
                <strong>{item.name || "Not stocked"}</strong>
              </button>
            ))}
          </div>
        </section>
        {(configError || error) && (
          <div role="alert" className="shop-alert">
            {configError || error}
          </div>
        )}
        {message && (
          <div role="status" className="shop-message">
            {message}
          </div>
        )}
        <section className="shop-products">
          <div className="shop-section-title">
            <h2>{demo ? "Explore the customer flow" : "In this machine"}</h2>
            <span>
              {demo ? "Sample products · practice only" : config?.name}
            </span>
            {!demo && (
              <button
                onClick={() => void refresh()}
                aria-label="Refresh products"
              >
                <RefreshCw size={18} />
              </button>
            )}
          </div>
          {demo && (
            <p className="shop-help">
              The machine is not configured yet. Try the full purchase flow here
              without a wallet, or open Machine setup to connect a
              four-compartment contract.
            </p>
          )}
          {!demo && items.length === 0 && (
            <p className="shop-help">
              Reading the machine’s on-chain catalog… If it cannot load,
              checkout stays unavailable.
            </p>
          )}
          <div className="product-grid-four">
            {items.map((p, i) => (
              <article key={i} className="shop-product">
                <div className={`product-art art-${i}`}>
                  <Package size={44} />
                  <span>{String.fromCharCode(65 + i)}</span>
                </div>
                <div className="product-meta">
                  <span>{positions[i]}</span>
                  <span>{p.available ? "Available" : "Sold out"}</span>
                </div>
                <h3>{p.name || "Not stocked"}</h3>
                <div className="product-bottom">
                  <strong>
                    {formatUnits(p.price, decimals)} <small>{symbol}</small>
                  </strong>
                  <Button
                    size="sm"
                    disabled={!p.available || busy || !!active}
                    onClick={() => {
                      setSelected(i);
                      setPracticeStage("");
                      setChecked(false);
                    }}
                  >
                    Choose <ArrowUpRight size={16} />
                  </Button>
                </div>
              </article>
            ))}
          </div>
        </section>
        {(selected !== null || active) && (
          <section className="checkout-panel" aria-labelledby="checkout-title">
            <div>
              <p className="shop-eyebrow">YOUR PICKUP</p>
              <h2 id="checkout-title">
                {active ? order.product : current?.name}
              </h2>
              <p>
                {positions[currentIndex ?? 0]} · Compartment{" "}
                {String.fromCharCode(65 + (currentIndex ?? 0))}
              </p>
            </div>
            <div className="checkout-actions">
              <ol className="checkout-progress">
                <li>{ready ? "✓" : "1"} Machine connected</li>
                <li>
                  {(active &&
                    ["paid", "opening", "opened", "unknown"].includes(
                      order.phase,
                    )) ||
                  practiceStage
                    ? "✓"
                    : "2"}{" "}
                  Payment confirmed
                </li>
                <li>
                  {(active && order.phase === "opened") ||
                  practiceStage === "opened"
                    ? "✓"
                    : "3"}{" "}
                  Compartment opened
                </li>
              </ol>
              {!ready && (
                <Button disabled={busy} onClick={connect}>
                  <Bluetooth size={18} />
                  {demo ? "Connect practice machine" : "Connect this machine"}
                </Button>
              )}
              {ready && !active && !practiceStage && (
                <>
                  <label className="checkbox-line">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => setChecked(e.target.checked)}
                    />
                    {demo
                      ? "I understand this is a practice purchase."
                      : "I’m beside this machine and can collect this item now."}
                  </label>
                  <Button
                    disabled={busy || !checked || !current?.available}
                    onClick={purchase}
                  >
                    <ShoppingBag size={18} />
                    {busy
                      ? stage || "Working…"
                      : demo
                        ? "Practice purchase"
                        : `Pay ${formatUnits(current?.price ?? 0n, decimals)} ${symbol}`}
                  </Button>
                  <p className="shop-help">
                    {demo
                      ? "No transaction is sent."
                      : "Your wallet may ask for token approval, then a separate purchase. Network gas is additional. This supervised pilot uses Sepolia only."}
                  </p>
                </>
              )}
              {active && order.phase === "submitted" && (
                <>
                  <p>
                    Payment is pending or its result needs checking. Do not pay
                    again.
                  </p>
                  <Button
                    disabled={busy}
                    onClick={() =>
                      action(async () => {
                        await checkPayment(order);
                        setStage("");
                      })
                    }
                  >
                    Check payment
                  </Button>
                </>
              )}
              {((active && order.phase === "paid") ||
                practiceStage === "paid") && (
                <>
                  <p>
                    Payment confirmed. Open the compartment when you’re ready.
                  </p>
                  <Button disabled={!ready || busy} onClick={openPaid}>
                    Open my compartment
                  </Button>
                </>
              )}
              {((active && order.phase === "opened") ||
                practiceStage === "opened") && (
                <>
                  <p>
                    The controller reports OPEN. Take your item, then close the
                    compartment.
                  </p>
                  <Button
                    disabled={busy}
                    onClick={() => {
                      if (demo) {
                        setPracticeStage("done");
                        setItems((a) =>
                          a.map((p, i) =>
                            i === selected ? { ...p, available: false } : p,
                          ),
                        );
                      } else if (order) store({ ...order, phase: "collected" });
                      setSelected(null);
                      setMessage("Collection confirmed. Thank you!");
                    }}
                  >
                    I collected my item <Check size={17} />
                  </Button>
                </>
              )}
              {active && ["unknown", "opening"].includes(order.phase) && (
                <div role="alert">
                  <strong>Pickup needs operator help</strong>
                  <p>
                    Your payment is recorded. Do not pay again or repeat the
                    unlock. Show the operator this receipt.
                  </p>
                </div>
              )}
              {active && (
                <>
                  <button
                    disabled={busy}
                    className="text-button"
                    onClick={() =>
                      action(async () => {
                        await checkPayment(order);
                      })
                    }
                  >
                    Check receipt status
                  </button>
                  <a
                    target="_blank"
                    rel="noreferrer"
                    href={`https://sepolia.etherscan.io/tx/${order.hash}`}
                  >
                    View payment receipt ↗
                  </a>
                  <button
                    className="text-button"
                    onClick={() =>
                      download(
                        "ksj-purchase-receipt.json",
                        JSON.stringify(order, null, 2),
                      )
                    }
                  >
                    <Download size={16} />
                    Save receipt
                  </button>
                </>
              )}
            </div>
          </section>
        )}
        <section className="shop-bottom">
          <Leaf size={28} />
          <p>
            Small essentials.
            <br />
            <strong>Shared infrastructure.</strong>
          </p>
          <a href="./?operator=1">
            Operator controls <ArrowUpRight size={17} />
          </a>
        </section>
      </main>
      <footer className="shop-footer">
        <span>Built with Decentral Park</span>
        <span>Physical pickup is confirmed separately from payment.</span>
        <a href="./setup-guide.html">Need help?</a>
      </footer>
      {setup && (
        <Setup
          config={config}
          onClose={() => setSetup(false)}
          onSave={(c) => {
            saveConfig(c);
            setConfig(c);
            setDemo(false);
            setSelected(null);
            setSetup(false);
            setConfigError("");
          }}
        />
      )}
    </div>
  );
}

function Setup({
  config,
  onSave,
  onClose,
}: {
  config: ShopConfig | null;
  onSave: (c: ShopConfig) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<ShopConfig>(
    config || {
      name: "KSJ four-compartment machine",
      contract: localStorage.getItem("ksj-setup-contract") || "",
      bluetoothName: "",
      channels: [1, 2, 3, 4],
      encoding: "pdf",
      f0MeansOpen: true,
    },
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [verified, setVerified] = useState(false);
  const [testToken, setTestToken] = useState(
    () => localStorage.getItem("ksj-setup-token") || "",
  );
  const [slot, setSlot] = useState(0);
  const [product, setProduct] = useState("Toothbrush kit");
  const [price, setPrice] = useState("2");
  const [loaded, setLoaded] = useState(false);
  const [refundId, setRefundId] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const mutex = useRef(false);
  useEffect(() => {
    dialog.current?.showModal();
    return () => dialog.current?.close();
  }, []);
  async function run(fn: () => Promise<void>) {
    if (mutex.current) return;
    mutex.current = true;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(explain(e));
    } finally {
      mutex.current = false;
      setBusy(false);
    }
  }
  async function deployToken() {
    await run(async () => {
      const artifact = await import("./contracts/KSJTestToken.json");
      const { w, account } = await wallet();
      setNotice(
        "Confirm creation of a free test-token contract in your wallet.",
      );
      const hash = await w.deployContract({
        account,
        abi: artifact.abi,
        bytecode: artifact.bytecode as `0x${string}`,
      });
      setNotice(`Deployment submitted: ${hash}`);
      const r = await client.waitForTransactionReceipt({
        hash,
        timeout: 180000,
      });
      if (r.status !== "success" || !r.contractAddress)
        throw new Error("Token deployment failed.");
      setTestToken(r.contractAddress);
      localStorage.setItem("ksj-setup-token", r.contractAddress);
      setNotice(
        "Test token created. Next, create the four-compartment contract.",
      );
    });
  }
  async function deployMachine() {
    await run(async () => {
      if (!/^0x[0-9a-fA-F]{40}$/.test(testToken))
        throw new Error("Create or enter the test token first.");
      const artifact = await import("./contracts/KSJVendV2.json");
      const { w, account } = await wallet();
      const hash = await w.deployContract({
        account,
        abi: artifact.abi,
        bytecode: artifact.bytecode as `0x${string}`,
        args: [testToken, account],
      });
      setNotice(`Deployment submitted: ${hash}`);
      const r = await client.waitForTransactionReceipt({
        hash,
        timeout: 180000,
      });
      if (r.status !== "success" || !r.contractAddress)
        throw new Error("Machine deployment failed.");
      setDraft((d) => ({ ...d, contract: r.contractAddress! }));
      localStorage.setItem("ksj-setup-contract", r.contractAddress);
      setNotice(
        "Machine contract created with four empty compartments. Stock each one below.",
      );
    });
  }
  async function credits() {
    await run(async () => {
      const token = config?.contract
        ? (await catalog(config)).token
        : testToken;
      if (!/^0x[0-9a-fA-F]{40}$/.test(token))
        throw new Error("Create or enter the test-token address first.");
      const { w, account } = await wallet();
      const hash = await w.writeContract({
        account,
        address: token as Address,
        abi: tokenAbi,
        functionName: "faucet",
      });
      const r = await client.waitForTransactionReceipt({
        hash,
        timeout: 180000,
      });
      if (r.status !== "success") throw new Error("Faucet failed.");
      setNotice("100 free TEST credits received. They have no monetary value.");
    });
  }
  async function stock() {
    await run(async () => {
      if (!loaded)
        throw new Error(
          "Put one item inside and close the compartment before stocking.",
        );
      const c = configSchema.parse(draft);
      const current = await catalog(c);
      const { w, account } = await wallet();
      if (current.owner.toLowerCase() !== account.toLowerCase())
        throw new Error(
          "Connect the wallet that created this machine contract.",
        );
      const amount = parseUnits(price, current.decimals);
      if (amount <= 0n) throw new Error("Enter a positive price.");
      const hash = await w.writeContract({
        account,
        address: c.contract as Address,
        abi,
        functionName: "configure",
        args: [slot, product, amount, true],
      });
      const r = await client.waitForTransactionReceipt({
        hash,
        timeout: 180000,
      });
      if (r.status !== "success") throw new Error("Stock update failed.");
      setLoaded(false);
      setNotice(
        `Compartment ${String.fromCharCode(65 + slot)} is available for one purchase. Repeat for the other stocked compartments.`,
      );
    });
  }
  return (
    <dialog
      className="shop-setup"
      ref={dialog}
      aria-labelledby="setup-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
    >
      <div className="shop-section-title">
        <h2 id="setup-title">Machine setup</h2>
        <button disabled={busy} onClick={onClose} aria-label="Close setup">
          ×
        </button>
      </div>
      <p>
        For the four-compartment KSJ.{" "}
        <a href="./setup-guide.html" target="_blank" rel="noreferrer">
          Follow the setup slideshow ↗
        </a>
      </p>
      <p className="shop-alert">
        Supervised Sepolia test only. The supplied BLE protocol has a shared
        handshake, not purchase-bound authorization. This is not ready for
        unattended sales with valuable stock.
      </p>
      {error && (
        <p className="shop-alert" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="shop-message" role="status">
          {notice}
        </p>
      )}
      <fieldset disabled={busy}>
        <label className="field">
          Machine name
          <input
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
        </label>
        <label className="field">
          Exact Bluetooth name
          <input
            placeholder="Record this during the empty-machine test"
            value={draft.bluetoothName}
            onChange={(e) =>
              setDraft({ ...draft, bluetoothName: e.target.value })
            }
          />
        </label>
        <p>
          Record which channel opens each position. These numbers are unverified
          until tested.
        </p>
        <div className="mapping-fields">
          {positions.map((p, i) => (
            <label className="field" key={p}>
              {p}
              <input
                aria-label={`${p} channel`}
                type="number"
                min="1"
                max="12"
                value={draft.channels[i]}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    channels: draft.channels.map((n, j) =>
                      j === i ? Number(e.target.value) : n,
                    ),
                  })
                }
              />
            </label>
          ))}
        </div>
        <label className="checkbox-line">
          <input
            type="checkbox"
            checked={draft.f0MeansOpen}
            onChange={(e) =>
              setDraft({ ...draft, f0MeansOpen: e.target.checked })
            }
          />
          F0 means OPEN (match physical sensor test)
        </label>
        <label className="field">
          Command profile
          <select
            value={draft.encoding}
            onChange={(e) =>
              setDraft({ ...draft, encoding: e.target.value as "pdf" | "apk" })
            }
          >
            <option value="pdf">PDF protocol</option>
            <option value="apk">APK protocol</option>
          </select>
        </label>
        <details>
          <summary>Create a fresh Sepolia test deployment</summary>
          <p>
            Use desktop Chrome with your wallet extension and Sepolia ETH for
            gas. These buttons request wallet approval; they do not use or store
            your private key.
          </p>
          <Button onClick={deployToken}>1. Create test token</Button>
          <label className="field">
            Test-token address
            <input
              value={testToken}
              onChange={(e) => setTestToken(e.target.value)}
            />
          </label>
          <Button onClick={deployMachine}>
            2. Create four-compartment contract
          </Button>
          <Button variant="light" onClick={credits}>
            3. Get test credits
          </Button>
        </details>
        <label className="field">
          KSJVendV2 contract address
          <input
            placeholder="0x…"
            value={draft.contract}
            onChange={(e) => setDraft({ ...draft, contract: e.target.value })}
          />
        </label>
        <details>
          <summary>Stock a compartment on-chain</summary>
          <label className="field">
            Compartment
            <select
              value={slot}
              onChange={(e) => setSlot(Number(e.target.value))}
            >
              {positions.map((p, i) => (
                <option value={i} key={p}>
                  {String.fromCharCode(65 + i)} · {p}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Product name
            <input
              maxLength={80}
              value={product}
              onChange={(e) => setProduct(e.target.value)}
            />
          </label>
          <label className="field">
            Price in token units
            <input
              inputMode="decimal"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
            />
          </label>
          <label className="checkbox-line">
            <input
              type="checkbox"
              checked={loaded}
              onChange={(e) => setLoaded(e.target.checked)}
            />
            I placed one item inside and closed the compartment.
          </label>
          <Button onClick={stock}>Make this item available</Button>
        </details>
        <details>
          <summary>Refund a failed pickup</summary>
          <p>
            Use the order ID in the saved receipt. A refund returns tokens to
            the buyer; it does not restock or open a compartment.
          </p>
          <label className="field">
            Order ID
            <input
              inputMode="numeric"
              value={refundId}
              onChange={(e) => setRefundId(e.target.value)}
            />
          </label>
          <Button
            onClick={() =>
              run(async () => {
                const c = configSchema.parse(draft);
                const { w, account } = await wallet();
                const hash = await w.writeContract({
                  account,
                  address: c.contract as Address,
                  abi,
                  functionName: "refund",
                  args: [BigInt(refundId)],
                });
                const r = await client.waitForTransactionReceipt({
                  hash,
                  timeout: 180000,
                });
                if (r.status !== "success") throw new Error("Refund reverted.");
                setNotice(
                  "Refund confirmed. Inspect the compartment before restocking.",
                );
              })
            }
          >
            Request refund in wallet
          </Button>
        </details>
        <label className="checkbox-line">
          <input
            type="checkbox"
            checked={verified}
            onChange={(e) => setVerified(e.target.checked)}
          />
          I physically checked all four channel mappings and sensor states.
        </label>
        <Button
          disabled={!verified}
          onClick={() =>
            run(async () => {
              const c = configSchema.parse(draft);
              await catalog(c);
              onSave(c);
            })
          }
        >
          Save machine and open shop
        </Button>
        {config && (
          <button
            className="text-button"
            onClick={() =>
              run(async () => {
                await navigator.clipboard.writeText(shareUrl(config));
                setNotice(
                  "Customer link copied. It includes public machine settings, not wallet secrets.",
                );
              })
            }
          >
            Copy customer link
          </button>
        )}
      </fieldset>
    </dialog>
  );
}
