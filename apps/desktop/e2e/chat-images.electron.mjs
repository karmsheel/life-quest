/**
 * Drives pictures-in-the-chat through the chat-panel harness page and through
 * the main process's read door, and turns the checks into
 * `e2e/artifacts/chat-images.{json,png}`.
 *
 * Run with the dev server up (`npm run dev`):
 *
 *   npx electron e2e/chat-images.electron.mjs
 *
 * Three legs, because the feature has three parts:
 *
 *  - RENDERER — a real Electron window against
 *    `chat-panel.html?images=1`, the page's own stubbed bridge answering the
 *    two pictures in the history and the `chatImageRead` door. The history
 *    fixture is the gateway's persisted shape run through `messagesFromPayload`,
 *    so nothing here asserts against a mock of the marker pairing.
 *  - MAIN — the real `electron/chat-image.ts`, bundled with the same esbuild
 *    call the app's main uses, against a throwaway vault root and profile home.
 *  - INSTRUCTIONS — the real `electron/companion-client.ts` `buildInstructions`
 *    bundled the same way: the picture rule the agent is always handed, and the
 *    root it names only when a vault is open.
 *
 * Failure modes this rig exists to catch, in the order they would bite:
 *
 *  1. The answer's markdown picture never appears, or its caption/alt is lost.
 *  2. Text runs around a picture are dropped, or a picture-free chat grows one.
 *  3. A picture that cannot be read shows a broken-image glyph or the raw
 *     markdown instead of the quiet missing chip.
 *  4. The operator's sent picture is missing from their own bubble on reload, or
 *     the gateway's `[screenshot]` / `[Image attached at: …]` markers are
 *     printed as words.
 *  5. The thumbnail does not open the overlay, or the overlay does not close on
 *     Escape or on a backdrop click.
 *  6. A live reply's markdown picture is not painted in its answer bubble.
 *  7. The composer's sent picture does not become a thumbnail in the sent
 *     bubble, or its chip is left behind after the send.
 *  8. The read door is loose: a `..` path, an absolute escape, a scheme, a
 *     non-picture extension, a renamed text file, a symlinked leaf or an
 *     oversized file returns bytes.
 *  9. The agent is never told the chat can draw a picture, or is told a path it
 *     cannot write — a root on a closed vault, or no root at all on an open one.
 *
 * Exit code 0 = every check held. The JSON report names every check and is
 * written even when a leg throws, so a failure says what failed.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { app, BrowserWindow, nativeTheme } from "electron";
import { build } from "esbuild";

// An occluded window stops painting, and a window that stops painting stops
// firing requestAnimationFrame: a rig that waits on a frame then hangs until its
// watchdog instead of failing, and reports only which step it was on. A rig runs
// hidden beside every other rig in the suite, so it has to keep painting.
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..", "..");
const artifactsDir = path.join(here, "artifacts");

/**
 * The page is opened with `?images=1`: the harness answers the first chat with
 * the gateway's picture shape and serves `chatImageRead` from the page. Every
 * other chat-panel rig opens the same page without the flag and keeps the page
 * it measures.
 */
const baseUrl =
  process.env.LIFEQUEST_E2E_URL ?? "http://127.0.0.1:5173/e2e/chat-panel.html";
const url = `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}images=1`;

// Its own Electron profile: the panel remembers the last chat it opened in
// localStorage, and a shared profile would start this run on another rig's chat.
const userDataDir = path.join(artifactsDir, "userdata", "chat-images");
fs.mkdirSync(userDataDir, { recursive: true });
app.setPath("userData", userDataDir);

const BUNDLE = path.join(artifactsDir, ".chat-images.bundle.mjs");
const INSTRUCTIONS_BUNDLE = path.join(artifactsDir, ".chat-instructions.bundle.mjs");
const REPORT = path.join(artifactsDir, "chat-images.json");
const SHOT = path.join(artifactsDir, "chat-images.png");

const DEFAULT_SIZE = { width: 1280, height: 900 };

/**
 * A real 120×80 PNG — a small floor plan — carried as base64.
 *
 * The renderer receives these bytes from the stubbed read door and builds a
 * blob from them, so the artifact's picture is a picture rather than a broken
 * glyph: a fixture that cannot decode would fail the run for the fixture's
 * reason, not the feature's.
 */
const FIXTURE_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAHgAAABQCAYAAADSm7GJAAAA8klEQVR42u3doQ2AMBRF0S6GrGEKJkB3PDbAsQ4EhSGhCAQvR9wqTHtQvwmUsQ67civnsq2LAgMMWIAFWIAFWJ8At3mK6OkwEvfVDfz3N7kXOG1fgAEDBgwYMGDAgAEDBgwYMGDAgAEDBgwYMGDAgAEDBgwYMGDAgAEDBgwYMGDAgAEDBgwYMGDAgAEDBgwYMGDAgAEDBgwYMGDAgAEDBgwY8PWMzygFAycGGDBgwIABAwYMGDBgwIABG3QYVRpVAgYMGDBgwIABAwYMGDBgwIABAwYMGDBgwIABvwL2e9ng60KFX/gLsAALsAALsO6AldsBUAl2ewlaRXQAAAAASUVORK5CYII=";
const FIXTURE_PNG = new Uint8Array(Buffer.from(FIXTURE_PNG_BASE64, "base64"));

/** The refs the harness's pictures fixture names (chat-panel.tsx `?images=1`). */
const PRESENT_ANSWER = "attachments/chat/present-plan.png";
const MISSING_ANSWER = "attachments/chat/missing-plan.png";
const PRESENT_SENT = "/tmp/lifequest-e2e/native-inputs/present-user.png";
const LIVE_PICTURE = "attachments/chat/present-shot.png";
const LIVE_PROMPT = "Show me the shot";
const LIVE_ANSWER = `![the shot](${LIVE_PICTURE})`;

/** The operator's sentence for every refusal (design §2). */
const UNREADABLE = "That picture could not be read.";

