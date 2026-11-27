import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const DEFAULT_LOOKBACK_DAYS = 30;
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;
const REVIEW_CONCURRENCY = 6;
const MARKER_PATTERN =
  /<!--\s*factory:model=([A-Za-z0-9._-]+\/[A-Za-z0-9._-]+)\s+role=([A-Za-z0-9_-]+)\s+run=([0-9]+)\s*-->/gi;
const AGENT_BRANCH_PATTERN = /\bagent\/(?:issue|spec-\d+-ticket)-(\d+)-(\d+)\b/;
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const ISSUE_NUMBER_PATTERN = /\/(?:issues|pull)\/(\d+)/;

export interface MarkerMatch {
  model: string;
  role: string;
  run: string;
}

export interface FactoryTouch {
  target: string;
  role: string;
  model: string;
  run: string;
  source: "commit" | "pr-body" | "issue-body" | "comment" | "review";
  timestamp: string;
}

export interface SummaryRow {
  target: string;
  role: string;
  model: string;
  run: string;
  sources: string[];
  latestAt: string;
}

export interface CliOptions {
  since: string;
  until: string;
  repository?: string;
  isJson: boolean;
}

interface GitHubPull {
  number: number;
  body: string | null;
  created_at: string;
  updated_at: string;
  head: { ref: string; sha: string };
}

interface GitHubIssue {
  number: number;
  body: string | null;
  created_at: string;
  updated_at: string;
  pull_request?: unknown;
}

interface GitHubComment {
  body: string | null;
  created_at: string;
  html_url: string;
  issue_url: string;
}

interface GitHubReview {
  body: string | null;
  submitted_at: string | null;
}

export function normalizeDateBound(value: string, isEndOfDay: boolean): string {
  if (!DATE_ONLY_PATTERN.test(value)) {
    return value;
  }
  return isEndOfDay ? `${value}T23:59:59.999Z` : `${value}T00:00:00.000Z`;
}

export function parseCliOptions(
  argumentsList: string[],
  now: Date
): CliOptions {
  const defaultSince = new Date(
    now.getTime() - DEFAULT_LOOKBACK_DAYS * MILLISECONDS_PER_DAY
  )
    .toISOString()
    .slice(0, 10);
  let since = normalizeDateBound(defaultSince, false);
  let until = now.toISOString();
  let repository: string | undefined;
  let isJson = false;

  for (let index = 0; index < argumentsList.length; index += 1) {
    const flag = argumentsList[index];
    const nextValue = argumentsList[index + 1];
    if (flag === "--since" && nextValue) {
      since = normalizeDateBound(nextValue, false);
      index += 1;
    } else if (flag === "--until" && nextValue) {
      until = normalizeDateBound(nextValue, true);
      index += 1;
    } else if (flag === "--repo" && nextValue) {
      repository = nextValue;
      index += 1;
    } else if (flag === "--json") {
      isJson = true;
    }
  }

  return { since, until, repository, isJson };
}

export function parseMarker(
  body: string | null | undefined
): MarkerMatch | undefined {
  if (!body) {
    return undefined;
  }
  let latest: MarkerMatch | undefined;
  for (const match of body.matchAll(MARKER_PATTERN)) {
    const [, model, role, run] = match;
    if (model && role && run) {
      latest = { model, role, run };
    }
  }
  return latest;
}

export function stripFactoryModelMarkers(text: string): string {
  return text.replace(/<!--\s*factory:model\b[\s\S]*?-->/gi, "");
}

export function isWithinRange(
  timestamp: string,
  since: string,
  until: string
): boolean {
  const value = Date.parse(timestamp);
  const start = Date.parse(since);
  const end = Date.parse(until);
  if (Number.isNaN(value) || Number.isNaN(start) || Number.isNaN(end)) {
    return false;
  }
  return value >= start && value <= end;
}

function parseTrailerValue(rawBlock: string, key: string): string {
  const prefix = `${key.toLowerCase()}:`;
  return (
    rawBlock
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.toLowerCase().startsWith(prefix))
      .map((line) => line.slice(prefix.length).trim())
      .filter(Boolean)
      .at(-1) ?? ""
  );
}

function resolveCommitTarget(
  sha: string,
  decorations: string,
  branchToPullNumber: ReadonlyMap<string, number>
): { target: string; run: string } {
  const branchMatch = AGENT_BRANCH_PATTERN.exec(decorations);
  if (!branchMatch) {
    return { target: `commit ${sha.slice(0, 8)}`, run: "-" };
  }
  const run = branchMatch[2] ?? "-";
  const pullNumber = branchToPullNumber.get(branchMatch[0]);
  return {
    target:
      pullNumber !== undefined
        ? `PR #${pullNumber}`
        : `Issue #${branchMatch[1]}`,
    run,
  };
}

