/**
 * E2E harness page for Daily Note — the rail entry and the page
 * (`components/shell/nav-items` + `pages/DailyNotePage`).
 *
 * The real shell, the real rail, the real page and the real stylesheet render
 * here; only the IPC bridge is stubbed, and it is a *recording* stub: every
 * method the page calls is listed, and anything else answers `{ ok: false }` and
 * is NAMED in `dailyNoteUnexpectedCalls`, so a page that grows a dependency this
 * rig does not model fails the run loudly instead of rendering a quietly empty
 * editor.
 *
 * ── How this can fail (written before the assertions) ────────────────────────
 *
 *  1. The rail entry is missing, or it is not where the operator was told it
 *     would be: directly under Decisions, above the divider, with an icon and a
 *     label, and pointing at `/notes`.
 *  2. The page lands on the wrong day — not the local today — so the note is
 *     written under a date the operator did not mean.
 *  3. The editor opens dirty: a freshly loaded day must not claim unsaved
 *     changes, or the page starts writing a day nobody touched.
 *  4. The autosave writes the wrong day, the wrong body, or writes the same prose
 *     over and over with nothing typed in between.
 *  5. The page keeps the pre-write draft after the write, so the editor disagrees
 *     with the file that was just written.
 *  6. An existing day does not load: the operator opens yesterday and sees an
 *     empty editor, which reads as "I wrote nothing" about a day they wrote.
 *  7. An empty day writes a file. "Write something first" is the rule; a draft
 *     typed and cleared before the page writes must reach no write at all.
 *  8. The future is reachable: Next day enabled on today, or a future-dated file
 *     offered in the journal strip, so a note can be written for a day that has
 *     not happened.
 *  9. A day that names no real date is offered as a link, so clicking it lands on
 *     an error instead of being reported as unreadable where it sits.
 * 10. A refused write loses the operator's draft — the one outcome that must
 *     never happen — or refuses silently, or is retried at the vault forever. A
 *     write that *fails* instead of being refused is treated as if it had landed,
 *     so the day is left with prose nobody can vouch for.
 * 11. The strip of earlier notes is empty after a write, so the day just written
 *     is invisible.
 * 12. The note is more than one box: a split grid or a preview pane comes back,
 *     so the operator reads and writes in two places that can disagree.
 * 13. The box does not render what was written — the markdown stays raw on the
 *     page — or it renders *all* of it, so the paragraph under the caret is not
 *     its own source. Both are the live preview being wrong in opposite ways.
 * 14. A bridge call this rig does not model, or a console error, passes
 *     unnoticed.
 * 15. A save control comes back, so the day is written only when the operator
 *     remembers to press something.
 * 16. The page's chrome is the engine's: the earlier-notes rows paint the
 *     platform's own button fill and keep the list's bullets, or the page's
 *     buttons are pills around a page of prose.
 *
 * The driver waits on `dailyNoteReady`, set after the rail and the editor have
 * painted, so it never samples a half-rendered page.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import {
  MemoryRouter,
  Route,
  Routes,
  useNavigate,
} from "react-router-dom";
import type { DailyNote, DailyNoteIndexEntry, VaultSnapshot } from "@lifequest/vault-core";
import { AppShell } from "@/components/shell/AppShell";
import { WindowTitleBar } from "@/components/shell/WindowTitleBar";
import DailyNotePage from "@/pages/DailyNotePage";
import ReviewPage from "@/pages/ReviewPage";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import { ChatDockProvider } from "@/state/ChatDockProvider";
import { NavDockProvider } from "@/state/NavDockProvider";
import { VaultProvider } from "@/state/VaultProvider";
import { applyAppSkin } from "./apply-app-skin";
import "@/styles/global.css";

// The app's own skin first: this rig judges the page the operator sees, so it has
// to paint in the palette they run rather than in the base tokens.
const skinName = applyAppSkin("dark");

type Result<T> = { ok: true; value: T } | { ok: false; error: string };
const ok = <T,>(value: T): Result<T> => ({ ok: true, value });
const fail = (error: string): Result<never> => ({ ok: false, error });

type WriteCall = { date: string; body: string; shown: string | null };

type HarnessWindow = Window & {
  dailyNoteReady?: boolean;
  dailyNoteSkin?: string;
  /** The journal the page reads and writes, keyed by date. */
  dailyNoteJournal?: Map<string, DailyNote>;
  /** Dates on disk that cannot be read as a day at all. */
  dailyNoteUnreadable?: string[];
  dailyNoteCalls?: string[];
  dailyNoteUnexpectedCalls?: string[];
  dailyNoteWrites?: WriteCall[];
  dailyNoteGets?: string[];
  /** When true, the next write is refused, to prove a draft survives a failure. */
  dailyNoteFailWrite?: boolean;
  /** When true, the next write rejects the way a dropped bridge does. */
  dailyNoteThrowWrite?: boolean;
  /** When true, a window read answers with an empty journal. */
  dailyNoteEmptyWindow?: boolean;
  /** Every window read the page made, so a driver can compute what to expect. */
  dailyNoteWindowCalls?: { start: string; end: string }[];
  dailyNoteSeed?: (date: string, body: string) => void;
  dailyNoteToday?: string;
  dailyNoteYesterday?: string;
  /** The day before yesterday: the rig's own empty day. */
  dailyNoteTwoBack?: string;
  /** On disk but in the future: the strip must never offer it. */
  dailyNoteTomorrow?: string;
  dailyNoteFarDay?: string;
  /** The year the far day's note was stamped with, for the last-edited column. */
  dailyNoteFarDayYear?: string;
  /** Move the harness router, so one rig can cover the page and the panel. */
  dailyNoteGoto?: (path: string) => void;
};

