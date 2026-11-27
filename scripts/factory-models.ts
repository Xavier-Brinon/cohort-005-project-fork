import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const DEFAULT_LOOKBACK_DAYS = 30;
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;
const REVIEW_CONCURRENCY = 6;
const MARKER_PATTERN =
  /<!--\s*factory:model=([A-Za-z0-9._-]+\/[A-Za-z0-9._-]+)\s+role=([A-Za-z0-9_-]+)\s+run=([0-9]+)\s*-->/gi;
const AGENT_BRANCH_PATTERN =
  /\b(agent\/(?:issue|spec-\d+-ticket)-(\d+)-(\d+)(?:-(\d+))?)\b/;
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const ISSUE_NUMBER_PATTERN = /\/(?:issues|pull)\/(\d+)/;
const TABLE_HEADERS = ["TARGET", "ROLE", "MODEL", "RUN", "SOURCES", "DATE"];

type TouchSource = "commit" | "pr-body" | "issue-body" | "comment" | "review";

interface MarkerMatch {
  model: string;
  role: string;
  run: string;
}

export interface FactoryTouch {
  target: string;
  role: string;
  model: string;
  run: string;
  source: TouchSource;
  timestamp: string;
}

interface SummaryRow {
  target: string;
  role: string;
  model: string;
  run: string;
  sources: TouchSource[];
  latestAt: string;
}

interface CliOptions {
  since: string;
  until: string;
  repository?: string;
  isJson: boolean;
}

export interface PullLookup {
  branchToPullNumber: ReadonlyMap<string, number>;
  headShaToPullNumber: ReadonlyMap<string, number>;
}

interface GitHubItem {
  number: number;
  body: string | null;
  created_at: string;
  updated_at: string;
}

interface GitHubPull extends GitHubItem {
  head: { ref: string; sha: string };
}

interface GitHubIssue extends GitHubItem {
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
  const sinceDate = new Date(
    now.getTime() - DEFAULT_LOOKBACK_DAYS * MILLISECONDS_PER_DAY
  )
    .toISOString()
    .slice(0, 10);
  let since = normalizeDateBound(sinceDate, false);
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
  for (const [, model, role, run] of body.matchAll(MARKER_PATTERN)) {
    if (model && role && run) {
      latest = { model, role, run };
    }
  }
  return latest;
}

export function isWithinRange(
  timestamp: string,
  since: string,
  until: string
): boolean {
  const [value, start, end] = [timestamp, since, until].map(Date.parse);
  if ([value, start, end].some(Number.isNaN)) {
    return false;
  }
  return (value ?? 0) >= (start ?? 0) && (value ?? 0) <= (end ?? 0);
}

export function hasActivityOverlap(
  window: { createdAt: string; updatedAt: string },
  range: { since: string; until: string }
): boolean {
  const values = [
    window.createdAt,
    window.updatedAt,
    range.since,
    range.until,
  ].map(Date.parse);
  if (values.some(Number.isNaN)) {
    return false;
  }
  const [created = 0, updated = 0, start = 0, end = 0] = values;
  return updated >= start && created <= end;
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
  commit: { sha: string; refName: string; role: string },
  lookup: PullLookup
): { target: string; run: string } {
  const branchMatch = AGENT_BRANCH_PATTERN.exec(commit.refName);
  if (branchMatch) {
    const [, branch = "", issueNumber = "", builderRun = "-", fallbackRun] =
      branchMatch;
    const pullNumber =
      lookup.branchToPullNumber.get(branch) ??
      lookup.headShaToPullNumber.get(commit.sha);
    const run = fallbackRun
      ? commit.role === "reviewer"
        ? fallbackRun
        : "-"
      : commit.role === "builder"
        ? builderRun
        : "-";
    return {
      target:
        pullNumber !== undefined
          ? `PR #${pullNumber}`
          : `Issue #${issueNumber}`,
      run,
    };
  }
  const shaPull = lookup.headShaToPullNumber.get(commit.sha);
  return {
    target:
      shaPull !== undefined
        ? `PR #${shaPull}`
        : `commit ${commit.sha.slice(0, 8)}`,
    run: "-",
  };
}

export function parseGitLogOutput(
  output: string,
  lookup: PullLookup
): FactoryTouch[] {
  return output.split("\x1e").flatMap((record) => {
    const trimmed = record.trim();
    if (!trimmed) {
      return [];
    }
    const [
      sha = "",
      timestamp = "",
      refName = "",
      modelBlock = "",
      roleBlock = "",
    ] = trimmed.split("\x1f");
    const model = parseTrailerValue(modelBlock, "Agent-Model");
    if (!model) {
      return [];
    }
    const role = parseTrailerValue(roleBlock, "Agent-Role") || "unknown";
    const resolved = resolveCommitTarget({ sha, refName, role }, lookup);
    return [{ ...resolved, role, model, source: "commit" as const, timestamp }];
  });
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
  return [...grouped.values()].sort((left, right) =>
    left.latestAt !== right.latestAt
      ? right.latestAt.localeCompare(left.latestAt)
      : left.target.localeCompare(right.target)
  );
}

