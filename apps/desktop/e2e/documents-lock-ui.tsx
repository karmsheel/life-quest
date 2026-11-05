/**
 * E2E harness page for the Documents/notes page (`pages/DocumentsPage`).
 *
 * The library page is where a note is locked, proposed against, and deleted.
 * That work used to live in a row of buttons at the bottom of the composer plus
 * a switch in the page corner; it is now one three-dot PageMenu in the corner,
 * with the lock as the menu's FIRST item, "Propose change" behind it while the
 * note is locked, and "Delete note" (danger, last) always. This rig renders the
 * REAL page with the IPC bridge stubbed, so what it measures is what ships.
 *
 * The bridge is a recording stub, deliberately small: every method the page
 * calls is listed, and anything else answers `{ ok: false }` and is NAMED in
 * `documentsLockUnexpectedCalls` so a page that grows a new dependency fails
 * the run loudly instead of rendering a quietly empty library.
 *
 * The driver waits on `documentsLockCommits`, bumped from an effect after React
 * has committed, so it never samples a half-painted page.
 */
import { StrictMode, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import type {
  DomainRecord,
  LibraryDocument,
  VaultSnapshot,
} from "@lifequest/vault-core";
import DocumentsPage from "@/pages/DocumentsPage";
import { VaultProvider } from "@/state/VaultProvider";
import { applyAppSkin } from "./apply-app-skin";
import "@/styles/global.css";

// The app's own skin first: this rig judges the notes page the operator sees, so
// it has to paint in the palette they run rather than in the base tokens.
const skinName = applyAppSkin("dark");

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

const ok = <T,>(value: T): Result<T> => ({ ok: true, value });

/** The one note the library serves, and every write the page made. */
const NOTE_ID = "note-harness-1";
const NOTE_TITLE = "Harness note";

function seedNote(): LibraryDocument {
  return {
    id: NOTE_ID,
    title: NOTE_TITLE,
    bodyMarkdown: "The note's body, seeded by the rig.",
    domainSlugs: ["financial"],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    deletedAt: null,
    locked: false,
  };
}

type HarnessWindow = Window & {
  documentsLockReady?: boolean;
  documentsLockCommits?: number;
  documentsLockCalls?: string[];
  documentsLockUnexpectedCalls?: string[];
  documentsLockSkin?: string;
  /** Every lock write, in order: the note it named and the value it carried. */
  documentsLockLockCalls?: { id: string; locked: boolean }[];
  documentsLockDeleteCalls?: string[];
  documentsLockGetCalls?: string[];
  documentsLockDecisionCalls?: unknown[];
  documentsLockUpdateCalls?: unknown[];
  documentsLockCreateCalls?: unknown[];
  documentsLockListCalls?: number;
  /** The library the page reads, so the driver can assert what it served. */
  documentsLockNote?: () => LibraryDocument | null;
};

const harness = window as HarnessWindow;

harness.documentsLockCalls = [];
harness.documentsLockUnexpectedCalls = [];
harness.documentsLockLockCalls = [];
harness.documentsLockDeleteCalls = [];
harness.documentsLockGetCalls = [];
harness.documentsLockDecisionCalls = [];
harness.documentsLockUpdateCalls = [];
harness.documentsLockCreateCalls = [];
harness.documentsLockListCalls = 0;

/** The library the page reads. The note is replaced in place on every write. */
let records: LibraryDocument[] = [seedNote()];

/** One live domain, so the composer offers a domain checkbox to disable. */
const SNAPSHOT: VaultSnapshot = {
  rootPath: "C:\\harness\\vault",
  lifequest: {
    schemaVersion: 1,
    id: "harness-vault",
    name: "Harness",
    createdAt: "2026-01-01T00:00:00.000Z",
  },
  settings: {
    hermesBaseUrl: "http://localhost:8642",
    theme: "dark",
    weekStartDay: "monday",
    autoApproveInserts: [],
    chatQuestions: [],
    decisionInbox: { autoOpen: false, autoClose: false },
  },
  domains: [
    {
      slug: "financial",
      meta: {
        name: "Financial",
        description: null,
        color: null,
        sortOrder: 3,
        archivedAt: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      documents: {} as DomainRecord["documents"],
    },
  ],
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

/**
 * Every bridge method the page uses, with the value it answers. A method the
 * page calls that is not here is recorded and answered `{ ok: false }`, so the
 * run reports it by name.
 */
function bridge(): Record<string, (...args: unknown[]) => unknown> {
  return {
    vaultGetSnapshot: async () => ok(SNAPSHOT),
    vaultListRecent: async () => [],
    domainGetActive: async () => null,
    domainSetActive: async () => ok(null),
    onVaultFileChanged: () => () => {},
    // The library the page reads.
    libraryList: async () => {
      harness.documentsLockListCalls = (harness.documentsLockListCalls ?? 0) + 1;
      return ok({ records: records.map((note) => ({ ...note })), skipped: 0 });
    },
    libraryGet: async (id: unknown) => {
      harness.documentsLockGetCalls!.push(id as string);
      const found = records.find((note) => note.id === id);
      if (!found) return { ok: false as const, error: `no note ${String(id)}` };
      return ok({ ...found });
    },
    // The two writes this rig is about, plus the note's save path so a page
    // that saves behind the operator's back is caught by the recorder.
    librarySetLocked: async (id: unknown, locked: unknown) => {
      harness.documentsLockLockCalls!.push({
        id: id as string,
        locked: locked === true,
      });
      const found = records.find((note) => note.id === id);
      if (!found) return { ok: false as const, error: `no note ${String(id)}` };
      found.locked = locked === true;
      return ok({ ...found });
    },
    libraryDelete: async (id: unknown) => {
      harness.documentsLockDeleteCalls!.push(id as string);
      const found = records.find((note) => note.id === id);
      if (!found) return { ok: false as const, error: `no note ${String(id)}` };
      records = records.filter((note) => note.id !== id);
      return ok({ ...found, deletedAt: "2026-01-03T00:00:00.000Z" });
    },
    libraryUpdate: async (id: unknown, patch: unknown) => {
      harness.documentsLockUpdateCalls!.push({ id, patch });
      const found = records.find((note) => note.id === id);
      if (!found) return { ok: false as const, error: `no note ${String(id)}` };
      Object.assign(found, patch as Partial<LibraryDocument>);
      return ok({ ...found });
    },
    libraryCreate: async (input: unknown) => {
      harness.documentsLockCreateCalls!.push(input);
      const note: LibraryDocument = {
        ...seedNote(),
        id: "note-created-1",
        ...(input as Partial<LibraryDocument>),
      };
      records = [note, ...records];
      return ok(note);
    },
    // Propose change files a Decision. It must not be reached unless the
    // operator submits the dialog, so it is recorded and answered.
    decisionCreate: async (input: unknown) => {
      harness.documentsLockDecisionCalls!.push(input);
      return ok({});
    },
  };
}

const stubs = bridge();

(window as unknown as { lifequest: object }).lifequest = new Proxy(stubs, {
  get(target, prop) {
    if (typeof prop !== "string") return undefined;
    const found = target[prop];
    if (found) {
      return (...args: unknown[]) => {
        harness.documentsLockCalls!.push(prop);
        return found(...args);
      };
    }
    return (..._args: unknown[]) => {
      harness.documentsLockUnexpectedCalls!.push(prop);
      return Promise.resolve({
        ok: false,
        error: `unexpected bridge call: ${prop}`,
      });
    };
  },
});

/** What the library currently serves, for a driver that wants to check it. */
harness.documentsLockNote = () => records[0] ?? null;

function Harness() {
  const commits = useRef(0);
  useEffect(() => {
    commits.current += 1;
    harness.documentsLockCommits = commits.current;
  }, []);
  return (
    <MemoryRouter initialEntries={["/documents"]}>
      <VaultProvider>
        <DocumentsPage />
      </VaultProvider>
    </MemoryRouter>
  );
}

const root = createRoot(document.getElementById("root")!);
root.render(
  <StrictMode>
    <Harness />
  </StrictMode>,
);

harness.documentsLockReady = true;
harness.documentsLockSkin = skinName;