const scenarios = [];
const failures = [];
const check = (name, condition, detail) => {
  scenarios.push({ name, pass: Boolean(condition), detail: detail ?? null });
  if (!condition) failures.push(`${name}: ${detail}`);
  return Boolean(condition);
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Page-side helpers injected into the driver's own expressions: the legs below
 * are about pictures, not about writing poll loops.
 */
const PRELUDE = `
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const until = async (predicate, timeoutMs = 8000) => {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const value = await predicate();
      if (value) return value;
      await wait(50);
    }
    return null;
  };
  const fixtureBytes = () =>
    Uint8Array.from(atob(${JSON.stringify(FIXTURE_PNG_BASE64)}), (char) => char.charCodeAt(0));
`;

/**
 * One read of the thread: every turn with its two bubbles, every picture
 * control with its state/source/box, the overlay if one is up, the composer's
 * chip and the bridge recordings. The assertions are made against this, not
 * against the panel's own state, so a picture that is in the data but not on
 * the screen still fails.
 */
const SAMPLE = `(() => {
  const text = (el) => ((el && el.textContent) || "").trim();
  const boxOf = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {
      left: Math.round(r.left),
      right: Math.round(r.right),
      top: Math.round(r.top),
      bottom: Math.round(r.bottom),
      width: Math.round(r.width),
      height: Math.round(r.height),
    };
  };
  const imagesIn = (root) =>
    Array.from((root ?? document).querySelectorAll('[data-testid="chat-image"]')).map((el) => {
      const img = el.querySelector("img");
      return {
        source: el.getAttribute("data-image-source"),
        state: el.getAttribute("data-image-state"),
        className: el.getAttribute("class"),
        title:
          el.getAttribute("title") ??
          el.querySelector("[title]")?.getAttribute("title") ??
          null,
        insideUserImages: Boolean(el.closest('[data-testid="turn-user-images"]')),
        insideTurnUser: Boolean(el.closest('[data-testid="turn-user"]')),
        insideTurnAnswer: Boolean(el.closest('[data-testid="turn-answer"]')),
        img: img
          ? { src: img.getAttribute("src"), alt: img.getAttribute("alt") }
          : null,
        text: text(el),
        box: boxOf(el),
      };
    });
  const turns = Array.from(document.querySelectorAll('[data-testid="turn"]')).map((turn) => {
    const user = turn.querySelector('[data-testid="turn-user"]');
    const answer = turn.querySelector('[data-testid="turn-answer"]');
    return {
      status: turn.getAttribute("data-turn-status"),
      userText: text(user && user.querySelector(".chat-panel__message-content")),
      answerText: text(answer && answer.querySelector(".chat-panel__message-content")),
      userImageRow: Boolean(user && user.querySelector('[data-testid="turn-user-images"]')),
      userImages: imagesIn(user),
      answerImages: imagesIn(answer),
    };
  });
  const messages = document.querySelector(".chat-panel__messages");
  const overlay = document.querySelector('[data-testid="chat-image-overlay"]');
  return {
    turns,
    images: imagesIn(document),
    messagesText: messages ? messages.innerText : "",
    transcriptImages: Array.from((messages ?? document).querySelectorAll("img")).map((img) => ({
      src: img.getAttribute("src"),
      alt: img.getAttribute("alt"),
    })),
    overlay: overlay
      ? {
          present: true,
          closePresent: Boolean(
            overlay.querySelector('[data-testid="chat-image-overlay-close"]'),
          ),
          imageSrcs: Array.from(overlay.querySelectorAll("img")).map((img) =>
            img.getAttribute("src"),
          ),
        }
      : { present: false, closePresent: false, imageSrcs: [] },
    rail: Array.from(document.querySelectorAll(".chats-rail__row")).map((row) =>
      text(row.querySelector(".chats-rail__label")),
    ),
    attachmentChips: document.querySelectorAll('[data-testid="chat-attachment"]').length,
    attachmentCalls: window.__lqAttachmentCalls ?? [],
    chatCalls: window.__lqChatCalls ?? [],
    chatImageCalls: window.__lqChatImageCalls ?? [],
    sendState: document.querySelector(".chat-panel__send")?.getAttribute("data-state") ?? null,
    composerValue: document.querySelector(".chat-panel__composer-input")?.value ?? null,
  };
})()`;

/** Whether the pictures-history turn is on screen with both pictures settled. */
const HISTORY_READY = `(() => {
  const turns = Array.from(document.querySelectorAll('[data-testid="turn"]'));
  const turn = turns.find((element) =>
    ((element.querySelector('[data-testid="turn-user"]')?.textContent) ?? "").includes("look at this"));
  if (!turn) return false;
  const ready = (root) =>
    Boolean(root && root.querySelector('[data-testid="chat-image"][data-image-state="ready"]'));
  const missing = Boolean(
    turn.querySelector('[data-testid="turn-answer"] [data-testid="chat-image"][data-image-state="missing"]'),
  );
  return ready(turn.querySelector('[data-testid="turn-user"]')) &&
    ready(turn.querySelector('[data-testid="turn-answer"]')) &&
    missing;
})()`;

/**
 * Wait until an expression is true, or throw with the label that timed out.
 * The rigs fail on their steps rather than on a timer: a timeout names what the
 * screen never showed.
 */
function makeWaiter(win) {
  return async (expression, label, timeoutMs = 12_000) => {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      if (await win.webContents.executeJavaScript(expression, true)) return;
      await sleep(50);
    }
    throw new Error(`timed out waiting for ${label}`);
  };
}

/** Open the chat whose rail label is `title`, the way the operator does. */
function openChatExpression(title) {
  return `(() => {
    const label = ${JSON.stringify(title)};
    const row = Array.from(document.querySelectorAll(".chats-rail__row")).find(
      (element) => ((element.querySelector(".chats-rail__label")?.textContent) ?? "").trim() === label,
    );
    const main = row?.querySelector(".chats-rail__row-main");
    if (!main) return false;
    main.click();
    return true;
  })()`;
}

