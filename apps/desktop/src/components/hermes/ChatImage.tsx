import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ImageOff, X } from "lucide-react";
import type { ChatImageSource } from "@/lib/chat-images";
import { api } from "@/lib/ipc";

/** The read door's answer reduced to what the bubble needs from it. */
type ReadOutcome = { ok: true; bytes: Uint8Array; mime: string } | { ok: false };

/** Ask main for one picture. A refusal and a transport failure look the same to
 *  the bubble: both are the quiet missing chip, never an error page. */
async function readChatImage(ref: string): Promise<ReadOutcome> {
  try {
    const result = await api().chatImageRead(ref);
    return result.ok
      ? { ok: true, bytes: result.value.bytes, mime: result.value.mime }
      : { ok: false };
  } catch {
    return { ok: false };
  }
}

/**
 * One picture in the thread.
 *
 * A chat picture is a file, never a URL. `src` is an inline source the app itself
 * minted (a data URL from a Pi reload) and paints directly; `ref` is a vault
 * path, or the gateway's retained copy of what the operator sent, and is read
 * once through main's guarded door. The bytes become a blob URL, revoked when
 * the reference changes or the picture unmounts — the same lifecycle as
 * `useImageUrls`, but owned by the one picture, so a long thread does not hold
 * every answer's bytes for the life of the page.
 *
 * The thumbnail is a button. Clicking it opens a fixed overlay on `document.body`
 * — the dock clips its own overflow, and a picture larger than the column should
 * open over the whole window — showing the picture at its own size. Escape and a
 * backdrop click close it, and the listener goes with it. Nothing here can make
 * the app fetch a remote host: only `data:`/`blob:` sources paint, and a `ref`
 * goes through the read door, which refuses anything that is not a local picture.
 */
export function ChatImage({
  source,
  variant,
}: {
  source: ChatImageSource;
  variant: "answer" | "sent";
}) {
  // A source the app did not mint is not painted: an `https:` URL here would be
  // the model making the app fetch an arbitrary host, which the CSP refuses and
  // this component refuses a step earlier.
  const inline =
    source.src && /^(?:data:image\/|blob:)/i.test(source.src) ? source.src : null;
  const ref = source.ref ?? null;
  const [read, setRead] = useState<{ ref: string; url: string } | null>(null);
  const [failedRef, setFailedRef] = useState<string | null>(null);
  /**
   * The read this picture has in flight for one ref. StrictMode runs a mount
   * effect twice, so the effect below finds the promise already here instead of
   * asking main for the same picture a second time; the second run still paints
   * from that one answer.
   */
  const readLedger = useRef<{ ref: string; outcome: Promise<ReadOutcome> } | null>(null);
  // A URL that paints but does not decode — a truncated blob, a bogus data URL
  // in a transcript — is the same quiet missing chip as a refused read, never
  // the browser's broken-image glyph.
  const [broken, setBroken] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setBroken(false);
  }, [inline, ref]);

  useEffect(() => {
    if (inline || !ref) return;
    let cancelled = false;
    let url: string | null = null;
    if (readLedger.current?.ref !== ref) {
      readLedger.current = { ref, outcome: readChatImage(ref) };
    }
    void readLedger.current.outcome.then((outcome) => {
      if (cancelled) return;
      if (!outcome.ok) {
        setFailedRef(ref);
        return;
      }
      url = URL.createObjectURL(
        new Blob([outcome.bytes as BlobPart], { type: outcome.mime }),
      );
      setRead({ ref, url });
    });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [inline, ref]);

  // The overlay is dismissed by the keyboard as readily as by the pointer, and
  // the listener exists only while it is up.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  const url = inline ?? (read && read.ref === ref ? read.url : null);
  // A failed read is only about the ref it was made for: when the turn's picture
  // changes the row reads the new one instead of wearing the old failure.
  const state =
    url && !broken ? "ready" : !ref || broken || failedRef === ref ? "missing" : "loading";
  const classes = `chat-panel__image chat-panel__image--${variant}`;
  const label = source.name;

  if (state === "loading") {
    // The box is already the size the picture will take: sent pictures are
    // squares and answer pictures reserve the column, so nothing below them
    // moves when the bytes land.
    return (
      <button
        type="button"
        className={classes}
        data-testid="chat-image"
        data-image-source={variant}
        data-image-state="loading"
        aria-busy="true"
        aria-label={`Loading ${label}`}
        disabled
      />
    );
  }

  if (state === "missing") {
    return (
      <button
        type="button"
        className={`${classes} chat-panel__image-missing`}
        data-testid="chat-image"
        data-image-source={variant}
        data-image-state="missing"
        title="That picture could not be read."
        aria-label={`${label} — that picture could not be read.`}
      >
        <ImageOff size={12} aria-hidden />
        <span className="chat-panel__image-name">{label}</span>
      </button>
    );
  }

  // `state === "ready"` means `url` is real; the guard narrows it for the JSX.
  if (!url) return null;
  return (
    <>
      <button
        type="button"
        className={classes}
        data-testid="chat-image"
        data-image-source={variant}
        data-image-state="ready"
        title={label}
        aria-label={`Open picture: ${label}`}
        onClick={() => setOpen(true)}
      >
        <img
          className="chat-panel__image-img"
          src={url}
          alt={label}
          loading="lazy"
          draggable={false}
          onError={() => setBroken(true)}
        />
      </button>
      {open && url
        ? createPortal(
            <div
              className="chat-panel__image-overlay"
              data-testid="chat-image-overlay"
              role="dialog"
              aria-modal="true"
              aria-label={label}
              onClick={(event) => {
                // Only the backdrop closes: a click on the picture itself is the
                // operator looking closer, not asking for it to go away.
                if (event.target === event.currentTarget) setOpen(false);
              }}
            >
              <button
                type="button"
                className="chat-panel__image-overlay-close"
                data-testid="chat-image-overlay-close"
                aria-label="Close picture"
                title="Close"
                onClick={() => setOpen(false)}
              >
                <X size={16} aria-hidden />
              </button>
              <img className="chat-panel__image-overlay-img" src={url} alt={label} />
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
