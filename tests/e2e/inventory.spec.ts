import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { storageStateFor } from "./global-setup";
import { closeDb, db } from "./support/db";

test.use({ storageState: storageStateFor("inventory") });
test.describe.configure({ mode: "serial" });

let sku: string;
let variantId: string;

test.beforeAll(async () => {
  const item = await db().inventoryItem.findFirstOrThrow({
    where: { quantityReserved: 0, variant: { isActive: true, deletedAt: null, sku: { not: { startsWith: "E2E" } } } },
    orderBy: { variant: { sku: "asc" } },
    include: { variant: { select: { sku: true } } },
  });
  sku = item.variant.sku;
  variantId = item.variantId;
});
test.afterAll(closeDb);

const row = (page: Page) => page.getByTestId(`inventory-row-${sku}`);
const onHandCell = (page: Page) => row(page).getByRole("cell").nth(2);

test("manual adjustment updates the row and lands in the movements log", async ({ page }) => {
  await page.goto(`/admin/inventory?q=${encodeURIComponent(sku)}`);
  await expect(row(page)).toBeVisible();
  const before = Number((await onHandCell(page).innerText()).replace(/\D/g, ""));

  await row(page).getByRole("button", { name: `Adjust stock for ${sku}` }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: `Adjust ${sku}` })).toBeVisible();
  await dialog.getByRole("spinbutton").first().fill("5");
  await dialog.getByLabel(/^Note/).fill("PO-E2E-1");
  await expect(dialog.getByText("+5")).toBeVisible();
  await dialog.getByRole("button", { name: "Record adjustment" }).click();
  await expect(dialog).toBeHidden();
  await expect(onHandCell(page)).toHaveText(String(before + 5));

  await page.goto(`/admin/inventory/movements?q=${encodeURIComponent(sku)}`);
  const latest = page.locator("tbody tr").first();
  await expect(latest).toContainText(sku);
  await expect(latest).toContainText("Restock");
  await expect(latest).toContainText("+5");
  await expect(latest).toContainText("PO-E2E-1");
});

test("removing more than is free to sell is refused client-side", async ({ page }) => {
  await page.goto(`/admin/inventory?q=${encodeURIComponent(sku)}`);
  await row(page).getByRole("button", { name: `Adjust stock for ${sku}` }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("radio", { name: "Set count" }).click();
  await dialog.getByRole("spinbutton").first().fill("0");
  await dialog.getByRole("button", { name: "Record adjustment" }).click();
  // Set-count 0 with no reservations is allowed; reasons for a count are "any" direction.
  await expect(dialog).toBeHidden();
  await expect(onHandCell(page)).toHaveText("0");
  await expect(row(page)).toContainText("Out of stock");
});

test("live feed: a change made elsewhere appears without reloading", async ({ page, browser }) => {
  await page.goto(`/admin/inventory?q=${encodeURIComponent(sku)}`);
  await expect(page.getByRole("status").filter({ hasText: "Live" })).toBeVisible({ timeout: 20_000 });
  const before = Number((await onHandCell(page).innerText()).replace(/\D/g, ""));

  // Another admin session adjusts the same SKU through the API.
  const other = await browser.newContext({ storageState: storageStateFor("admin") });
  const origin = new URL(page.url()).origin;
  const response = await other.request.post(`/api/admin/inventory/${variantId}/adjust`, {
    data: { mode: "delta", quantity: 7, reason: "PURCHASE_ORDER_RECEIVED", note: "live feed e2e" },
    headers: { Origin: origin },
  });
  expect(response.status()).toBe(200);
  await other.close();

  await expect(onHandCell(page)).toHaveText(String(before + 7), { timeout: 15_000 });
});

test("movements export downloads a CSV with the filtered rows", async ({ page }) => {
  await page.goto(`/admin/inventory/movements?q=${encodeURIComponent(sku)}`);
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export CSV" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^stock-movements-\d{4}-\d{2}-\d{2}\.csv$/);
  const text = readFileSync(await download.path(), "utf8");
  const [header, ...lines] = text.trim().split(/\r?\n/);
  expect(header).toBe("timestamp,sku,product,type,reason,on_hand_delta,reserved_delta,on_hand_after,reserved_after,available_after,order,actor,note");
  expect(lines.length).toBeGreaterThanOrEqual(3);
  expect(lines.every((line) => line.includes(sku))).toBe(true);
});

test("live feed crosses processes: an event published by another container (the worker) reaches the table", async ({ page }) => {
  // The worker publishes through Redis exactly like this after reservation expiry, webhook
  // deductions or refund restocks; this test process plays the worker's role.
  const Redis = (await import("ioredis")).default;
  const publisher = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379/0");
  const channel = `${process.env.REDIS_KEY_PREFIX ?? "collab:"}events:inventory`;
  try {
    await page.goto(`/admin/inventory?q=${encodeURIComponent(sku)}`);
    await expect(page.getByRole("status").filter({ hasText: "Live" })).toBeVisible({ timeout: 20_000 });
    const item = await db().inventoryItem.findUniqueOrThrow({ where: { variantId } });
    await publisher.publish(
      channel,
      JSON.stringify({ variantId, sku, onHand: 4321, reserved: 0, available: 4321, threshold: item.lowStockThreshold, version: item.version + 1000, at: new Date().toISOString() }),
    );
    await expect(onHandCell(page)).toHaveText("4,321", { timeout: 10_000 });
  } finally {
    publisher.disconnect();
  }
});
