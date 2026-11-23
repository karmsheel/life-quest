import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

/**
 * The Notebox page's general capture surface — text, image, any file and a
 * pasted link — as the real shell paints it in a real layout engine, plus the
 * inbox triage: a status select moves a row and the row paints the vault's
 * answer back. The claims themselves live in `e2e/chain-capture.electron.mjs`,
 * which drives the harness; this file runs that driver and refuses a report
 * that does not hold.
 *
 * Run it through `lifequest-e2e`, which puts THIS checkout's dev server on 5173:
 *
 *   /root/.local/bin/lifequest-e2e <checkout> apps/desktop/tests/chain-capture-e2e.test.ts
 *
 * With no dev server this test FAILS, loudly, instead of skipping: a skipped rig
 * is evidence of nothing, and an empty report that "passes" is exactly the
 * vacuous evidence this test exists to refuse.
 *
 * The artifact is `e2e/artifacts/chain-capture.json` plus the captures the
 * driver takes — the seeded chain, a text capture, an uploaded image row, a
 * non-image file card (`chain-inbox-file.png`), a pasted link row, and the
 * triaged inbox (`chain-inbox-triage.png`) — each of which must be a real
 * capture of the shipped page, not an empty file.
 */

const desktopRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const require = createRequire(import.meta.url);
const electron = require("electron") as string;

const DEV_PORT = 5173;
const ARTIFACTS = path.join(desktopRoot, "e2e/artifacts");
const REPORT = path.join(ARTIFACTS, "chain-capture.json");
const CAPTURES = [
  "chain-capture-seeded.png",
  "chain-capture-text.png",
  "chain-capture-pending.png",
  "chain-capture-image.png",
  "chain-capture-image-only.png",
  "chain-capture-pending-file.png",
  "chain-inbox-file.png",
  "chain-capture-link.png",
  "chain-capture-dock.png",
  "chain-inbox-triage.png",
];

type Picture = {
  present: boolean;
  img: boolean;
  complete?: boolean;
  width?: number;
  height?: number;
  blob?: boolean;
};

type Row = {
  attachment: string | null;
  body: string | null;
  bodyPresent: boolean;
  text: string | null;
  image: Picture;
  link:
    | { present: true; href: string | null; target: string | null; text: string | null }
    | { present: false };
  file:
    | { present: true; text: string | null; name: string | null; save: boolean }
    | { present: false };
};

type CreateAttachment = {
  kind: "image" | "link" | "file";
  name?: string;
  url?: string;
  mime?: string;
  width?: number | null;
  height?: number | null;
  byteLength?: number;
  size?: number;
  relPath?: string;
};

type Create = {
  type: string;
  title: string | null;
  body: string;
  domainSlug: string | null;
  attachment: CreateAttachment | null;
};

type Select = {
  value: string;
  options: { value: string; label: string }[];
};

type Box = { left: number; top: number; width: number; height: number };

/** One inbox filter: the picker's options, the applied value, its geometry. */
type FilterControl = Select & {
  present: boolean;
  testid: string;
  tag: string | null;
  box: Box;
};

/** One fixture seed, with the labels the contract says its row must paint. */
type InboxExpectedSeed = {
  id: string;
  body: string;
  attachment: "text" | "image" | "link";
  domainSlug: string | null;
  domainLabel: string;
  projectId: string | null;
  projectLabel: string;
  status: string;
  statusLabel: string;
  priority: string | null;
  priorityLabel: string;
  capturedFrom: string | null;
};

type InboxRow = {
  id: string;
  body: string;
  expected: InboxExpectedSeed;
  attachment: string | null;
  dataStatus: string | null;
  dataPriority: string | null;
  dataProjectId: string | null;
  dataDomainSlug: string | null;
  domain: string | null;
  project: string | null;
  status: string | null;
  priority: string | null;
  capturedFrom: string | null;
  statusSelect: Select | null;
  prioritySelect: Select | null;
  projectSelect: Select | null;
};

