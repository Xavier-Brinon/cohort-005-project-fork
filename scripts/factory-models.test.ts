import { describe, expect, it } from "vitest";

import {
  type FactoryTouch,
  formatTable,
  hasActivityOverlap,
  isWithinRange,
  normalizeDateBound,
  parseCliOptions,
  parseGitLogOutput,
  parseMarker,
  type PullLookup,
  summarizeTouches,
} from "./factory-models.ts";

const EMPTY_LOOKUP: PullLookup = {
  branchToPullNumber: new Map(),
  headShaToPullNumber: new Map(),
};

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

describe("parseGitLogOutput", () => {
  it("maps builder commits to PR and run, and avoids attributing builder run to reviewer commits", () => {
    const sample = [
      [
        "abc123456789",
        "2026-11-27T12:00:00Z",
        "refs/remotes/origin/agent/issue-60-9001",
        "Agent-Model: claude-code/claude-opus-5-5\n",
        "Agent-Role: builder\n",
      ].join("\x1f"),
      [
        "bbb222333444",
        "2026-11-27T12:10:00Z",
        "refs/remotes/origin/agent/issue-60-9001",
        "Agent-Model: claude-code/claude-opus-5-5\n",
        "Agent-Role: reviewer\n",
      ].join("\x1f"),
      ["def987654321", "2026-11-27T11:00:00Z", "refs/heads/main", "", ""].join(
        "\x1f"
      ),
    ].join("\x1e");

    const lookup: PullLookup = {
      branchToPullNumber: new Map([["agent/issue-60-9001", 61]]),
      headShaToPullNumber: new Map(),
    };
    expect(parseGitLogOutput(sample, lookup)).toEqual([
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
        role: "reviewer",
        model: "claude-code/claude-opus-5-5",
        run: "-",
        source: "commit",
        timestamp: "2026-11-27T12:10:00Z",
      },
    ]);
  });

  it("maps fallback review branches to the fallback PR and reviewer run id", () => {
    const sample = [
      "ccc333444555",
      "2026-11-27T12:20:00Z",
      "refs/remotes/origin/agent/issue-60-9001-9002",
      "Agent-Model: claude-code/claude-opus-5-5",
      "Agent-Role: reviewer",
    ].join("\x1f");
    const lookup: PullLookup = {
      branchToPullNumber: new Map([["agent/issue-60-9001-9002", 62]]),
      headShaToPullNumber: new Map(),
    };
    expect(parseGitLogOutput(`${sample}\x1e`, lookup)).toEqual([
      {
        target: "PR #62",
        role: "reviewer",
        model: "claude-code/claude-opus-5-5",
        run: "9002",
        source: "commit",
        timestamp: "2026-11-27T12:20:00Z",
      },
    ]);
  });

  it("falls back to head SHA lookup or commit hash when ref is not an agent branch", () => {
    const sample = [
      [
        "112233445566",
        "2026-11-27T12:30:00Z",
        "refs/heads/main",
        "Agent-Model: claude-code/claude-opus-5-5",
        "Agent-Role: reviewer",
      ].join("\x1f"),
      [
        "998877665544",
        "2026-11-27T12:35:00Z",
        "refs/heads/main",
        "Agent-Model: claude-code/claude-opus-5-5",
        "Agent-Role: builder",
      ].join("\x1f"),
    ].join("\x1e");
    const lookup: PullLookup = {
      branchToPullNumber: new Map(),
      headShaToPullNumber: new Map([["112233445566", 70]]),
    };
    expect(parseGitLogOutput(sample, lookup)).toEqual([
      {
        target: "PR #70",
        role: "reviewer",
        model: "claude-code/claude-opus-5-5",
        run: "-",
        source: "commit",
        timestamp: "2026-11-27T12:30:00Z",
      },
      {
        target: "commit 99887766",
        role: "builder",
        model: "claude-code/claude-opus-5-5",
        run: "-",
        source: "commit",
        timestamp: "2026-11-27T12:35:00Z",
      },
    ]);
  });

  it("returns empty array when no commits carry Agent-Model", () => {
    expect(parseGitLogOutput("", EMPTY_LOOKUP)).toEqual([]);
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

  it("checks inclusive UTC timestamp range and PR activity overlap after until", () => {
    const start = normalizeDateBound("2026-11-20", false);
    const end = normalizeDateBound("2026-11-25", true);
    expect(isWithinRange("2026-11-25T10:00:00Z", start, end)).toBe(true);
    expect(isWithinRange("2026-11-19T23:59:59Z", start, end)).toBe(false);
    expect(
      hasActivityOverlap(
        {
          createdAt: "2026-11-21T10:00:00Z",
          updatedAt: "2026-11-27T10:00:00Z",
        },
        { since: start, until: end }
      )
    ).toBe(true);
    expect(
      hasActivityOverlap(
        {
          createdAt: "2026-11-26T10:00:00Z",
          updatedAt: "2026-11-27T10:00:00Z",
        },
        { since: start, until: end }
      )
    ).toBe(false);
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
