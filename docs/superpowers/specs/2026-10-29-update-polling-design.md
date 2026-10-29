# Update polling — Design Spec

**Date:** 2026-10-29  
**Status:** Approved — implemented  
**Product:** LifeQuest — local-first life-management studio  
**Depends on:** [Auto-update](./2026-10-12-auto-update-design.md)

The auto-update feature read GitHub once, at launch, and put the news at the foot
of the rail. A release published five minutes later stayed invisible until the
operator clicked the build number — and they had no reason to click it, because
nothing said there was news. This spec adds the missing half: the app reads the
feed on a clock while it is running, and tells the operator without being asked.

---

## 1. Purpose

The reported fault: *"When a user is using the app and a new update is available,
they can only see it if they click the version number in the left sidebar."*

The build number's glow works, but it is one quiet line in a column of icons, and
the launch's check is only true at launch. Two things were missing:

1. **A cadence.** Nothing read the feed again after the launch, so a release cut
   during a working session produced no state change at all.
2. **A tell.** Even when the launch found a release, the only sign was a caption
   above the version number — which the operator had already learned to ignore.

### Success criteria

- A release published while the app is open reaches the renderer within the
  poll interval, with no click, no reload, and no change of screen.
- The operator gets an in-app notice naming the release and the running build,
  offering the upgrade and a dismissal.
- If the window is not focused, the OS gets a notification too, so a minimised
  app can still tell them.
- The same release is announced once per session; a dismissed notice does not
  come back for that release.
- A failed poll is silent and does not erase an offer the operator can still
  install.
- The shipped bundle contains no poll interval override and no test seam.

---

## 2. Why polling and not a webhook

A GitHub webhook needs a publicly reachable HTTPS endpoint that GitHub can POST
to, and a secret to verify it with. LifeQuest is a local-first desktop app: it
opens no listener other than loopback MCP doors, holds no server, and has no
public address. Standing one up would mean hosting infrastructure for every
operator, plus a credential in the app — two things this product deliberately
does not have.

Polling is the shape that fits the product: one anonymous GET of the public
`releases/latest` feed, on a timer, in main. GitHub's unauthenticated rate limit
(60 requests/hour/IP) is far above four reads an hour.

---

## 3. Locked product decisions

| # | Topic | Decision |
|---|--------|----------|
| 1 | Where | **Main process.** A renderer timer is throttled when the window is hidden, and a hidden app is exactly when OS notification matters. Main owns the clock; the renderer owns the drawing. |
| 2 | Cadence | **Every 15 minutes** (`UPDATE_POLL_MS`), armed once when the app is ready, beside the FX refresh loop. The launch check is unchanged. An in-flight read is skipped, so reads never queue. |
| 3 | Channel | One push channel, `update:decision` → `onUpdateDecision`, carrying the feed's answer (`available` or `current`). Main has no polling state the renderer re-derives: the feed's latest answer is the one on screen. |
| 4 | Notice | An in-app card at the foot of the content column — the version, the running build, *View update*, and a dismissal. Portalled to `body`, `role="status"`, `aria-live="polite"`, never focused, never modal. |
| 5 | Notice lifetime | Once per release per session. A dismissal is final for that release. A release that disappears from the feed clears the notice; if it comes back, it is news again. |
| 6 | OS notification | When the window is not focused, main also shows a native `Notification`. When it is focused, the in-app notice is the whole tell — two notifications for one release is one too many. |
| 7 | Failed reads | Silent. A background read that cannot answer restores the session's previous answer and leaves the offered installer in place: a check that did not happen is not news, and it must not disarm an offer the operator can still install. |
| 8 | Manual checks | Unchanged: the rail's build number and Settings → *Check now* force a read; their failure clears the offer, because the answer on screen was the one the operator just asked for. |
| 9 | Test seam | `LIFEQUEST_E2E.updatePollMs` shortens the interval for the rig only. The shipped bundle compiles the seam out (`__LIFEQUEST_E2E_SEAM__` false), so the product's cadence has no override. |
| 10 | Out of scope | Webhooks/hosted infrastructure, silent install, a bell/inbox notification centre, per-channel (stable/beta) cadence, and any stored credential. |


---

## 4. Failure modes (written before the code)

1. **Two reads overlap on a slow feed** — the tick is skipped while one is in
   flight, so reads cannot queue and two answers cannot land out of order.
2. **A read fails** (offline, 404, rate limit) — quiet; the previous offer and
   the session's cached answer stand.
3. **The same release every tick** — announced once; `reported` remembers it.
4. **A release withdrawn** — the watch reports `current` once; the renderer drops
   the glow, the notice, and the offered installer together.
5. **A watch push races a launch/manual check** — a `newsSeq` guard drops the
   older answer when it resolves, so the newer fact wins regardless of order.
6. **The operator dismisses the notice** — `announced` remembers the release, so
   later ticks do not raise it again.
7. **A bridge with no push channel** (an older preload, a harness proxy) — the
   subscription is skipped; a missing channel is a quiet app, not a thrown rail.
8. **A listener throws / a notification is refused by the OS** — the watch's
   clock survives; the in-app notice is still there.
9. **A notification fires for a test run** — suppressed under the e2e seam, so a
   hidden rig window never pops a real desktop notification on the test machine.

---

## 5. Files

| File | Role |
|------|------|
| `electron/updater.ts` | `UPDATE_POLL_MS`, `startUpdateWatch`, and the `background` read that leaves a failed poll quiet. |
| `electron/main.ts` | Arms the watch; broadcasts `update:decision`; shows the native notification when no window is focused; the `updatePollMs` seam. |
| `electron/preload.ts` | `onUpdateDecision` — the one new bridge method (no secret). |
| `src/state/UpdateProvider.tsx` | Subscribes to the watch; announces a release once; the notice state and dismissal; the race guard. |
| `src/components/shell/UpdateNotice.tsx` | The in-app card, and the real `UpdateDialog` it opens. |
| `src/App.tsx` | Mounts the notice above every route and outside the vault gate. |
| `src/styles/global.css` | The notice's card, ink, motion, and narrow-window wrap. |

---

## 6. Acceptance

`npm test`, and one new rig that runs the **real** main process, preload, and
renderer against a feed whose answer changes while the app is running:

| Rig | Proves |
|-----|--------|
| `e2e/update-poll.electron.mjs` | Launch with nothing to offer is quiet; a release published after launch reaches the renderer over IPC with no click; the notice names the release and the running build, is a polite status region, and stays inside the window; the same release is not re-announced; a failing read is silent and the session's offer survives it; a withdrawal clears the notice and a republication announces it again; "View update" opens the real upgrade dialog; "Not now" keeps the notice; dismissing it ends the release's notice while the watch keeps reading. |
| `e2e/update-badge.electron.mjs` | Unchanged: the glow, the popup, the install, Settings, the Developer preview — now with the notice's provider subscription present and harmless. |
| `e2e/update-install.electron.mjs` | Unchanged: the version rules, the refusals, the real download, the flight, the hand-over. |

Artifacts: `e2e/artifacts/update-poll.json`, `update-poll-toast.png`,
`update-poll-dialog.png` (captured from the shipped renderer, not a mock).

The one thing no rig covers: whether the OS actually draws the native
notification on Windows — the e2e seam suppresses it, and a hidden window cannot
screenshot OS chrome.

---

## 7. What is not here

The release flow itself is unchanged. There is no hosted service, no webhook, no
token, and no auto-install: the operator still chooses "Download and install", and
main still asks them in a native dialog before running the executable.
