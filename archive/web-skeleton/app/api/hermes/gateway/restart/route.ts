import { NextResponse } from "next/server";
import { discoverHermes } from "@/lib/hermes-connection.ts";
import {
  isLocalGatewayControlAllowed,
  restartHermesGateway,
} from "@/lib/hermes-gateway.ts";

export async function POST(request: Request) {
  const host = request.headers.get("host");
  if (!isLocalGatewayControlAllowed(host)) {
    return NextResponse.json(
      {
        ok: false,
        error: "Gateway control is only available for local desktop sessions.",
      },
      { status: 403 },
    );
  }

  try {
    const result = await restartHermesGateway();
    const { env, result: probe } = await discoverHermes();

    return NextResponse.json({
      ...result,
      suggested: probe.ok
        ? {
            baseUrl: probe.baseUrl,
            apiKey: env?.apiServerKey,
          }
        : null,
      probe,
    });
  } catch (error) {
    console.error("Hermes gateway restart error", error);
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error ? error.message : "Gateway restart failed",
      },
      { status: 500 },
    );
  }
}
