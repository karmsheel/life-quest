\- Never write unit tests after you write code.



\- Highly prefer E2E tests as the sole testing mechanism. Use them to verify complex features work. At the end of E2E tests, produce a verifiable and repeatable artifact.



\- If you must test a system in isolation, first write down all the ways it could fail, then write the code."



\- If a feature change only takes effect after a restart - a rebuilt main process, a changed preload or IPC channel, a dev server serving stale bundles - do the restart yourself at the end of the work, then verify the feature against the restarted process. In `apps/desktop`, `npm run dev` rebundles main and preload and relaunches the app, so that is the whole restart. Alerting the operator is not doing it, and a feature checked against a stale process is not checked. Restart only what the change needs; ask before stopping a process that is the operator's rather than one you started.

## Worktrees

- If this thread will modify files and the `create_worktree` tool is available, start it in its own worktree from the primary checkout before editing, with a task-named branch (for example `feat/<slug>`). Do all edits there.
- If the session is already inside a worktree, do not create another; work in the current checkout.
- New worktrees start at committed HEAD; staged, unstaged, and untracked files stay in the source checkout. Commit anything the new thread must inherit.

## The VPS test bench

This machine is headless. The app runs on a virtual X display and the human watches it in a browser over Tailscale:

- `lifequest-display.service` (enabled at boot) owns Xvfb `:99`, x11vnc on loopback, and noVNC on `http://100.88.181.80:6080/vnc.html?autoconnect=1&resize=scale`.
- One app sits on that display. `/root/.local/bin/lifequest-dev [checkout]` starts `npm run dev` for a checkout there, replacing whatever was on it; `--status` says which checkout is being served, `--stop` stops it.
- `/root/.local/bin/lifequest-shot [out.png]` captures the display without the browser, for an artifact you can link.
- There is exactly one bench: do not start a second `npm run dev` or bind 5173 by hand. Vite runs with `strictPort`, and a second app would also fight the profile and the companion's MCP doors.
- Moving the bench restarts the app and reopens its vault. Say so before moving it if the human may be looking, and put the primary checkout back (`lifequest-dev /root/projects/life-quest`) when you are done unless they asked you to leave your branch on it.

## Running E2E against your checkout

1. Work in your worktree and run `npm ci` there once. Do not symlink the primary checkout's `node_modules`: workspace links then resolve `@lifequest/vault-core` to the primary tree and the worktree silently runs the wrong engine.
2. Run E2E through `/root/.local/bin/lifequest-e2e <worktree> [tests/<name>.test.ts ...]`. It holds a lock, puts that checkout's dev server on 5173 under a throwaway profile, runs the tests, and restores the previous bench even when they fail. A bare `npm test` can test another branch's code — the rigs load whatever is on 5173 — or pass by skipping every rig when no server is up.
3. A skipped rig is evidence of nothing. Count only a run whose report artifact exists and whose picture shows the shipped screen.

## Handing a change over for testing

The operator runs several branches at once and does QC in batches. Do not expect them to watch, and do not put a branch on the bench until they ask.

When the work is done and its E2E has passed, declare it in this shape and then stop:

    READY FOR TESTING — <feature in one line>
    branch: <branch> at <short sha>
    artifact: <path> — <what it shows>
    try: <the interaction that proves it>

"Ready" means all four are true: the relevant rig ran against THIS checkout, the report artifact exists, the picture or video shows the shipped UI rather than a mock, and you have presented it (`present`) so the operator can open it later. Pictures come from the rig's own `capturePage`; use `/root/.local/bin/lifequest-record [out.mp4] [seconds]` only for motion a still cannot show — it records the bench, so put your branch on it first and restore afterwards.

Then wait. "Ready" is a statement, not a request to start: do not move the bench, merge, or push. The bench moves only when the operator says "let's test this" or names the branch — then run `lifequest-dev <worktree>`, reply with the VNC URL, and leave the app alone. Merge (`--no-ff` in the primary checkout) and push only after they say the branch is good. If they report a defect, fix it in the same worktree and hand over again with a new artifact and a new "ready".

For the human test the bench opens the operator's real profile and vault, so a branch that migrates storage changes real data when it is put there. Say so before the handover and test that branch against a copy.