/** Open the first ready picture in the pictures-history turn's answer. */
const OPEN_ANSWER_PICTURE = `(() => {
  const turns = Array.from(document.querySelectorAll('[data-testid="turn"]'));
  const turn = turns.find((element) =>
    ((element.querySelector('[data-testid="turn-user"]')?.textContent) ?? "").includes("look at this"));
  const button = turn?.querySelector(
    '[data-testid="turn-answer"] [data-testid="chat-image"][data-image-state="ready"]',
  );
  if (!button) return false;
  button.click();
  return true;
})()`;

/** Close the overlay by clicking its backdrop, with a real pointer press. */
async function clickOverlayBackdrop(win) {
  const point = await win.webContents.executeJavaScript(
    `(() => {
      const overlay = document.querySelector('[data-testid="chat-image-overlay"]');
      if (!overlay) return null;
      const r = overlay.getBoundingClientRect();
      const candidates = [
        [r.left + 8, r.top + 8],
        [r.right - 8, r.top + 8],
        [r.left + 8, r.bottom - 8],
        [r.right - 8, r.bottom - 8],
      ];
      for (const [x, y] of candidates) {
        const hit = document.elementFromPoint(x, y);
        // A point that really lands on the scrim, not on the picture or the
        // close control: the "click outside closes" path is the path under test.
        if (hit === overlay) return { x, y };
      }
      return null;
    })()`,
    true,
  );
  if (!point) return false;
  const x = Math.round(point.x);
  const y = Math.round(point.y);
  win.webContents.sendInputEvent({ type: "mouseDown", x, y, button: "left", clickCount: 1 });
  await sleep(30);
  win.webContents.sendInputEvent({ type: "mouseUp", x, y, button: "left", clickCount: 1 });
  return true;
}

/** A real Escape key, through Chromium's own input path. */
async function pressEscape(win) {
  win.webContents.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
  win.webContents.sendInputEvent({ type: "keyUp", keyCode: "Escape" });
  await sleep(120);
}

/** The real module under test, bundled exactly the way the app's main is. */
async function loadModules() {
  await build({
    stdin: {
      contents: `export * from ${JSON.stringify(
        path.join(repoRoot, "apps/desktop/electron/chat-image.ts"),
      )};`,
      resolveDir: repoRoot,
      sourcefile: "chat-images.entry.ts",
      loader: "ts",
    },
    outfile: BUNDLE,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    external: ["electron", "node:sqlite"],
    logLevel: "silent",
  });
  return import(pathToFileURL(BUNDLE).href);
}

/**
 * The instruction module under test, bundled the same way.
 *
 * `buildInstructions` is the one prompt the agent is handed every turn, so the
 * picture rule must be in the bundle the app ships rather than a fixture. The
 * module imports only one shared type module, so a plain esbuild turn suffices.
 */
async function loadInstructionModule() {
  await build({
    stdin: {
      contents: `export * from ${JSON.stringify(
        path.join(repoRoot, "apps/desktop/electron/companion-client.ts"),
      )};`,
      resolveDir: repoRoot,
      sourcefile: "chat-instructions.entry.ts",
      loader: "ts",
    },
    outfile: INSTRUCTIONS_BUNDLE,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    external: ["electron", "node:sqlite"],
    logLevel: "silent",
  });
  return import(pathToFileURL(INSTRUCTIONS_BUNDLE).href);
}

/** The picture rule's paragraph, out of the shipped instruction prompt. */
function pictureRuleOf(instructions) {
  const text = String(instructions ?? "");
  return (
    text
      .split("\n")
      .find((line) => /chat draws a picture/i.test(line)) ?? ""
  );
}

/**
 * Write a small real picture at `file`, creating its directory.
 *
 * The bytes are the same decoded PNG the page's read door returns, so a leg
 * that reads a file and a page that paints a picture are talking about the same
 * picture rather than two fixtures that happen to share a name.
 */
function writeFixture(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, FIXTURE_PNG);
  return file;
}

/** True when a refusal of `ref` is the one quiet sentence and nothing was read. */
function refused(result) {
  return (
    result &&
    result.ok === false &&
    typeof result.error === "string" &&
    result.error.length > 0 &&
    /could not be read/i.test(result.error)
  );
}

/**
 * The main leg: the read door, against a throwaway vault and profile home.
 *
 * Every allowed shape reads its bytes; every refused shape is refused with the
 * operator's one sentence. The fixtures live under the rig's own userData, so
 * the operator's vault and profile are never touched.
 */
