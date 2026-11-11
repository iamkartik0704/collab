import { expect, test } from "@playwright/test";
import { storageStateFor } from "./global-setup";
import { closeDb, db } from "./support/db";

test.describe.configure({ mode: "serial" });
test.afterAll(closeDb);

/**
 * The assistant itself needs a real ANTHROPIC_API_KEY; in CI it answers with the graceful
 * "unavailable" message instead. Either way the conversation is stored, and the human hand-off
 * path (escalation -> agent takeover -> reply in the customer's widget) is fully exercised.
 */
test("guest chat reaches the support inbox and the agent's reply appears in the widget", async ({ page, browser }) => {
  await page.goto("/support");
  await page.getByRole("button", { name: /Chat with us/ }).click();
  const chat = page.getByRole("dialog", { name: "Collab support chat" });
  await expect(chat).toBeVisible();

  const question = `Where is my parcel? (e2e ${Date.now().toString(36)})`;
  await chat.getByLabel("Message", { exact: true }).fill(question);
  await chat.getByRole("button", { name: "Send message" }).click();
  await expect(chat.getByText(question)).toBeVisible();
  // The turn finishes: either an answer or the "assistant unavailable" notice.
  await expect(chat.locator(".animate-spin")).toHaveCount(0, { timeout: 45_000 });

  const sessionId = await page.evaluate(() => window.localStorage.getItem("collab.chat.session"));
  expect(sessionId).toBeTruthy();
  const stored = await db().chatMessage.findFirst({ where: { sessionId: sessionId!, role: "USER" } });
  expect(stored?.content).toBe(question);

  // Escalate (what the assistant's escalate_to_human tool does).
  const ticketNumber = `TKT-E2E${Date.now().toString(36).toUpperCase()}`.slice(0, 24);
  await db().$transaction([
    db().supportTicket.create({ data: { ticketNumber, chatSessionId: sessionId!, category: "ORDER", priority: "HIGH", subject: "Parcel not received (e2e)", summary: "Customer asks where their parcel is." } }),
    db().chatSession.update({ where: { id: sessionId! }, data: { status: "ESCALATED", escalatedAt: new Date() } }),
  ]);

  // Support agent takes over and replies.
  const agentContext = await browser.newContext({ storageState: storageStateFor("support") });
  const agent = await agentContext.newPage();
  await agent.goto("/admin/support");
  await agent.getByRole("row").filter({ hasText: ticketNumber }).getByRole("link").click();
  await expect(agent.getByText(question)).toBeVisible();
  await agent.getByRole("button", { name: "Take over conversation" }).click();
  const reply = "Hi! This is Priya from Collab support. Your parcel is with the courier.";
  await agent.getByLabel("Reply to the customer").fill(reply);
  await agent.getByRole("button", { name: "Send reply" }).click();
  await expect(agent.getByText(reply)).toBeVisible();

  // The customer's widget picks the reply up (it polls while a person is involved).
  await page.reload();
  await page.getByRole("button", { name: "Open support chat" }).click();
  await expect(page.getByRole("dialog", { name: "Collab support chat" }).getByText(reply)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("You're chatting with our team")).toBeVisible();

  // While taken over, customer messages wait for the agent instead of going to the assistant.
  await page.getByLabel("Message", { exact: true }).fill("Thanks! When will it arrive?");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByText("A member of our support team will reply here shortly.")).toBeVisible();

  // Resolve closes the conversation and the ticket.
  agent.once("dialog", (prompt) => void prompt.accept("Customer informed"));
  await agent.getByRole("button", { name: "Resolve & close" }).click();
  await expect(agent.getByText("This conversation is closed.", { exact: false })).toBeVisible();
  const ticket = await db().supportTicket.findUniqueOrThrow({ where: { ticketNumber } });
  expect(ticket.status).toBe("RESOLVED");
  await agentContext.close();
});
