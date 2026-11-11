import { expect, test } from "@playwright/test";
import { storageStateFor } from "./global-setup";

test.use({ storageState: storageStateFor("admin") });
test.describe.configure({ mode: "serial" });

const code = `E2E${Date.now().toString(36).toUpperCase()}`;

test("create, edit and delete a coupon", async ({ page }) => {
  await page.goto("/admin/coupons");
  await page.getByRole("button", { name: "New coupon" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Code").fill(code);
  await dialog.getByLabel("Description").fill("End-to-end test coupon");
  await dialog.getByLabel("Percent off").fill("12.5");
  await dialog.getByLabel("Maximum discount (₹)").fill("1500");
  await dialog.getByLabel("Minimum cart value (₹)").fill("5000");
  await dialog.getByRole("button", { name: "Create coupon" }).click();
  await expect(dialog).toBeHidden();

  const row = page.locator("tbody tr").filter({ hasText: code });
  await expect(row).toContainText("12.5% off (max ₹1,500)");
  await expect(row).toContainText("Active");

  await row.getByRole("button", { name: `Edit ${code}` }).click();
  await dialog.getByRole("radio", { name: "Flat amount" }).click();
  await dialog.getByLabel("Amount off (₹)").fill("750");
  await dialog.getByRole("button", { name: "Save coupon" }).click();
  await expect(dialog).toBeHidden();
  await expect(row).toContainText("₹750 off");

  page.once("dialog", (confirm) => void confirm.accept());
  await row.getByRole("button", { name: `Delete ${code}` }).click();
  await expect(page.getByRole("status")).toContainText(`Deleted ${code}`);
  await expect(row).toHaveCount(0);
});

test("invalid coupons are rejected with field errors", async ({ page }) => {
  await page.goto("/admin/coupons");
  await page.getByRole("button", { name: "New coupon" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Code").fill("x");
  await dialog.getByRole("button", { name: "Create coupon" }).click();
  await expect(dialog.getByRole("alert").first()).toContainText("Code");
});

test("audit log records the coupon lifecycle with a field diff", async ({ page }) => {
  await page.goto("/admin/audit-log?entityType=Coupon");
  await expect(page.getByRole("heading", { name: "Audit log" })).toBeVisible();
  const entries = page.locator("tbody tr").filter({ hasText: "Coupon" });
  await expect(entries.filter({ hasText: "Delete" }).first()).toBeVisible();
  const change = entries.filter({ hasText: "Coupon change" }).first();
  await change.getByRole("button", { name: "Show changes" }).click();
  await expect(page.getByRole("cell", { name: "discountType" }).first()).toBeVisible();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export CSV" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^audit-log-\d{4}-\d{2}-\d{2}\.csv$/);
});
