import { NextRequest, NextResponse } from "next/server";
import { buildMailDomainDnsInstructions } from "@wpcloud/shared";
import { requireAdminSession } from "@/lib/auth";
import {
  addMailDomain,
  createMailbox,
  getDb,
  runTitanImapSync,
  saveDb,
} from "@/lib/store";

export async function GET(req: NextRequest) {
  const authError = requireAdminSession(req);
  if (authError) return authError;
  const db = await getDb();
  const domainDnsMap: Record<string, ReturnType<typeof buildMailDomainDnsInstructions>> = {};

  for (const dom of db.mailServer.domains) {
    domainDnsMap[dom.id] = buildMailDomainDnsInstructions(
      dom,
      db.settings.vpsIpv4
    );
  }

  return NextResponse.json({
    mailServer: db.mailServer,
    vpsIpv4: db.settings.vpsIpv4,
    domainDnsMap,
  });
}

export async function POST(req: NextRequest) {
  const authError = requireAdminSession(req);
  if (authError) return authError;

  try {
    const body = await req.json();

    if (body.action === "add_domain") {
      const record = await addMailDomain(body.domain || "");
      return NextResponse.json({ ok: true, domain: record });
    }

    if (body.action === "create_mailbox") {
      const mb = await createMailbox({
        domainId: body.domainId,
        localPart: body.localPart,
        displayName: body.displayName,
        password: body.password,
        quotaMb: Number(body.quotaMb || 5120),
      });
      return NextResponse.json({ ok: true, mailbox: mb });
    }

    if (body.action === "update_delivery_mode") {
      const db = await getDb();
      db.mailServer.deliveryMode =
        body.deliveryMode === "relay" ? "relay" : "direct";
      if (body.relayConfig) {
        db.mailServer.relayConfig = {
          ...db.mailServer.relayConfig,
          ...body.relayConfig,
        };
      }
      await saveDb(db);
      return NextResponse.json({ ok: true, mailServer: db.mailServer });
    }

    if (body.action === "titan_imapsync") {
      const syncJob = await runTitanImapSync({
        sourceHost: body.sourceHost || "imap.titan.email",
        sourceEmail: body.sourceEmail,
        sourcePassword: body.sourcePassword,
        targetEmail: body.targetEmail,
      });
      return NextResponse.json({ ok: true, syncJob });
    }

    return NextResponse.json({ error: "Unknown mail action" }, { status: 400 });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Mail action failed" },
      { status: 400 }
    );
  }
}

