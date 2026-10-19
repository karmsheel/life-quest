import { parseBlocks, serializeBlocks } from "@/components/documents/LiveMarkdownEditor";

/**
 * The one form a markdown body is held in on a page that autosaves it: the
 * editor's own.
 *
 * A vault stores a note as its prose plus exactly one closing newline, and the
 * editor emits its prose alone. Every body such a page holds — the file it
 * loaded, the draft the operator is typing, the file's answer to a write — goes
 * through here first. Without it a file and its own untouched draft would not
 * compare equal, and the page would write every note it merely opened, and re-cut
 * the paragraph under the caret every time a write landed.
 */
export function asHeld(markdown: string): string {
  return serializeBlocks(parseBlocks(markdown));
}

/**
 * Two spellings of one note: is this the same thing written down?
 *
 * The box holds a note in its own form and the vault holds it in its own — the
 * file carries exactly one closing newline, and both sides drop the whitespace at
 * the end of the body. So the draft an operator left mid-sentence ("the next word
 * is not typed yet " — a space, not a typo) and the body the vault wrote from it
 * are *one note*, and comparing them as strings calls that a change. Everywhere a
 * page asks "is this different from the file?" it has to ask it this way instead:
 * a page that answers with `!==` sees a difference where there is none, and the
 * answer it then gives the box — the file's body — is a body the box did not
 * emit, which re-cuts the paragraph under the caret and closes the line the
 * operator is writing in.
 */
export function sameNote(a: string, b: string): boolean {
  return asHeld(a) === asHeld(b);
}
