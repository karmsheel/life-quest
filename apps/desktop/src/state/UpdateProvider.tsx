/**
 * The app's own view of the update feed: the launch's check, the watch main runs
 * on a clock, and the operator's manual check from the rail's build number (or
 * Settings → Updates) whenever they ask for one.
 *
 * A release published while the studio is open used to stay invisible until the
 * operator clicked the version number — and they had no reason to click it,
 * because nothing said there was news. Main now reads the feed every
 * `UPDATE_POLL_MS` and pushes what it finds over `onUpdateDecision`; this provider
 * turns that push into a state change *and* a notice, so the operator is told
 * without asking.
 *
 * This is a system-in-isolation rig's worth of work done in the renderer, so the
 * ways it can fail are written down before the code:
 *
 *  1. No `window.lifequest` (a harness page, or a preload that did not load) —
 *     must render the badge in its resting state, never throw and take the rail
 *     down with it.
 *  2. A bridge that answers the wrong shape (`{ ok: true, value: null }`, from a
 *     stub that does not know this channel) — must fail closed: no glow, no
 *     popup, no crash. An unreadable answer is not an available update.
 *  3. `onUpdateProgress` answering with something that is not a function — the
 *     cleanup must not call it. A listener handle is a function or it is junk.
 *  4. React's StrictMode running the mount effect twice — the launch's check
 *     must go out once, not twice. The ref survives the simulated remount.
 *  5. A failed check (no token, offline, refused) — the reason is kept for
 *     Settings and the panel, and the rail stays quiet. The badge never nags.
 *  6. A manual check asked for while one is already in flight — the second
 *     request joins the first. Two answers racing would let an older one land
 *     last and overwrite a newer one, and the operator's click must not cost a
 *     second read of the feed for an answer that is already on its way.
 *  7. A watch push landing while the launch's check is still in flight — the
 *     watch's answer is the newer fact, so the older check must not overwrite it
 *     when it finally resolves. `pollSeq` is the guard: an answer that started
 *     before a push is dropped rather than allowed to land last.
 *  8. The same release pushed twice, or pushed after the operator dismissed the
 *     notice — announced once per version, and a dismissed notice stays
 *     dismissed. Only a release that disappears and comes back is announced
 *     again.
 *  9. A bridge that does not know `onUpdateDecision` (the badge harness's proxy,
 *     or an older preload) — subscribe only when it is a function; a missing
 *     channel is a quiet app, not a thrown rail.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { version } from "../../package.json";
import { api } from "@/lib/ipc";
import type { UpdateDecision } from "@/vite-env";

type Phase = "checking" | "ready" | "failed";

/** What the notice says about the release main's watch reported. */
export type UpdateNotice = {
  latest: string;
  title: string | null;
  publishedAt: string | null;
};

/** Where the Developer page keeps its preview switch. */
const PREVIEW_KEY = "lifequest-update-preview";

/**
 * What the rail and the popup show when the Developer preview is on and the feed
 * has nothing for us.
 *
 * Nothing about this can be installed: `installer` is null, so the popup draws
 * the release-page offer it already draws for a release published without a
 * Windows installer. A preview must never be able to start a download, and this
 * is the cheapest possible way to guarantee it — the install path is simply not
 * reachable from here.
 */
const PREVIEW: UpdateDecision = {
  state: "available",
  current: version,
  latest: "9.9.9",
  title: "LifeQuest 9.9.9 (preview)",
  notes:
    "A local preview from Settings → Developer. Nothing is being downloaded, and this release does not exist.",
  publishedAt: null,
  releaseUrl: "https://github.com/karmsheel/life-quest/releases",
  installer: null,
};

function readPreviewPreference(): boolean {
  try {
    return window.localStorage.getItem(PREVIEW_KEY) === "1";
  } catch {
    return false;
  }
}

export type UpdateValue = {
  /** What this build is running, off its own package.json. */
  current: string;
  phase: Phase;
  /**
   * What the *feed* said. Settings → Updates reports on this, so the preview
   * switch can never change what the app claims GitHub told it.
   */
  decision: UpdateDecision | null;
  /** Why the last check could not answer, if it could not. */
  error: string | null;
  /**
   * What the rail and the popup draw: the feed's answer when it offered one,
   * otherwise the preview if the Developer switch is on. A real release always
   * wins — the preview cannot hide an upgrade.
   */
  shown: UpdateDecision | null;
  /** True when `shown` is the preview rather than anything GitHub said. */
  previewing: boolean;
  /** True only when the rail should glow — a real offer, or a preview of one. */
  available: boolean;
  /** The Developer page's switch. Persisted, and off to begin with. */
  preview: boolean;
  setPreview: (on: boolean) => void;
  /**
   * The release main's watch reported while the app was open, and that the
   * operator has not dismissed. Null before any news, and after a dismissal.
   */
  notice: UpdateNotice | null;
  dismissNotice: () => void;
  installing: boolean;
  progress: { downloaded: number; total: number } | null;
  installError: string | null;
  /** `force` re-reads the feed; the launch's own check does not. */
  refresh: (options?: { force?: boolean }) => Promise<void>;
  /** Download the release's installer and hand it over. No-op if there is none. */
  install: () => Promise<void>;
  openReleasePage: () => Promise<void>;
};

