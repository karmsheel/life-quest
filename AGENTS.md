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

## Testing a branch on the bench

1. Work in your worktree and run `npm ci` there once. Do not symlink the primary checkout's `node_modules`: workspace links then resolve `@lifequest/vault-core` to the primary tree and the worktree silently runs the wrong engine.
2. Run the worktree's e2e rigs, or `lifequest-dev <worktree>` when the change needs a human look. Hand over the noVNC URL and wait.
3. The bench uses the operator's real profile and vault, so a branch that migrates storage changes real data on open. If the branch touches the vault schema, point it at a copy (or a throwaway `LIFEQUEST_E2E` profile) before opening it.
4. Merge and push only after an explicit go-ahead from the human. The merge happens in the primary checkout (`git merge --no-ff <branch>`), then push. Never merge or push on your own initiative, and never move the bench back before the human has finished looking.

