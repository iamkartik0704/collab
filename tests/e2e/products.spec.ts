import { expect, test } from "@playwright/test";
import { storageStateFor } from "./global-setup";

test.use({ storageState: storageStateFor("inventory") });

test("SKU builder creates a product with a colour × storage matrix and keeps it on reload", async ({ page }) => {
  // Auto-SKUs use the first three characters of each word, so the random part comes first.
  const random = () => Math.random().toString(36).slice(2, 5).toUpperCase().padEnd(3, "X");
  const name = `E2E ${random()} ${random()} Phone`;
  await page.goto("/admin/products/new");
  await expect(page.getByRole("heading", { name: "New product" })).toBeVisible();

  await page.getByLabel("Product name").fill(name);
  await page.getByRole("combobox", { name: "Brand", exact: true }).selectOption({ index: 1 });
  await page.getByRole("combobox", { name: "Category", exact: true }).selectOption({ index: 1 });
  await page.getByLabel("Description", { exact: true }).fill("A phone created by the end-to-end test suite.");

  for (const colour of ["Graphite", "Silver"]) {
    await page.getByLabel("New colour name").fill(colour);
    await page.getByLabel("New colour name").press("Enter");
  }
  for (const storage of ["128", "256"]) {
    await page.getByRole("textbox", { name: "Storage" }).fill(storage);
    await page.getByRole("textbox", { name: "Storage" }).press("Enter");
  }
  await expect(page.getByText("4 SKUs generated")).toBeVisible();

  await page.getByLabel("Price for all variants").fill("49999");
  await page.getByRole("button", { name: "Apply to all" }).click();
  await page.getByLabel("Opening stock for new variants").fill("12");
  await page.getByRole("button", { name: "Set opening stock" }).click();

  await page.getByRole("button", { name: "Create product" }).click();
  await expect(page).toHaveURL(/\/admin\/products\/[^/]+\?created=1$/, { timeout: 20_000 });
  await expect(page.getByText("Product created.")).toBeVisible();

  // The saved matrix survives a full reload unchanged (regression: re-mount must not rebuild it).
  await page.reload();
  await expect(page.getByRole("heading", { name })).toBeVisible();
  await expect(page.getByText("4 SKUs generated")).toBeVisible();
  await expect(page.getByLabel("SKU")).toHaveCount(4);

  // Opening stock was recorded as a restock movement.
  await page.goto(`/admin/inventory?q=${encodeURIComponent(name)}`);
  await expect(page.locator("tbody tr")).toHaveCount(4);
  await expect(page.locator("tbody tr").first().getByRole("cell").nth(2)).toHaveText("12");
});
