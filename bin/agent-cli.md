# bin/agent-cli

One place where an agent finds the facts, lookups, and canonical commands it
keeps re-deriving from the transcript corpus (12k+ bash calls, thousands of
`git status` / `rg` / `lifequest-*` repeats). Zero dependencies, Node 22 builtins
only; read-only by default.

## Use

```bash
./bin/agent-cli                    # status: cwd, checkout, branch, dirty, bench, deps, e2e
./bin/agent-cli help --json        # discover every command/action
./bin/agent-cli <cmd> --help       # one command
./bin/agent-cli <cmd> [action] --json
```

Repo root is `dirname(dirname(realpath(argv[1])))`, so it works from any cwd and
reports the checkout it lives in (worktree stays a worktree). `AGENT_CLI_ROOT`
overrides the root. Exit codes: `0` ok, `1` runtime failure/no match, `2` usage.

## JSON contract

- Success: one object on stdout — `{"cmd":"<name>","ok":true,"data":{...}}`.
- Runtime failure: `{"cmd":"<name>","ok":false,"error":"..."}` + exit 1.
- Usage error: `agent-cli: ...` on stderr + exit 2.
- `help --json` lists every command with `{name, summary, usage, actions,
  supportsJson:true}`; text mode is terse `key=value` lines (default actions are
  kept to roughly 25 lines, `--json` carries the full data).

## Commands and actions

| Command | Actions (default first) | Replaces |
|---|---|---|
| `status` | state in one shot | `pwd` + `git status` + `git log -3` + bench/deps probes |
| `git` | state, log `[--limit N]`, diff `[--stat\|--name-only] [base]`, branch, worktrees | hundreds of git status/log/diff/branch/worktree calls |
| `bench` | status, url, shot `[out]`, move `<checkout>`, stop; `--dry-run` | `lifequest-dev --status`, `lifequest-shot` |
| `e2e` | how `[tests...]`, list `[--grep]`, last `[--tail N]`, run `[tests...]` `--dry-run` | `lifequest-e2e` invocation + test selection + report guessing |
| `check` | deps, typecheck `[--tail N]`, summary; `--dry-run` on typecheck | `npm run typecheck`, `npm ci`, vault-core resolution probes |
| `flow` | merge, release, cleanup, handover | "sync, verify, merge, push", worktree cleanup, release checklists |
| `docs` | list, show `<agents\|design\|readme\|product\|vision\|laws/NAME\|path>` `[--section]`, search `<term>` | repeated full reads of README/AGENTS/DESIGN/LAWS |
| `find` | `<pattern> [--under] [--kind file\|dir] [--worktrees]` | glob/find/worktree path juggling |
| `where` | `<term> [--under] [--limit N]` | 72+ `rg -n` calls (repo-relative, exit 1 with `matches=0`) |
| `map` | `[area]` — chat, shell, electron, vault-core, e2e, docs | "where is X implemented" lookups |
| `db` | files, schema `[model]`, query `"<sql>" --db <path>` (read-only sqlite) | prisma/schema + sqlite probes |
| `logs` | list, tail `<name\|path> [--bytes N]` | tail/read loops over rig logs and artifacts |
| `env` | versions/ports/display/lock/disk/worktrees | which/ps/lsof/ss probes |
| `layout` | entrypoints, scripts, key files | `ls` + repeated `cat package.json` |

## Safety

Read-only by default. The only mutating actions are `bench move|stop|shot`,
`e2e run`, and `check typecheck` — each explicit and each `--dry-run` where it
spawns; `db query` opens SQLite read-only. `check typecheck` keeps its last-run
summary in the gitignored `.scratch/agent-cli/`, and nothing else writes.

## Extending

Add one `command({ name, summary, usage, actions, flags, defaultAction, run })`
entry in `bin/agent-cli`. `run(ctx, action)` gets `ctx.json`, `ctx.args`,
`ctx.flags`; use `emit(ctx, textLines, data)` so text and `--json` stay in sync.
A new command is discovered by `help --json` automatically; new spawning actions
must take `--dry-run` and must not write inside the repo.
