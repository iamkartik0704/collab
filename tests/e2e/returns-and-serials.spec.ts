import { expect, test } from "@playwright/test";
import { storageStateFor } from "./global-setup";
import { closeDb, createPaidOrder, db, markDelivered } from "./support/db";

test.describe.configure({ mode: "serial" });
test.afterAll(closeDb);

const IMEI = "490154203237518"; // Luhn-valid

test("serial / IMEI numbers are captured when packing and shown on the order", async ({ browser }) => {
  const { orderNumber } = await createPaidOrder("serials");
  const context = await browser.newContext({ storageState: storageStateFor("inventory") });
  const page = await context.newPage();
  await page.goto(`/admin/orders/${orderNumber}`);

  await page.getByRole("button", { name: "Confirm order" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Confirm order" }).click();
  await page.getByRole("button", { name: "Mark packed" }).click();
  const dialog = page.getByRole("dialog");
  const units = dialog.getByRole("textbox", { name: /Serial or IMEI for .* unit/ });
  await expect(units).toHaveCount(2); // the fixture order has 2 units

  // An IMEI with a wrong check digit is refused before anything is saved.
  await units.nth(0).fill("490154203237519");
  await dialog.getByRole("button", { name: "Mark packed" }).click();
  await expect(dialog.getByRole("alert")).toContainText(/check digit/i);

  await units.nth(0).fill(IMEI);
  await units.nth(1).fill("C02XK0ABJG5H");
  await dialog.getByRole("button", { name: "Mark packed" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText(`S/N: ${IMEI}, C02XK0ABJG5H`)).toBeVisible();

  const item = await db().orderItem.findFirstOrThrow({ where: { order: { orderNumber } } });
  expect(item.serialNumbers).toEqual([IMEI, "C02XK0ABJG5H"]);
  await context.close();
});

test("customer raises a warranty request on a delivered order and staff approve it", async ({ browser }) => {
  const { orderNumber } = await createPaidOrder("rma");
  await markDelivered(orderNumber);

  const customer = await browser.newContext({ storageState: storageStateFor("customer") });
  const shopper = await customer.newPage();
  await shopper.goto("/account");
  await shopper.getByRole("link", { name: orderNumber }).click();
  await expect(shopper.getByRole("heading", { name: `Order ${orderNumber}` })).toBeVisible();

  await shopper.getByRole("button", { name: "Start a request" }).click();
  await shopper.getByRole("combobox", { name: "Request", exact: true }).selectOption("REPLACEMENT");
  await shopper.getByRole("combobox", { name: "Reason", exact: true }).selectOption("DEFECTIVE");
  // A defect needs a description.
  await shopper.getByRole("button", { name: "Submit request" }).click();
  await expect(shopper.getByText(/Describe the problem/)).toBeVisible();
  await shopper.getByLabel("What's wrong?").fill("Left speaker crackles at any volume since day one.");
  await shopper.getByRole("button", { name: "Submit request" }).click();
  await expect(shopper.getByRole("status")).toContainText(/Request RMA-[0-9A-Z]{8} received/);
  await expect(shopper.getByText("Under review")).toBeVisible();
  const rma = (await db().returnRequest.findFirstOrThrow({ where: { order: { orderNumber } } })).rmaNumber;

  // Staff see it on the admin order page and approve it.
  const staff = await browser.newContext({ storageState: storageStateFor("inventory") });
  const admin = await staff.newPage();
  await admin.goto(`/admin/orders/${orderNumber}`);
  const card = admin.locator("div.rounded-md").filter({ hasText: rma });
  await expect(card).toContainText("Left speaker crackles");
  await card.getByLabel(`Note for ${rma}`).fill("Approved - courier pickup on Thursday.");
  await card.getByRole("button", { name: "Approve" }).click();
  await expect(card).toContainText("Approved");

  // The customer sees the decision; the same item cannot be requested twice at once.
  await shopper.reload();
  await expect(shopper.getByText(/Approved - we'll arrange the pickup/)).toBeVisible();
  await expect(shopper.getByText("Approved - courier pickup on Thursday.")).toBeVisible();
  const again = await shopper.request.post(`/api/account/orders/${orderNumber}/returns`, {
    data: { orderItemId: (await db().orderItem.findFirstOrThrow({ where: { order: { orderNumber } } })).id, type: "REPLACEMENT", quantity: 2, reason: "DEFECTIVE", description: "Asking again for both units." },
    headers: { Origin: new URL(shopper.url()).origin },
  });
  expect(again.status()).toBe(422);

  // Someone else's order is invisible.
  const other = await db().order.findFirstOrThrow({ where: { orderNumber: { startsWith: "CLB-DEMO" } } });
  const foreign = await shopper.goto(`/account/orders/${other.orderNumber}`);
  expect(foreign?.status()).toBe(404);

  await customer.close();
  await staff.close();
});
