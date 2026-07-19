import { NextResponse } from "next/server";
import { discoverHermes } from "@/lib/hermes-connection.ts";

export async function POST() {
  try {
    const { env, envPath, candidates, result } = await discoverHermes();

    return NextResponse.json({
      envPath,
      candidates,
      apiServerEnabled: env?.apiServerEnabled ?? null,
      hasApiKey: Boolean(env?.apiServerKey),
      suggested: result.ok
        ? {
            baseUrl: result.baseUrl,
            apiKey: env?.apiServerKey,
          }
        : null,
      probe: result,
    });
  } catch (error) {
    console.error("Hermes discover error", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Discovery failed" },
      { status: 500 },
    );
  }
}