async function readDoorLeg() {
  const mod = await loadModules();
  const present = check(
    "the read door module exports readChatImage and a size ceiling",
    typeof mod.readChatImage === "function" && typeof mod.CHAT_IMAGE_MAX_BYTES === "number",
    `readChatImage ${typeof mod.readChatImage}, ceiling ${mod.CHAT_IMAGE_MAX_BYTES}`,
  );
  if (!present) return { ceiling: mod.CHAT_IMAGE_MAX_BYTES ?? null };

  const ceiling = mod.CHAT_IMAGE_MAX_BYTES;
  check(
    "publishes the 24 MB picture ceiling",
    ceiling === 24 * 1024 * 1024,
    `${ceiling}`,
  );

  const stamp = `${process.pid}-${Date.now().toString(36)}`;
  const vaultRoot = path.join(userDataDir, `vault-${stamp}`);
  const profileHome = path.join(userDataDir, `profile-${stamp}`);
  const outsideRoot = path.join(userDataDir, `outside-${stamp}`);
  fs.mkdirSync(vaultRoot, { recursive: true });
  fs.mkdirSync(profileHome, { recursive: true });
  fs.mkdirSync(outsideRoot, { recursive: true });

  // A picture in the vault, reachable by a vault-relative ref and by its own
  // absolute path; the profile's retained copy; a valid picture that lives
  // outside both allowed roots; and the files the door must refuse.
  const storedRelative = "attachments/chat/present-plan.png";
  const storedAbsolute = writeFixture(path.join(vaultRoot, storedRelative));
  const nativeRelative = "native-inputs/present-user.png";
  const nativeAbsolute = writeFixture(path.join(profileHome, nativeRelative));
  const outsideFile = writeFixture(path.join(outsideRoot, "present-outside.png"));
  writeFixture(path.join(vaultRoot, "escape.png"));
  writeFixture(path.join(vaultRoot, "not-a-picture.txt"));
  fs.writeFileSync(path.join(vaultRoot, "liar.png"), "this is text, not a png");
  fs.writeFileSync(path.join(vaultRoot, "renamed.jpg"), FIXTURE_PNG);
  const symlinkLeaf = path.join(vaultRoot, "linked.png");
  fs.symlinkSync(outsideFile, symlinkLeaf);
  const oversized = path.join(vaultRoot, "oversized.png");
  const big = Buffer.alloc(ceiling + 1024, 0x41);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(big);
  fs.writeFileSync(oversized, big);

  const read = (ref, roots = { vaultRoot, profileHome }) =>
    mod.readChatImage({ vaultRoot: roots.vaultRoot, profileHome: roots.profileHome, ref });

  const allowed = async (name, ref, roots) => {
    const result = await read(ref, roots);
    check(
      name,
      result?.ok === true &&
        result.value?.mime === "image/png" &&
        result.value?.bytes?.byteLength === FIXTURE_PNG.byteLength,
      result?.ok === true
        ? `mime ${result.value?.mime}, ${result.value?.bytes?.byteLength} bytes`
        : `refused: ${result?.error}`,
    );
    return result;
  };

  const forbid = async (name, ref, roots) => {
    const result = await read(ref, roots);
    check(name, refused(result), result?.ok === true ? "the door returned bytes" : `error ${JSON.stringify(result?.error)}`);
    return result;
  };

  // The three refs a chat bubble legitimately names: an answer's vault-relative
  // path, a path the agent named absolutely inside the vault, and the gateway's
  // retained copy of a picture the operator sent.
  await allowed("reads a vault-relative picture", storedRelative);
  await allowed("reads an absolute path inside the vault", storedAbsolute);
  await allowed("reads an absolute path under the profile's native-inputs", nativeAbsolute);
  check(
    "the vault's own picture is on disk where the ref says",
    fs.existsSync(path.join(vaultRoot, storedRelative)),
    storedAbsolute,
  );
  check(
    "the profile's retained copy is on disk where the hint says",
    fs.existsSync(nativeAbsolute),
    nativeAbsolute,
  );

  // Every shape the door must refuse. A hit here is a picture the model (or a
  // corrupted transcript) talked the app into reading.
  await forbid("refuses a path that climbs out of the vault", "../escape.png");
  await forbid("refuses an absolute path outside both allowed roots", outsideFile);
  await forbid("refuses a remote URL", "https://example.com/x.png");
  await forbid("refuses a data URL", `data:image/png;base64,${FIXTURE_PNG_BASE64.slice(0, 24)}`);
  await forbid("refuses a file that is not a picture extension", "not-a-picture.txt");
  await forbid("refuses a picture whose bytes are text", "liar.png");
  await forbid("refuses a picture whose bytes are another format", "renamed.jpg");
  await forbid("refuses a symlinked leaf", "linked.png");
  await forbid("refuses a picture over the size ceiling", "oversized.png");
  await forbid("refuses a picture that is not on disk", "missing-file.png");
  await forbid("refuses an empty ref", "");
  await forbid("refuses a NUL in the ref", `${storedRelative}\u0000.png`);

  // A relative ref is resolved against the vault root: the same file reached
  // through an absolute path must be the byte-identical file.
  const relativeRead = await read(storedRelative);
  check(
    "a relative ref and the vault's absolute path name the same picture",
    relativeRead?.ok === true &&
      Buffer.compare(Buffer.from(relativeRead.value.bytes), fs.readFileSync(storedAbsolute)) === 0,
    relativeRead?.ok === true ? "bytes differ" : `refused: ${relativeRead?.error}`,
  );

  return {
    ceiling,
    vaultRoot,
    profileHome,
    allowed: { storedRelative, storedAbsolute, nativeAbsolute },
  };
}

/**
 * The instruction leg: the picture rule the agent is handed every turn.
 *
 * The rule is a capability of the app, not of a turn, so it rides an ordinary
 * instruction prompt with no picture on it. With a vault open it must name the
 * root the agent may actually save under, because the gateway's working
 * directory is neither the vault nor stable; with no vault open it must still
 * carry the rule but name no root it cannot write. A remote or data URL is
 * never drawn, and both transports share the same block.
 */