type InboxCheck = {
  expected: {
    projects: { id: string; title: string }[];
    seeded: InboxExpectedSeed[];
    target: { id: string; body: string };
  } | null;
  rows: InboxRow[];
  controls: {
    statusOptions: string[];
    statusLabels: string[];
    priorityOptions: string[];
    priorityLabels: string[];
    projectOptions: string[];
    projectLabels: string[];
    filterStatus: FilterControl;
    filterDomain: FilterControl;
    filterProject: FilterControl;
    filterLayout: {
      band: Box;
      labels: string[];
      fields: Box[];
      buttons: number;
    };
  };
  triage: {
    targetId: string | null;
    targetBody: string | null;
    before: {
      dataStatus: string | null;
      status: string | null;
      select: string | null;
    };
    after: {
      dataStatus: string | null;
      status: string | null;
      select: string | null;
      storedStatus: string | null;
    };
    patch: Record<string, unknown> | null;
    updates: { id: string; patch: Record<string, unknown> }[];
    listReadsBefore: number;
    listReadsAfter: number;
  };
  filter: {
    acting: { rows: number; value: string | null };
    done: {
      rows: number;
      empty: string | null;
      emptyLine: string | null;
      value: string | null;
    };
    all: { rows: number; value: string | null };
  };
  screenshot: { name: string; bytes: number };
};

type Report = {
  pass: boolean;
  failures: string[];
  consoleErrors: string[];
  screenshots: { name: string; bytes: number }[];
  expected: {
    seeded: {
      count: number;
      textBody: string;
      imageBody: string;
      imageName: string;
      imageRelPath: string;
      linkBody: string;
      linkUrl: string;
    };
  };
  checks: {
    page: {
      route: string | null;
      skin: string | null;
      heading: string | null;
      activeRail: string | null;
      rail: { label: string | null; href: string | null }[];
      presence: {
        page: boolean;
        composer: boolean;
        textarea: boolean;
        attachFile: boolean;
        attachLabel: string | null;
        attachBox: { left: number; top: number; width: number; height: number } | null;
        composerBox: { left: number; top: number; width: number; height: number } | null;
        log: boolean;
      };
      legacyComposer: {
        attachImage: boolean;
        attachLink: boolean;
        linkUrlField: boolean;
        addLink: boolean;
      };
      fileInput: { present: boolean; type: string | null; accept: string | null };
    };
    shiftEnter: { creates: number; value: string | null };
    textCapture: { create: Create; row: Row };
    pending: { count: number; image: Picture; removeImage: boolean };
    imageCapture: {
      create: Create;
      row: Row;
      reads: string[];
      bytes: Record<string, number>;
    };
    imageOnly: {
      create: Create;
      row: Row;
      bytes: Record<string, number>;
    };
    pendingFile: { text: string; remove: boolean; imageCount: number };
    fileCapture: {
      create: Create;
      row: Row;
      expectedBytes: number;
      pendingText: string;
      reads: string[];
      bytes: Record<string, number>;
      save: { clicked: boolean; reads: string[]; error: string | null };
      screenshot: { name: string; bytes: number };
    };
    linkPaste: {
      text: string;
      chip: { present: boolean; text: string | null; title: string | null };
      textarea: string | null;
      error: string | null;
    };
    linkCapture: { create: Create; row: Row };
    exclusivity: {
      imagePending: { imageCount: number; file: boolean };
      fileReplacesImage: {
        imageCount: number;
        file: { present: boolean; text?: string };
      };
      linkReplacesFile: {
        chip: { present: boolean; text: string | null };
        pendingFile: boolean;
        imageCount: number;
      };
      linkRemoved: boolean;
    };
    dock: {
      clicked: boolean;
      surface: string | null;
      heading: string | null;
      action: boolean;
      items: number;
      seededImage: Picture | null;
      seededLink:
        | { present: true; href: string | null; target: string | null }
        | null;
      bodies: (string | null)[];
    };
    seeded: {
      imageRow: Row | null;
      linkRow: Row | null;
      textRow: Row | null;
      reads: string[];
      bytes: Record<string, number>;
    };
    final: {
      route: string | null;
      rows: number;
      counts: Record<string, number>;
      creates: number;
      reads: string[];
      unexpected: string[];
      overflow: { scrollWidth: number; clientWidth: number };
      screenshots: { name: string; bytes: number }[];
    };
    inbox: InboxCheck;
  };
};

