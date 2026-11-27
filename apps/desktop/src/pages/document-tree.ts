/**
 * The same two questions `recordVisible` and `recordVisibleMulti` answer.
 * Inlined so this module can be tested without the workspace package install.
 */
export type DocLens = { kind: "overview" } | { kind: "domain"; slug: string };

function inLens(lens: DocLens, slugs: readonly (string | null)[]): boolean {
  if (lens.kind === "overview") return true;
  return slugs.includes(lens.slug);
}

/** The four doctrine files, in the order the app reads them. */
export type DoctrineKind = "premise" | "what" | "why" | "how";

/**
 * One file the Documents page can open. The kind says which vault write the
 * editor uses. Daily notes and reviews are not in this set.
 */
export type DocRef =
  | { kind: "library"; id: string }
  | { kind: "ideal"; id: string }
  | { kind: "project"; id: string }
  | { kind: "doctrine"; slug: string; documentKind: DoctrineKind };

export type TreeFile = {
  key: string;
  title: string;
  ref: DocRef;
};

export type TreeArea = {
  slug: string;
  name: string;
  files: TreeFile[];
};

export type TreeGroup = {
  id: "notes" | "ideal" | "projects" | "doctrine";
  label: string;
  files: TreeFile[];
  areas: TreeArea[];
};

export function docKey(ref: DocRef): string {
  if (ref.kind === "doctrine") return `doctrine:${ref.slug}:${ref.documentKind}`;
  return `${ref.kind}:${ref.id}`;
}

function matches(title: string, needle: string): boolean {
  return needle === "" || title.toLowerCase().includes(needle);
}

/**
 * The file tree for Documents.
 *
 * Overview shows every named document. An area lens keeps notes tagged with
 * that area, projects assigned to it, and that area's doctrine. Ideal State
 * has no area, so it stays visible on every lens. An empty group is omitted.
 */
export function buildDocumentTree(input: {
  lens: DocLens;
  query: string;
  notes: { id: string; title: string; domainSlugs: string[] }[];
  ideals: { id: string; title: string }[];
  projects: { id: string; title: string; domainSlug: string | null }[];
  areas: {
    slug: string;
    name: string;
    documents: { kind: DoctrineKind; title: string }[];
  }[];
}): TreeGroup[] {
  const needle = input.query.trim().toLowerCase();
  const groups: TreeGroup[] = [];

  const notes = input.notes
    .filter((note) => inLens(input.lens, note.domainSlugs))
    .filter((note) => matches(note.title, needle))
    .map((note) => {
      const ref: DocRef = { kind: "library", id: note.id };
      return { key: docKey(ref), title: note.title, ref };
    });
  if (notes.length > 0) {
    groups.push({ id: "notes", label: "Notes", files: notes, areas: [] });
  }

  const ideals = input.ideals
    .filter((doc) => matches(doc.title, needle))
    .map((doc) => {
      const ref: DocRef = { kind: "ideal", id: doc.id };
      return { key: docKey(ref), title: doc.title, ref };
    });
  if (ideals.length > 0) {
    groups.push({ id: "ideal", label: "Ideal State", files: ideals, areas: [] });
  }

  const projects = input.projects
    .filter((project) => inLens(input.lens, [project.domainSlug]))
    .filter((project) => matches(project.title, needle))
    .map((project) => {
      const ref: DocRef = { kind: "project", id: project.id };
      return { key: docKey(ref), title: project.title, ref };
    });
  if (projects.length > 0) {
    groups.push({ id: "projects", label: "Projects", files: projects, areas: [] });
  }

  const areas = input.areas
    .filter((area) => input.lens.kind === "overview" || area.slug === input.lens.slug)
    .map((area) => ({
      slug: area.slug,
      name: area.name,
      files: area.documents
        .filter((doc) => matches(doc.title, needle))
        .map((doc) => {
          const ref: DocRef = {
            kind: "doctrine",
            slug: area.slug,
            documentKind: doc.kind,
          };
          return { key: docKey(ref), title: doc.title, ref };
        }),
    }))
    .filter((area) => area.files.length > 0);
  if (areas.length > 0) {
    groups.push({ id: "doctrine", label: "Doctrine", files: [], areas });
  }

  return groups;
}
