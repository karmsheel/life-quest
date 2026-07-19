import { prisma } from "./prisma.ts";
import { SEED_DOMAIN_NAMES } from "./constants.ts";
import { DOCUMENT_KINDS } from "./document-kinds.ts";

const TITLES: Record<string, string> = {
  why: "Why",
  what: "What",
  how: "How",
};

export async function ensureCanonicalDocuments(domainId: string) {
  for (const kind of DOCUMENT_KINDS) {
    await prisma.domainDocument.upsert({
      where: { domainId_kind: { domainId, kind } },
      create: {
        domainId,
        kind,
        title: TITLES[kind] ?? kind,
        bodyMarkdown: "",
        status: "draft",
      },
      update: {},
    });
  }
}

export async function seedDomainsForUser(userId: string) {
  const domains = [];
  for (let i = 0; i < SEED_DOMAIN_NAMES.length; i++) {
    const name = SEED_DOMAIN_NAMES[i]!;
    const domain = await prisma.domain.create({
      data: { userId, name, sortOrder: i },
    });
    await ensureCanonicalDocuments(domain.id);
    domains.push(domain);
  }
  return domains;
}
