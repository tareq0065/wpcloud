import { NextRequest, NextResponse } from "next/server";
import {
  NginxSiteOptionsSchema,
  PhpPoolOptionsSchema,
  WpSmtpConfigSchema,
} from "@wpcloud/shared";
import {
  checkSiteDnsAndProtectEmail,
  executeSiteWpCli,
  getDb,
  getSiteGeneratedConfigs,
  issueSiteLetsEncryptSsl,
  toggleOrDeleteSite,
  updateSiteNginxConfig,
  updateSitePhpConfig,
  updateSiteSmtpConfig,
} from "@/lib/store";

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const db = await getDb();
    const site = db.sites.find((s) => s.id === id);
    if (!site) {
      return NextResponse.json({ error: "Site not found" }, { status: 404 });
    }
    const configs = await getSiteGeneratedConfigs(id);
    const dnsReport = await checkSiteDnsAndProtectEmail(id);
    return NextResponse.json({
      site,
      ...configs,
      dnsReport,
      vpsIpv4: db.settings.vpsIpv4,
      vpsIpv6: db.settings.vpsIpv6,
      adminerPort: db.settings.adminerPort,
    });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load site" },
      { status: 400 }
    );
  }
}

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const body = await req.json();

    if (body.action === "update_nginx") {
      const options = NginxSiteOptionsSchema.parse(body.nginxOptions);
      const res = await updateSiteNginxConfig(id, options);
      return NextResponse.json({ ok: true, ...res });
    }

    if (body.action === "update_php") {
      const options = PhpPoolOptionsSchema.parse(body.phpOptions);
      const res = await updateSitePhpConfig(id, options);
      return NextResponse.json({ ok: true, ...res });
    }

    if (body.action === "check_dns") {
      const dnsReport = await checkSiteDnsAndProtectEmail(id);
      return NextResponse.json({ ok: true, dnsReport });
    }

    if (body.action === "issue_ssl") {
      const res = await issueSiteLetsEncryptSsl(id, Boolean(body.force));
      return NextResponse.json({ ok: true, ...res });
    }

    if (body.action === "update_smtp") {
      const smtpConfig = WpSmtpConfigSchema.parse(body.smtpConfig);
      const res = await updateSiteSmtpConfig(id, smtpConfig);
      return NextResponse.json({ ok: true, ...res });
    }

    if (body.action === "wp_cli") {
      const res = await executeSiteWpCli(id, body.operation, body.params);
      return NextResponse.json({ ok: true, ...res });
    }

    if (body.action === "enable" || body.action === "disable") {
      await toggleOrDeleteSite(id, body.action);
      const db = await getDb();
      const site = db.sites.find((s) => s.id === id);
      return NextResponse.json({ ok: true, site });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Action failed" },
      { status: 400 }
    );
  }
}

export async function DELETE(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const res = await toggleOrDeleteSite(id, "delete");
    return NextResponse.json({ ok: true, ...res });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Delete failed" },
      { status: 400 }
    );
  }
}