async function instructionLeg() {
  const firstCheck = scenarios.length;
  const firstFailure = failures.length;
  const mod = await loadInstructionModule();
  const exported = check(
    "the instruction module exports buildInstructions",
    typeof mod.buildInstructions === "function",
    `buildInstructions ${typeof mod.buildInstructions}`,
  );
  if (!exported) return { pass: false, checks: scenarios.slice(firstCheck), rule: null };

  const context = {
    domainName: null,
    domainSlug: null,
    aboutMe: "",
    locked: false,
    vaultOpen: true,
  };
  const withRoot = mod.buildInstructions({ ...context, vaultRoot: "/tmp/vault-root" });
  const withoutRoot = mod.buildInstructions(context);
  const pi = mod.buildInstructions({ ...context, vaultRoot: "/tmp/vault-root" }, "pi");
  const ruleWithRoot = pictureRuleOf(withRoot);
  const ruleWithoutRoot = pictureRuleOf(withoutRoot);

  check(
    "an ordinary turn carries the picture rule",
    ruleWithRoot.includes("![") && /\.png/i.test(ruleWithRoot) && /picture/i.test(ruleWithRoot),
    `rule ${JSON.stringify(ruleWithRoot.slice(0, 160))}`,
  );
  check(
    "the picture rule names the open vault's root",
    ruleWithRoot.includes("/tmp/vault-root") && /root on this machine/i.test(ruleWithRoot),
    `rule ${JSON.stringify(ruleWithRoot)}`,
  );
  check(
    "a turn with no vault still carries the picture rule",
    ruleWithoutRoot.includes("![") && /picture/i.test(ruleWithoutRoot),
    `rule ${JSON.stringify(ruleWithoutRoot.slice(0, 160))}`,
  );
  check(
    "a turn with no vault names no root it cannot write",
    ruleWithoutRoot.length > 0 &&
      !/root on this machine/i.test(ruleWithoutRoot) &&
      !ruleWithoutRoot.includes("/tmp/vault-root"),
    `rule ${JSON.stringify(ruleWithoutRoot)}`,
  );
  check(
    "the picture rule says a remote or data URL is never drawn",
    /remote URL or a data URL is never drawn/i.test(ruleWithRoot) &&
      /remote URL or a data URL is never drawn/i.test(ruleWithoutRoot),
    `with ${JSON.stringify(ruleWithRoot.slice(-120))}, without ${JSON.stringify(ruleWithoutRoot.slice(-120))}`,
  );
  check(
    "both transports are handed the same picture rule",
    pictureRuleOf(pi) === ruleWithRoot && pictureRuleOf(pi).includes("/tmp/vault-root"),
    "the Pi and Hermes prompts disagree",
  );

  return {
    pass: failures.length === firstFailure,
    checks: scenarios.slice(firstCheck),
    rule: { withRoot: ruleWithRoot, withoutRoot: ruleWithoutRoot },
  };
}

/**
 * The renderer leg: a real window, the real ChatPanel, the real ChatImage and
 * CSS, with only the IPC bridge stubbed by the harness page.
 */
