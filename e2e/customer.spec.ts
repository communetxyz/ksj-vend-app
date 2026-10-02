import { test, expect } from "@playwright/test";
test("customer can choose, practice pay and collect from four-compartment shop", async ({
  page,
}, info) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Something you need. Within reach." }),
  ).toBeVisible();
  await expect(page.locator(".shop-door")).toHaveCount(4);
  await page
    .getByRole("button", { name: "Choose", exact: true })
    .first()
    .click();
  await page.getByRole("button", { name: "Connect practice machine" }).click();
  await expect(
    page.getByRole("button", { name: "Practice purchase", exact: true }),
  ).toBeDisabled();
  await page.getByLabel("I understand this is a practice purchase.").check();
  await page
    .getByRole("button", { name: "Practice purchase", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Open my compartment" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Open my compartment" }).click();
  await expect(
    page.getByText(
      "The controller reports OPEN. Take your item, then close the compartment.",
    ),
  ).toBeVisible();
  await page.getByRole("button", { name: "I collected my item" }).click();
  await expect(
    page.getByText("Collection confirmed. Thank you!"),
  ).toBeVisible();
  await expect(page.locator(".shop-product").first()).toContainText("Sold out");
  await page.screenshot({
    path: `test-results/${info.project.name}-customer.png`,
    fullPage: true,
  });
});
test("machine setup cannot save unverified channel mapping", async ({
  page,
}) => {
  await page.goto("/?setup=1");
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Save machine and open shop" }),
  ).toBeDisabled();
  await expect(page.getByLabel("Left · tall channel")).toHaveValue("1");
  await expect(page.getByLabel("Right · bottom channel")).toHaveValue("4");
});
test("slideshow navigation and notes survive reload", async ({ page }) => {
  await page.goto("/setup-guide.html");
  await expect(
    page.getByRole("heading", {
      name: "Set up your KSJ four-compartment machine",
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Next slide" }).click();
  await expect(
    page.getByRole("heading", { name: "Put these items on the table" }),
  ).toBeVisible();
  await page.getByLabel("Jump to step").selectOption("6");
  await page
    .getByPlaceholder("Copy the exact name from the app")
    .fill("KSJ-physical-test");
  await page.reload();
  await expect(
    page.getByPlaceholder("Copy the exact name from the app"),
  ).toHaveValue("KSJ-physical-test");
  await page.getByLabel("Jump to step").selectOption("23");
  await expect(
    page.getByRole("heading", { name: "Documentation and seller request" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Next slide" })).toBeDisabled();
});
