import { z } from "zod";

/** Return / replacement / warranty request input, shared by the account form and the API (no server imports). */

export const RETURN_REASONS = {
  DEFECTIVE: "Defective or not working",
  DAMAGED_IN_TRANSIT: "Arrived damaged",
  WRONG_ITEM: "Wrong item or variant",
  NOT_AS_DESCRIBED: "Not as described",
  CHANGED_MIND: "No longer needed (unopened)",
  WARRANTY_FAULT: "Developed a fault (warranty)",
} as const;
export type ReturnReason = keyof typeof RETURN_REASONS;

export const returnRequestInputSchema = z
  .object({
    orderItemId: z.string().min(1).max(40),
    type: z.enum(["RETURN", "REPLACEMENT", "WARRANTY_REPAIR"]),
    quantity: z.number().int().min(1).max(100),
    reason: z.enum(Object.keys(RETURN_REASONS) as [ReturnReason, ...ReturnReason[]]),
    description: z.string().trim().max(2000).optional().default(""),
  })
  .superRefine((input, ctx) => {
    if (input.reason !== "CHANGED_MIND" && input.description.length < 10) {
      ctx.addIssue({ code: "custom", path: ["description"], message: "Describe the problem (at least 10 characters) so we can help quickly." });
    }
    if (input.type === "WARRANTY_REPAIR" && input.reason === "CHANGED_MIND") {
      ctx.addIssue({ code: "custom", path: ["reason"], message: "Warranty requests are for faulty products." });
    }
  });
export type ReturnRequestInput = z.input<typeof returnRequestInputSchema>;
