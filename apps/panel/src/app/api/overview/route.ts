import { NextRequest, NextResponse } from "next/server";
import { getAgentEngine, getDb } from "@/lib/store";
import { generateTotpCode, requireAdminSession } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const authError = requireAdminSession(req);
  if (authError) return authError;
  const db = await getDb();
  const engine = getAgentEngine();
  const metrics = await engine.getServerMetrics();
  const externalNginx = await engine.inspectExternalNginxDomains();
  const auditLog = engine.getAuditLog();

  return NextResponse.json({
    settings: {
      adminUsername: db.settings.adminUsername,
      totpEnabled: db.settings.totpEnabled,
      totpSecret: db.settings.totpSecret,
      totpCurrentCode: generateTotpCode(db.settings.totpSecret),
      panelPort: db.settings.panelPort,
      adminerPort: db.settings.adminerPort,
      panelHttps: db.settings.panelHttps,
      vpsIpv4: db.settings.vpsIpv4,
      vpsIpv6: db.settings.vpsIpv6,
      contaboReverseDnsHostname: db.settings.contaboReverseDnsHostname,
    },
    sites: db.sites,
    jobs: db.jobs,
    mailServer: db.mailServer,
    metrics,
    externalNginx,
    auditLog,
  });
}

