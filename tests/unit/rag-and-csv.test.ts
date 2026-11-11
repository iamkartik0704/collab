import { describe, expect, it } from "vitest";
import { csvCell } from "@/server/admin/audit-log.service";
import { chunkText } from "@/server/ai/rag";

describe("chunkText", () => {
  it("keeps short documents in one chunk", () => {
    expect(chunkText("Line one.\n\nLine two.")).toEqual(["Line one.\nLine two."]);
  });

  it("splits long documents on paragraph boundaries under the size limit", () => {
    const paragraph = "word ".repeat(150).trim();
    const chunks = chunkText([paragraph, paragraph, paragraph, paragraph].join("\n\n"));
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(1_600);
    expect(chunks.join("\n").replace(/\n/g, " ")).toBe([paragraph, paragraph, paragraph, paragraph].join(" "));
  });

  it("hard-splits a single oversized paragraph", () => {
    expect(chunkText("x".repeat(4_000)).map((chunk) => chunk.length)).toEqual([1_600, 1_600, 800]);
  });
});

describe("csvCell", () => {
  it("quotes separators and neutralises spreadsheet formulas", () => {
    expect(csvCell('a,"b"')).toBe('"a,""b"""');
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvCell(-5)).toBe("'-5");
    expect(csvCell(null)).toBe("");
    expect(csvCell({ a: 1 })).toBe('"{""a"":1}"');
  });
});
