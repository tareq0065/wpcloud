import { NextRequest, NextResponse } from "next/server";
import {
  appendSentToMaildir,
  listMaildirFolders,
  listMaildirMessages,
  readMaildirMessage,
  sendSmtpMessage,
} from "@wpcloud/agent/maildir-reader";
import {
  createWebmailToken,
  verifyWebmailToken,
  WEBMAIL_COOKIE_NAME,
} from "@/lib/auth";
import { getAgentEngine, getDb, getLiveMailServerState } from "@/lib/store";

function getWebmailSession(req: NextRequest) {
  const token = req.cookies.get(WEBMAIL_COOKIE_NAME)?.value;
  return verifyWebmailToken(token);
}

export async function GET(req: NextRequest) {
  const action = req.nextUrl.searchParams.get("action") || "session";
  const session = getWebmailSession(req);

  if (action === "session") {
    if (!session) {
      return NextResponse.json({ authenticated: false });
    }
    const engine = getAgentEngine();
    const maildirRoot = engine.getMaildirRoot(session.domain, session.localPart);
    const folders = await listMaildirFolders(maildirRoot);
    const mailServer = await getLiveMailServerState();
    const canSendSmtp =
      Boolean(mailServer.services?.postfix) ||
      (mailServer.deliveryMode === "relay" && Boolean(mailServer.relayConfig.host));

    return NextResponse.json({
      authenticated: true,
      email: session.email,
      folders,
      canSendSmtp,
      deliveryMode: mailServer.deliveryMode,
    });
  }

  if (!session) {
    return NextResponse.json({ error: "Webmail authentication required." }, { status: 401 });
  }

  const engine = getAgentEngine();
  const maildirRoot = engine.getMaildirRoot(session.domain, session.localPart);

  try {
    if (action === "messages") {
      const folder = req.nextUrl.searchParams.get("folder") || "INBOX";
      const offset = Number(req.nextUrl.searchParams.get("offset") || 0);
      const limit = Number(req.nextUrl.searchParams.get("limit") || 50);
      const query = req.nextUrl.searchParams.get("q") || "";
      const data = await listMaildirMessages(maildirRoot, folder, {
        offset,
        limit,
        query,
      });
      return NextResponse.json(data);
    }

    if (action === "message") {
      const folder = req.nextUrl.searchParams.get("folder") || "INBOX";
      const id = req.nextUrl.searchParams.get("id") || "";
      const { detail } = await readMaildirMessage(maildirRoot, folder, id);
      return NextResponse.json({ message: detail });
    }

    if (action === "attachment") {
      const folder = req.nextUrl.searchParams.get("folder") || "INBOX";
      const id = req.nextUrl.searchParams.get("id") || "";
      const index = Number(req.nextUrl.searchParams.get("index") || 0);
      const { attachmentPayloads } = await readMaildirMessage(maildirRoot, folder, id);
      const att = attachmentPayloads[index];
      if (!att) {
        return NextResponse.json({ error: "Attachment not found" }, { status: 404 });
      }
      const safeName = att.filename.replace(/["\\\r\n]/g, "_");
      return new NextResponse(new Uint8Array(att.data), {
        headers: {
          "Content-Type": att.contentType || "application/octet-stream",
          "Content-Disposition": `attachment; filename="${safeName}"`,
          "X-Content-Type-Options": "nosniff",
        },
      });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load mail" },
      { status: 400 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      action: "login" | "logout" | "send";
      email?: string;
      password?: string;
      to?: string;
      subject?: string;
      text?: string;
    };

    if (body.action === "logout") {
      const res = NextResponse.json({ ok: true });
      res.cookies.delete(WEBMAIL_COOKIE_NAME);
      return res;
    }

    if (body.action === "login") {
      const email = (body.email || "").trim().toLowerCase();
      const password = body.password || "";
      const engine = getAgentEngine();
      const auth = await engine.verifyMailboxCredentials(email, password);
      if (!auth.valid || !auth.domain || !auth.localPart) {
        return NextResponse.json(
          { error: "Invalid mailbox email or password." },
          { status: 401 }
        );
      }

      const token = createWebmailToken({
        email,
        domain: auth.domain,
        localPart: auth.localPart,
      });
      const isHttps =
        req.nextUrl.protocol === "https:" ||
        req.headers.get("x-forwarded-proto") === "https";

      const res = NextResponse.json({ ok: true, email });
      res.cookies.set(WEBMAIL_COOKIE_NAME, token, {
        httpOnly: true,
        sameSite: "lax",
        secure: isHttps,
        path: "/",
        maxAge: 60 * 60 * 24 * 7,
      });
      return res;
    }

    if (body.action === "send") {
      const session = getWebmailSession(req);
      if (!session) {
        return NextResponse.json(
          { error: "Webmail authentication required." },
          { status: 401 }
        );
      }
      if (!body.to || !body.subject) {
        return NextResponse.json(
          { error: "Recipient and subject are required." },
          { status: 400 }
        );
      }

      const db = await getDb();
      const engine = getAgentEngine();
      const mailServer = await getLiveMailServerState();

      let smtpHost = "127.0.0.1";
      let smtpPort = 25;
      let smtpUser: string | undefined;
      let smtpPass: string | undefined;

      if (mailServer.deliveryMode === "relay" && mailServer.relayConfig.host) {
        smtpHost = mailServer.relayConfig.host;
        smtpPort = mailServer.relayConfig.port || 587;
        smtpUser = mailServer.relayConfig.username || undefined;
        smtpPass = mailServer.relayConfig.password || undefined;
      } else if (!mailServer.services?.postfix) {
        return NextResponse.json(
          {
            error:
              "Outgoing SMTP is not active yet. Either run 'Setup IMAP/SMTP Server' in WPCloud Mail Server or configure an SMTP Relay (Brevo/SES/Mailgun).",
          },
          { status: 400 }
        );
      }

      const { rawMessage } = await sendSmtpMessage({
        host: smtpHost,
        port: smtpPort,
        username: smtpUser,
        password: smtpPass,
        from: session.email,
        to: body.to,
        subject: body.subject,
        text: body.text || "",
      });

      const maildirRoot = engine.getMaildirRoot(session.domain, session.localPart);
      await appendSentToMaildir(maildirRoot, rawMessage);

      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Webmail action failed" },
      { status: 400 }
    );
  }
}