export function parseGitLogOutput(
  output: string,
  branchToPullNumber: ReadonlyMap<string, number>
): FactoryTouch[] {
  const touches: FactoryTouch[] = [];
  for (const record of output.split("\x1e")) {
    const trimmed = record.trim();
    if (!trimmed) {
      continue;
    }
    const [
      sha = "",
      timestamp = "",
      decorations = "",
      modelBlock = "",
      roleBlock = "",
    ] = trimmed.split("\x1f");
    const model = parseTrailerValue(modelBlock, "Agent-Model");
    if (!model) {
      continue;
    }
    const role = parseTrailerValue(roleBlock, "Agent-Role") || "unknown";
    const resolved = resolveCommitTarget(sha, decorations, branchToPullNumber);
    touches.push({
      target: resolved.target,
      role,
      model,
      run: resolved.run,
      source: "commit",
      timestamp,
    });
  }
  return touches;
}

export function summarizeTouches(touches: FactoryTouch[]): SummaryRow[] {
  const grouped = new Map<string, SummaryRow>();
  for (const touch of touches) {
    const key = `${touch.target}|${touch.role}|${touch.model}|${touch.run}`;
    const existing = grouped.get(key);
    if (!existing) {
      grouped.set(key, {
        target: touch.target,
        role: touch.role,
        model: touch.model,
        run: touch.run,
        sources: [touch.source],
        latestAt: touch.timestamp,
      });
      continue;
    }
    if (!existing.sources.includes(touch.source)) {
      existing.sources.push(touch.source);
      existing.sources.sort();
    }
    if (touch.timestamp > existing.latestAt) {
      existing.latestAt = touch.timestamp;
    }
  }
  return [...grouped.values()].sort((left, right) => {
    if (left.latestAt !== right.latestAt) {
      return right.latestAt.localeCompare(left.latestAt);
    }
    return left.target.localeCompare(right.target);
  });
}

export function formatTable(rows: SummaryRow[]): string {
  if (rows.length === 0) {
    return "No factory runs found in range.";
  }
  const headers = ["TARGET", "ROLE", "MODEL", "RUN", "SOURCES", "DATE"];
  const matrix = [
    headers,
    ...rows.map((row) => [
      row.target,
      row.role,
      row.model,
      row.run,
      row.sources.join(","),
      row.latestAt.slice(0, 19).replace("T", " "),
    ]),
  ];
  const widths = headers.map((_, columnIndex) =>
    Math.max(...matrix.map((cells) => (cells[columnIndex] ?? "").length))
  );
  return matrix
    .map((cells) =>
      cells
        .map((cell, columnIndex) => cell.padEnd(widths[columnIndex] ?? 0))
        .join("  ")
        .trimEnd()
    )
    .join("\n");
}