const UpdateContext = createContext<UpdateValue | null>(null);

/** A decision is only usable if it carries a `state` this UI knows how to draw. */
function readDecision(decision: unknown): UpdateDecision | null {
  if (!decision || typeof decision !== "object") return null;
  const state = (decision as { state?: unknown }).state;
  if (
    state !== "available" &&
    state !== "current" &&
    state !== "no_release" &&
    state !== "error"
  ) {
    return null;
  }
  return decision as UpdateDecision;
}

export function UpdateProvider({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<Phase>("checking");
  const [decision, setDecision] = useState<UpdateDecision | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [installing, setInstalling] = useState(false);
  const [progress, setProgress] = useState<UpdateValue["progress"]>(null);
  const [installError, setInstallError] = useState<string | null>(null);
  const [preview, setPreviewState] = useState(readPreviewPreference);
  const [notice, setNotice] = useState<UpdateNotice | null>(null);

  const setPreview = useCallback((on: boolean) => {
    setPreviewState(on);
    try {
      if (on) window.localStorage.setItem(PREVIEW_KEY, "1");
      else window.localStorage.removeItem(PREVIEW_KEY);
    } catch {
      // A window with no storage still previews; it just forgets on restart.
    }
  }, []);

  /**
   * The last release the notice announced, so one release is announced once —
   * across the launch check, every watch push, and any manual check. It is a ref,
   * not state: the guard has to hold between renders and survive a dismissal
   * without causing one.
   */
  const announced = useRef<string | null>(null);

  /**
   * A counter of feed answers that arrived *after* a check started. A manual or
   * launch check is an answer to a question asked at a moment; a watch push is a
   * newer fact that landed while it was in flight. The older answer is dropped
   * rather than allowed to overwrite the newer one, whichever resolves last.
   */
  const newsSeq = useRef(0);

  /** Raise the notice for a release, unless it was already announced. */
  const announce = useCallback((next: UpdateDecision) => {
    if (next.state !== "available") return;
    if (announced.current === next.latest) return;
    announced.current = next.latest;
    setNotice({
      latest: next.latest,
      title: next.title,
      publishedAt: next.publishedAt,
    });
  }, []);

  const dismissNotice = useCallback(() => setNotice(null), []);

  // One check per launch. The ref, not state: StrictMode's second mount effect
  // must find the first request already made rather than make its own.
  const checked = useRef(false);

  // The request currently on its way, if any. A manual check that arrives while
  // the launch's own check is still running joins it instead of starting a second
  // read: the answer is the same answer, and two flights could land out of order.
  const inFlight = useRef<Promise<void> | null>(null);

  const refresh = useCallback((options: { force?: boolean } = {}): Promise<void> => {
    const pending = inFlight.current;
    if (pending) return pending;

    const run = (async (): Promise<void> => {
      let bridge: ReturnType<typeof api> | null = null;
      try {
        bridge = api();
      } catch {
        bridge = null;
      }
      if (!bridge) {
        setPhase("failed");
        setError(null);
        setDecision(null);
        return;
      }
      setPhase("checking");
      // The feed answer this request is asking for. If a watch push lands before
      // it resolves, that push is the newer fact and this answer is dropped.
      const newsWhenAsked = newsSeq.current;
      try {
        const result = await bridge.updateCheck(options);
        if (newsSeq.current !== newsWhenAsked) return;
        if (!result || result.ok !== true) {
          setDecision(null);
          setError(
            result && typeof result.error === "string" ? result.error : null,
          );
          setPhase("failed");
          return;
        }
        const parsed = readDecision(result.decision);
        if (!parsed) {
          setDecision(null);
          setError(null);
          setPhase("failed");
          return;
        }
        setDecision(parsed);
        setError(null);
        setPhase("ready");
        // An answer that offers a release is news even when it came from the
        // launch's own check: that is exactly the update the operator used to
        // have to click the build number to discover.
        announce(parsed);
      } catch (err) {
        if (newsSeq.current !== newsWhenAsked) return;
        setDecision(null);
        setError(err instanceof Error ? err.message : String(err));
        setPhase("failed");
      }
    })();

    const tracked: Promise<void> = run.finally(() => {
      if (inFlight.current === tracked) inFlight.current = null;
    });
    inFlight.current = tracked;
    return tracked;
  }, [announce]);

  useEffect(() => {
    if (checked.current) return;
    checked.current = true;
    void refresh();
  }, [refresh]);

  // The watch's news. Main reads the feed on a clock and pushes what it found, so
  // an app that is open when a release is published hears about it without
  // anyone asking. A channel this bridge does not have (the badge harness's proxy,
  // an older preload) is a quiet app, not a thrown rail.
  useEffect(() => {
    let off: unknown = null;
    try {
      const bridge = api();
      if (typeof bridge.onUpdateDecision !== "function") return;
      off = bridge.onUpdateDecision((raw) => {
        const parsed = readDecision(raw);
        if (!parsed) return;
        if (parsed.state === "available") {
          newsSeq.current += 1;
          setDecision(parsed);
          setError(null);
          setPhase("ready");
          announce(parsed);
          return;
        }
        if (parsed.state !== "current") return;
        // A release that was announced is not offered any more. The glow and the
        // notice go with the offer: the feed's latest answer is the one on
        // screen. A later release is news again, so the guard is cleared.
        newsSeq.current += 1;
        announced.current = null;
        setNotice(null);
        setDecision(parsed);
        setError(null);
        setPhase("ready");
      });
    } catch {
      off = null;
    }
    return () => {
      // A stub bridge that does not know this channel answers with junk rather
      // than an unsubscribe. Calling it would take the app down.
      if (typeof off === "function") (off as () => void)();
    };
  }, [announce]);

  // Progress is pushed while the download runs. Only the install's own view of
  // it lives here; the file itself never crosses this bridge.
  useEffect(() => {
    let off: unknown = null;
    try {
      off = api().onUpdateProgress((next) => {
        if (
          next &&
          typeof next.downloaded === "number" &&
          typeof next.total === "number"
        ) {
          setProgress({ downloaded: next.downloaded, total: next.total });
        }
      });
    } catch {
      off = null;
    }
    return () => {
      // A stub bridge that does not know this channel answers with junk rather
      // than an unsubscribe. Calling it would take the rail down on unmount.
      if (typeof off === "function") (off as () => void)();
    };
  }, []);

  // What the rail and the popup draw. A real offer always wins: the preview is a
  // way to *see* the upgrade affordance, never a way to hide a real upgrade.
  const realOffer = decision?.state === "available";
  const previewing = preview && !realOffer;
  const shown = previewing ? PREVIEW : decision;

  const install = useCallback(async () => {
    if (shown?.state !== "available" || !shown.installer) return;
    let bridge: ReturnType<typeof api>;
    try {
      bridge = api();
    } catch {
      return;
    }
    setInstalling(true);
    setInstallError(null);
    setProgress({ downloaded: 0, total: shown.installer.size });
    try {
      const result = await bridge.updateInstall(shown.installer);
      if (!result || result.ok !== true) {
        setInstallError(
          result && typeof result.error === "string"
            ? result.error
            : "The installer could not be started.",
        );
        setInstalling(false);
        return;
      }
      // The installer is up and the app is quitting; leaving `installing` true
      // keeps the popup from offering the same install a second time.
    } catch (err) {
      setInstallError(err instanceof Error ? err.message : String(err));
      setInstalling(false);
    }
  }, [shown]);

  const openReleasePage = useCallback(async () => {
    if (shown?.state !== "available") return;
    try {
      await api().updateOpenReleasePage(shown.releaseUrl);
    } catch {
      // Opening a browser is not worth an error card; the url is on screen.
    }
  }, [shown]);

  const value = useMemo<UpdateValue>(
    () => ({
      current: version,
      phase,
      decision,
      error,
      shown,
      previewing,
      available: shown?.state === "available",
      preview,
      setPreview,
      notice,
      dismissNotice,
      installing,
      progress,
      installError,
      refresh,
      install,
      openReleasePage,
    }),
    [
      phase,
      decision,
      error,
      shown,
      previewing,
      preview,
      setPreview,
      notice,
      dismissNotice,
      installing,
      progress,
      installError,
      refresh,
      install,
      openReleasePage,
    ],
  );

  return (
    <UpdateContext.Provider value={value}>{children}</UpdateContext.Provider>
  );
}

/**
 * The update state, or a quiet resting state when there is no provider.
 *
 * The fallback is deliberate rather than an error: `NavRail` is mounted by e2e
 * harnesses that wrap only the providers a sidebar needs, and a sidebar that
 * throws because nobody is watching the update feed is a rail that cannot be
 * tested at all.
 */
export function useUpdate(): UpdateValue {
  const value = useContext(UpdateContext);
  if (value) return value;
  return {
    current: version,
    phase: "failed",
    decision: null,
    error: null,
    shown: null,
    previewing: false,
    available: false,
    preview: false,
    setPreview: () => {},
    notice: null,
    dismissNotice: () => {},
    installing: false,
    progress: null,
    installError: null,
    refresh: async () => {},
    install: async () => {},
    openReleasePage: async () => {},
  };
}
