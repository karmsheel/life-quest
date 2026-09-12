import type { MapToolDef } from "./map/tools.ts";
import type { Actor, DocumentKind, LibraryDocument, DoctrineDocument } from "./types.ts";
import {
  libraryCreate,
  libraryUpdate,
  libraryList,
  libraryGet,
  getDocument,
  saveDocument,
  listDomains,
  createDecision,
} from "./index.ts";

export const DOCUMENT_TOOL_DEFS: MapToolDef[] = [
  {
    name: "list_documents",
    description: "List all library documents plus one representative item per live doctrine",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "get_document",
    description: "Read a library document by id or a doctrine document by domainSlug + kind",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string" },
        domainSlug: { type: "string" },
        kind: { type: "string" },
      },
    },
  },
  {
    name: "create_library_document",
    description: "Create a new library note",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string" },
        body: { type: "string" },
        domainSlugs: { type: "array", items: { type: "string" } },
      },
      required: ["title"],
    },
  },
  {
    name: "update_document",
    description: "Update a library document by id, or a doctrine document by domainSlug + kind (locked → pending decision)",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string" },
        domainSlug: { type: "string" },
        kind: { type: "string" },
        title: { type: "string" },
        body: { type: "string" },
      },
    },
  },
];

type DocumentToolResult =
  | Record<string, unknown>
  | { error: { code: string; message: string } };

function asLibraryRecord(doc: LibraryDocument): Record<string, unknown> {
  return {
    type: "library",
    id: doc.id,
    title: doc.title,
    bodyMarkdown: doc.bodyMarkdown,
    domainSlugs: doc.domainSlugs,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    locked: doc.locked,
  };
}

function asDoctrineRecord(doc: DoctrineDocument): Record<string, unknown> {
  return {
    type: "doctrine",
    domainSlug: doc.kind,
    kind: doc.kind,
    title: doc.title,
    bodyMarkdown: doc.bodyMarkdown,
    locked: doc.locked,
    updatedAt: doc.updatedAt,
  };
}

export async function executeDocumentTool(
  root: string,
  actor: Actor,
  name: string,
  args: Record<string, unknown>,
): Promise<DocumentToolResult> {
  switch (name) {
    case "list_documents": {
      const domainsResult = await listDomains(root);
      if (!domainsResult.ok) {
        return { error: { code: "MALFORMED", message: domainsResult.error } };
      }
      const libResult = await libraryList(root);
      const records: Record<string, unknown>[] = [];
      if (libResult.ok) {
        for (const rec of libResult.value.records) {
          records.push(asLibraryRecord(rec));
        }
      }
      for (const domain of domainsResult.value) {
        for (const kind of ["premise", "what", "why", "how"] as DocumentKind[]) {
          const doc = await getDocument(root, domain.slug, kind);
          if (doc.ok) {
            records.push(asDoctrineRecord(doc.value));
            break;
          }
        }
      }
      return { records };
    }

    case "get_document": {
      const id = args.id;
      if (typeof id === "string" && id.length > 0) {
        const libResult = await libraryGet(root, id);
        if (!libResult.ok) {
          return { error: { code: "MALFORMED", message: libResult.error } };
        }
        return asLibraryRecord(libResult.value);
      }
      const domainSlug = args.domainSlug;
      const kind = args.kind;
      if (typeof domainSlug !== "string" || typeof kind !== "string") {
        return { error: { code: "MALFORMED", message: "domainSlug and kind are required" } };
      }
      if (!isDocumentKind(kind)) {
        return { error: { code: "MALFORMED", message: `Unknown document kind: ${kind}` } };
      }
      const docResult = await getDocument(root, domainSlug, kind);
      if (!docResult.ok) {
        return { error: { code: "MALFORMED", message: docResult.error } };
      }
      return asDoctrineRecord(docResult.value);
    }

    case "create_library_document": {
      const title = args.title;
      if (typeof title !== "string" || !title.trim()) {
        return { error: { code: "MALFORMED", message: "title is required" } };
      }
      const body = typeof args.body === "string" ? args.body : "";
      const domainSlugs =
        Array.isArray(args.domainSlugs) && args.domainSlugs.every((s) => typeof s === "string")
          ? args.domainSlugs
          : undefined;
      const created = await libraryCreate(root, { title, bodyMarkdown: body, domainSlugs }, actor);
      if (!created.ok) {
        return { error: { code: "MALFORMED", message: created.error } };
      }
      return { record: asLibraryRecord(created.value) };
    }

    case "update_document": {
      const id = args.id;
      if (typeof id === "string" && id.length > 0) {
        const libResult = await libraryGet(root, id);
        if (!libResult.ok) {
          return { error: { code: "MALFORMED", message: libResult.error } };
        }
        const current = libResult.value;
        const patch: Parameters<Parameters<typeof libraryUpdate>[2]>[0] = {};
        if (typeof args.title === "string" && args.title.trim()) patch.title = args.title;
        if (typeof args.body === "string") patch.bodyMarkdown = args.body;
        if (patch.title === undefined && patch.bodyMarkdown === undefined) {
          return { error: { code: "MALFORMED", message: "No changes provided" } };
        }
        const updated = await libraryUpdate(root, id, patch, actor);
        if (!updated.ok) {
          return { error: { code: "MALFORMED", message: updated.error } };
        }
        return { record: asLibraryRecord(updated.value) };
      }

      const domainSlug = args.domainSlug;
      const kind = args.kind;
      if (typeof domainSlug !== "string" || typeof kind !== "string") {
        return { error: { code: "MALFORMED", message: "domainSlug and kind are required" } };
      }
      if (!isDocumentKind(kind)) {
        return { error: { code: "MALFORMED", message: `Unknown document kind: ${kind}` } };
      }
      const current = await getDocument(root, domainSlug, kind);
      if (!current.ok) {
        return { error: { code: "MALFORMED", message: current.error } };
      }
      const proposedTitle =
        typeof args.title === "string" && args.title.trim() ? args.title : current.value.title;
      const proposedBodyMarkdown = typeof args.body === "string" ? args.body : current.value.bodyMarkdown;
      if (proposedTitle === current.value.title && proposedBodyMarkdown === current.value.bodyMarkdown) {
        return { error: { code: "MALFORMED", message: "No changes provided" } };
      }
      if (!current.value.locked) {
        const updated = await saveDocument(root, domainSlug, kind, proposedBodyMarkdown, proposedTitle, actor);
        if (!updated.ok) {
          return { error: { code: "MALFORMED", message: updated.error } };
        }
        return { record: asDoctrineRecord(updated.value) };
      }
      const decisionResult = await createDecision(root, {
        target: { type: "doctrine", domainSlug, kind },
        proposedTitle,
        previousTitle: current.value.title,
        proposedBodyMarkdown,
        previousBodyMarkdown: current.value.bodyMarkdown,
        actor,
      });
      if (!decisionResult.ok) {
        return { error: { code: "MALFORMED", message: decisionResult.error } };
      }
      return { decisionId: decisionResult.value.id, status: decisionResult.value.status };
    }

    default:
      return { error: { code: "MALFORMED", message: "Unknown tool" } };
  }
}

function isDocumentKind(kind: string): kind is DocumentKind {
  return (["premise", "what", "why", "how"] as const).includes(kind as DocumentKind);
}
