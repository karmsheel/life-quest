/**
 * Drives the composer's keys, its attach control and its live-turn gestures in
 * a real Electron window, and turns the measurements into
 * `e2e/artifacts/composer-keys-attachments.{json,png}`.
 *
 * Run through its wrapper (`npm run test -w @lifequest/desktop`, which skips
 * when the dev server is down), or by hand against a live `npm run dev`:
 *
 *   npx electron e2e/composer-keys-attachments.electron.mjs
 *
 * Failure modes this rig exists to catch, in the order they would bite:
 *
 *  1. Enter still sends. A prompt is a paragraph, and a half-written thought
 *     must not be thrown away by the key the operator reaches for while writing.
 *  2. Ctrl+Enter does not send — the send moved somewhere nobody can find.
 *  3. The add control is not inside the composer box, or not at its bottom
 *     left: the composer must be able to carry a picture, a clip, a recording
 *     or a document, not words alone — and the add control is the first gesture
 *     of the box's own control row, under the field.
 *  4. An attach that never reaches the turn: the file must ride the turn, and
 *     the turn must carry what kind of file it is.
 *  5. The composer closes while a turn runs, so a thought that arrives halfway
 *     through a long answer has nowhere to go — the field must stay open.
 *  6. A steer that never reaches the live run, or that clears the draft when it
 *     was refused: the words must survive a refusal.
 *  7. A queued message that is lost, or that never runs.
 *  8. The two attach flows collapsing into one. The add control takes any file
 *     (no `accept`, `multiple`), because an attachment is something the agent
 *     may look at. The receipt control takes one picture (`image/png`,
 *     `image/jpeg`), because a receipt is what the ledger cites as a
 *     transaction's source. One picker serving both would silently stop a clip
 *     from being attached, or a receipt from being cited.
 *
 * Exit code 0 = every invariant held.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, nativeTheme } from "electron";

// An occluded window stops painting, and a window that stops painting stops
// firing requestAnimationFrame: a rig that waits on a frame then hangs until its
// watchdog instead of failing. A rig runs hidden beside every other rig in the
// suite, so it has to keep painting.
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");

const here = path.dirname(fileURLToPath(import.meta.url));
const artifactsDir = path.join(here, "artifacts");
const url =
  process.env.LIFEQUEST_E2E_URL ?? "http://127.0.0.1:5173/e2e/chat-panel.html";

// Its own Electron profile: a rig sharing a profile with another run would
// start on the previous run's localStorage.
const userDataDir = path.join(artifactsDir, "userdata", "composer-keys-attachments");
fs.mkdirSync(userDataDir, { recursive: true });
app.setPath("userData", userDataDir);

const DEFAULT_SIZE = { width: 1280, height: 900 };

const failures = [];
const check = (label, condition, detail) => {
  if (!condition) failures.push(`${label}: ${detail}`);
  return Boolean(condition);
};

async function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });

  nativeTheme.themeSource = "dark";

  const win = new BrowserWindow({
    ...DEFAULT_SIZE,
    show: false,
    backgroundColor: "#1a1917",
    webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
  });

  const run = (expression) => win.webContents.executeJavaScript(expression, true);

  let report;
  const timeout = setTimeout(() => {
    console.error("composer-keys-attachments: timed out after 90s");
    app.exit(1);
  }, 90_000);

  try {
    await win.loadURL(url);
    await run("window.chatPanelHarnessReady.then(() => true)");

    win.setContentSize(DEFAULT_SIZE.width, DEFAULT_SIZE.height);
    await new Promise((resolve) => setTimeout(resolve, 250));
    win.showInactive();

    /**
     * The composer box, the field on top of it, the control row inside its
     * bottom edge, and the two file pickers that row's controls open.
     */
    const readComposer = `(() => {
      const field = document.querySelector(".chat-panel__composer-input");
      const box = document.querySelector(".chat-panel__composer-box");
      const dock = document.querySelector(".chat-panel__composer-dock");
      const plus = document.querySelector(".chat-panel__composer-plus");
      const attachmentInput = document.querySelector(".chat-panel__attachment-input");
      const receiptInput = document.querySelector(".chat-panel__receipt-input");
      if (!field || !box) return { fieldPresent: false };
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
      const inside = (inner, outer) =>
        Boolean(inner) &&
        Boolean(outer) &&
        inner.left >= outer.left - 0.5 &&
        inner.right <= outer.right + 0.5 &&
        inner.top >= outer.top - 0.5 &&
        inner.bottom <= outer.bottom + 0.5;
      const alphaOf = (color) => {
        const numbers = ((color ?? "").match(/[0-9.]+/g) ?? []).map(Number);
        return numbers.length >= 4 ? numbers[3] : 1;
      };
      // A pill radius is 999px today, but resolve a percentage against the
      // control's own height so the claim survives a skin that writes "50%".
      const radiusOf = (style, height) => {
        const value = style ? style.borderTopLeftRadius : "";
        const amount = parseFloat(value) || 0;
        return value.trim().endsWith("%") ? (amount / 100) * height : amount;
      };
      const fieldBox = boxOf(field);
      const boxBox = boxOf(box);
      const dockBox = boxOf(dock);
      const plusBox = boxOf(plus);
      const plusStyle = plus ? getComputedStyle(plus) : null;
      return {
        fieldPresent: true,
        fieldBox,
        boxBox,
        dockBox,
        plusBox,
        plusPresent: Boolean(plus),
        plusLabel: plus ? plus.getAttribute("aria-label") : null,
        plusBackground: plusStyle ? plusStyle.backgroundColor : null,
        plusRadiusPx:
          plusStyle && plusBox ? Math.round(radiusOf(plusStyle, plusBox.height)) : null,
        plusInsideBox: inside(plusBox, boxBox),
        plusInsideDock: inside(plusBox, dockBox),
        // The bottom-left of the box, under the field: the control row lives
        // inside the box's bottom edge, and the add control is its first
        // gesture, so it sits below the field and on the box's left half.
        plusBelowField:
          Boolean(plusBox) && Boolean(fieldBox) && plusBox.top >= fieldBox.bottom - 0.5,
        plusOnLeftHalf:
          Boolean(plusBox) && Boolean(boxBox) && plusBox.left <= boxBox.left + boxBox.width / 2,
        plusBottomLeft:
          inside(plusBox, boxBox) &&
          Boolean(plusBox) &&
          Boolean(fieldBox) &&
          plusBox.top >= fieldBox.bottom - 0.5 &&
          Boolean(boxBox) &&
          plusBox.left <= boxBox.left + boxBox.width / 2,
        // A circular muted surface: painted rather than transparent, square,
        // and rounded by at least half its own height.
        plusCircular:
          Boolean(plusBox && plusStyle) &&
          plusBox.width === plusBox.height &&
          alphaOf(plusStyle.backgroundColor) > 0 &&
          radiusOf(plusStyle, plusBox.height) >= plusBox.height / 2,
        // The two attach flows are two pickers, not one.
        attachmentInputPresent: Boolean(attachmentInput),
        attachmentAccept: attachmentInput ? attachmentInput.getAttribute("accept") : null,
        attachmentMultiple: attachmentInput ? attachmentInput.multiple : false,
        receiptInputPresent: Boolean(receiptInput),
        receiptAccept: receiptInput ? receiptInput.getAttribute("accept") : null,
        distinctPickers:
          Boolean(attachmentInput) && Boolean(receiptInput) && attachmentInput !== receiptInput,
        fieldDisabled: field.disabled,
        sendCalls: (window.__lqChatCalls ?? []).length,
      };
    })()`;

    const initial = await run(readComposer);

    check("the composer box rendered", initial.fieldPresent, "no composer box on the page");
    check(
      "the add control is inside the composer box, at its bottom left",
      initial.plusBottomLeft,
      `box ${JSON.stringify(initial.boxBox)} plus ${JSON.stringify(initial.plusBox)} field ${JSON.stringify(initial.fieldBox)}`,
    );
    check(
      "the add control sits on the box's control row",
      initial.plusInsideDock,
      `plus ${JSON.stringify(initial.plusBox)} dock ${JSON.stringify(initial.dockBox)}`,
    );
    check(
      "the add control wears a circular surface",
      initial.plusCircular,
      `background ${initial.plusBackground}, ${initial.plusBox?.width}x${initial.plusBox?.height}px, ` +
        `radius ${initial.plusRadiusPx}px`,
    );
    check(
      "the add control names itself",
      Boolean(initial.plusLabel),
      "the plus button has no aria-label",
    );
    // Both attach flows survive, as two pickers: the add control takes any
    // file; the receipt control takes one picture.
    check(
      "the add control opens the general file picker",
      initial.attachmentInputPresent &&
        initial.attachmentAccept === null &&
        initial.attachmentMultiple === true,
      `attachment picker accept=${JSON.stringify(initial.attachmentAccept)}, ` +
        `multiple=${initial.attachmentMultiple}`,
    );
    check(
      "the receipt control keeps its own image-only picker",
      initial.receiptInputPresent &&
        initial.receiptAccept === "image/png,image/jpeg" &&
        initial.distinctPickers,
      `receipt picker accept=${JSON.stringify(initial.receiptAccept)}, ` +
        `distinct=${initial.distinctPickers}`,
    );

    // 1 — Enter is a newline, and it sends nothing.
    const afterEnter = await run(`(() => {
      const field = document.querySelector(".chat-panel__composer-input");
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        "value",
      ).set;
      setter.call(field, "first line");
      field.dispatchEvent(new Event("input", { bubbles: true }));
      field.focus();
      const before = field.value;
      field.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
      );
      return {
        before,
        after: field.value,
        sends: (window.__lqChatCalls ?? []).length,
        prevented: false,
      };
    })()`);

    check(
      "Enter did not send the message",
      afterEnter.sends === 0,
      `${afterEnter.sends} chat call(s) after Enter`,
    );
    check(
      "Enter left the field's text where it was",
      afterEnter.after === afterEnter.before,
      `field became ${JSON.stringify(afterEnter.after)}`,
    );

    // A real keystroke, through Chromium's own input path, so the newline is
    // the browser's insertion and not the app's: the field must end up holding
    // two lines.
    await run(`(() => {
      const field = document.querySelector(".chat-panel__composer-input");
      field.focus();
      return true;
    })()`);
    win.webContents.sendInputEvent({ type: "keyDown", keyCode: "Enter" });
    win.webContents.sendInputEvent({ type: "char", keyCode: "Enter" });
    win.webContents.sendInputEvent({ type: "keyUp", keyCode: "Enter" });
    await new Promise((resolve) => setTimeout(resolve, 250));

    const afterRealEnter = await run(`(() => {
      const field = document.querySelector(".chat-panel__composer-input");
      return {
        value: field.value,
        lines: field.value.split("\\n").length,
        sends: (window.__lqChatCalls ?? []).length,
      };
    })()`);

    check(
      "a typed Enter broke the line",
      afterRealEnter.lines >= 2,
      `field holds ${JSON.stringify(afterRealEnter.value)}`,
    );
    check(
      "the typed Enter sent nothing",
      afterRealEnter.sends === 0,
      `${afterRealEnter.sends} chat call(s) after a typed Enter`,
    );

    // 2 — Ctrl+Enter sends, and the draft goes with it.
    //
    // The field is read after a tick, not straight after the keydown: the
    // draft is cleared by the app's own state, and React has not put that
    // state back on the DOM yet when the keydown returns.
    const afterCtrlEnter = await run(`(async () => {
      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const field = document.querySelector(".chat-panel__composer-input");
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        "value",
      ).set;
      setter.call(field, "the whole prompt");
      field.dispatchEvent(new Event("input", { bubbles: true }));
      field.focus();
      field.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
      await wait(250);
      return {
        sends: (window.__lqChatCalls ?? []).length,
        calls: window.__lqChatCalls ?? [],
        value: field.value,
      };
    })()`);

    check(
      "Ctrl+Enter sent the message",
      afterCtrlEnter.sends === 1,
      `${afterCtrlEnter.sends} chat call(s) after Ctrl+Enter`,
    );
    check(
      "the sent message carried the whole prompt",
      afterCtrlEnter.calls[0]?.input === "the whole prompt",
      `sent ${JSON.stringify(afterCtrlEnter.calls[0]?.input)}`,
    );
    check(
      "Ctrl+Enter cleared the draft",
      afterCtrlEnter.value === "",
      `draft is ${JSON.stringify(afterCtrlEnter.value)}`,
    );

    // 3 — the attach control takes a file of any kind.
    const attached = await run(`(async () => {
      const input = document.querySelector('[data-testid="chat-attachment-input"]');
      const file = new File([new Uint8Array([1, 2, 3, 4])], "clip.mp4", { type: "video/mp4" });
      const transfer = new DataTransfer();
      transfer.items.add(file);
      input.files = transfer.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      for (let i = 0; i < 40; i += 1) {
        if (document.querySelector('[data-testid="chat-attachment"]')) break;
        await wait(100);
      }
      const chip = document.querySelector('[data-testid="chat-attachment"]');
      return {
        calls: window.__lqAttachmentCalls ?? [],
        chip: chip?.textContent ?? null,
        chipKind: chip?.getAttribute("data-attachment-kind") ?? null,
        chipPresent: Boolean(chip),
      };
    })()`);

    check(
      "the picked file reached main",
      attached.calls.length === 1,
      `${attached.calls.length} attach call(s)`,
    );
    check(
      "the picked file kept its name and kind",
      attached.calls[0]?.name === "clip.mp4" && attached.calls[0]?.mime === "video/mp4",
      `call ${JSON.stringify(attached.calls[0])}`,
    );
    check("the attachment showed a chip", attached.chipPresent, "no chip on the composer");
    check(
      "the chip names the file",
      (attached.chip ?? "").includes("clip.mp4"),
      `chip reads ${JSON.stringify(attached.chip)}`,
    );
    check(
      "the chip knows what kind of file it is",
      attached.chipKind === "video",
      `chip kind ${attached.chipKind}`,
    );

    // 4 — the attachment rides the turn.
    const turnWithAttachment = await run(`(() => {
      const field = document.querySelector(".chat-panel__composer-input");
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        "value",
      ).set;
      setter.call(field, "look at this");
      field.dispatchEvent(new Event("input", { bubbles: true }));
      field.focus();
      field.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
      const calls = window.__lqChatCalls ?? [];
      return { last: calls[calls.length - 1], count: calls.length };
    })()`);

    check(
      "the turn carried the attachment",
      Array.isArray(turnWithAttachment.last?.attachments) &&
        turnWithAttachment.last.attachments.length === 1,
      `attachments ${JSON.stringify(turnWithAttachment.last?.attachments)}`,
    );
    check(
      "the turn named the file's kind",
      turnWithAttachment.last?.attachments?.[0]?.kind === "video",
      `attachment ${JSON.stringify(turnWithAttachment.last?.attachments?.[0])}`,
    );

    // 5 — while a turn runs, the composer stays open, and the two gestures
    // appear as soon as there is something to say with them.
    const live = await run(`(async () => {
      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const field = document.querySelector(".chat-panel__composer-input");
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        "value",
      ).set;
      window.__lqChatDelay = 4000;
      setter.call(field, "another turn");
      field.dispatchEvent(new Event("input", { bubbles: true }));
      field.focus();
      field.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
      await wait(400);
      const whileEmpty = {
        disabled: field.disabled,
        steerButton: Boolean(document.querySelector('[data-testid="chat-steer-button"]')),
        sends: (window.__lqChatCalls ?? []).length,
      };
      // Now the operator writes the next thought while the first is still
      // running: the gestures appear for it.
      setter.call(field, "wait, include the tax too");
      field.dispatchEvent(new Event("input", { bubbles: true }));
      await wait(300);
      const during = {
        disabled: field.disabled,
        steerButton: Boolean(document.querySelector('[data-testid="chat-steer-button"]')),
        queueButton: Boolean(document.querySelector('[data-testid="chat-queue-button"]')),
        sends: (window.__lqChatCalls ?? []).length,
      };
      // Let the run finish, so the next legs start from an idle composer.
      window.__lqChatDelay = 0;
      window.__lqEmit?.({ type: "run.completed" });
      await wait(4500);
      return { whileEmpty, during, after: { disabled: field.disabled } };
    })()`);

    check(
      "the composer stayed open while the turn ran",
      live.during.disabled === false,
      "the field was disabled during the turn",
    );
    check(
      "the steer gesture appeared while the turn ran",
      live.during.steerButton,
      "no steer button during the turn",
    );
    check(
      "the queue gesture appeared while the turn ran",
      live.during.queueButton,
      "no queue button during the turn",
    );

    // 6 — a steer reaches the live run, and the words show in the thread.
    const steered = await run(`(async () => {
      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const field = document.querySelector(".chat-panel__composer-input");
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        "value",
      ).set;
      window.__lqChatDelay = 4000;
      setter.call(field, "start over");
      field.dispatchEvent(new Event("input", { bubbles: true }));
      field.focus();
      field.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
      await wait(400);
      window.__lqEmit?.({ type: "run.started", runId: "run_harness_steer" });
      // The run id has to reach the store before a steer can be aimed at it:
      // the steer button is armed by that id, and a steer sent before it
      // arrives has no run to steer.
      let armed = false;
      for (let i = 0; i < 40; i += 1) {
        const button = document.querySelector('[data-testid="chat-steer-button"]');
        if (button && !button.disabled) {
          armed = true;
          break;
        }
        setter.call(field, "actually, focus on the budget");
        field.dispatchEvent(new Event("input", { bubbles: true }));
        await wait(100);
      }
      setter.call(field, "actually, focus on the budget");
      field.dispatchEvent(new Event("input", { bubbles: true }));
      field.focus();
      field.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
      await wait(400);
      window.__lqChatDelay = 0;
      // The turn ends here, so the next leg starts from an idle composer.
      window.__lqEmit?.({ type: "run.completed" });
      await wait(4500);
      return {
        armed,
        calls: window.__lqSteerCalls ?? [],
        draft: field.value,
        transcript: [...document.querySelectorAll(".chat-panel__message--user")].map(
          (row) => row.textContent ?? "",
        ),
      };
    })()`);

    check(
      "the steer reached the live run",
      steered.calls.length >= 1,
      `${steered.calls.length} steer call(s)`,
    );
    check(
      "the steer named the run it steered",
      steered.calls[0]?.runId === "run_harness_steer",
      `steer call ${JSON.stringify(steered.calls[0])}`,
    );
    check(
      "the steer carried the operator's words",
      steered.calls[0]?.text === "actually, focus on the budget",
      `steer text ${JSON.stringify(steered.calls[0]?.text)}`,
    );
    check(
      "the steer cleared the draft",
      steered.draft === "",
      `draft is ${JSON.stringify(steered.draft)}`,
    );
    check(
      "the steer showed in the thread",
      steered.transcript.some((text) => text.includes("focus on the budget")),
      `thread reads ${JSON.stringify(steered.transcript)}`,
    );

    // 7 — a queued message waits, and is shown as waiting.
    const queued = await run(`(async () => {
      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const field = document.querySelector(".chat-panel__composer-input");
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        "value",
      ).set;
      // The previous leg's turn has to be over before this one can start:
      // while a turn is live the same key steers it, which is the point of
      // the other gesture, not a way to send a new turn.
      for (let i = 0; i < 60; i += 1) {
        if (!document.querySelector('[data-testid="chat-steer-button"]')) break;
        setter.call(field, "");
        field.dispatchEvent(new Event("input", { bubbles: true }));
        await wait(100);
      }
      window.__lqChatDelay = 4000;
      setter.call(field, "and after that, summarise it");
      field.dispatchEvent(new Event("input", { bubbles: true }));
      field.focus();
      field.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
      await wait(400);
      window.__lqEmit?.({ type: "run.started", runId: "run_harness_queue" });
      // The queue gesture is there once the turn is live and there is
      // something to line up.
      let armed = false;
      for (let i = 0; i < 40; i += 1) {
        const button = document.querySelector('[data-testid="chat-queue-button"]');
        if (button) {
          armed = true;
          break;
        }
        setter.call(field, "and after that, summarise it");
        field.dispatchEvent(new Event("input", { bubbles: true }));
        await wait(100);
      }
      const setter2 = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        "value",
      ).set;
      setter2.call(field, "and after that, summarise it");
      field.dispatchEvent(new Event("input", { bubbles: true }));
      await wait(150);
      document.querySelector('[data-testid="chat-queue-button"]')?.click();
      await wait(300);
      const rows = [...document.querySelectorAll('[data-testid="chat-queued-row"]')].map(
        (row) => row.textContent ?? "",
      );
      const draft = field.value;
      window.__lqChatDelay = 0;
      await wait(4500);
      return { armed, rows, draft, calls: (window.__lqChatCalls ?? []).length };
    })()`);

    check(
      "the queued message was shown as waiting",
      queued.rows.some((row) => row.includes("summarise it")),
      `queued rows ${JSON.stringify(queued.rows)}`,
    );
    check(
      "queueing cleared the draft",
      queued.draft === "",
      `draft is ${JSON.stringify(queued.draft)}`,
    );

    // The picture, for the operator: the one bordered composer box, its add
    // control at the bottom left of the row inside it, an attachment chip, and
    // the two live-turn gestures. It is taken while a turn is running and a
    // file is waiting, because that is the state the feature is about.
    const shot = path.join(artifactsDir, "composer-keys-attachments.png");
    await run(`(async () => {
      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const field = document.querySelector(".chat-panel__composer-input");
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        "value",
      ).set;
      // A turn running, with something written to steer or queue.
      window.__lqChatDelay = 6000;
      setter.call(field, "start the export");
      field.dispatchEvent(new Event("input", { bubbles: true }));
      field.focus();
      field.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
      await wait(500);
      window.__lqEmit?.({ type: "run.started", runId: "run_harness_shot" });
      await wait(200);
      // A file waiting on the next turn. It is attached AFTER the send,
      // because a send takes the attachments with it.
      const input = document.querySelector('[data-testid="chat-attachment-input"]');
      const file = new File([new Uint8Array([1, 2, 3, 4])], "clip.mp4", { type: "video/mp4" });
      const transfer = new DataTransfer();
      transfer.items.add(file);
      input.files = transfer.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
      await wait(400);
      setter.call(field, "and check the budget while you are at it");
      field.dispatchEvent(new Event("input", { bubbles: true }));
      field.focus();
      await wait(400);
      return true;
    })()`);
    await new Promise((resolve) => setTimeout(resolve, 400));
    fs.writeFileSync(shot, (await win.webContents.capturePage()).toPNG());

    report = {
      url,
      ranAt: new Date().toISOString(),
      initial,
      afterEnter,
      afterRealEnter,
      afterCtrlEnter,
      attached,
      turnWithAttachment,
      live,
      steered,
      queued,
      screenshots: [shot],
      failures,
      pass: failures.length === 0,
    };
  } catch (error) {
    report = {
      url,
      ranAt: new Date().toISOString(),
      failures: [
        ...failures,
        `threw: ${error instanceof Error ? error.message : String(error)}`,
      ],
      pass: false,
    };
  } finally {
    clearTimeout(timeout);
  }

  const reportFile = path.join(artifactsDir, "composer-keys-attachments.json");
  fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`);

  if (report.initial) {
    console.log(
      `plus: bottom-left ${report.initial.plusBottomLeft}, on the dock ` +
        `${report.initial.plusInsideDock}, circular ${report.initial.plusCircular} ` +
        `(${JSON.stringify(report.initial.plusBox)})`,
    );
    console.log(
      `pickers: add accept=${JSON.stringify(report.initial.attachmentAccept)} ` +
        `multiple=${report.initial.attachmentMultiple}; receipt accept=` +
        `${JSON.stringify(report.initial.receiptAccept)}; distinct=${report.initial.distinctPickers}`,
    );
    console.log(
      `keys: Enter sent ${report.afterEnter?.sends}, typed Enter made ` +
        `${report.afterRealEnter?.lines} line(s), Ctrl+Enter sent ${report.afterCtrlEnter?.sends}`,
    );
    console.log(
      `attach: ${report.attached?.calls?.length} call(s), chip ${JSON.stringify(report.attached?.chip)}, ` +
        `turn carried ${JSON.stringify(report.turnWithAttachment?.last?.attachments)}`,
    );
    console.log(
      `live: field disabled ${report.live?.during?.disabled}, steer button ${report.live?.during?.steerButton}`,
    );
    console.log(
      `steer: ${report.steered?.calls?.length} call(s) → ${JSON.stringify(report.steered?.calls?.[0])}`,
    );
    console.log(`queue: ${JSON.stringify(report.queued?.rows)}`);
    console.log("");
  }
  console.log(`report: ${reportFile}`);
  for (const failure of report.failures ?? []) console.log(`FAIL ${failure}`);
  console.log(
    report.pass ? "composer keys and attachments: PASS" : "composer keys and attachments: FAIL",
  );

  app.exit(report.pass ? 0 : 1);
}

app.on("window-all-closed", () => {});

app
  .whenReady()
  .then(main)
  .catch((error) => {
    console.error(
      `composer-keys-attachments: ${error instanceof Error ? error.stack : error}`,
    );
    app.exit(1);
  });
