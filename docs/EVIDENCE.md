# Hardware evidence and boundaries

Verified October 3, 2026 (Tokyo).

## Actual purchased cabinet

The exact [Alibaba listing](https://www.alibaba.com/product-detail/Mini-Hotel-Room-Personal-Care-Vending_1601194835816.html), inspected in Chrome, identifies **KSJ-4 grid machine**, Innergroove **Four**, Bluetooth reading mode, and a 5V field. Its photograph shows one tall left compartment and three stacked right compartments. The prior 12-door cabinet assumption was incorrect. Twelve is the capacity described by the supplied controller protocol, not the physical cabinet count.

On October 3, 2026, the owner confirmed that the delivered unit runs only on batteries and has no external power supply. This direct observation takes precedence over the listing’s ambiguous 5V field for setup instructions. Battery type, quantity or pack specification, polarity, rechargeability, switch/wake procedure, firmware, and channel wiring remain unconfirmed; use the unit’s markings or seller documentation for these details.

The same manufacturer's [Hotel Four-Bay Vending Machine page](https://www.oemsmartlock.com/hotel-room-vending-machine/62302630.html) describes scan, select, pay, then opening the matching compartment. It is a product description, not a setup manual. Searches for KSJ-4, KSJ 4 grid, and the manufacturer in English/Chinese did not locate a model-specific downloadable manual or a public firmware/channel map.

## New implementation

Fresh `communetxyz/ksj-vend-app` frontend repository, actual Decentral Park UI kit. Four A-D positions are separate from configurable controller channels. The root is the customer shop; `?operator=1` opens field diagnostics; `setup-guide.html` is a standalone 24-step slideshow.

The new `KSJVendV2` version is in `communetxyz/mutual-vend-sc` under `src/ksj`. No old deployment is used. Sepolia wallet deployment is initiated explicitly by the operator through their wallet. The app never requests wallet seeds or private keys. Test-token and machine bytecode are bundled for that deployment.

A compartment becomes unavailable after one paid purchase, until the operator restocks. Approval, confirmed purchase, controller-open feedback and physical collection are separate states. Purchases need the expected on-chain event for the exact contract, buyer, compartment and amount. Receipts are persisted and interrupted openings require inspection. No automatic unlock retry.

## Deployment limitations

This is a supervised Sepolia pilot. The supplied BLE handshake is shared and the board does not verify a purchase receipt. Browser-side payment gating and local journals do not provide tamper-proof authorization or global replay protection. Unattended commercial sales need a trusted controller or purchase-bound firmware protocol, plus physical validation. No production-payment deployment or real-hardware test has occurred here.

The full wallet + direct-Bluetooth test uses desktop Chrome with an injected wallet extension. Android Chrome can perform Bluetooth diagnostics; the combined checkout is not supported there without a wallet connection integration. iPhone browsers cannot use this direct Web Bluetooth path.

## Supplied controller documents and APK findings

Input: `base.apk.1`, approximately 14 MB, extracted locally only. No vendor source/assets are republished. Its manifest identifies `东莞KSJ蓝牙工具` (Dongguan KSJ Bluetooth Tool), version 1.0.0, `__UNI__883A608`; bundled asset dates are 2024-09-26. It is a Uni-app/Vue app with three routes: login, Bluetooth search, and device control. Static inspection is evidence of implemented paths, not a successful live vendor session.

The app exposes vendor login (`/push/index/login`), discovery/filtering, connection/disconnection, manual and automatic handshake, device information/battery, twelve individual door buttons, USB on/off and a clearable raw log. An all-open button is disabled. A new-name input is read-only. A QR helper and an uncalled `/index/getcmd` helper exist, but no active rename/provisioning action was found. Do not infer working SaaS management or customer checkout from this service-tool APK. Vendor credentials are not stored, printed in the deliverables, or embedded in the application. The replacement's direct BLE controls do not require vendor login.

## Interoperability details

* KSJ: service FFC0, write FFC1, notify/read FFC2 (full Bluetooth base UUID). These are visible in the PDF photograph and APK.
* Legacy fallback: FFF0, write FFF2, notify/read FFF1 (APK). Actual availability depends on the board.
* Handshake: 18 bytes beginning `8E FB 06 17` and ending `66 5B 4F E8`. The PDF prose is garbled; the photographed characteristic and APK agree. Expected positive reply in the photograph: `E8 F0 00 00 00 8E`. The app requires the six-byte framed reply with positive `F0`; write success alone never authenticates. Unknown firmware replies fail closed for diagnosis.
* Door command: `FF 4F 50 45 4E 00 NN FF FF FE`. PDF specifies numeric 1–12 (01–0C). APK uses 01–09, then 10, 11, 12 **hex**. This is a real disagreement. The default is PDF; choose APK only as an explicit alternative after a physical check. No all-door command is exposed.
* Query device: `66 F0 FF 77`. Valid device reply is 8 bytes: `77 version batteryFlag percentage 51 48 4C 66`. Battery 0% is preserved. A non-battery flag is reported as unexpected controller data, not evidence of an external supply on this battery-only unit.
* Query doors: `66 F1 FF 77`. Lock-state frames are 14 bytes, 1C/1D/1E header, 12 F0/0F states, 1B trailer. All three are parsed, including fragmented/coalesced notifications. Default sensor interpretation is F0=open, 0F=closed, with an explicitly labeled invert setting for physical verification.
* USB: APK sends `88 F0 01 88` for on and `88 F0 00 88` for off. The PDF's last-page image instead lists 09, 0A, and 20+hours without complete framing. Only the fully observed APK commands are exposed as optional diagnostics for a confirmed output port; timed USB is not implemented. These commands do not establish that this unit has USB output or that its batteries can be charged. USB state cannot be positively confirmed from the supplied evidence, so the app reports “written; check physically.”
* Before unlocking, the app requests fresh door status and requires that door closed. After one write it awaits a matching open-state report. An unrelated door report is not success. Disconnect invalidates all displayed door states. A timeout never automatically resends an unlock.
