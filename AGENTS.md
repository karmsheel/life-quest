# AGENTS.md — how to work in this repo

This is the file an agent is handed first. It routes you to the plan pack and records the
machine-specific workflow; the rules themselves live in one place.

## Read before you code

| Read | For |
|---|---|
| [`PRD.md`](PRD.md) | What the product is, for whom, and which requirements a change must keep |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | Stack, folders, data flow, where each contract lives |
| [`DESIGN.md`](DESIGN.md) | Colors, fonts, components, motion, and the vibe |
| [`RULES.md`](RULES.md) | Coding conventions, workflow, and the never-do list — **canonical** |
| [`TASKS.md`](TASKS.md) | What is being worked on now, and its definition of done |
| [`PROGRESS.md`](PROGRESS.md) | What shipped, what broke, what is next |

Also: [`LAWS/`](LAWS/README.md) holds observable product invariants (RFC 2119), and
[`docs/wiki/`](docs/wiki/index.md) is the operator guide that must stay true to the app.
Where these disagree with the code, the code is right — then fix the doc.

## Use the CLI first

- Use `./bin/agent-cli` first: prefer it over re-reading files or guessing commands.
  `agent-cli --help` shows the command set; `status`, `git`, `bench`, `e2e`, `check`, `flow`,
  `docs`, `find`, `where`, `map`, `db`, `logs`, `env` and `layout` answer the lookups past
  sessions repeated, and `--json` gives the same data for parsing.
- The CLI's evidence behind it refreshes itself: `scripts/refresh-agent-cli.sh` re-mines the
  session corpus, re-runs the benchmark and re-runs the CLI's E2E once a week
  (`agent-cli-refresh.timer`), writing to `.scratch/agent-cli/`. Run
  `./scripts/refresh-agent-cli.sh --check` to see its state; the last run's summary is
  `/var/log/agent-cli-refresh/latest.md`.

## The project wiki

- The operator-facing wiki is `docs/wiki/` (Markdown) and is published at
  <https://karmsheel.github.io/life-quest/> by `.github/workflows/docs.yml`.
  `docs/wiki/index.md` is the site home.
- Any change a user can see updates its wiki page in the same branch. A feature that changes a
  rail label, route, Settings tab, or the release version must update the wiki, or
  `npm run docs:check` fails.
- `npm run docs:check` is the gate: it checks the index's "Version covered" against
  `apps/desktop/package.json`, every route in `App.tsx`, every rail label and wing label, every
  Settings tab, every internal link, the MkDocs nav, each page's shape, and (since the plan
  pack landed) the six root planning docs. CI runs it on every PR, on master, and weekly
  (`docs-check.yml`); a weekly failure opens an issue.
- `npm run release` runs the same check before electron-builder starts and refuses to build a
  stale wiki. `npm run docs:serve` previews the site; `npm run docs:build` builds it.
- The **Releases** page is generated from the GitHub Releases feed at build time
  (`scripts/build-docs.mjs`), and the docs workflow rebuilds on `release: published`, so every
  published release appears on the site without a wiki edit.

## Worktrees

- If this thread will modify files and the `create_worktree` tool is available, start it in its
  own worktree from the primary checkout before editing, with a task-named branch (for example
  `feat/<slug>`). Do all edits there.
- If the session is already inside a worktree, do not create another; work in the current
  checkout.
- New worktrees start at committed HEAD; staged, unstaged, and untracked files stay in the
  source checkout. Commit anything the new thread must inherit.

## The VPS test bench

This machine is headless. The app runs on a virtual X display and the human watches it in a
browser over Tailscale:

- `lifequest-display.service` (enabled at boot) owns Xvfb `:99`, x11vnc on loopback, and noVNC
  on `http://100.88.181.80:6080/vnc.html?autoconnect=1&resize=scale`.
- One app sits on that display. `/root/.local/bin/lifequest-dev [checkout]` starts
  `npm run dev` for a checkout there, replacing whatever was on it; `--status` says which
  checkout is being served, `--stop` stops it.
- `/root/.local/bin/lifequest-shot [out.png]` captures the display without the browser, for an
  artifact you can link.
- There is exactly one bench: do not start a second `npm run dev` or bind 5173 by hand. Vite
  runs with `strictPort`, and a second app would also fight the profile and the companion's MCP
  doors.
- Moving the bench restarts the app and reopens its vault. Say so before moving it if the human
  may be looking, and put the primary checkout back
  (`lifequest-dev /root/projects/life-quest`) when you are done unless they asked you to leave
  your branch on it.

## Running E2E against your checkout

1. Work in your worktree and run `npm ci` there once. Do not symlink the primary checkout's
   `node_modules`: workspace links then resolve `@lifequest/vault-core` to the primary tree and
   the worktree silently runs the wrong engine.
2. Run E2E through `/root/.local/bin/lifequest-e2e <worktree> [tests/<name>.test.ts ...]`. It
   holds a lock, puts that checkout's dev server on 5173 under a throwaway profile, runs the
   tests, and restores the previous bench even when they fail. A bare `npm test` can test
   another branch's code — the rigs load whatever is on 5173 — or pass by skipping every rig
   when no server is up.
3. A skipped rig is evidence of nothing. Count only a run whose report artifact exists and
   whose picture shows the shipped screen.

## Handing a change over for testing

The operator runs several branches at once and does QC in batches. Do not expect them to watch,
and do not put a branch on the bench until they ask.

When the work is done and its E2E has passed, declare it in this shape and then stop:

    READY FOR TESTING — <feature in one line>
    branch: <branch> at <short sha>
    artifact: <path> — <what it shows>
    try: <the interaction that proves it>

"Ready" means all four are true: the relevant rig ran against THIS checkout, the report
artifact exists, the picture or video shows the shipped UI rather than a mock, and you have
presented it (`present`) so the operator can open it later. Pictures come from the rig's own
`capturePage`; use `/root/.local/bin/lifequest-record [out.mp4] [seconds]` only for motion a
still cannot show — it records the bench, so put your branch on it first and restore
afterwards.

Then wait. "Ready" is a statement, not a request to start: do not move the bench, merge, or
push. The bench moves only when the operator says "let's test this" or names the branch — then
run `lifequest-dev <worktree>`, reply with the VNC URL, and leave the app alone. Merge
(`--no-ff` in the primary checkout) and push only after they say the branch is good. If they
report a defect, fix it in the same worktree and hand over again with a new artifact and a new
"ready".

For the human test the bench opens the operator's real profile and vault, so a branch that
migrates storage changes real data when it is put there. Say so before the handover and test
that branch against a copy.

## When in doubt

- A user-visible change updates its wiki page, and its law if behavior changed.
- A release is not a release until `npm run release`, the packaged smoke test, and the live
  update feed have passed ([`RULES.md`](RULES.md) §4).
- If the queue and `git worktree list` disagree, the worktrees are right — fix
  [`TASKS.md`](TASKS.md).
