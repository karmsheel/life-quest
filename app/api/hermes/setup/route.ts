import { NextResponse } from "next/server";
import { discoverHermes } from "@/lib/hermes-connection.ts";
import { setupHermesApiServer } from "@/lib/hermes-setup.ts";
import { setupSummaryMessage } from "@/lib/hermes-setup-shared.ts";

export async function POST() {
  try {
    const result = await setupHermesApiServer();
    const { env, result: probe } = await discoverHermes();

    return NextResponse.json({
      ...result,
      needsGatewayRestart: result.needsGatewayRestart,
      message: setupSummaryMessage(result),
      suggested: probe.ok
        ? {
            baseUrl: probe.baseUrl,
            apiKey: env?.apiServerKey,
          }
        : null,
      probe,
    });
  } catch (error) {
    console.error("Hermes setup error", error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Setup failed",
      },
      { status: 500 },
    );
  }
}
