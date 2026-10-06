import { test, expect } from "@playwright/test";
declare global {
  interface Window {
    batteryFixture: {
      percentage: number;
      flag: number;
      silent: boolean;
      writes: number[][];
    };
  }
}
test("practice: connection, door lifecycle, stock edit, collection, ledger and reload", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/?operator=1");
  await expect(
    page.getByRole("heading", { name: "Your machine, connected." }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Test door 1, unknown", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Try a simulation" }).click();
  await page.getByRole("button", { name: "Start practice session" }).click();
  await expect(page.getByText("✓ Handshake confirmed")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Test door 1, closed", exact: true }),
  ).toBeEnabled();
  await page.screenshot({
    path: `test-results/${testInfo.project.name}-machine.png`,
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Test door 1, closed", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Open door 1 once", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Test door 1, open", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close simulated doors" }).click();
  await expect(
    page.getByRole("button", { name: "Test door 1, closed", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Inventory", exact: true }).click();
  await page.getByRole("button", { name: "Edit stock" }).first().click();
  await page.getByLabel("Product name", { exact: true }).fill("Care kit");
  await page.getByLabel("Quantity inside").fill("4");
  await page.getByLabel("Reference price (USD)").fill("2.50");
  await page.getByRole("button", { name: "Save compartment" }).click();
  await expect(
    page.getByRole("heading", { name: "Care kit", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Collect", exact: true })
    .first()
    .click();
  await page
    .getByRole("button", { name: "Open door 1 once", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Inspect door 1" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "I took one item" }).click();
  await expect(page.getByText("4 recorded inside")).toBeVisible();
  await page.screenshot({
    path: `test-results/${testInfo.project.name}-inventory.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: "Activity", exact: true }).click();
  await expect(
    page.getByRole("cell", { name: "Care kit", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("collected", { exact: true })).toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export session" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toContain("mutual-vend-session");
  await page.getByRole("button", { name: "Field guide", exact: true }).click();
  await page.getByRole("checkbox").first().check();
  await expect(
    page.getByText("1 of 9 checks recorded for practice"),
  ).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Inventory", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Care kit", exact: true }),
  ).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(overflow).toBe(false);
  expect(errors).toEqual([]);
});
test("timeout stays uncertain and controls recover without duplicate open", async ({
  page,
}) => {
  await page.goto("/?operator=1");
  await page.getByRole("button", { name: "Try a simulation" }).click();
  await page.getByRole("button", { name: "Start practice session" }).click();
  await expect(page.getByText("✓ Handshake confirmed")).toBeVisible();
  await page.getByText("Device tools", { exact: false }).first().click();
  await page.getByLabel("Simulated failure").selectOption("timeout");
  await page.getByRole("button", { name: "Refresh status" }).click();
  await expect(page.getByRole("alert")).toContainText("result is unknown", {
    timeout: 10000,
  });
  await page.getByLabel("Simulated failure").selectOption("none");
  await page.getByRole("button", { name: "Refresh status" }).click();
  await expect(
    page.getByRole("button", { name: "Test door 1, closed", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Disconnect machine" }).click();
  await expect(
    page.getByRole("button", { name: "Test door 1, unknown", exact: true }),
  ).toBeDisabled();
});
test("settings reject wrong inputs and keep hardware changes disconnected", async ({
  page,
}) => {
  await page.goto("/?operator=1");
  await page.getByRole("button", { name: "Machine settings" }).click();
  await page.getByLabel("Machine name", { exact: true }).fill("Hotel bench");
  await page.getByLabel("Door command profile").selectOption("apk");
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByText("APK command profile")).toBeVisible();
  await page.getByRole("button", { name: "Inventory", exact: true }).click();
  await page.getByRole("button", { name: "Edit stock" }).first().click();
  await page.getByLabel("Quantity inside").fill("-1");
  await page.getByRole("button", { name: "Save compartment" }).click();
  await expect(page.getByRole("alert")).toContainText("whole stock count");
});

test("mocked real Bluetooth: battery reads, arming, collection confirmation, and stock persistence", async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => {
    const battery = {
      percentage: 64,
      flag: 1,
      silent: false,
      writes: [] as number[][],
    };
    window.batteryFixture = battery;
    const states = Array(12).fill(0x0f);
    const rx = Object.assign(new EventTarget(), {
      value: undefined as DataView | undefined,
      startNotifications: async () => {},
    });
    const emit = (bytes: number[]) =>
      setTimeout(() => {
        rx.value = new DataView(Uint8Array.from(bytes).buffer);
        rx.dispatchEvent(new Event("characteristicvaluechanged"));
      }, 10);
    const tx = {
      properties: { write: true },
      writeValueWithResponse: async (bytes: Uint8Array) => {
        battery.writes.push([...bytes]);
        if (bytes[0] === 0x8e) emit([0xe8, 0xf0, 0, 0, 0, 0x8e]);
        if (bytes[0] === 0x66 && bytes[1] === 0xf0 && !battery.silent)
          emit([
            0x77,
            2,
            battery.flag,
            battery.percentage,
            0x51,
            0x48,
            0x4c,
            0x66,
          ]);
        if (bytes[0] === 0x66 && bytes[1] === 0xf1)
          emit([0x1e, ...states, 0x1b]);
        if (bytes[0] === 0xff) {
          states[bytes[6] - 1] = 0xf0;
          emit([0x1c, ...states, 0x1b]);
        }
      },
    };
    const service = {
      getCharacteristic: async (id: number) => (id === 0xffc1 ? tx : rx),
    };
    const device = Object.assign(new EventTarget(), {
      name: "KSJ-mocked-test",
      gatt: {
        connected: true,
        connect: async () => ({ getPrimaryService: async () => service }),
        disconnect: () => {},
      },
    });
    Object.defineProperty(navigator, "bluetooth", {
      value: { requestDevice: async () => device },
      configurable: true,
    });
  });
  await page.goto("/?operator=1");
  await expect(
    page.getByRole("button", { name: "Read battery level" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Inventory", exact: true }).click();
  await page.getByRole("button", { name: "Edit stock" }).first().click();
  await page.getByLabel("Product name", { exact: true }).fill("Test item");
  await page.getByLabel("Quantity inside").fill("2");
  await page.getByRole("button", { name: "Save compartment" }).click();
  await page.getByRole("button", { name: "Machine", exact: true }).click();
  await page
    .getByRole("button", { name: "Connect machine", exact: true })
    .click();
  await expect(page.getByText("✓ Handshake confirmed")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Test door 1, closed", exact: true }),
  ).toBeDisabled();
  await expect(page.getByTestId("battery-value")).toHaveText("64% reported");
  await page.evaluate(() => {
    window.batteryFixture.percentage = 0;
    window.batteryFixture.writes = [];
  });
  await page.getByRole("button", { name: "Read battery level" }).click();
  await expect(page.getByTestId("battery-value")).toHaveText("0% reported");
  expect(await page.evaluate(() => window.batteryFixture.writes)).toEqual([
    [0x66, 0xf0, 0xff, 0x77],
  ]);
  await expect(
    page.getByText("Battery reply at", { exact: false }),
  ).toBeVisible();
  await expect(page.getByLabel("I’m beside my machine")).not.toBeChecked();
  await page
    .locator(".connection-card")
    .screenshot({ path: `test-results/${testInfo.project.name}-battery.png` });
  await page.evaluate(() => {
    window.batteryFixture.silent = true;
  });
  await page.getByRole("button", { name: "Read battery level" }).click();
  await expect(
    page.getByRole("button", { name: "Reading battery…" }),
  ).toBeDisabled();
  await expect(page.getByTestId("battery-value")).toHaveText("Reading…");
  await expect(page.getByRole("alert")).toContainText(
    "Battery level unavailable",
    { timeout: 10000 },
  );
  await expect(page.getByTestId("battery-value")).toContainText("Unavailable");
  await expect(
    page.getByText("Battery reply at", { exact: false }),
  ).toHaveCount(0);
  await page.evaluate(() => {
    window.batteryFixture.silent = false;
    window.batteryFixture.flag = 0;
  });
  await page.getByRole("button", { name: "Read battery level" }).click();
  await expect(page.getByTestId("battery-value")).toHaveText(
    "Unavailable — unexpected controller power flag",
  );
  await page.evaluate(() => {
    window.batteryFixture.flag = 1;
    window.batteryFixture.percentage = 63;
  });
  await page.getByRole("button", { name: "Read battery level" }).click();
  await expect(page.getByTestId("battery-value")).toHaveText("63% reported");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    ),
  ).toBe(false);
  await page.getByLabel("I’m beside my machine").check();
  await expect(
    page.getByRole("button", { name: "Test door 1, closed", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Inventory", exact: true }).click();
  await page
    .getByRole("button", { name: "Collect", exact: true })
    .first()
    .click();
  await page
    .getByRole("button", { name: "Open door 1 once", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Inspect door 1" }),
  ).toBeVisible();
  await expect(page.getByText("2 recorded inside")).toBeVisible();
  await page.getByRole("button", { name: "I took one item" }).click();
  await expect(page.getByText("1 recorded inside")).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Inventory", exact: true }).click();
  await expect(page.getByText("1 recorded inside")).toBeVisible();
  await page.getByRole("button", { name: "Activity", exact: true }).click();
  await expect(page.getByText("collected", { exact: true })).toBeVisible();
});
