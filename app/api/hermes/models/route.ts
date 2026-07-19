import { NextResponse } from "next/server";
import { fetchHermesModels } from "@/lib/hermes-models.ts";

export async function POST(request: Request) {
  try {
    const { baseUrl, apiKey } = await request.json();

    if (!baseUrl || !apiKey) {
      return NextResponse.json(
        { error: "Missing baseUrl or apiKey" },
        { status: 400 },
      );
    }

    const models = await fetchHermesModels(baseUrl, apiKey);
    return NextResponse.json({ models });
  } catch (error) {
    console.error("Hermes models error", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to load models",
      },
      { status: 500 },
    );
  }
}
