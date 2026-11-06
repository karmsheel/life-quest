/**
 * Drives the electron half of the general attachment path and the steer verb,
 * and turns the measurements into `e2e/artifacts/attachments.{json,png}`.
 *
 * Run by hand against a dev server, or through the wrapper the test suite
 * uses (`npm run test -w @lifequest/desktop`, which skips when the dev server
 * is down):
 *
 *   npx electron e2e/attachments.electron.mjs
 *
 * This rig has no UI leg on purpose. Everything it checks lives in the main
 * process - the vault write, the pending store, the turn body, the
 * instructions - and the RENDERER half of the feature (the composer's chips,
 * the attach control, the drag and the paste) is the subject of
 * `composer-keys-attachments.electron.mjs`. Driving the composer here as well
 * would make this rig fail for a reason that has nothing to do with what it
 * proves.
 *
 * Why it bundles: Electron's main process cannot import the app's TypeScript,
 * so the modules under test are bundled with the same esbuild call `dev.mjs`
 * uses for main, then imported. `node:sqlite` is a builtin and stays external.
 *
 * Failure modes this rig exists to catch, in the order they would bite:
 *
 *  1. An attachment that is not stored at all, or stored somewhere the agent
 *     cannot open.
 *  2. An image that does not ride the turn as an `image_url` part, so the
 *     model never sees it. The gateway accepts text and image parts ONLY
 *     (`api_server._normalize_multimodal_content` refuses a `file` part with
 *     `unsupported_content_type`), so an image that is not inlined is an
 *     image the agent is told about but cannot see.
 *  3. A non-image attachment that is inlined anyway, which the gateway
 *     REJECTS outright - the turn fails at the far end with a message about
 *     content types.
 *  4. Several images on one turn, which is legal: the gateway walks every
 *     part and refuses only the types it cannot read.
 *  5. An instruction that names a RELATIVE path. The agent's own file tools
 *     resolve a relative path against the gateway process's working directory,
 *     which is neither the vault nor stable, so a relative path is a path the
 *     agent cannot open - an attachment that reads as though it was ignored.
 *  6. A turn naming an attachment the app does not hold, sent anyway as a
 *     turn that quietly lacks the file.
 *  7. The RECEIPT losing its inline copy when the general path was
 *     generalised. The receipt rides its own pending slot and keeps its own
 *     instruction wording, but the wire does not know that: the gateway sees
 *     one list of parts.
 *  8. A steer refusal that says "steer failed", which tells the operator
 *     nothing about whether their message went anywhere.
 *
 * Exit code 0 = every invariant held.
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { app, BrowserWindow, nativeImage } from "electron";
import { build } from "esbuild";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..", "..");
const artifactsDir = path.join(here, "artifacts");

/**
 * Its own Electron profile, and its own throwaway vault.
 *
 * A rig sharing a profile with another run would start on the previous run's
 * localStorage. The vault is a fresh path every run because Windows refuses to
 * remove a directory while any handle inside it is still closing, so a fixed
 * path makes one interrupted run poison every later one.
 */
const userDataDir = path.join(artifactsDir, "userdata", "attachments");
fs.mkdirSync(userDataDir, { recursive: true });
app.setPath("userData", userDataDir);

const VAULT = path.join(userDataDir, `vault-${process.pid}-${Date.now().toString(36)}`);
const BUNDLE = path.join(artifactsDir, ".attachments.bundle.mjs");

/** The real modules under test. */
const MODULES = [
  "packages/vault-core/src/index.ts",
  "apps/desktop/electron/attachment-store.ts",
  "apps/desktop/electron/pending-attachment.ts",
  "apps/desktop/electron/companion-client.ts",
];

async function loadModules() {
  const contents = MODULES.map(
    (rel) => `export * from ${JSON.stringify(path.join(repoRoot, rel))};`,
  ).join("\n");
  await build({
    stdin: { contents, resolveDir: repoRoot, sourcefile: "attachments.entry.ts", loader: "ts" },
    outfile: BUNDLE,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    external: ["electron"],
    logLevel: "silent",
  });
  return import(pathToFileURL(BUNDLE).href);
}