export function formatTable(rows: SummaryRow[]): string {
  if (rows.length === 0) {
    return "No factory runs found in range.";
  }
  const matrix = [
    TABLE_HEADERS,
    ...rows.map((row) => [
      row.target,
      row.role,
      row.model,
      row.run,
      row.sources.join(","),
      row.latestAt.slice(0, 19).replace("T", " "),
    ]),
  ];
  const widths = TABLE_HEADERS.map((_, columnIndex) =>
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
    source: TouchSource;
  },
  options: CliOptions
): FactoryTouch[] {
  const marker = parseMarker(entry.body);
  if (
    !marker ||
    !isWithinRange(entry.timestamp, options.since, options.until)
  ) {
    return [];
  }
  const { target, source, timestamp } = entry;
  return [{ target, ...marker, source, timestamp }];
}

function collectPullTouches(pulls: GitHubPull[], options: CliOptions) {
  const branchToPullNumber = new Map<string, number>();
  const headShaToPullNumber = new Map<string, number>();
  const touches = pulls.flatMap((pull) => {
    branchToPullNumber.set(pull.head.ref, pull.number);
    headShaToPullNumber.set(pull.head.sha, pull.number);
    return makeMarkerTouch(
      {
        target: `PR #${pull.number}`,
        body: pull.body,
        timestamp: pull.created_at,
        source: "pr-body",
      },
      options
    );
  });
  return { touches, lookup: { branchToPullNumber, headShaToPullNumber } };
}

function collectIssueTouches(issues: GitHubIssue[], options: CliOptions) {
  return issues
    .filter((issue) => !issue.pull_request)
    .flatMap((issue) =>
      makeMarkerTouch(
        {
          target: `Issue #${issue.number}`,
          body: issue.body,
          timestamp: issue.created_at,
          source: "issue-body",
        },
        options
      )
    );
}

function collectCommentTouches(comments: GitHubComment[], options: CliOptions) {
  return comments.flatMap((comment) => {
    const label = comment.html_url.includes("/pull/") ? "PR" : "Issue";
    const match = ISSUE_NUMBER_PATTERN.exec(comment.html_url);
    return makeMarkerTouch(
      {
        target: match ? `${label} #${match[1]}` : comment.issue_url,
        body: comment.body,
        timestamp: comment.created_at,
        source: "comment",
      },
      options
    );
  });
}

async function collectReviewTouches(
  repository: string,
  pulls: GitHubPull[],
  options: CliOptions
): Promise<FactoryTouch[]> {
  const candidates = pulls.filter((pull) =>
    hasActivityOverlap(
      { createdAt: pull.created_at, updatedAt: pull.updated_at },
      { since: options.since, until: options.until }
    )
  );
  const touches: FactoryTouch[] = [];
  for (let index = 0; index < candidates.length; index += REVIEW_CONCURRENCY) {
    const batch = candidates.slice(index, index + REVIEW_CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (pull) => {
        const reviews = await ghApiPagesAsync<GitHubReview>(
          `repos/${repository}/pulls/${pull.number}/reviews?per_page=100`
        );
        return reviews.flatMap((review) =>
          makeMarkerTouch(
            {
              target: `PR #${pull.number}`,
              body: review.body,
              timestamp: review.submitted_at ?? pull.updated_at,
              source: "review",
            },
            options
          )
        );
      })
    );
    touches.push(...results.flat());
  }
  return touches;
}

function collectCommitTouches(
  options: CliOptions,
  lookup: PullLookup
): FactoryTouch[] {
  const gitOutput = runCommand("git", [
    "log",
    "--all",
    "--source",
    `--since=${options.since}`,
    `--until=${options.until}`,
    "--format=%H%x1f%aI%x1f%S%x1f%(trailers:key=Agent-Model)%x1f%(trailers:key=Agent-Role)%x1e",
  ]);
  return parseGitLogOutput(gitOutput, lookup);
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
  const rows = summarizeTouches([
    ...pullResult.touches,
    ...collectIssueTouches(issues, options),
    ...collectCommentTouches(comments, options),
    ...reviewTouches,
    ...collectCommitTouches(options, pullResult.lookup),
  ]);
  console.log(
    options.isJson ? JSON.stringify(rows, null, 2) : formatTable(rows)
  );
}

if (import.meta.main) {
  await main();
}
