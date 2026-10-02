# KSJ Mutual Vend

Customer shop and operator setup for the **KSJ-4 grid machine**: one tall left compartment and three stacked right compartments. Fresh frontend repository; Decentral Park UI kit.

- [Live customer shop](https://communetxyz.github.io/ksj-vend-app/)
- [Step-by-step setup slideshow](https://communetxyz.github.io/ksj-vend-app/setup-guide.html)

Routes:

- Customer shop: `/`
- Operator diagnostics: `/?operator=1`
- Wallet/contract setup: `/?setup=1`
- HTML setup slideshow: `/setup-guide.html`

## Run

Node 22+:

```sh
npm ci
npm run dev
```

Open http://127.0.0.1:5184 in Chrome. `npm run build` emits static files in `dist/`. GitHub Pages publishes those files from `gh-pages`.

## First physical test

Follow the slideshow. Inspect the actual power label, leave the unit empty, establish handshake, verify sensor polarity, and record the four channel mappings. The generic PDF has twelve channels; the cabinet has four compartments. Do not infer wiring or power details from protocol capacity.

Use desktop Chrome with a wallet extension for the full flow. Create a free test token and four-compartment V2 contract through Machine setup, fund the wallet with Sepolia gas, stock one item on-chain, and share the generated customer link. The app uses real wallet requests; it does not have a preconfigured live machine deployment. The unconfigured root is an explicitly labeled preview.

## Checkout and security boundary

Sepolia only. Exact-amount ERC20 approval, two-confirmation purchase receipt verification, matching buyer/slot/amount/event, then one BLE unlock and separate collection confirmation. Payment success never claims delivery. A compartment sells once until restocked. Failed pickups can be refunded by the contract owner; retain contract funds for refunds.

This direct-Bluetooth pilot must remain supervised. The supplied protocol uses a shared handshake. A browser cannot enforce secure paid access or globally prevent replay against that controller. A trusted gateway or purchase-authorizing firmware is required before unattended valuable stock / real-money sales.

New contracts: https://github.com/communetxyz/mutual-vend-sc/tree/feat/ksj-four-compartment-v2/src/ksj

## Verify

```sh
npm test
npm run build
npm run test:e2e
npm run test:production
# Requires anvil in PATH; uses disposable local EVM accounts, never a personal wallet.
npm run test:chain
```

The last command tests actual contract deployment/payment on local Anvil plus a mocked GATT board. It does not prove physical compatibility. Source findings: [docs/EVIDENCE.md](docs/EVIDENCE.md).

No seller credentials, original APK/PDF or private wallet information is included.
