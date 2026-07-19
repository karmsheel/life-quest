import { prisma } from "./prisma.ts";
import type { LifeEventType } from "./life-log.ts";

export async function appendLifeEvent(input: {
  userId: string;
  domainId?: string | null;
  type: LifeEventType;
  summary: string;
  payload?: unknown;
}) {
  return prisma.lifeEvent.create({
    data: {
      userId: input.userId,
      domainId: input.domainId ?? null,
      type: input.type,
      summary: input.summary,
      payloadJson: input.payload ? JSON.stringify(input.payload) : null,
    },
  });
}
