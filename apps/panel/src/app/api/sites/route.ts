import { NextRequest, NextResponse } from "next/server";
import {
  CreateSiteInputSchema,
  ImportSiteInputSchema,
} from "@wpcloud/shared";
import {
  createNewWordPressSite,
  importExistingWordPressSite,
} from "@/lib/store";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    if (body.mode === "import") {
      const parsed = ImportSiteInputSchema.parse(body);
      const result = await importExistingWordPressSite(parsed);
      return NextResponse.json({ ok: true, ...result });
    }

    const parsed = CreateSiteInputSchema.parse(body);
    const result = await createNewWordPressSite(parsed);
    return NextResponse.json({ ok: true, ...result });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Failed to provision WordPress site";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

