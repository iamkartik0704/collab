import { expect, test } from "@playwright/test";
import { storageStateFor } from "./global-setup";

test.use({ storageState: storageStateFor("admin") });

test("dashboard shows KPIs, charts and latest orders from the seeded history", async ({ page }) => {
  await page.goto("/admin?range=30d");
  await expect(page.getByRole("heading", { name: "Executive dashboard" })).toBeVisible();
  for (const label of ["Gross revenue", "Net revenue", "Orders", "Average order value"]) {
    await expect(page.getByText(label, { exact: true }).first()).toBeVisible();
  }
  // Seeded demo orders: revenue is not zero.
  const gross = page.getByText("Gross revenue", { exact: true }).first().locator("xpath=following-sibling::p[1]");
  await expect(gross).not.toHaveText("₹0");
  await expect(page.getByRole("heading", { name: "Revenue", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Latest orders" })).toBeVisible();

  await page.getByRole("link", { name: "90 days" }).click();
  await expect(page).toHaveURL(/range=90d/);
});
