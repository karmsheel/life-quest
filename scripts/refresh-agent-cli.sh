#!/usr/bin/env bash
# refresh-agent-cli.sh — keep bin/agent-cli's evidence fresh, once a week.
#
# The CLI itself is hand-written; what goes stale is the evidence behind it:
# the mined inventory of repeated asks/lookups/reads/commands, and the
# before/after benchmark derived from it. This script re-derives that evidence
# from the live session corpus and leaves a report of what changed.
#
# It NEVER touches the repo: it writes only under .scratch/agent-cli/ (gitignored)
# and under /var/log/agent-cli-refresh/ (outside the repo). It never moves the
# bench, never starts a server, never commits, never pushes.
#
#   scripts/refresh-agent-cli.sh              run the refresh now
#   scripts/refresh-agent-cli.sh --check      report status, change nothing
#
# Exit codes: 0 ok, 1 refresh failed, 2 usage error.
set -uo pipefail

REPO="${AGENT_CLI_REPO:-/root/projects/life-quest}"
SCRATCH="$REPO/.scratch/agent-cli"
BENCH_DIR="$SCRATCH/bench"
LOG_DIR="${AGENT_CLI_REFRESH_LOG_DIR:-/var/log/agent-cli-refresh}"
SNAPSHOT_DIR="${AGENT_CLI_REFRESH_SNAPSHOT_DIR:-/var/lib/agent-cli-refresh/corpus}"
CORPUS="${MINE_CORPUS:-/root/.dsh/sessions/--root-projects-life-quest--}"
NODE_BIN="${NODE_BIN:-$(command -v node)}"
LOCK="${AGENT_CLI_REFRESH_LOCK:-/run/lifequest-e2e.lock}"

die() { printf 'refresh-agent-cli: %s\n' "$*" >&2; exit 1; }
usage() {
  printf 'usage: %s [--check]\n' "$0" >&2
  exit 2
}

CHECK_ONLY=0
for arg in "$@"; do
  case "$arg" in
    --check) CHECK_ONLY=1 ;;
    -h | --help) usage ;;
    *) usage ;;
  esac
done

[ -d "$REPO" ] || die "repo not found: $REPO"
[ -f "$REPO/bin/agent-cli" ] || die "bin/agent-cli not found in $REPO"
[ -f "$SCRATCH/mine.mjs" ] || die "miner missing: $SCRATCH/mine.mjs (expected in the repo's .scratch/agent-cli/)"
[ -f "$BENCH_DIR/bench.mjs" ] || die "benchmark missing: $BENCH_DIR/bench.mjs"
[ -x "$NODE_BIN" ] || die "node not found at $NODE_BIN"
command -v zstd >/dev/null 2>&1 || die "zstd is required (the miner shells out to zstd -dc)"

log() { printf '%s %s\n' "$(date -Is)" "$*"; }

