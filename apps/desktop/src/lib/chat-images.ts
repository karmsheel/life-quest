/**
 * The pictures inside a chat message, split from the words around them.
 *
 * A reply arrives as plain text: the harness writes markdown and the dock paints
 * it as text. The one piece of that markdown that names a picture is
 * `![caption](vault-relative-path)`, and this module is the pure half of drawing
 * it — it finds those references and leaves every other byte where it was, so a
 * reply with no pictures renders exactly as it did before.
 *
 * Two rules matter to the reader:
 *
 *  - Only a real picture reference becomes an image. The ref has to carry a
 *    picture's extension and no scheme; a remote URL or a `data:` URL stays
 *    literal text, because the renderer never fetches anything on the model's
 *    behalf (design §1). Main's read door guards the bytes; this only decides
 *    what looks like a picture.
 *  - A tag that has not finished arriving stays text. A streaming reply ends
 *    mid-tag for a frame or two, and those half-written characters must not
 *    flicker into a broken image on the way; they flip to the picture once the
 *    tag completes.
 */

export type ChatImageSource = { name: string; src?: string; ref?: string };

export type ChatTextSegment =
  | { kind: "text"; text: string }
  | { kind: "image"; alt: string; source: ChatImageSource };

/**
 * Markdown's inline image: `![alt](<dest> "title")`, with the angle brackets and
 * the title optional. The destination is either angle-wrapped — the only way a
 * path with spaces is written — or a run of the punctuation a bare destination
 * may hold. Anything unmatched, including a tag still arriving, is words.
 */
const IMAGE_TAG =
  /!\[([^\]]*)\]\(\s*(?:<([^<>]*)>|([^\s()<>]+))(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/g;

const PICTURE_EXTENSION = /\.(?:png|jpe?g|gif|webp)$/i;
const URL_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/** The file name a chip can show when the model gave no caption. */
function fileName(ref: string): string {
  const path = ref.split(/[?#]/, 1)[0] ?? ref;
  return path.split(/[\\/]/).pop() || ref;
}

/**
 * The ref the renderer will ask main to read, or null when the tag is not a
 * picture. A local path with no scheme is the only kind accepted: `//host/…`
 * is a network reference wearing a path, and a scheme alone is a promise this
 * renderer will not keep.
 */
function pictureRef(ref: string): string | null {
  if (!ref || ref.startsWith("//")) return null;
  if (URL_SCHEME.test(ref)) return null;
  // The extension decides, and a query or fragment is not part of the name.
  const path = ref.split(/[?#]/, 1)[0] ?? ref;
  return PICTURE_EXTENSION.test(path) ? ref : null;
}

/** Split one message into pictures and the exact text runs between them. */
export function parseChatImages(text: string): ChatTextSegment[] {
  if (!text) return [];
  const segments: ChatTextSegment[] = [];
  let cursor = 0;
  IMAGE_TAG.lastIndex = 0;
  for (let match = IMAGE_TAG.exec(text); match; match = IMAGE_TAG.exec(text)) {
    const alt = match[1] ?? "";
    // Either the angle-wrapped destination or the bare one; the group that did
    // not take part is undefined.
    const ref = match[2] ?? match[3] ?? "";
    const picture = pictureRef(ref);
    if (!picture) {
      // Not a picture after all: the tag was something the model wrote as words,
      // so it stays in the run verbatim. The scan steps past it rather than
      // restarting inside it, or its brackets would be read a second time.
      continue;
    }
    if (match.index > cursor) {
      segments.push({ kind: "text", text: text.slice(cursor, match.index) });
    }
    segments.push({
      kind: "image",
      alt,
      source: { name: alt.trim() || fileName(picture), ref: picture },
    });
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length) {
    segments.push({ kind: "text", text: text.slice(cursor) });
  }
  return segments;
}