/**
 * A small real image, built rather than embedded. Hand-written base64 is a
 * fixture that can be silently undecodable, and then the rig proves that the
 * *fixture* is broken rather than that the code refuses a bad image.
 */
function fixtureImage() {
  const width = 8;
  const height = 8;
  const bgra = Buffer.allocUnsafe(width * height * 4);
  for (let i = 0; i < bgra.length; i += 4) {
    bgra[i] = 40;
    bgra[i + 1] = 90;
    bgra[i + 2] = 200;
    bgra[i + 3] = 255;
  }
  return new Uint8Array(nativeImage.createFromBitmap(bgra, { width, height }).toJPEG(95));
}

const failures = [];
const scenarios = [];
const check = (name, condition, detail) => {
  scenarios.push({ name, pass: Boolean(condition), detail: detail ?? null });
  if (!condition) failures.push(`${name}: ${detail}`);
  return Boolean(condition);
};

/**
 * The measurements the artifact shows.
 *
 * They are the REAL outputs of the modules under test, not a rendering of what
 * the rig expected: the turn body the gateway would receive, and the
 * instructions the agent would be handed.
 */
const measurements = {};

/**
 * The HTML the picture is rendered from.
 *
 * The page is served over HTTP rather than loaded from a `data:` URL or a
 * `file:` path, because both of those leave the renderer unpainted in a
 * headless container and `capturePage()` then answers with the compositor's
 * `UnknownVizError` instead of a picture. A real HTTP response - with a
 * charset and a length - is the one navigation path that paints here.
 *
 * The content is the rig's own measurements, escaped: the point of the
 * picture is that the operator can SEE the parts the turn carries and the
 * paths the agent is given, without reading the JSON.
 */
