import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
test("production customer app and all 24 slideshow steps fit and work offline", async ({
  page,
  context,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Something you need. Within reach." }),
  ).toBeVisible();
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await page.screenshot({
    path: `test-results/${info.project.name}-shop-production.png`,
    fullPage: true,
  });
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator(".shop-door")).toHaveCount(4);
  await page.goto("/setup-guide.html");
  for (let i = 0; i < 24; i++) {
    await page.getByLabel("Jump to step").selectOption(String(i));
    await expect(page.locator(".slide:not([hidden])")).toHaveCount(1);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth,
      ),
    ).toBe(false);
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    if ([0, 3, 10, 15, 23].includes(i))
      await page.screenshot({
        path: `test-results/${info.project.name}-slide-${i + 1}.png`,
        fullPage: true,
      });
  }
  await page.getByLabel("Jump to step").selectOption("6");
  await page
    .getByPlaceholder("Copy the exact name from the app")
    .fill("KSJ-notes-offline");
  await page.reload();
  await expect(
    page.getByPlaceholder("Copy the exact name from the app"),
  ).toHaveValue("KSJ-notes-offline");
  expect(errors).toEqual([]);
});
