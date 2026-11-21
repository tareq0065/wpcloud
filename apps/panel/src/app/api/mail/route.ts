import { NextRequest, NextResponse } from "next/server";
import {
  buildMailDomainDnsInstructions,
  generateAppleMailMobileConfig,
} from "@wpcloud/shared";
import { requireAdminSession } from "@/lib/auth";
import {
  addMailDomain,
  createMailbox,
  getAgentEngine,
  getDb,
  getLiveMailServerState,
  issueMailDomainSsl,
  runTitanImapSync,
  updateMailDeliveryMode,
} from "@/lib/store";

export async function GET(req: NextRequest) {
  const authError = requireAdminSession(req);
  if (authError) return authError;
  const db = await getDb();

  if (req.nextUrl.searchParams.get("action") === "mobileconfig") {
    const mailboxId = req.nextUrl.searchParams.get("mailboxId") || "";
    const mb = db.mailServer.mailboxes.find((m) => m.id === mailboxId);
    if (!mb) {
      return NextResponse.json({ error: "Mailbox not found" }, { status: 404 });
    }
    const dom = db.mailServer.domains.find((d) => d.id === mb.domainId);
    const mailHostname = dom?.mailHostname || `mail.${mb.domain}`;
    const xml = generateAppleMailMobileConfig({
      email: mb.email,
      displayName: mb.displayName,
      mailHostname,
      domain: mb.domain,
    });
    const safeFilename = `${mb.email.replace(/[^a-zA-Z0-9._@-]/g, "_")}.mobileconfig`;
    return new NextResponse(xml, {
      headers: {
        "Content-Type": "application/x-apple-aspen-config",
        "Content-Disposition": `attachment; filename="${safeFilename}"`,
        "X-Content-Type-Options": "nosniff",
      },
    });
  }

  const mailServer = await getLiveMailServerState();
  const domainDnsMap: Record<string, ReturnType<typeof buildMailDomainDnsInstructions>> = {};

  for (const dom of db.mailServer.domains) {
    domainDnsMap[dom.id] = buildMailDomainDnsInstructions(
      dom,
      db.settings.vpsIpv4
    );
  }

  return NextResponse.json({
    mailServer,
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
      const mailServer = await updateMailDeliveryMode({
        deliveryMode: body.deliveryMode === "relay" ? "relay" : "direct",
        relayConfig: body.relayConfig,
      });
      return NextResponse.json({ ok: true, mailServer });
    }

    if (body.action === "titan_imapsync") {
      const syncJob = await runTitanImapSync({
        sourceHost: body.sourceHost || "imap.titan.email",
        sourcePort: body.sourcePort ? Number(body.sourcePort) : 993,
        sourceEmail: body.sourceEmail,
        sourcePassword: body.sourcePassword,
        targetEmail: body.targetEmail,
      });
      return NextResponse.json({ ok: true, syncJob });
    }

    if (body.action === "setup_mail_stack") {
      const engine = getAgentEngine();
      await engine.setupMailServerStack();
      const mailServer = await getLiveMailServerState();
      return NextResponse.json({ ok: true, mailServer });
    }

    if (body.action === "issue_mail_ssl") {
      const domain = await issueMailDomainSsl(body.domainId || "");
      const mailServer = await getLiveMailServerState();
      return NextResponse.json({ ok: true, domain, mailServer });
    }

    return NextResponse.json({ error: "Unknown mail action" }, { status: 400 });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Mail action failed" },
      { status: 400 }
    );
  }
}