function pictureHtml(measurements) {
  const escape = (value) =>
    String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  const parts = Array.isArray(measurements.turnBody) ? measurements.turnBody : [];
  const partRows = parts
    .map((part) => {
      const label = part.type === "image_url" ? "image_url" : part.type;
      const detail =
        part.type === "image_url"
          ? `data:image/jpeg;base64,${String(part.image_url?.url ?? "").slice(23, 43)}...`
          : String(part.text ?? "");
      return `<tr><td class="kind">${escape(label)}</td><td class="detail">${escape(detail)}</td></tr>`;
    })
    .join("\n");
  const stored = measurements.stored ?? {};
  const storedRows = Object.values(stored)
    .filter(Boolean)
    .map(
      (row) =>
        `<tr><td class="kind">${escape(row.kind)}</td><td class="detail">${escape(row.relPath)}<br><span class="dim">${escape(row.name)} - ${escape(row.size)} bytes</span></td></tr>`,
    )
    .join("\n");
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>attachments</title>
<style>
  body { margin: 0; background: #1a1917; color: #ece7df;
         font: 13px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; padding: 20px 24px; }
  h1 { font-size: 15px; margin: 0 0 4px; letter-spacing: .04em; }
  h2 { font-size: 12px; margin: 18px 0 6px; color: #9a938a; text-transform: uppercase;
       letter-spacing: .08em; }
  p.sub { margin: 0 0 10px; color: #9a938a; }
  table { border-collapse: collapse; width: 100%; margin-bottom: 4px; }
  td { border-top: 1px solid #35322d; padding: 5px 8px; vertical-align: top; }
  td.kind { color: #8fc98f; width: 110px; white-space: nowrap; }
  td.detail { color: #ece7df; word-break: break-all; }
  .dim { color: #7d766d; }
  pre { margin: 0; white-space: pre-wrap; word-break: break-word; color: #c9c2b8;
        border-top: 1px solid #35322d; padding: 8px; max-height: 300px; overflow: hidden; }
</style></head>
<body>
  <h1>attachments - the electron turn</h1>
  <p class="sub">The turn body the gateway receives, and the instructions the agent is handed.</p>

  <h2>turn body (input)</h2>
  <table>${partRows || '<tr><td class="detail">a plain string - nothing attached</td></tr>'}</table>

  <h2>stored in the vault</h2>
  <table>${storedRows || '<tr><td class="detail">nothing stored</td></tr>'}</table>

  <h2>instructions (the attachment block)</h2>
  <pre>${escape(
    String(measurements.instructions ?? "")
      .split("\n")
      .filter((line) => /attached to this turn|stored in the vault|file tools|^\d+\./i.test(line))
      .join("\n"),
  )}</pre>
</body></html>`;
}

/**
 * Render the measurements into a PNG.
 *
 * The server is opened on a loopback port of its own and closed as soon as
 * the picture is taken, so the rig never collides with the dev server the
 * suite runs on 5173.
 */
async function capturePicture(file, measurements) {
  const html = pictureHtml(measurements);
  const server = http.createServer((_req, res) => {
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Length": Buffer.byteLength(html),
      "Cache-Control": "no-store",
    });
    res.end(html);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const win = new BrowserWindow({
    width: 1180,
    height: 900,
    show: false,
    backgroundColor: "#1a1917",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  try {
    await win.loadURL(`http://127.0.0.1:${port}/`);
    // The page has to have PAINTED before it is captured: a capture of an
    // unpainted window is a picture of nothing.
    await new Promise((resolve) => setTimeout(resolve, 400));
    const image = await win.webContents.capturePage();
    fs.writeFileSync(file, image.toPNG());
  } finally {
    win.destroy();
    server.close();
  }
}

async function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });
  const mod = await loadModules();

  fs.mkdirSync(VAULT, { recursive: true });
  const created = await mod.createVault(VAULT, "Attachments rig");
  if (!created.ok) throw new Error(`createVault failed: ${created.error}`);

  // 1 - an image attaches.
  const jpeg = fixtureImage();
  const image = await mod.storeAttachment(VAULT, {
    bytes: jpeg,
    mime: "image/jpeg",
    name: "photo.jpg",
  });
  check("an image attaches", image.ok, image.ok ? null : image.error);
  check(
    "an image is the image kind",
    image.ok && image.value.kind === "image",
    image.ok ? image.value.kind : "not ok",
  );
  check(
    "an image carries an inline copy",
    image.ok &&
      typeof image.value.dataUrl === "string" &&
      image.value.dataUrl.startsWith("data:image/jpeg;base64,"),
    image.ok ? String(image.value.dataUrl).slice(0, 40) : "not ok",
  );

  // 2 - a video attaches and cannot be inlined.
  const videoBytes = new Uint8Array([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70]);
  const video = await mod.storeAttachment(VAULT, {
    bytes: videoBytes,
    mime: "video/mp4",
    name: "clip.mp4",
  });
  check("a video attaches", video.ok, video.ok ? null : video.error);
  check(
    "a video is the video kind",
    video.ok && video.value.kind === "video",
    video.ok ? video.value.kind : "not ok",
  );
  check(
    "a video has no inline copy",
    video.ok && video.value.dataUrl === null,
    video.ok ? String(image.value.dataUrl) : "not ok",
  );

  // 3 - the stored file is really on disk, with the bytes that were sent.
  if (image.ok) {
    const abs = path.join(VAULT, image.value.relPath);
    check(
      "the stored path is a file on disk",
      fs.existsSync(abs) && fs.statSync(abs).isFile(),
      abs,
    );
    const onDisk = fs.readFileSync(abs);
    check(
      "the stored bytes are the bytes that were sent",
      Buffer.compare(onDisk, Buffer.from(jpeg)) === 0,
      `${onDisk.length} bytes on disk vs ${jpeg.length} sent`,
    );
    check(
      "the stored path stays inside the vault",
      image.value.relPath.startsWith("attachments/files/"),
      image.value.relPath,
    );
  }

  // 4 - the turn body: one image part per image, no part for a video.
  const attachments = [
    {
      id: "a1",
      kind: "image",
      relPath: image.ok ? image.value.relPath : "",
      name: "photo.jpg",
      size: jpeg.length,
      mime: "image/jpeg",
      dataUrl: image.ok ? image.value.dataUrl : null,
      absolutePath: image.ok ? path.join(VAULT, image.value.relPath) : "",
    },
    {
      id: "a2",
      kind: "video",
      relPath: video.ok ? video.value.relPath : "",
      name: "clip.mp4",
      size: videoBytes.length,
      mime: "video/mp4",
      dataUrl: null,
      absolutePath: video.ok ? path.join(VAULT, video.value.relPath) : "",
    },
  ];
  const body = mod.buildTurnInput("look at these", attachments);
  check("a turn with an image is a parts array", Array.isArray(body), typeof body);
  check(
    "the turn body carries one image part",
    Array.isArray(body) && body.filter((p) => p.type === "image_url").length === 1,
    JSON.stringify(body),
  );
  check(
    "the turn body carries no part for the video",
    Array.isArray(body) && body.every((p) => p.type === "text" || p.type === "image_url"),
    JSON.stringify(body),
  );
  check(
    "a turn with nothing attached is still a plain string",
    mod.buildTurnInput("plain", null) === "plain" &&
      mod.buildTurnInput("plain", []) === "plain",
    JSON.stringify(mod.buildTurnInput("plain", [])),
  );
  check(
    "two images ride one turn as two parts",
    Array.isArray(mod.buildTurnInput("two", [attachments[0], { ...attachments[0], id: "a3" }])) &&
      mod.buildTurnInput("two", [attachments[0], { ...attachments[0], id: "a3" }]).filter(
        (p) => p.type === "image_url",
      ).length === 2,
    "expected two image parts",
  );

  // 5 - the instructions describe every attachment.
  const instructions = mod.buildInstructions({
    domainName: null,
    domainSlug: null,
    aboutMe: "",
    locked: false,
    vaultOpen: true,
    attachments,
  });
  check(
    "the instructions name the image's stored path",
    instructions.includes(attachments[0].relPath),
    "path missing",
  );
  check(
    "the instructions name the image's absolute path",
    instructions.includes(attachments[0].absolutePath),
    "absolute path missing",
  );
  check(
    "the instructions name the video's stored path",
    instructions.includes(attachments[1].relPath),
    "video path missing",
  );
  check(
    "the instructions name the video's file name",
    instructions.includes("clip.mp4"),
    "video name missing",
  );
  check(
    "the instructions say the video is a video",
    /video/i.test(instructions),
    "no kind word",
  );
  check(
    "the instructions say the agent may read the file",
    /read it with your own file tools/i.test(instructions),
    "no read instruction",
  );
  check(
    "the instructions name the size",
    /\d+ (bytes|KB|MB)/.test(instructions),
    "no size",
  );
  check(
    "an ordinary turn says nothing about attachments",
    !/attached to this turn/i.test(
      mod.buildInstructions({
        domainName: null,
        domainSlug: null,
        aboutMe: "",
        locked: false,
        vaultOpen: true,
      }),
    ),
    "an ordinary turn mentions attachments",
  );

  // 5b - the RECEIPT still rides the turn as an image part. The receipt has
  // its own pending slot and its own instruction wording, but the wire does
  // not know that: the gateway sees one list of parts, and the receipt's
  // picture is one of them. This is the check that catches a receipt losing
  // its inline copy when the general attachment path was generalised.
  const receiptPart = {
    id: "receipt-1",
    kind: "image",
    relPath: "domains/financial/data/files/abc/receipt.jpg",
    name: "receipt.jpg",
    size: 1234,
    mime: "image/jpeg",
    dataUrl: "data:image/jpeg;base64,AAAA",
    absolutePath: "/vault/domains/financial/data/files/abc/receipt.jpg",
  };
  const withReceipt = mod.buildTurnInput("log this", [], receiptPart);
  check(
    "the receipt still rides the turn as an image part",
    Array.isArray(withReceipt) &&
      withReceipt.filter((p) => p.type === "image_url").length === 1 &&
      withReceipt.find((p) => p.type === "image_url").image_url.url ===
        "data:image/jpeg;base64,AAAA",
    JSON.stringify(withReceipt),
  );
  check(
    "the receipt and the general images ride one turn together",
    Array.isArray(mod.buildTurnInput("both", [attachments[0]], receiptPart)) &&
      mod.buildTurnInput("both", [attachments[0]], receiptPart).filter(
        (p) => p.type === "image_url",
      ).length === 2,
    "expected two image parts",
  );

  // 6 - the pending store refuses an id it does not hold.
  const pending = mod.pendingAttachments;
  pending.clear();
  pending.add({
    id: "held-1",
    kind: "file",
    name: "notes.txt",
    size: 12,
    mime: "text/plain",
    relPath: "attachments/files/x/notes.txt",
    dataUrl: null,
  });
  check("a held attachment can be found", pending.find("held-1") !== null, "not found");
  check("an unknown id is not found", pending.find("nope") === null, "found one");
  const taken = pending.take(["held-1"]);
  check("a held attachment is taken", taken.length === 1, `${taken.length} taken`);
  check(
    "a taken attachment leaves the pending set",
    pending.peek().length === 0,
    `${pending.peek().length} left`,
  );
  check("taking an unknown id yields nothing", pending.take(["nope"]).length === 0, "got one");

  // 7 - the steer refusal wording. The gateway is NOT called here: these are
  // our own sentences, and the gateway's status codes are mapped onto them.
  const steerSource = fs.readFileSync(
    path.join(repoRoot, "apps/desktop/electron/companion.ts"),
    "utf8",
  );
  check(
    "the steer maps 404 to the operator's sentence",
    steerSource.includes(
      "That turn is no longer running, so the message could not be steered into it.",
    ),
    "404 wording missing",
  );
  check(
    "the steer maps 409 to the operator's sentence",
    steerSource.includes(
      "That turn has already finished, so the message could not be steered into it.",
    ),
    "409 wording missing",
  );
  check(
    "the steer refuses empty text before calling",
    /if \(!steerText\)/.test(steerSource),
    "empty-text guard missing",
  );

  // What the artifact shows: the REAL turn body and the REAL instructions.
  measurements.turnBody = body;
  measurements.instructions = instructions;
  measurements.stored = {
    image: image.ok
      ? {
          relPath: image.value.relPath,
          name: image.value.name,
          size: image.value.size,
          kind: image.value.kind,
        }
      : null,
    video: video.ok
      ? {
          relPath: video.value.relPath,
          name: video.value.name,
          size: video.value.size,
          kind: video.value.kind,
        }
      : null,
  };

  const report = {
    ranAt: new Date().toISOString(),
    vault: VAULT,
    scenarios,
    failures,
    pass: failures.length === 0,
    measurements,
  };

  // The picture: what the turn actually carries, and what the agent is
  // actually told. Both are the modules' own output - the rig renders them,
  // it does not compose them - so a picture that shows the right parts and
  // the right paths is evidence about the shipped behaviour rather than about
  // the rig.
  const pictureFile = path.join(artifactsDir, "attachments.png");
  try {
    await capturePicture(pictureFile, measurements);
    check("the artifact picture was written", fs.existsSync(pictureFile), pictureFile);
  } catch (error) {
    check(
      "the artifact picture was written",
      false,
      error instanceof Error ? error.message : String(error),
    );
  }
  report.picture = fs.existsSync(pictureFile)
    ? path.relative(artifactsDir, pictureFile)
    : null;

  const reportFile = path.join(artifactsDir, "attachments.json");
  fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`);

  const rows = scenarios.map((s) => [s.pass ? "PASS" : "FAIL", s.name, s.detail ?? ""]);
  const header = ["", "scenario", "detail"];
  const widths = header.map((_, i) =>
    Math.max(header[i].length, ...rows.map((r) => String(r[i]).length)),
  );
  const format = (row) => row.map((cell, i) => String(cell).padEnd(widths[i])).join("  ");
  console.log(format(header));
  console.log(widths.map((w) => "-".repeat(w)).join("  "));
  for (const row of rows) console.log(format(row));
  console.log("");
  console.log(`report: ${reportFile}`);
  for (const failure of failures) console.log(`FAIL ${failure}`);
  console.log(report.pass ? "attachments: PASS" : "attachments: FAIL");

  app.exit(report.pass ? 0 : 1);
}

app.on("window-all-closed", () => {});

app
  .whenReady()
  .then(main)
  .catch((error) => {
    console.error(`attachments: ${error instanceof Error ? error.stack : error}`);
    app.exit(1);
  });
