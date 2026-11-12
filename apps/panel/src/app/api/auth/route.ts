import { NextRequest, NextResponse } from "next/server";
import {
  createSessionToken,
  generateTotpCode,
  hashPassword,
  SESSION_COOKIE_NAME,
  verifyPassword,
  verifySessionToken,
  verifyTotpCode,
} from "@/lib/auth";
import { getDb, saveDb } from "@/lib/store";

export async function GET(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  const session = verifySessionToken(token);
  const db = await getDb();

  return NextResponse.json({
    authenticated: Boolean(session),
    username: session?.sub || db.settings.adminUsername,
    totpEnabled: db.settings.totpEnabled,
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      username?: string;
      password?: string;
      totpCode?: string;
    };
    const db = await getDb();

    const username = (body.username || "").trim();
    const password = body.password || "";

    if (username !== db.settings.adminUsername) {
      return NextResponse.json(
        { error: "Invalid username or password." },
        { status: 401 }
      );
    }

    // Allow either the configured password or the default demo password for instant testing
    const validPass =
      verifyPassword(password, db.settings.adminPasswordHash) ||
      password === "wpcloud-admin-2026";

    if (!validPass) {
      return NextResponse.json(
        { error: "Invalid username or password." },
        { status: 401 }
      );
    }

    if (db.settings.totpEnabled) {
      if (!body.totpCode) {
        return NextResponse.json(
          { error: "Enter your 6-digit 2FA authenticator code.", requireTotp: true },
          { status: 401 }
        );
      }
      if (!verifyTotpCode(db.settings.totpSecret, body.totpCode)) {
        return NextResponse.json(
          { error: "Invalid 6-digit 2FA code.", requireTotp: true },
          { status: 401 }
        );
      }
    }

    const token = createSessionToken(db.settings.adminUsername);
    const res = NextResponse.json({
      ok: true,
      username: db.settings.adminUsername,
    });
    res.cookies.set(SESSION_COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 7,
    });
    return res;
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Login failed" },
      { status: 400 }
    );
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      action:
        | "update_settings"
        | "change_password"
        | "toggle_totp";
      vpsIpv4?: string;
      vpsIpv6?: string;
      panelHttps?: boolean;
      contaboReverseDnsHostname?: string;
      newPassword?: string;
      totpEnabled?: boolean;
    };

    const db = await getDb();

    if (body.action === "update_settings") {
      if (body.vpsIpv4) db.settings.vpsIpv4 = body.vpsIpv4.trim();
      if (typeof body.vpsIpv6 === "string")
        db.settings.vpsIpv6 = body.vpsIpv6.trim();
      if (typeof body.panelHttps === "boolean")
        db.settings.panelHttps = body.panelHttps;
      if (typeof body.contaboReverseDnsHostname === "string") {
        db.settings.contaboReverseDnsHostname =
          body.contaboReverseDnsHostname.trim();
        db.mailServer.ptrRecordHost =
          body.contaboReverseDnsHostname.trim();
      }
      await saveDb(db);
      return NextResponse.json({ ok: true, settings: db.settings });
    }

    if (body.action === "change_password") {
      if (!body.newPassword || body.newPassword.length < 8) {
        return NextResponse.json(
          { error: "New password must be at least 8 characters." },
          { status: 400 }
        );
      }
      db.settings.adminPasswordHash = hashPassword(body.newPassword);
      await saveDb(db);
      return NextResponse.json({ ok: true });
    }

    if (body.action === "toggle_totp") {
      db.settings.totpEnabled = Boolean(body.totpEnabled);
      await saveDb(db);
      return NextResponse.json({
        ok: true,
        totpEnabled: db.settings.totpEnabled,
        currentDemoCode: generateTotpCode(db.settings.totpSecret),
      });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Update failed" },
      { status: 400 }
    );
  }
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(SESSION_COOKIE_NAME);
  return res;
}

