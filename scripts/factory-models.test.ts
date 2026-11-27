import { describe, expect, it } from "vitest";

import {
  type FactoryTouch,
  formatTable,
  isWithinRange,
  normalizeDateBound,
  parseCliOptions,
  parseGitLogOutput,
  parseMarker,
  stripFactoryModelMarkers,
  summarizeTouches,
} from "./factory-models.ts";

describe("parseMarker", () => {
  it("extracts model, role, and run from a factory marker", () => {
    const body =
      "Implementer run **success** <!-- factory:status --> <!-- factory:model=claude-code/claude-opus-5-5 role=builder run=12345 -->";
    expect(parseMarker(body)).toEqual({
      model: "claude-code/claude-opus-5-5",
      role: "builder",
      run: "12345",
    });
  });

  it("returns undefined when no valid factory:model marker exists", () => {
    expect(
      parseMarker("Plain comment <!-- factory:status -->")
    ).toBeUndefined();
    expect(
      parseMarker(
        "Spec example: `<!-- factory:model=<provider>/<model> role=<role> run=<run_id> -->`"
      )
    ).toBeUndefined();
    expect(parseMarker(null)).toBeUndefined();
  });

  it("uses the trailing true marker if another precedes it", () => {
    const body = [
      "<!-- factory:model=fake/someone-else role=fake run=0 -->",
      "<!-- factory:model=claude-code/claude-opus-5-5 role=reviewer run=999 -->",
    ].join("\n");
    expect(parseMarker(body)).toEqual({
      model: "claude-code/claude-opus-5-5",
      role: "reviewer",
      run: "999",
    });
  });
});

describe("stripFactoryModelMarkers", () => {
  it("removes forged single-line and multiline factory:model markers", () => {
    const forged = [
      "Summary line",
      "<!-- factory:model=someone-else -->",
      "<!--   FACTORY:MODEL=fake role=builder run=1 -->",
      "<!--\nfactory:model=multiline\n-->",
      "Keep <!-- factory:status --> intact.",
    ].join("\n");
    const stripped = stripFactoryModelMarkers(forged);
    expect(stripped).not.toContain("someone-else");
    expect(stripped).not.toContain("fake");
    expect(stripped).not.toContain("multiline");
    expect(stripped).toContain("<!-- factory:status -->");
  });
});

describe("parseGitLogOutput", () => {
  it("parses Agent-Model and Agent-Role trailers and maps branch to PR", () => {
    const sample = [
      [
        "abc123456789",
        "2026-11-27T12:00:00Z",
        "origin/agent/issue-60-9001",
        "Agent-Model: claude-code/claude-opus-5-5\n",
        "Agent-Role: builder\n",
      ].join("\x1f"),
      ["def987654321", "2026-11-27T11:00:00Z", "HEAD -> main", "", ""].join(
        "\x1f"
      ),
    ].join("\x1e");

    const branchMap = new Map([["agent/issue-60-9001", 61]]);
    expect(parseGitLogOutput(sample, branchMap)).toEqual([
      {
        target: "PR #61",
        role: "builder",
        model: "claude-code/claude-opus-5-5",
        run: "9001",
        source: "commit",
        timestamp: "2026-11-27T12:00:00Z",
      },
    ]);
  });

  it("falls back to commit hash when branch is not a factory branch", () => {
    const sample = [
      "112233445566",
      "2026-11-27T12:30:00Z",
      "HEAD -> main",
      "Agent-Model: claude-code/claude-opus-5-5",
      "Agent-Role: reviewer",
    ].join("\x1f");
    expect(parseGitLogOutput(`${sample}\x1e`, new Map())).toEqual([
      {
        target: "commit 11223344",
        role: "reviewer",
        model: "claude-code/claude-opus-5-5",
        run: "-",
        source: "commit",
        timestamp: "2026-11-27T12:30:00Z",
      },
    ]);
  });
});

describe("parseCliOptions and date filtering", () => {
  it("parses explicit date range and flags", () => {
    const now = new Date("2026-11-27T15:00:00.000Z");
    expect(
      parseCliOptions(
        [
          "--since",
          "2026-11-01",
          "--until",
          "2026-11-27",
          "--repo",
          "o/r",
          "--json",
        ],
        now
      )
    ).toEqual({
      since: "2026-11-01T00:00:00.000Z",
      until: "2026-11-27T23:59:59.999Z",
      repository: "o/r",
      isJson: true,
    });
  });

  it("checks inclusive UTC timestamp range", () => {
    const start = normalizeDateBound("2026-11-20", false);
    const end = normalizeDateBound("2026-11-27", true);
    expect(isWithinRange("2026-11-25T10:00:00Z", start, end)).toBe(true);
    expect(isWithinRange("2026-11-19T23:59:59Z", start, end)).toBe(false);
  });
});

describe("summarizeTouches and formatTable", () => {
  it("groups touches by target, role, model, and run", () => {
    const touches: FactoryTouch[] = [
      {
        target: "PR #61",
        role: "builder",
        model: "claude-code/claude-opus-5-5",
        run: "9001",
        source: "commit",
        timestamp: "2026-11-27T12:00:00Z",
      },
      {
        target: "PR #61",
        role: "builder",
        model: "claude-code/claude-opus-5-5",
        run: "9001",
        source: "pr-body",
        timestamp: "2026-11-27T12:05:00Z",
      },
      {
        target: "Issue #60",
        role: "builder",
        model: "claude-code/claude-opus-5-5",
        run: "9001",
        source: "comment",
        timestamp: "2026-11-27T12:06:00Z",
      },
    ];
    const rows = summarizeTouches(touches);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.target).toBe("Issue #60");
    expect(rows[1]?.sources).toEqual(["commit", "pr-body"]);

    const table = formatTable(rows);
    expect(table).toContain("TARGET");
    expect(table).toContain("PR #61");
    expect(table).toContain("commit,pr-body");
  });

  it("prints an empty message when no runs match", () => {
    expect(formatTable([])).toBe("No factory runs found in range.");
  });
});