async function rendererLeg() {
  const win = new BrowserWindow({
    ...DEFAULT_SIZE,
    show: false,
    backgroundColor: "#1a1917",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  const run = (expression) => win.webContents.executeJavaScript(expression, true);
  const waitFor = makeWaiter(win);

  try {
    await win.loadURL(url);
    await run("window.chatPanelHarnessReady.then(() => true)");
    win.setContentSize(DEFAULT_SIZE.width, DEFAULT_SIZE.height);
    await sleep(250);
    win.showInactive();
    win.webContents.focus();
    await sleep(150);

    // ── The reloaded operator row and the answer's pictures ────────────────
    //
    // The page's first chat is opened by its rail row, the gesture the operator
    // makes, rather than assumed: the fixture answers that chat and only it.
    const opened = await run(openChatExpression("Harness"));
    check("the pictures history chat can be opened from the rail", opened === true, "no Harness row");
    await waitFor(HISTORY_READY, "the reloaded sent picture and the answer's pictures");
    const history = await run(SAMPLE);
    const historyTurn = history.turns.find((turn) => turn.userText.includes("look at this")) ?? null;
    check(
      "the reloaded operator row keeps its turn",
      Boolean(historyTurn),
      `rows ${JSON.stringify(history.turns.map((turn) => turn.userText))}`,
    );

    const sentPicture = historyTurn?.userImages?.find((image) => image.state === "ready") ?? null;
    check(
      "the reloaded operator row draws its sent picture",
      Boolean(sentPicture) &&
        historyTurn?.userImageRow === true &&
        sentPicture.source === "sent" &&
        sentPicture.insideUserImages === true,
      `row ${historyTurn?.userImageRow}, pictures ${JSON.stringify(historyTurn?.userImages)}`,
    );
    check(
      "the sent picture paints from a blob the app minted, not a path",
      typeof sentPicture?.img?.src === "string" && sentPicture.img.src.startsWith("blob:"),
      `src ${JSON.stringify(sentPicture?.img?.src)}`,
    );
    check(
      "the gateway's picture markers are not printed as words",
      !history.messagesText.includes("[screenshot]") &&
        !history.messagesText.includes("[Image attached"),
      `thread reads ${JSON.stringify(history.messagesText.slice(0, 240))}`,
    );
    check(
      "the operator's words survive the marker strip exactly",
      historyTurn?.userText === "look at this",
      `text ${JSON.stringify(historyTurn?.userText)}`,
    );

    const answerPictures = historyTurn?.answerImages ?? [];
    const presentPicture =
      answerPictures.find((image) => image.state === "ready" && image.source === "answer") ?? null;
    const missingPicture =
      answerPictures.find((image) => image.state === "missing") ?? null;
    check(
      "the answer's markdown picture is drawn",
      Boolean(presentPicture) && presentPicture.insideTurnAnswer === true,
      `pictures ${JSON.stringify(answerPictures)}`,
    );
    check(
      "the answer's picture keeps its caption as the alt text",
      presentPicture?.img?.alt === "the floor plan",
      `alt ${JSON.stringify(presentPicture?.img?.alt)}`,
    );
    check(
      "the answer's picture paints from a blob, not the raw path",
      typeof presentPicture?.img?.src === "string" &&
        presentPicture.img.src.startsWith("blob:"),
      `src ${JSON.stringify(presentPicture?.img?.src)}`,
    );
    check(
      "an unreadable picture is the quiet missing chip, not a broken image",
      Boolean(missingPicture) && missingPicture.img === null,
      `missing ${JSON.stringify(missingPicture)}`,
    );
    check(
      "the missing chip says why the picture is not there",
      /could not be read/i.test(String(missingPicture?.title ?? "")),
      `title ${JSON.stringify(missingPicture?.title)}`,
    );
    check(
      "the words around the pictures survive exactly",
      typeof historyTurn?.answerText === "string" &&
        historyTurn.answerText.includes("Here is the plan:") &&
        historyTurn.answerText.includes("and a missing one"),
      `answer reads ${JSON.stringify(historyTurn?.answerText)}`,
    );
    check(
      "no raw markdown or vault path is printed in the thread",
      !history.messagesText.includes("![") &&
        !history.messagesText.includes("attachments/chat/"),
      `thread reads ${JSON.stringify(history.messagesText.slice(0, 240))}`,
    );
    check(
      "no picture in the thread loads a raw path",
      history.transcriptImages.every(
        (image) =>
          String(image.src ?? "").startsWith("blob:") ||
          String(image.src ?? "").startsWith("data:"),
      ),
      `images ${JSON.stringify(history.transcriptImages)}`,
    );
    const askedRefs = history.chatImageCalls.map((call) => call.ref);
    check(
      "the thread asked the read door for the three refs its pictures name",
      askedRefs.includes(PRESENT_ANSWER) &&
        askedRefs.includes(MISSING_ANSWER) &&
        askedRefs.some((ref) => String(ref).endsWith("present-user.png")),
      `refs ${JSON.stringify(askedRefs)}`,
    );

    // ── A picture-free chat stays picture-free ─────────────────────────────
    const switched = await run(openChatExpression("Second chat"));
    check("the picture-free chat can be opened from the rail", switched === true, "no Second chat row");
    await waitFor(
      `document.querySelector(".chat-panel__messages")?.innerText.includes("Loaded the other chat.")`,
      "the picture-free chat's transcript",
    );
    await sleep(200);
    const other = await run(SAMPLE);
    check(
      "a picture-free chat draws no picture at all",
      other.images.length === 0 &&
        other.turns.every((turn) => turn.userImages.length === 0 && turn.answerImages.length === 0),
      `pictures ${JSON.stringify(other.images)}`,
    );

    // Back to the pictures chat: the overlay legs are about its history rows.
    await run(openChatExpression("Harness"));
    await waitFor(HISTORY_READY, "the pictures history to come back");

    // ── The thumbnail opens the overlay; Escape and the backdrop close it ──
    const openedOverlay = await run(OPEN_ANSWER_PICTURE);
    check("a ready picture is a button that can be clicked", openedOverlay === true, "no ready picture");
    await waitFor(
      `Boolean(document.querySelector('[data-testid="chat-image-overlay"]'))`,
      "the picture overlay to open",
    );
    const overlayOpen = await run(SAMPLE);
    check(
      "clicking a picture opens the picture overlay",
      overlayOpen.overlay.present && overlayOpen.overlay.closePresent,
      JSON.stringify(overlayOpen.overlay),
    );
    check(
      "the overlay shows the picture that was clicked",
      overlayOpen.overlay.imageSrcs.some(
        (src) => typeof src === "string" && src.startsWith("blob:"),
      ),
      `srcs ${JSON.stringify(overlayOpen.overlay.imageSrcs)}`,
    );
    await pressEscape(win);
    await waitFor(
      `document.querySelector('[data-testid="chat-image-overlay"]') === null`,
      "Escape to close the overlay",
    );
    const afterEscape = await run(SAMPLE);
    check("Escape closes the picture overlay", afterEscape.overlay.present === false, JSON.stringify(afterEscape.overlay));

    const reopened = await run(OPEN_ANSWER_PICTURE);
    await waitFor(
      `Boolean(document.querySelector('[data-testid="chat-image-overlay"]'))`,
      "the picture overlay to open again",
    );
    const backdropClicked = await clickOverlayBackdrop(win);
    check("the overlay's backdrop is hit-testable outside the picture", backdropClicked === true, "no scrim point");
    await waitFor(
      `document.querySelector('[data-testid="chat-image-overlay"]') === null`,
      "a backdrop click to close the overlay",
    );
    const afterBackdrop = await run(SAMPLE);
    check(
      "clicking the backdrop closes the picture overlay",
      reopened === true && afterBackdrop.overlay.present === false,
      `reopened ${reopened}, overlay ${JSON.stringify(afterBackdrop.overlay)}`,
    );

    // ── A live answer's picture ────────────────────────────────────────────
    //
    // The turn is opened by the real composer and settled through the page's
    // stream handle: the frames are the gateway's own event shape, so what is
    // proved is the panel painting a streamed markdown picture, not a fixture
    // the page injected into the turn.
    const liveStartedAt = Date.now();
    // The transport is held open long enough for the frames to land in a live
    // turn, the way the real stream does.
    await run(`window.__lqChatDelay = 1500`);
    const liveSent = await run(`(async () => { ${PRELUDE}
      const field = document.querySelector(".chat-panel__composer-input");
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
      setter.call(field, ${JSON.stringify(LIVE_PROMPT)});
      field.dispatchEvent(new Event("input", { bubbles: true }));
      await until(() => document.querySelector(".chat-panel__send"), 4000);
      const before = (window.__lqChatCalls ?? []).length;
      document.querySelector(".chat-panel__send").click();
      return { before, clicked: true };
    })()`);
    check("the composer sends the live message", liveSent.clicked === true, JSON.stringify(liveSent));
    await waitFor(
      `(() => {
        const turns = Array.from(document.querySelectorAll('[data-testid="turn"]'));
        const turn = turns.find((element) =>
          ((element.querySelector('[data-testid="turn-user"]')?.textContent) ?? "").includes(${JSON.stringify(LIVE_PROMPT)}));
        return Boolean(turn) && document.querySelector(".chat-panel__send")?.getAttribute("data-state") === "stop";
      })()`,
      "the live turn to open",
    );
    await run(`(() => {
      const emit = window.__lqEmit;
      if (!emit) throw new Error("the panel never registered its stream listener");
      emit({ type: "run.started", runId: "run_harness_images" });
      emit({ type: "assistant.final", text: ${JSON.stringify(LIVE_ANSWER)} });
      emit({ type: "run.completed" });
      return true;
    })()`);
    await waitFor(
      `(() => {
        const turns = Array.from(document.querySelectorAll('[data-testid="turn"]'));
        const turn = turns.find((element) =>
          ((element.querySelector('[data-testid="turn-user"]')?.textContent) ?? "").includes(${JSON.stringify(LIVE_PROMPT)}));
        return Boolean(turn && turn.querySelector('[data-testid="turn-answer"] [data-testid="chat-image"][data-image-state="ready"]'));
      })()`,
      "the live answer's picture",
    );
    const live = await run(SAMPLE);
    const liveTurn = live.turns.find((turn) => turn.userText.includes(LIVE_PROMPT)) ?? null;
    const livePicture =
      liveTurn?.answerImages?.find((image) => image.state === "ready" && image.source === "answer") ??
      null;
    check(
      "the live answer paints the picture its reply names",
      Boolean(livePicture),
      `turn ${JSON.stringify(liveTurn)}`,
    );
    check(
      "the live answer's picture keeps the markdown caption as alt",
      livePicture?.img?.alt === "the shot",
      `alt ${JSON.stringify(livePicture?.img?.alt)}`,
    );
    check(
      "the live answer paints from a blob",
      typeof livePicture?.img?.src === "string" && livePicture.img.src.startsWith("blob:"),
      `src ${JSON.stringify(livePicture?.img?.src)}`,
    );
    check(
      "the live turn settled back to an idle composer",
      live.sendState !== "stop",
      `send state ${JSON.stringify(live.sendState)}`,
    );

    // Let the held transport resolve before the next send: its settle belongs to
    // the turn above, not to the one the composer is about to open.
    await sleep(Math.max(0, liveStartedAt + 1700 - Date.now()));

    // ── The composer's sent picture ────────────────────────────────────────
    await run(`window.__lqChatDelay = 1500`);
    const attached = await run(`(async () => { ${PRELUDE}
      const input = document.querySelector('[data-testid="chat-attachment-input"]');
      if (!input) return { found: false };
      const file = new File([fixtureBytes()], "present-shot.png", { type: "image/png" });
      const transfer = new DataTransfer();
      transfer.items.add(file);
      input.files = transfer.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
      const chip = await until(() => document.querySelector('[data-testid="chat-attachment"]'), 6000);
      return {
        found: true,
        chipPresent: Boolean(chip),
        chipText: chip ? (chip.textContent ?? "") : null,
        calls: window.__lqAttachmentCalls ?? [],
      };
    })()`);
    check(
      "the add control takes a picture into the composer",
      attached.found === true &&
        attached.chipPresent === true &&
        attached.calls.some(
          (call) => call.name === "present-shot.png" && call.mime === "image/png",
        ),
      `chip ${attached.chipPresent}, calls ${JSON.stringify(attached.calls)}`,
    );
    const composerSent = await run(`(() => {
      const button = document.querySelector(".chat-panel__send");
      if (!button) return { clicked: false };
      button.click();
      return { clicked: true };
    })()`);
    check("the composer sends the attached picture", composerSent.clicked === true, "no send control");
    await waitFor(
      `(() => {
        const turns = Array.from(document.querySelectorAll('[data-testid="turn"]'));
        const turn = turns[turns.length - 1];
        const image = turn?.querySelector('[data-testid="turn-user-images"] [data-testid="chat-image"]');
        return Boolean(image) && image.getAttribute("data-image-state") === "ready";
      })()`,
      "the sent picture to paint in the operator's own bubble",
    );
    // The live answer for the same turn, so the run's picture shows both
    // directions at once: the thumbnail the operator sent and the picture the
    // companion's reply drew.
    await run(`(() => {
      const emit = window.__lqEmit;
      emit({ type: "run.started", runId: "run_harness_composer" });
      emit({ type: "assistant.final", text: ${JSON.stringify(LIVE_ANSWER)} });
      emit({ type: "run.completed" });
      return true;
    })()`);
    await waitFor(
      `(() => {
        const turns = Array.from(document.querySelectorAll('[data-testid="turn"]'));
        const turn = turns[turns.length - 1];
        return Boolean(turn?.querySelector('[data-testid="turn-answer"] [data-testid="chat-image"][data-image-state="ready"]'));
      })()`,
      "the composer turn's answer picture",
    );
    const composed = await run(SAMPLE);
    const sentTurn = composed.turns[composed.turns.length - 1] ?? null;
    const sentThumbnail =
      sentTurn?.userImages?.find((image) => image.state === "ready") ?? null;
    check(
      "the operator's sent picture shows as a thumbnail in their own bubble",
      Boolean(sentThumbnail) &&
        sentTurn?.userImageRow === true &&
        sentThumbnail.source === "sent" &&
        sentThumbnail.insideUserImages === true,
      `turn ${JSON.stringify(sentTurn)}`,
    );
    check(
      "the sent thumbnail paints from a blob the app minted",
      typeof sentThumbnail?.img?.src === "string" &&
        sentThumbnail.img.src.startsWith("blob:"),
      `src ${JSON.stringify(sentThumbnail?.img?.src)}`,
    );
    check(
      "the sent picture is a mini square, not the answer column",
      Boolean(sentThumbnail?.box) &&
        Math.abs(sentThumbnail.box.width - sentThumbnail.box.height) <= 2 &&
        sentThumbnail.box.width > 24 &&
        sentThumbnail.box.width < 96,
      `box ${JSON.stringify(sentThumbnail?.box)}`,
    );
    check(
      "the composer's attachment chip is gone after the send",
      composed.attachmentChips === 0,
      `${composed.attachmentChips} chip(s) left on the composer`,
    );
    check(
      "an image-only message still shows its operator row",
      sentTurn?.userText === "" && Boolean(sentTurn?.userImageRow),
      `text ${JSON.stringify(sentTurn?.userText)}`,
    );

    // The picture, for the operator: the last turn's sent thumbnail with the
    // reply's picture under it, and no overlay over either. Taken last, after
    // every leg that opens the overlay has closed it; the short beat lets the
    // thread's end-keeping finish scrolling over the pictures that just landed.
    await sleep(350);
    fs.writeFileSync(SHOT, (await win.webContents.capturePage()).toPNG());
    const shotSize = fs.statSync(SHOT).size;
    check("the artifact picture was written", fs.existsSync(SHOT) && shotSize > 0, `${shotSize} bytes`);

    // ── A reload keeps the history row's picture ───────────────────────────
    //
    // The harness answers the first chat from the gateway-shaped fixture again,
    // so this reload proves the marker pairing still paints after a fresh page:
    // the failure mode is a transcript that only drew the picture live.
    // A reload is a navigation: wait for the new document to finish loading
    // before asking it anything, or the next call can land in the page that is
    // being torn down.
    await new Promise((resolve) => {
      win.webContents.once("did-finish-load", resolve);
      win.webContents.reload();
    });
    await run("window.chatPanelHarnessReady.then(() => true)");
    win.setContentSize(DEFAULT_SIZE.width, DEFAULT_SIZE.height);
    await sleep(250);
    await run(openChatExpression("Harness"));
    await waitFor(HISTORY_READY, "the reloaded history's sent picture");
    const reloaded = await run(SAMPLE);
    const reloadedTurn =
      reloaded.turns.find((turn) => turn.userText.includes("look at this")) ?? null;
    const reloadedPicture =
      reloadedTurn?.userImages?.find((image) => image.state === "ready") ?? null;
    check(
      "a reload keeps the operator row's sent picture",
      Boolean(reloadedPicture) &&
        reloadedPicture.source === "sent" &&
        String(reloadedPicture.img?.src ?? "").startsWith("blob:"),
      `turn ${JSON.stringify(reloadedTurn)}`,
    );
    check(
      "the reloaded page read the picture again through the door",
      reloaded.chatImageCalls.length > 0,
      `calls ${JSON.stringify(reloaded.chatImageCalls)}`,
    );
    check(
      "the reloaded page still prints no marker text",
      !reloaded.messagesText.includes("[screenshot]") &&
        !reloaded.messagesText.includes("[Image attached"),
      `thread reads ${JSON.stringify(reloaded.messagesText.slice(0, 200))}`,
    );

    return {
      history: {
        turn: historyTurn,
        askedRefs,
        messagesText: history.messagesText,
      },
      otherChat: { pictures: other.images.length, turns: other.turns },
      overlay: {
        opened: overlayOpen.overlay.present,
        closePresent: overlayOpen.overlay.closePresent,
        imageSrcs: overlayOpen.overlay.imageSrcs,
        closedByEscape: true,
        backdropClicked,
        closedByBackdrop: true,
      },
      live: { turn: liveTurn, picture: livePicture },
      composer: {
        attachCall: attached.calls.at(-1) ?? null,
        sentTurn,
        sentThumbnail,
        chipsLeft: composed.attachmentChips,
      },
      reload: { turn: reloadedTurn, picture: reloadedPicture, calls: reloaded.chatImageCalls },
    };
  } finally {
    win.destroy();
  }
}

async function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });
  // A rig opens a real window; paint it in the app's own default theme so a run
  // is not a white sheet flashing across the operator's screen.
  nativeTheme.themeSource = "dark";

  let report;
  const timeout = setTimeout(() => {
    console.error("chat-images: timed out after 180s");
    app.exit(1);
  }, 180_000);

  try {
    // The legs are reported separately: a door that fails must not hide what
    // the screen did, and the screen must not hide a missing instruction.
    let renderer = null;
    try {
      renderer = await rendererLeg();
    } catch (error) {
      check(
        "the renderer leg ran",
        false,
        error instanceof Error ? error.message : String(error),
      );
    }
    let readDoor = null;
    try {
      readDoor = await readDoorLeg();
    } catch (error) {
      check(
        "the read door leg ran",
        false,
        error instanceof Error ? error.message : String(error),
      );
    }
    let instruction = null;
    try {
      instruction = await instructionLeg();
    } catch (error) {
      check(
        "the instruction leg ran",
        false,
        error instanceof Error ? error.message : String(error),
      );
    }

    report = {
      ranAt: new Date().toISOString(),
      url,
      fixture: { bytes: FIXTURE_PNG.byteLength, refs: { PRESENT_ANSWER, MISSING_ANSWER, PRESENT_SENT } },
      renderer,
      readDoor,
      instruction,
      screenshot: fs.existsSync(SHOT) ? SHOT : null,
      scenarios,
      failures,
      pass: failures.length === 0,
    };
  } catch (error) {
    report = {
      ranAt: new Date().toISOString(),
      url,
      scenarios,
      failures: [
        ...failures,
        `threw: ${error instanceof Error ? error.message : String(error)}`,
      ],
      pass: false,
    };
  } finally {
    clearTimeout(timeout);
  }

  fs.writeFileSync(REPORT, `${JSON.stringify(report, null, 2)}\n`);

  const rows = scenarios.map((scenario) => [
    scenario.pass ? "PASS" : "FAIL",
    scenario.name,
    scenario.detail ?? "",
  ]);
  const header = ["", "check", "detail"];
  const widths = header.map((_, index) =>
    Math.max(header[index].length, ...rows.map((row) => String(row[index]).length)),
  );
  const format = (row) => row.map((cell, index) => String(cell).padEnd(widths[index])).join("  ");
  console.log(format(header));
  console.log(widths.map((width) => "-".repeat(width)).join("  "));
  for (const row of rows) console.log(format(row));
  console.log("");
  console.log(`report: ${REPORT}`);
  console.log(`shot: ${SHOT}`);
  for (const failure of failures) console.log(`FAIL ${failure}`);
  console.log(report.pass ? "chat images: PASS" : "chat images: FAIL");

  app.exit(report.pass ? 0 : 1);
}

app.on("window-all-closed", () => {});

app
  .whenReady()
  .then(main)
  .catch((error) => {
    console.error(`chat-images: ${error instanceof Error ? error.stack : error}`);
    app.exit(1);
  });
