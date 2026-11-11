import { expect, test } from "@playwright/test";
import { storageStateFor } from "./global-setup";
import { closeDb, createPaidOrder } from "./support/db";

test.describe.configure({ mode: "serial" });
test.afterAll(closeDb);

test.describe("fulfilment (inventory manager)", () => {
  test.use({ storageState: storageStateFor("inventory") });

  test("confirm → pack → ship with tracking → deliver", async ({ page }) => {
    const { orderNumber } = await createPaidOrder("fulfil");
    await page.goto(`/admin/orders?q=${orderNumber}`);
    await page.getByRole("link", { name: orderNumber }).click();
    await expect(page.getByRole("heading", { name: `Order ${orderNumber}` })).toBeVisible();

    await page.getByRole("button", { name: "Confirm order" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Confirm order" }).click();
    await expect(page.getByRole("button", { name: "Mark packed" })).toBeVisible();

    await page.getByRole("button", { name: "Mark packed" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Mark packed" }).click();

    await page.getByRole("button", { name: "Mark shipped" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Mark shipped" }).click();
    await expect(dialog.getByRole("alert")).toContainText(/carrier/i);
    await dialog.getByLabel("Carrier").fill("Delhivery");
    await dialog.getByLabel("Tracking number").fill("DL123456789");
    await dialog.getByLabel(/Tracking link/).fill("https://www.delhivery.com/track/package/DL123456789");
    await dialog.getByRole("button", { name: "Mark shipped" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText("DL123456789")).toBeVisible();

    await page.getByRole("button", { name: "Mark delivered" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Mark delivered" }).click();
    await expect(page.getByText("Delivered", { exact: true }).first()).toBeVisible();
    // Timeline records every step.
    for (const step of ["Confirmed", "Packed", "Shipped", "Delivered"]) {
      await expect(page.getByRole("listitem").filter({ hasText: step }).first()).toBeVisible();
    }
  });

  test("cannot issue refunds (super admin only)", async ({ page }) => {
    const { orderNumber } = await createPaidOrder("norefund");
    await page.goto(`/admin/orders/${orderNumber}`);
    await expect(page.getByRole("heading", { name: `Order ${orderNumber}` })).toBeVisible();
    await expect(page.getByRole("button", { name: "Issue refund" })).toHaveCount(0);
  });
});

test.describe("refunds (super admin)", () => {
  test.use({ storageState: storageStateFor("admin") });

  test("partial item refund is recorded and reduces the refundable amount", async ({ page }) => {
    const { orderNumber, sku } = await createPaidOrder("refund");
    await page.goto(`/admin/orders/${orderNumber}`);
    await page.getByRole("button", { name: "Issue refund" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel(`Units of ${sku} to refund`).selectOption("1");
    await dialog.getByLabel("Reason").fill("One unit arrived damaged");
    const submit = dialog.getByRole("button", { name: /^Refund ₹/ });
    await expect(submit).toBeEnabled();
    await submit.click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText("One unit arrived damaged")).toBeVisible();
    await expect(page.getByText("1 refunded")).toBeVisible();
  });

  test("cancelling a paid order before dispatch warns about the automatic refund", async ({ page }) => {
    const { orderNumber } = await createPaidOrder("cancel");
    await page.goto(`/admin/orders/${orderNumber}`);
    await page.getByRole("button", { name: "Cancel order" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("puts every unit back into stock and refunds");
    await dialog.getByLabel("Reason").fill("Customer asked to cancel");
    await dialog.getByRole("button", { name: "Cancel order" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText("Cancelled", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Order cancelled before dispatch").or(page.getByText("Customer asked to cancel")).first()).toBeVisible();
  });
});