function runCommand(command: string, argumentsList: string[]): string {
  return execFileSync(command, argumentsList, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

async function ghApiPagesAsync<T>(endpoint: string): Promise<T[]> {
  const { stdout } = await execFileAsync(
    "gh",
    ["api", "--paginate", "--slurp", endpoint],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }
  );
  const parsed: unknown = JSON.parse(stdout);
  return Array.isArray(parsed) ? (parsed.flat() as T[]) : [];
}

function resolveRepository(explicitRepository?: string): string {
  if (explicitRepository) {
    return explicitRepository;
  }
  return runCommand("gh", [
    "repo",
    "view",
    "--json",
    "nameWithOwner",
    "--jq",
    ".nameWithOwner",
  ]).trim();
}

function makeMarkerTouch(
  entry: {
    target: string;
    body: string | null;
    timestamp: string;
    source: FactoryTouch["source"];
  },
  options: CliOptions
): FactoryTouch | undefined {
  const marker = parseMarker(entry.body);
  if (
    !marker ||
    !isWithinRange(entry.timestamp, options.since, options.until)
  ) {
    return undefined;
  }
  return {
    target: entry.target,
    role: marker.role,
    model: marker.model,
    run: marker.run,
    source: entry.source,
    timestamp: entry.timestamp,
  };
}

function collectPullTouches(
  pulls: GitHubPull[],
  options: CliOptions
): { touches: FactoryTouch[]; branchToPullNumber: Map<string, number> } {
  const touches: FactoryTouch[] = [];
  const branchToPullNumber = new Map<string, number>();
  for (const pull of pulls) {
    branchToPullNumber.set(pull.head.ref, pull.number);
    const touch = makeMarkerTouch(
      {
        target: `PR #${pull.number}`,
        body: pull.body,
        timestamp: pull.created_at,
        source: "pr-body",
      },
      options
    );
    if (touch) {
      touches.push(touch);
    }
  }
  return { touches, branchToPullNumber };
}

function collectIssueTouches(
  issues: GitHubIssue[],
  options: CliOptions
): FactoryTouch[] {
  return issues
    .filter((issue) => !issue.pull_request)
    .flatMap((issue) => {
      const touch = makeMarkerTouch(
        {
          target: `Issue #${issue.number}`,
          body: issue.body,
          timestamp: issue.created_at,
          source: "issue-body",
        },
        options
      );
      return touch ? [touch] : [];
    });
}

function collectCommentTouches(
  comments: GitHubComment[],
  options: CliOptions
): FactoryTouch[] {
  return comments.flatMap((comment) => {
    const label = comment.html_url.includes("/pull/") ? "PR" : "Issue";
    const numberMatch = ISSUE_NUMBER_PATTERN.exec(comment.html_url);
    const target = numberMatch
      ? `${label} #${numberMatch[1]}`
      : comment.issue_url;
    const touch = makeMarkerTouch(
      {
        target,
        body: comment.body,
        timestamp: comment.created_at,
        source: "comment",
      },
      options
    );
    return touch ? [touch] : [];
  });
}

async function fetchSinglePullReviews(
  repository: string,
  pull: GitHubPull,
  options: CliOptions
): Promise<FactoryTouch[]> {
  const reviews = await ghApiPagesAsync<GitHubReview>(
    `repos/${repository}/pulls/${pull.number}/reviews?per_page=100`
  );
  return reviews.flatMap((review) => {
    const touch = makeMarkerTouch(
      {
        target: `PR #${pull.number}`,
        body: review.body,
        timestamp: review.submitted_at ?? pull.updated_at,
        source: "review",
      },
      options
    );
    return touch ? [touch] : [];
  });
}

async function collectReviewTouches(
  repository: string,
  pulls: GitHubPull[],
  options: CliOptions
): Promise<FactoryTouch[]> {
  const inRangePulls = pulls.filter((pull) =>
    isWithinRange(pull.updated_at, options.since, options.until)
  );
  const touches: FactoryTouch[] = [];
  for (
    let index = 0;
    index < inRangePulls.length;
    index += REVIEW_CONCURRENCY
  ) {
    const batch = inRangePulls.slice(index, index + REVIEW_CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map((pull) => fetchSinglePullReviews(repository, pull, options))
    );
    touches.push(...batchResults.flat());
  }
  return touches;
}

function collectCommitTouches(
  options: CliOptions,
  branchToPullNumber: ReadonlyMap<string, number>
): FactoryTouch[] {
  const gitOutput = runCommand("git", [
    "log",
    "--all",
    "--source",
    `--since=${options.since}`,
    `--until=${options.until}`,
    "--format=%H%x1f%aI%x1f%S%x1f%(trailers:key=Agent-Model)%x1f%(trailers:key=Agent-Role)%x1e",
  ]);
  return parseGitLogOutput(gitOutput, branchToPullNumber);
}

async function main() {
  const options = parseCliOptions(process.argv.slice(2), new Date());
  const repository = resolveRepository(options.repository);
  const encodedSince = encodeURIComponent(options.since);

  const [pulls, issues, comments] = await Promise.all([
    ghApiPagesAsync<GitHubPull>(
      `repos/${repository}/pulls?state=all&sort=updated&direction=desc&per_page=100`
    ),
    ghApiPagesAsync<GitHubIssue>(
      `repos/${repository}/issues?state=all&since=${encodedSince}&per_page=100`
    ),
    ghApiPagesAsync<GitHubComment>(
      `repos/${repository}/issues/comments?since=${encodedSince}&per_page=100`
    ),
  ]);

  const pullResult = collectPullTouches(pulls, options);
  const reviewTouches = await collectReviewTouches(repository, pulls, options);
  const touches = [
    ...pullResult.touches,
    ...collectIssueTouches(issues, options),
    ...collectCommentTouches(comments, options),
    ...reviewTouches,
    ...collectCommitTouches(options, pullResult.branchToPullNumber),
  ];

  const rows = summarizeTouches(touches);
  if (options.isJson) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }
  console.log(formatTable(rows));
}

if (import.meta.main) {
  await main();
}