function devServerUp(): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ port: DEV_PORT, host: "127.0.0.1" });
    const done = (up: boolean) => {
      socket.destroy();
      resolve(up);
    };
    socket.on("connect", () => done(true));
    socket.on("error", () => done(false));
  });
}

type DriverRun = { code: number; stdout: string; stderr: string };

function runDriver(): Promise<DriverRun> {
  return new Promise((resolve, reject) => {
    // Electron hosts (DSH and other Electron apps) export ELECTRON_RUN_AS_NODE,
    // which would make this spawn run as plain node and die without a window.
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    execFile(
      electron,
      [path.join(desktopRoot, "e2e/chain-capture.electron.mjs")],
      { cwd: desktopRoot, timeout: 240_000, env },
      (error, stdout, stderr) => {
        if (error && typeof error.code !== "number") {
          reject(error);
          return;
        }
        resolve({ code: error ? (error.code as number) : 0, stdout, stderr });
      },
    );
  });
}

describe("Notebox page — general capture", () => {
  it("captures text, an image, a file and a pasted link, and paints them back from the vault", async () => {
    if (!(await devServerUp())) {
      assert.fail(
        `no dev server on ${DEV_PORT} — a skipped rig is not evidence; ` +
          "run `lifequest-e2e <checkout> apps/desktop/tests/chain-capture-e2e.test.ts`",
      );
    }

    fs.rmSync(REPORT, { force: true });
    for (const name of CAPTURES) fs.rmSync(path.join(ARTIFACTS, name), { force: true });

    const run = await runDriver();

    assert.equal(
      fs.existsSync(REPORT),
      true,
      "driver wrote no report artifact\n" +
        `--- driver stderr ---\n${run.stderr.slice(-4000)}\n` +
        `--- driver stdout ---\n${run.stdout.slice(-2000)}`,
    );
    const report = JSON.parse(fs.readFileSync(REPORT, "utf8")) as Report;

    // A report that does not hold is not evidence, whatever the exit code says.
    assert.deepEqual(report.failures, []);
    assert.equal(report.pass, true);
    assert.equal(
      run.code,
      0,
      `driver exited non-zero\n${run.stderr.slice(-4000)}`,
    );

    // Every named capture exists and is a real picture, not an empty file. The
    // screenshots are the operator-facing half of the evidence.
    for (const name of CAPTURES) {
      const file = path.join(ARTIFACTS, name);
      assert.equal(fs.existsSync(file), true, `no capture at ${name}`);
      const size = fs.statSync(file).size;
      assert.ok(size > 20_000, `${name} looks empty (${size} bytes)`);
      assert.ok(
        report.screenshots.some((shot) => shot.name === name && shot.bytes === size),
        `${name} is not the capture the report recorded`,
      );
    }

    const { checks, expected, consoleErrors } = report;

    // The shipped shell page, renamed Notebox: one plus attachment arm over an
    // unrestricted hidden picker, and the old Image/Link arms gone.
    assert.equal(checks.page.route, "/chain");
    assert.equal(checks.page.activeRail, "Notebox");
    assert.equal(checks.page.heading, "Notebox", "the page heading is not Notebox");
    assert.ok(
      checks.page.rail.some((item) => item.label === "Notebox" && item.href === "/chain"),
      "no Notebox row on the rail",
    );
    assert.equal(checks.page.presence.page, true);
    assert.equal(checks.page.presence.composer, true);
    assert.equal(checks.page.presence.textarea, true);
    assert.equal(checks.page.presence.attachFile, true, "no plus attachment control");
    assert.equal(checks.page.presence.attachLabel, "Attach a file");
    assert.ok(
      checks.page.presence.attachBox !== null &&
        checks.page.presence.composerBox !== null &&
        checks.page.presence.attachBox.top >=
          checks.page.presence.composerBox.top +
            checks.page.presence.composerBox.height / 2,
      "the plus is not in the composer's lower half",
    );
    assert.equal(checks.page.presence.log, true);
    assert.equal(checks.page.legacyComposer.attachImage, false, "the Image arm is still there");
    assert.equal(checks.page.legacyComposer.attachLink, false, "the Link arm is still there");
    assert.equal(checks.page.legacyComposer.linkUrlField, false, "the Link URL field is still there");
    assert.equal(checks.page.legacyComposer.addLink, false, "the Add link control is still there");
    assert.equal(checks.page.fileInput.present, true);
    assert.equal(checks.page.fileInput.type, "file");
    assert.equal(checks.page.fileInput.accept, null, "the any-file picker still has an accept gate");
    assert.equal(typeof checks.page.skin, "string");

    // Enter logs a text-only capture; Shift+Enter did not submit.
    assert.equal(checks.shiftEnter.creates, 0);
    assert.equal(checks.shiftEnter.value, "a draft line");
    assert.equal(checks.textCapture.create.body, "line one\nline two");
    assert.equal(checks.textCapture.create.attachment, null);
    assert.equal(checks.textCapture.row.attachment, "text");
    assert.match(checks.textCapture.row.body ?? "", /line one/);

    // The drop became a decoded pending thumbnail, and the capture carried bytes.
    assert.equal(checks.pending.count, 1);
    assert.ok((checks.pending.image.width ?? 0) > 0, "the pending thumbnail never decoded");
    assert.equal(checks.pending.removeImage, true);
    assert.equal(checks.imageCapture.create.attachment?.kind, "image");
    assert.equal(checks.imageCapture.create.attachment?.name, expected.seeded.imageName);
    assert.ok(
      (checks.imageCapture.create.attachment?.byteLength ?? 0) > 1_000,
      "the bridge was handed no image bytes",
    );
    const relPath = checks.imageCapture.create.attachment?.relPath ?? "";
    assert.match(
      relPath,
      /^\.lifequest\/signal-chain\/files\/[0-9a-f-]+\.(png|jpg|gif|webp)$/,
    );
    assert.equal(
      checks.imageCapture.bytes[relPath],
      checks.imageCapture.create.attachment?.byteLength,
      "the vault did not keep the bytes under the path it minted",
    );
    assert.ok(
      checks.imageCapture.reads.includes(relPath),
      "the row never read its picture back through signalChainReadImage",
    );
    assert.equal(checks.imageCapture.row.attachment, "image");
    assert.ok(
      (checks.imageCapture.row.image.width ?? 0) > 0,
      "the uploaded image row never decoded its picture",
    );
    assert.equal(checks.imageCapture.row.image.blob, true);
    assert.match(checks.imageCapture.row.body ?? "", /lamp I want on the desk/);
    assert.match(checks.imageCapture.create.body, /lamp I want on the desk/);

    // An image alone is allowed, with no body line on the row.
    assert.equal(checks.imageOnly.create.body, "");
    assert.equal(checks.imageOnly.create.attachment?.kind, "image");
    assert.ok((checks.imageOnly.create.attachment?.byteLength ?? 0) > 1_000);
    assert.equal(checks.imageOnly.row.attachment, "image");
    assert.ok((checks.imageOnly.row.image.width ?? 0) > 0);
    assert.equal(checks.imageOnly.row.body ?? "", "");

    // A non-image file is a first-class capture: a pending chip naming it and
    // its size, the bytes on the bridge, a card painting the stored name and a
    // human size, and a Save that reads the bytes back by the minted path.
    assert.match(checks.pendingFile.text, /brief\.pdf/);
    assert.match(checks.pendingFile.text, /\d+(\.\d+)?\s*(B|KB|MB)/, "the pending chip has no size");
    assert.equal(checks.pendingFile.remove, true, "no Remove the attached file control");
    assert.equal(checks.pendingFile.imageCount, 0);
    const fileCreate = checks.fileCapture.create;
    assert.equal(fileCreate.attachment?.kind, "file");
    assert.equal(fileCreate.attachment?.name, "brief.pdf");
    assert.equal(fileCreate.attachment?.mime, "application/pdf");
    assert.equal(
      fileCreate.attachment?.byteLength,
      checks.fileCapture.expectedBytes,
      "the bridge did not receive the file's real bytes",
    );
    assert.ok((fileCreate.attachment?.byteLength ?? 0) > 0);
    const fileRelPath = fileCreate.attachment?.relPath ?? "";
    assert.match(
      fileRelPath,
      /^\.lifequest\/signal-chain\/files\/[0-9a-f-]+\.pdf$/,
      "the vault minted no pdf path for the file bytes",
    );
    assert.equal(
      checks.fileCapture.bytes[fileRelPath],
      checks.fileCapture.expectedBytes,
      "the vault did not keep the file bytes under the path it minted",
    );
    assert.equal(checks.fileCapture.row.attachment, "file");
    assert.equal(checks.fileCapture.row.file.present, true, "the file row paints no card");
    assert.equal(checks.fileCapture.row.file.name, "brief.pdf");
    assert.match(
      checks.fileCapture.row.file.text ?? "",
      /\d+(\.\d+)?\s*(B|KB|MB)/,
      "the file card paints no human size",
    );
    assert.equal(checks.fileCapture.row.file.save, true, "the file row offers no Save");
    assert.match(checks.fileCapture.row.body ?? "", /brief for the desk rebuild/);
    assert.equal(checks.fileCapture.save.clicked, true);
    assert.ok(
      checks.fileCapture.save.reads.includes(fileRelPath),
      "Save never asked the bridge to read the stored file",
    );
    assert.equal(checks.fileCapture.save.error, null, "the file row reported its file missing");
    assert.ok(checks.fileCapture.screenshot.bytes > 20_000);
    assert.equal(checks.fileCapture.screenshot.name, "chain-inbox-file.png");

    // The link arm is paste-only: the pasted URL becomes a chip, does not stay
    // in the textarea, and logs an anchor that opens externally.
    assert.equal(checks.linkPaste.chip.present, true, "the pasted URL left no link chip");
    assert.match(checks.linkPaste.chip.text ?? "", /are\.na/);
    assert.equal(checks.linkPaste.textarea, "", "the pasted URL was left in the textarea");
    assert.equal(checks.linkPaste.error ?? "", "");
    assert.equal(checks.linkCapture.create.attachment?.kind, "link");
    assert.equal(
      checks.linkCapture.create.attachment?.url,
      "https://www.are.na/editorial/attention",
    );
    assert.equal(checks.linkCapture.row.attachment, "link");
    assert.equal(
      checks.linkCapture.row.link.present ? checks.linkCapture.row.link.href : null,
      "https://www.are.na/editorial/attention",
    );
    assert.equal(
      checks.linkCapture.row.link.present ? checks.linkCapture.row.link.target : null,
      "_blank",
    );
    assert.match(checks.linkCapture.row.body ?? "", /attention costs/);

    // One attachment at a time: each new pick or paste replaces the last.
    assert.equal(checks.exclusivity.imagePending.imageCount, 1);
    assert.equal(checks.exclusivity.imagePending.file, false);
    assert.equal(checks.exclusivity.fileReplacesImage.imageCount, 0);
    assert.equal(checks.exclusivity.fileReplacesImage.file.present, true);
    assert.equal(checks.exclusivity.linkReplacesFile.pendingFile, false);
    assert.equal(checks.exclusivity.linkReplacesFile.imageCount, 0);
    assert.equal(checks.exclusivity.linkReplacesFile.chip.present, true);
    assert.equal(checks.exclusivity.linkRemoved, true);

    // The seeded fixture rows render on the shipped page.
    assert.ok(checks.seeded.textRow, "the seeded text row is gone");
    assert.equal(checks.seeded.textRow?.attachment, "text");
    assert.equal(checks.seeded.imageRow?.attachment, "image");
    assert.ok(
      (checks.seeded.imageRow?.image.width ?? 0) > 0,
      "the seeded image row never decoded its picture",
    );
    assert.equal(
      checks.seeded.imageRow?.body ?? "",
      expected.seeded.imageBody,
    );
    assert.equal(checks.seeded.linkRow?.attachment, "link");
    assert.equal(
      checks.seeded.linkRow?.link.present
        ? checks.seeded.linkRow.link.href
        : null,
      expected.seeded.linkUrl,
    );
    assert.ok(
      checks.seeded.reads.includes(expected.seeded.imageRelPath),
      "the seeded picture was never served by the bridge",
    );

    // The dock's mirrored Notebox surface renders the same records and draws
    // their attachments: the seeded picture decodes and the seeded link anchors.
    assert.equal(checks.dock.clicked, true);
    assert.equal(checks.dock.surface, "chain");
    assert.equal(checks.dock.heading, "Notebox", "the dock heading is not Notebox");
    assert.equal(checks.dock.action, true);
    assert.equal(checks.dock.items, expected.seeded.count + 5);
    assert.equal(
      checks.dock.seededImage?.width,
      checks.seeded.imageRow?.image.width,
    );
    assert.ok((checks.dock.seededImage?.width ?? 0) > 0);
    assert.equal(checks.dock.seededLink?.href, expected.seeded.linkUrl);
    assert.equal(checks.dock.seededLink?.target, "_blank");

    // Hygiene: every capture on the chain, nothing unmodelled, nothing broken.
    assert.equal(checks.final.rows, expected.seeded.count + 5);
    assert.equal(checks.final.creates, 5);
    assert.deepEqual(checks.final.unexpected, []);
    assert.deepEqual(consoleErrors, []);
    assert.ok(
      checks.final.overflow.scrollWidth <= checks.final.overflow.clientWidth,
      `page overflows horizontally: ${checks.final.overflow.scrollWidth}px in ${checks.final.overflow.clientWidth}px`,
    );
    assert.equal(checks.final.route, "/chain");

    // ── the inbox: three filter drop-downs on one line ─────────────────────
    // The renderer contract fixes the attributes, labels, row selects and the
    // three filter pickers; the driver read them off the live DOM, made one
    // triage gesture through the operator's own select, then picked values on
    // the status filter. These assertions refuse a report where the filters
    // went back to rows of pills, the page echoed its own state, mislabelled a
    // row, or never re-read.
    const inbox = checks.inbox;
    assert.equal(inbox.rows.length, expected.seeded.count);
    assert.deepEqual(
      inbox.expected?.projects.map((project) => project.title),
      ["Desk rebuild", "Reading list"],
    );
    assert.deepEqual(
      inbox.controls.statusOptions,
      ["inbox", "triaged", "acting", "done", "dropped"],
      "the status select does not offer the five stored values",
    );
    assert.deepEqual(
      inbox.controls.statusLabels,
      ["Inbox", "Triaged", "Acting", "Done", "Dropped"],
      "the status select labels are not the contract's",
    );
    assert.deepEqual(
      [...inbox.controls.priorityLabels].sort(),
      ["High", "Low", "None", "Normal"],
    );
    assert.ok(
      inbox.controls.projectLabels.includes("No project") &&
        inbox.controls.projectLabels.includes("Desk rebuild") &&
        inbox.controls.projectLabels.includes("Reading list"),
      `the project select labels are ${JSON.stringify(inbox.controls.projectLabels)}`,
    );

    // The three filters are pickers, not chip rows: All plus the contract's
    // values, each holding the applied value in its own control.
    assert.equal(
      inbox.controls.filterStatus?.tag,
      "SELECT",
      "the status filter is not a drop-down",
    );
    assert.deepEqual(
      inbox.controls.filterStatus.options.map((option) => option.value),
      ["all", "inbox", "triaged", "acting", "done", "dropped"],
      "the status filter does not offer All and the five stored values",
    );
    assert.deepEqual(
      inbox.controls.filterStatus.options.map((option) => option.label),
      ["All", "Inbox", "Triaged", "Acting", "Done", "Dropped"],
      "the status filter labels are not the contract's",
    );
    assert.equal(
      inbox.controls.filterStatus.value,
      "all",
      "the status filter does not start on All",
    );
    assert.equal(
      inbox.controls.filterDomain?.tag,
      "SELECT",
      "the area filter is not a drop-down",
    );
    const domainFilterValues = inbox.controls.filterDomain.options.map(
      (option) => option.value,
    );
    assert.ok(
      domainFilterValues.includes("all") &&
        domainFilterValues.includes("none") &&
        domainFilterValues.includes("health"),
      `the area filter options are ${JSON.stringify(domainFilterValues)}`,
    );
    assert.equal(
      inbox.controls.filterProject?.tag,
      "SELECT",
      "the project filter is not a drop-down",
    );
    assert.deepEqual(
      [...inbox.controls.filterProject.options.map((option) => option.value)].sort(),
      [
        "a2f4e78f-1e7f-4aac-bee3-6b80042d16c1",
        "all",
        "b7c9d1a2-3f4e-4b6c-8d9e-0f1a2b3c4d5e",
      ].sort(),
      "the project filter is not All plus one option per live project",
    );

    // The requested change, measured: the three pickers share one line, the
    // band is one compact row, and no chip buttons are left in it.
    const filterLayout = inbox.controls.filterLayout;
    assert.equal(
      filterLayout.fields.length,
      3,
      "the filter band does not hold three fields",
    );
    for (const field of filterLayout.fields) {
      assert.equal(
        field.top,
        filterLayout.fields[0].top,
        `a filter field sits on its own line: ${JSON.stringify(filterLayout.fields)}`,
      );
    }
    for (const group of ["filterStatus", "filterDomain", "filterProject"]) {
      assert.equal(
        inbox.controls[group].box.top,
        inbox.controls.filterStatus.box.top,
        `${group} is not on the status filter's line`,
      );
    }
    assert.ok(
      filterLayout.band.height <= 56,
      `the filter band is ${filterLayout.band.height}px tall, not one compact row`,
    );
    assert.equal(
      filterLayout.buttons,
      0,
      "the filter band still contains chip buttons",
    );
    assert.deepEqual(filterLayout.labels, ["Status", "Area", "Project"]);

    // Each seeded row: stored value on the row, contract label beside it.
    for (const row of inbox.rows) {
      assert.ok(row.attachment, `seeded row ${row.body} is not on the page`);
      assert.equal(row.dataStatus, row.expected.status, `${row.body}: data-status`);
      assert.equal(row.status, row.expected.statusLabel, `${row.body}: status chip`);
      assert.equal(
        row.dataDomainSlug,
        row.expected.domainSlug ?? "",
        `${row.body}: data-domain-slug`,
      );
      assert.equal(row.domain, row.expected.domainLabel, `${row.body}: domain chip`);
      assert.equal(
        row.dataProjectId,
        row.expected.projectId ?? "",
        `${row.body}: data-project-id`,
      );
      assert.equal(row.project, row.expected.projectLabel, `${row.body}: project chip`);
      assert.equal(
        row.dataPriority,
        row.expected.priority ?? "none",
        `${row.body}: data-priority`,
      );
      assert.equal(row.priority, row.expected.priorityLabel, `${row.body}: priority chip`);
      assert.equal(row.statusSelect?.value, row.expected.status, `${row.body}: status select`);
      assert.ok(row.prioritySelect, `${row.body}: no priority select`);
      assert.ok(row.projectSelect, `${row.body}: no project select`);
      if (row.expected.capturedFrom) {
        assert.equal(row.capturedFrom, row.expected.capturedFrom, `${row.body}: source chip`);
      }
    }

    // A null area is painted with a word, never a blank cell; a null project
    // says so, and the seeded fixture's source text is on its row.
    const unassigned = inbox.rows.find((row) => row.dataDomainSlug === "");
    assert.ok(unassigned, "no unassigned seeded row on the page");
    assert.equal(unassigned?.domain, "Unassigned");
    assert.equal(unassigned?.project, "No project");
    assert.equal(unassigned?.capturedFrom, "Chrome — AI tab group");
    const filed = inbox.rows.find(
      (row) => row.dataProjectId === "a2f4e78f-1e7f-4aac-bee3-6b80042d16c1",
    );
    assert.ok(filed, "no project-filed seeded row on the page");
    assert.equal(filed?.project, "Desk rebuild");
    assert.equal(filed?.priority, "High");
    assert.equal(filed?.dataPriority, "high");
    const alreadyTriaged = inbox.rows.find((row) => row.dataStatus === "triaged");
    assert.ok(alreadyTriaged, "no seeded row already triaged");
    assert.equal(alreadyTriaged?.status, "Triaged");
    assert.equal(alreadyTriaged?.project, "Reading list");

    // The triage itself: the select wrote one patch, the store kept it, and the
    // row only painted Acting after a fresh chain read answered with it.
    assert.equal(inbox.triage.targetId, filed?.id);
    assert.equal(inbox.triage.before.dataStatus, "inbox");
    assert.equal(inbox.triage.before.status, "Inbox");
    assert.equal(inbox.triage.before.select, "inbox");
    assert.equal(inbox.triage.after.dataStatus, "acting");
    assert.equal(inbox.triage.after.status, "Acting");
    assert.equal(inbox.triage.after.select, "acting");
    assert.equal(inbox.triage.after.storedStatus, "acting");
    assert.deepEqual(inbox.triage.patch, { status: "acting" });
    assert.ok(
      inbox.triage.updates.some(
        (update) =>
          update.id === inbox.triage.targetId && update.patch.status === "acting",
      ),
      "the triage update never reached the recording bridge",
    );
    assert.ok(
      inbox.triage.listReadsAfter > inbox.triage.listReadsBefore,
      `the chain was not re-read after the triage (${inbox.triage.listReadsBefore} reads)`,
    );

    // The status filter narrows, says there is no match, and restores the chain.
    assert.equal(inbox.filter.acting.rows, 1, "the acting filter did not show the triaged row");
    assert.equal(inbox.filter.acting.value, "acting");
    assert.equal(inbox.filter.done.rows, 0, "a status with no rows still painted rows");
    assert.equal(inbox.filter.done.empty, "No signals match these filters.");
    assert.equal(inbox.filter.done.emptyLine, null, "the no-match line became the empty-vault line");
    assert.equal(inbox.filter.done.value, "done");
    assert.equal(inbox.filter.all.rows, expected.seeded.count + 5);
    assert.equal(inbox.filter.all.value, "all");
    assert.ok(
      inbox.screenshot.bytes > 20_000,
      `the triage capture looks empty (${inbox.screenshot.bytes} bytes)`,
    );
  });
});
