/**
 * Stands in for the NSIS installer the auto-update rig would otherwise run on
 * the operator's own machine.
 *
 * The app hands it the file it downloaded, as `argv[2]`. This records that the
 * hand-over really happened — the path, the size, and the SHA-256 of the bytes
 * that were handed over — into the file `LIFEQUEST_FAKE_INSTALLER_OUT` names, so
 * the rig can assert on it from outside the app.
 *
 * It fails loudly rather than quietly succeeding when it is not given a path: a
 * shim that wrote "ok" while being launched with nothing would make the rig's
 * strongest claim — "the app ran exactly the file it downloaded" — vacuous.
 */
import crypto from "node:crypto";
import fs from "node:fs";

const target = process.argv[2];
const out = process.env.LIFEQUEST_FAKE_INSTALLER_OUT;

function record(payload) {
  const body = `${JSON.stringify(
    { at: new Date().toISOString(), argv: process.argv.slice(2), ...payload },
    null,
    2,
  )}\n`;
  if (out) {
    fs.writeFileSync(out, body);
    return;
  }
  process.stdout.write(body);
}

if (!target) {
  record({ ok: false, error: "no installer path was handed over" });
  process.exit(2);
}

let stat;
try {
  stat = fs.statSync(target);
} catch (error) {
  record({
    ok: false,
    installer: target,
    error: `the file the app handed over does not exist: ${
      error instanceof Error ? error.message : String(error)
    }`,
  });
  process.exit(3);
}

const bytes = fs.readFileSync(target);
record({
  ok: true,
  installer: target,
  size: stat.size,
  sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
  head: bytes.subarray(0, 12).toString("utf8"),
});
process.exit(0);