# --- status only ------------------------------------------------------------
if [ "$CHECK_ONLY" -eq 1 ]; then
  printf 'repo=%s\n' "$REPO"
  printf 'cli.sha256=%s\n' "$(sha256sum "$REPO/bin/agent-cli" | cut -d' ' -f1)"
  printf 'cli.commit=%s\n' "$(git -C "$REPO" rev-parse --short HEAD 2>/dev/null || echo unknown)"
  if [ -f "$SCRATCH/FROZEN.json" ]; then
    printf 'frozen.generatedAt=%s\n' "$(sed -n 's/.*"generatedAt": "\([^"]*\)".*/\1/p' "$SCRATCH/FROZEN.json")"
    printf 'frozen.sessions=%s\n' "$(sed -n 's/.*"sessions": \([0-9]*\).*/\1/p' "$SCRATCH/FROZEN.json")"
    printf 'frozen.sha256=%s\n' "$(sed -n 's/.*"sha256": "\([^"]*\)".*/\1/p' "$SCRATCH/FROZEN.json")"
  else
    printf 'frozen.generatedAt=<none>\n'
  fi
  printf 'corpus.sessions=%s\n' "$(ls -1 "$CORPUS" 2>/dev/null | wc -l)"
  printf 'snapshot=%s\n' "$SNAPSHOT_DIR"
  exit 0
fi

# --- one refresh at a time --------------------------------------------------
# Two locks, for two different jobs:
#   * a refresh lock, so two refreshes never overlap each other;
#   * the E2E bench lock, so the refresh never runs while a test suite has the
#     bench. The bench lock is SHARED with lifequest-e2e, which is why we wait
#     for it rather than refuse: a weekly refresh that skipped because a test
#     happened to be running would silently never refresh.
#
# If the bench is busy past the wait, we exit 75 (EX_TEMPFAIL) — the systemd
# unit treats that as "try again shortly" instead of a successful run.
exec 9>"${AGENT_CLI_REFRESH_LOCK:-/run/agent-cli-refresh.lock}"
if ! flock -n 9; then
  log "another refresh is already running; skipping"
  exit 0
fi

mkdir -p "$SCRATCH" "$BENCH_DIR" "$LOG_DIR" "$SNAPSHOT_DIR"
RUN_LOG="$LOG_DIR/$(date +%Y-%m-%d).log"
exec >>"$RUN_LOG" 2>&1
log "=== refresh start (repo=$REPO)"

BENCH_WAIT="${AGENT_CLI_REFRESH_BENCH_WAIT:-900}"
if [ -e "$LOCK" ]; then
  log "waiting up to ${BENCH_WAIT}s for the bench lock (a test run may be active)"
  if ! flock -w "$BENCH_WAIT" "$LOCK" -c 'true' 2>/dev/null; then
    log "bench still busy after ${BENCH_WAIT}s; deferring this refresh (exit 75)"
    exit 75
  fi
  log "bench lock is free"
fi

# The cutoff is the moment the snapshot starts: a session file modified after
# this instant is still being written by a live agent, so the miner will drop
# it and the benchmark will never see a half-written transcript.
CUTOFF_MS="$(date +%s)000"

# 1. Snapshot the corpus. Copying first and mining the copy is what makes two
#    runs byte-identical: the miner then only sees sessions as they were at
#    the cutoff, never ones being appended by another agent mid-run. The miner
#    applies MINE_BEFORE_MS by mtime, so in-flight sessions are excluded twice
#    over — once by the cutoff, once because their bytes are still changing.
SNAPSHOT_TMP="$(mktemp -d "${SNAPSHOT_DIR}.new.XXXXXX")"
SNAPPED=0
for d in "$CORPUS"/*/; do
  [ -d "$d" ] || continue
  f="$d/session.v4.jsonl.zstd"
  [ -f "$f" ] || continue
  if cp -a "$d" "$SNAPSHOT_TMP/" 2>/dev/null; then SNAPPED=$((SNAPPED + 1)); fi
done
rm -rf "${SNAPSHOT_DIR}.old"
if [ -d "$SNAPSHOT_DIR" ]; then mv "$SNAPSHOT_DIR" "${SNAPSHOT_DIR}.old"; fi
mv "$SNAPSHOT_TMP" "$SNAPSHOT_DIR"
rm -rf "${SNAPSHOT_DIR}.old"
log "snapshot: $SNAPPED sessions -> $SNAPSHOT_DIR"

if [ "$SNAPPED" -lt 1 ]; then
  die "snapshot is empty — refusing to overwrite good evidence with nothing"
fi

# 2. Mine the snapshot.
OLD_SHA=""
[ -f "$SCRATCH/FROZEN.json" ] && OLD_SHA="$(sed -n 's/.*"sha256": "\([^"]*\)".*/\1/p' "$SCRATCH/FROZEN.json")"

MINE_OUT="$(cd "$SCRATCH" && MINE_CORPUS="$SNAPSHOT_DIR" MINE_BEFORE_MS="$CUTOFF_MS" "$NODE_BIN" mine.mjs)"
echo "$MINE_OUT" | tail -3
if [ ! -f "$SCRATCH/repeats.json" ] || [ ! -f "$SCRATCH/repeats.md" ]; then
  die "mining produced no output"
fi

NEW_SHA="$(sha256sum "$SCRATCH/repeats.json" | cut -d' ' -f1)"
log "repeats.json sha256: $NEW_SHA (was ${OLD_SHA:-<none>})"

# 3. Record the freeze manifest the benchmark reconciles against.
"$NODE_BIN" - "$SCRATCH" "$SNAPSHOT_DIR" "$CUTOFF_MS" "$NEW_SHA" <<'NODE'
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

const [scratch, snapshot, cutoffMs, sha] = process.argv.slice(2);
const stats = JSON.parse(fs.readFileSync(path.join(scratch, "mine.stats.json"), "utf8"));
const sessionsCsv = fs.readFileSync(path.join(scratch, "sessions.csv"));
const repeatsMd = fs.readFileSync(path.join(scratch, "repeats.md"));

const fingerprint = createHash("sha256");
const dirs = fs.readdirSync(snapshot).sort();
for (const d of dirs) {
  const f = path.join(snapshot, d, "session.v4.jsonl.zstd");
  if (!fs.existsSync(f)) continue;
  const st = fs.statSync(f);
  fingerprint.update(`${d}:${st.size}:${Math.floor(st.mtimeMs)}\n`);
}

fs.writeFileSync(
  path.join(scratch, "FROZEN.json"),
  JSON.stringify(
    {
      generatedAt: new Date(Number(cutoffMs)).toISOString(),
      cutoffMs: Number(cutoffMs),
      sha256: sha,
      sha256_sessionsCsv: createHash("sha256").update(sessionsCsv).digest("hex"),
      sha256_repeatsMd: createHash("sha256").update(repeatsMd).digest("hex"),
      corpusFingerprint: fingerprint.digest("hex"),
      corpusSnapshot: snapshot,
      stableAcrossTwoRuns: null,
      counts: {
        sessions: stats.sessions,
        root: stats.root,
        subagent: stats.subagents,
        toolCalls: stats.toolCalls,
        bash: stats.bash,
        read: stats.readCalls,
        resultChars: stats.toolResultTextChars,
        tokens: Math.round(stats.toolResultTextChars / 4),
      },
    },
    null,
    2,
  ) + "\n",
);
NODE
[ -f "$SCRATCH/FROZEN.json" ] || die "could not write FROZEN.json"

# 4. Re-run the before/after benchmark against the fresh snapshot.
AGENT_CLI_BENCH_CORPUS="$SNAPSHOT_DIR" "$NODE_BIN" "$BENCH_DIR/bench.mjs" | tail -3
[ -f "$BENCH_DIR/report.md" ] || die "benchmark produced no report"

# 5. Run the CLI's own black-box E2E against the current binary — a stale or
#    broken CLI must not pass unnoticed just because the evidence refreshed.
if "$NODE_BIN" "$REPO/bin/agent-cli.e2e.mjs" | tail -2; then
  E2E="pass"
else
  E2E="fail"
fi
log "E2E: $E2E"

# 6. Write the weekly change report the operator reads.
"$NODE_BIN" - "$SCRATCH" "$LOG_DIR" "$OLD_SHA" "$NEW_SHA" "$E2E" "$CUTOFF_MS" <<'NODE'
import fs from "node:fs";
import path from "node:path";

const [scratch, logDir, oldSha, newSha, e2e, cutoffMs] = process.argv.slice(2);
const stats = JSON.parse(fs.readFileSync(path.join(scratch, "mine.stats.json"), "utf8"));
const repeats = JSON.parse(fs.readFileSync(path.join(scratch, "repeats.json"), "utf8"));
const report = fs.existsSync(path.join(scratch, "bench", "report.json"))
  ? JSON.parse(fs.readFileSync(path.join(scratch, "bench", "report.json"), "utf8"))
  : null;

const prev = path.join(logDir, "previous.json");
let before = null;
if (fs.existsSync(prev)) {
  try { before = JSON.parse(fs.readFileSync(prev, "utf8")); } catch {}
}
const now = {
  generatedAt: new Date(Number(cutoffMs)).toISOString(),
  sha256: newSha,
  sessions: stats.sessions,
  toolCalls: stats.toolCalls,
  bash: stats.bash,
  read: stats.readCalls,
  resultChars: stats.toolResultTextChars,
  tokens: Math.round(stats.toolResultTextChars / 4),
  callsReplaced: report?.totals?.unionCalls ?? null,
  tokensReplaced: report?.totals?.unionResultTokens ?? null,
  e2e,
  // Sessions still being written when the cutoff passed: the miner drops them
  // so no half-written transcript is ever counted. A small negative delta in
  // sessions between two runs is this, not lost history.
  skippedLive: repeats?.meta?.liveSessionsSkippedByCutoff ?? null,
};
fs.writeFileSync(prev, JSON.stringify(now, null, 2) + "\n");

const d = (k) => (before && before[k] !== undefined ? Number(before[k]) : null);
const delta = (k) => {
  const a = d(k), b = now[k];
  return a === null || b === null ? "—" : `${b - a >= 0 ? "+" : ""}${b - a}`;
};

const lines = [
  `# agent-cli evidence refresh — ${now.generatedAt}`,
  "",
  `- evidence sha256: \`${now.sha256}\``,
  `- corpus: ${now.sessions} sessions, ${now.toolCalls} tool calls (${now.bash} bash, ${now.read} read), ${now.resultChars} result chars ≈ ${now.tokens} tokens`,
  `- CLI black-box E2E: **${e2e}**`,
  now.skippedLive ? `- skipped ${now.skippedLive} session(s) still being written at the cutoff (in-flight agents; they land in the next run)` : "",
  "",
  "| metric | previous | now | delta |",
  "|---|---:|---:|---:|",
  `| sessions | ${d("sessions") ?? "—"} | ${now.sessions} | ${delta("sessions")} |`,
  `| tool calls | ${d("toolCalls") ?? "—"} | ${now.toolCalls} | ${delta("toolCalls")} |`,
  `| result chars | ${d("resultChars") ?? "—"} | ${now.resultChars} | ${delta("resultChars")} |`,
  `| calls the CLI replaces | ${d("callsReplaced") ?? "—"} | ${now.callsReplaced ?? "—"} | ${delta("callsReplaced")} |`,
  `| tokens the CLI replaces | ${d("tokensReplaced") ?? "—"} | ${now.tokensReplaced ?? "—"} | ${delta("tokensReplaced")} |`,
  "",
  "The CLI binary itself is hand-written and only changes when someone edits it;",
  "this refresh keeps the mined evidence and the benchmark honest.",
  "",
];
const out = path.join(logDir, "latest.md");
fs.writeFileSync(out, lines.join("\n"));
console.log(lines.join("\n"));
NODE

log "=== refresh done (e2e=$E2E)"
