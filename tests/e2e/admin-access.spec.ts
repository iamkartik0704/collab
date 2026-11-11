import { expect, test } from "@playwright/test";
import { storageStateFor } from "./global-setup";

test.describe("admin access control", () => {
  test("anonymous visitors are sent to sign in", async ({ page }) => {
    await page.goto("/admin/orders");
    await expect(page).toHaveURL(/\/login\?callbackUrl=%2Fadmin%2Forders/);
  });

  test("admin APIs reject anonymous and cross-origin requests", async ({ request, baseURL }) => {
    const anonymous = await request.get("/api/admin/inventory");
    expect(anonymous.status()).toBe(401);
    const crossOrigin = await request.post("/api/admin/coupons", { data: {}, headers: { Origin: "https://evil.example" } });
    expect(crossOrigin.status()).toBe(403);
    expect(baseURL).toBeTruthy();
  });

  test.describe("support agent", () => {
    test.use({ storageState: storageStateFor("support") });

    test("sees the dashboard and orders but not catalogue or money tools", async ({ page }) => {
      await page.goto("/admin");
      await expect(page.getByRole("heading", { name: "Executive dashboard" })).toBeVisible();
      const nav = page.getByRole("navigation", { name: "Admin" }).first();
      await expect(nav.getByRole("link", { name: "Orders" })).toBeVisible();
      await expect(nav.getByRole("link", { name: "Products" })).toHaveCount(0);
      await expect(nav.getByRole("link", { name: "Coupons" })).toHaveCount(0);
      await expect(nav.getByRole("link", { name: "Audit log" })).toHaveCount(0);
    });

    test("is bounced from pages and APIs outside their role", async ({ page }) => {
      await page.goto("/admin/products");
      await expect(page).toHaveURL(/\/admin\?denied=1$/);
      const response = await page.request.post("/api/admin/inventory/x/adjust", {
        data: { mode: "delta", quantity: 1, reason: "PURCHASE_ORDER_RECEIVED" },
        headers: { Origin: new URL(page.url()).origin },
      });
      expect(response.status()).toBe(403);
    });
  });
});