const harness = window as HarnessWindow;

harness.dailyNoteCalls = [];
harness.dailyNoteUnexpectedCalls = [];
harness.dailyNoteWrites = [];
harness.dailyNoteGets = [];
harness.dailyNoteFailWrite = false;
harness.dailyNoteThrowWrite = false;
harness.dailyNoteUnreadable = ["2026-02-31"];

const journal = new Map<string, DailyNote>();
harness.dailyNoteJournal = journal;

/** The same normalization the vault applies: prose, then exactly one newline. */
function canonical(body: string): string {
  const trimmed = body.replace(/\r\n/g, "\n").replace(/\s+$/, "");
  return trimmed === "" ? "" : `${trimmed}\n`;
}

function localToday(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function shift(date: string, days: number): string {
  const parsed = new Date(`${date}T00:00:00`);
  parsed.setDate(parsed.getDate() + days);
  return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, "0")}-${String(parsed.getDate()).padStart(2, "0")}`;
}

const today = localToday();
const yesterday = shift(today, -1);
const twoBack = shift(today, -2);
const tomorrow = shift(today, 1);
// Ten weeks back: always another week AND another month, so the panel can prove
// it shows the period and not the journal.
const farDay = shift(today, -70);
// The far day's note is stamped from another year, so the strip's last-edited
// column can be read back against the journal by its year alone — a value no page
// could arrive at from today's clock, and one no locale renders differently.
const farDayStamp = "2019-03-04T05:06:00.000Z";
const farDayYear = "2019";
harness.dailyNoteToday = today;
harness.dailyNoteYesterday = yesterday;
harness.dailyNoteTwoBack = twoBack;
harness.dailyNoteTomorrow = tomorrow;
harness.dailyNoteFarDay = farDay;
harness.dailyNoteFarDayYear = farDayYear;
harness.dailyNoteWindowCalls = [];
harness.dailyNoteEmptyWindow = false;

/**
 * The journal the page lands on: yesterday has a note, today does not. That pair
 * is what makes "an existing day loads" and "an empty day is empty" two different
 * observations rather than one.
 */
function seed(date: string, body: string, updatedAt?: string): void {
  const stamp = updatedAt ?? new Date().toISOString();
  journal.set(date, {
    date,
    createdAt: stamp,
    updatedAt: stamp,
    bodyMarkdown: canonical(body),
  });
}
seed(yesterday, "Yesterday: a walk, then the rig.");
// On disk but not a day, and dated in the future: the strip must report the first
// as unreadable and never offer the second.
seed(tomorrow, "Tomorrow: written by hand on disk.");
// A day the current period cannot contain, for the panel's window claim. Its
// second line is what makes "the body is rendered when opened" falsifiable, and
// its stamp is what makes the strip's last-edited column falsifiable.
seed(
  farDay,
  "Ten weeks ago: outside every current period.\n\nOnly visible if the window is wrong.",
  farDayStamp,
);

harness.dailyNoteSeed = seed;

const SNAPSHOT: VaultSnapshot = {
  rootPath: "C:\\harness\\vault",
  lifequest: {
    schemaVersion: 1,
    id: "harness-vault",
    name: "Daily Note Rig",
    createdAt: "2026-01-01T00:00:00.000Z",
  },
  settings: {
    hermesBaseUrl: "http://127.0.0.1:1",
    theme: "dark",
    weekStartDay: "monday",
    autoApproveInserts: [],
  },
  domains: [],
  agents: [],
  decisions: [],
  log: [],
  map: null,
  mapError: null,
  goals: [],
  goalsError: null,
  reviews: [],
  planning: [],
  weeklyFileCount: 0,
};

const SESSION = {
  id: "harness-session",
  title: "Harness",
  preview: "Daily note rig",
  lastActive: 1_700_000_000,
};

/** Every bridge method the page is allowed to reach. Anything else is named. */
const bridge: Record<string, unknown> = {
  vaultGetSnapshot: () => ok(SNAPSHOT),
  vaultListRecent: () => Promise.resolve([]),
  onVaultFileChanged: () => () => {},
  domainGetActive: () => ok(null),
  domainSetActive: () => ok(null),
  companionSessionsList: () => ok([SESSION]),
  companionSessionCreate: () => ok(SESSION),
  companionSessionMessages: () => ok([]),
  // The shell's own dependencies: the dock reads the open board's lock, and the
  // composer asks which models the profile offers. Neither is this rig's subject;
  // both are modelled so that "an unmodelled call" stays a real signal.
  companionModelOptions: () =>
    ok({ providers: [], current: { model: "harness", provider: "harness" } }),
  pinsList: () => ok({ pins: [], locked: false }),
  onCompanionStream: () => () => {},
  windowChrome: {
    get: () => Promise.resolve({ overlay: true, platform: "win32" }),
    setTitleBarOverlay: () => Promise.resolve(),
    minimize: () => {},
    toggleMaximize: () => {},
    close: () => {},
    isMaximized: () => Promise.resolve(false),
    onMaximizeChange: () => () => {},
  },
  dailyNoteGet: (date: string) => {
    harness.dailyNoteCalls?.push(`dailyNoteGet:${date}`);
    harness.dailyNoteGets?.push(date);
    const note = journal.get(date);
    return Promise.resolve(note ? ok(note) : fail("Daily note not found"));
  },
  dailyNoteWrite: (date: string, body: string) => {
    harness.dailyNoteCalls?.push(`dailyNoteWrite:${date}`);
    // The day the page was *showing* when it asked for the write, read off the
    // page's own day label. A write to a day the operator is not on is the one
    // way autosave can put prose on the wrong date, so it is recorded here.
    const shown =
      document
        .querySelector('[data-testid="daily-note-day"]')
        ?.getAttribute("data-date") ?? null;
    harness.dailyNoteWrites?.push({ date, body, shown });
    // A bridge that drops the call instead of answering: the write neither landed
    // nor was refused, which is the one outcome the page cannot reason about.
    if (harness.dailyNoteThrowWrite) {
      return Promise.reject(new Error("The bridge dropped the write"));
    }
    if (harness.dailyNoteFailWrite) {
      return Promise.resolve(fail("The vault refused the write"));
    }
    // The vault's own rule, mirrored here: a note must have something written in
    // it. Without this the rig would prove a clear "lands" while the real engine
    // refuses it — a harness that agrees with the page instead of with the vault.
    const canonicalBody = canonical(body);
    if (canonicalBody.trim() === "") {
      return Promise.resolve(fail("A daily note needs something written in it"));
    }
    // And the other rule: a note cannot be written for a day that has not
    // happened. The page closes the future itself; this is the vault behind it.
    if (date > (harness.dailyNoteToday ?? date)) {
      return Promise.resolve(
        fail(`A daily note cannot be written for a future day: ${date}`),
      );
    }
    const existing = journal.get(date);
    const stamp = new Date().toISOString();
    const note: DailyNote = {
      date,
      createdAt: existing?.createdAt ?? stamp,
      updatedAt: stamp,
      bodyMarkdown: canonicalBody,
    };
    journal.set(date, note);
    return Promise.resolve(ok(note));
  },
  dailyNoteList: () => {
    harness.dailyNoteCalls?.push("dailyNoteList");
    const rows: DailyNoteIndexEntry[] = [...journal.values()]
      .map((note) => ({ date: note.date, updatedAt: note.updatedAt }))
      .sort((a, b) => (a.date < b.date ? -1 : 1));
    for (const date of harness.dailyNoteUnreadable ?? []) {
      rows.push({ date, updatedAt: null, error: "Invalid daily note date" });
      rows.sort((a, b) => (a.date < b.date ? -1 : 1));
    }
    return Promise.resolve(ok(rows));
  },
  // The read the Review page's panel makes: the notes inside an inclusive window,
  // oldest first, prose only, and never a day that has not happened — the same
  // shape, order and exclusions the vault returns. A harness that skipped the
  // future rule would let the panel "prove" it shows a day that is still to come.
  dailyNoteWindow: (start: string, end: string) => {
    harness.dailyNoteCalls?.push(`dailyNoteWindow:${start}..${end}`);
    harness.dailyNoteWindowCalls?.push({ start, end });
    if (harness.dailyNoteEmptyWindow) return Promise.resolve(ok([]));
    const notes = [...journal.values()]
      .filter((note) => note.date >= start && note.date <= end)
      .filter((note) => note.date <= (harness.dailyNoteToday ?? note.date))
      .filter((note) => note.bodyMarkdown.trim() !== "")
      .sort((a, b) => (a.date < b.date ? -1 : 1));
    return Promise.resolve(ok(notes));
  },
  // The review itself is not this rig's subject; a period with no file is the
  // ordinary empty state and keeps the page on its preview branch.
  reviewGet: () => Promise.resolve(fail("Review file not found")),
};

const stubbed = new Proxy(bridge, {
  get(target, prop) {
    const found = target[prop as string];
    if (found !== undefined) return found;
    return (...args: unknown[]) => {
      const name = String(prop);
      harness.dailyNoteUnexpectedCalls?.push(name);
      void args;
      return Promise.resolve(fail(`unmodelled bridge call: ${name}`));
    };
  },
  has: () => true,
});

(window as unknown as { lifequest: unknown }).lifequest = stubbed;

const root = document.getElementById("root");
if (!root) throw new Error("#root missing from daily-note.html");

/**
 * One rig, two surfaces: the day's page and the Review panel that reads the same
 * journal. The driver moves between them through the harness's own router rather
 * than by clicking the rail, so the route under test is named in the driver.
 */
function RouterControl() {
  const navigate = useNavigate();
  harness.dailyNoteGoto = (path: string) => navigate(path);
  return null;
}

createRoot(root).render(
  <StrictMode>
    <MemoryRouter initialEntries={["/notes"]}>
      <RouterControl />
      <ThemeProvider>
        <VaultProvider>
          <ChatDockProvider>
            <NavDockProvider>
              <div className="app-root">
                <WindowTitleBar />
                <div className="app-root__body">
                  <Routes>
                    <Route element={<AppShell />}>
                      <Route path="/notes" element={<DailyNotePage />} />
                      <Route path="/review/:cadence" element={<ReviewPage />} />
                    </Route>
                  </Routes>
                </div>
              </div>
            </NavDockProvider>
          </ChatDockProvider>
        </VaultProvider>
      </ThemeProvider>
    </MemoryRouter>
  </StrictMode>,
);

// The driver waits on this rather than on a timer: the editor is only painted
// after the day's own read resolves, so a slow first Vite transform cannot be
// mistaken for "the page never rendered".
let settle: () => void = () => {};
const ready = new Promise<void>((resolve) => {
  settle = resolve;
});

const waitForPage = () => {
  const rail = document.querySelector(".nav-rail");
  const body = document.querySelector('[data-testid="daily-note-editor"]');
  const day = document.querySelector('[data-testid="daily-note-day"]');
  if (!rail || !body || !day) {
    requestAnimationFrame(waitForPage);
    return;
  }
  requestAnimationFrame(() => requestAnimationFrame(() => settle()));
};
requestAnimationFrame(waitForPage);

(harness as HarnessWindow).dailyNoteReady = false;
void ready.then(() => {
  harness.dailyNoteReady = true;
});
harness.dailyNoteSkin = skinName;
