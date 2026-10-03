# Validation scope

The original 35 BLE/controller/storage tests were retained. New tests cover four-channel config validation, exact receipt matching, persisted-order recovery, customer preview checkout, setup gating, and slideshow navigation/notes. Contract tests cover single-sale inventory, stale-price rejection, owner-only restocking/refunds, failed transfers, and all four positions.

A local Anvil + mocked-Bluetooth browser test validates the payment-to-command path without a personal wallet. Production checks validate offline loading, accessibility and layouts. See CI for current results.

Owner-confirmed: the delivered unit is battery-powered only, with no external supply. Not established: battery type/count or pack specification, rechargeability, wake procedure, BLE compatibility, actual lock movements, sensor polarity, controller channel mapping, live Sepolia deployment or an actual paid physical pickup. The slideshow explicitly requires these physical checks.
