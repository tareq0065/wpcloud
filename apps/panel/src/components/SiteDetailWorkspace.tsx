"use client";

import React, { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  CheckCircle2,
  Copy,
  Cpu,
  Database,
  ExternalLink,
  FileCode2,
  FileText,
  Globe,
  HardDrive,
  Lock,
  Mail,
  Play,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Terminal,
  Trash2,
  Wrench,
} from "lucide-react";
import type {
  DnsCheckReport,
  NginxSiteOptions,
  PhpPoolOptions,
  PhpVersion,
  SiteRecord,
  WpSmtpConfig,
} from "@wpcloud/shared";
import { NativeModalDialog } from "./NativeModalDialog";

interface SiteDetailWorkspaceProps {
  siteId: string;
  onBack: () => void;
  onSiteUpdated: () => void;
  onOpenMailTab: (domain: string) => void;
  notify: (msg: string, tone?: "success" | "error") => void;
}

type SiteTab =
  | "overview"
  | "dns"
  | "ssl"
  | "nginx"
  | "php"
  | "wpcli"
  | "wpmail"
  | "logs"
  | "database";

export function SiteDetailWorkspace({
  siteId,
  onBack,
  onSiteUpdated,
  onOpenMailTab,
  notify,
}: SiteDetailWorkspaceProps) {
  const [activeTab, setActiveTab] = useState<SiteTab>("overview");
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const [site, setSite] = useState<SiteRecord | null>(null);
  const [nginxConfigText, setNginxConfigText] = useState("");
  const [phpPoolConfigText, setPhpPoolConfigText] = useState("");
  const [logs, setLogs] = useState<{
    access: string;
    error: string;
    phpError: string;
  }>({ access: "", error: "", phpError: "" });
  const [selectedLogType, setSelectedLogType] = useState<
    "access" | "error" | "phpError"
  >("access");
  const [dnsReport, setDnsReport] = useState<DnsCheckReport | null>(null);
  const [vpsIpv4, setVpsIpv4] = useState("194.163.148.72");
  const [adminerPort, setAdminerPort] = useState(7071);

  // Editable form states
  const [nginxForm, setNginxForm] = useState<NginxSiteOptions | null>(null);
  const [phpForm, setPhpForm] = useState<PhpPoolOptions | null>(null);
  const [smtpForm, setSmtpForm] = useState<WpSmtpConfig | null>(null);
  const [wpCliOutput, setWpCliOutput] = useState("");
  const [searchFrom, setSearchFrom] = useState("");
  const [searchTo, setSearchTo] = useState("");

  // Native confirmation dialog for deleting site
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [confirmDomainInput, setConfirmDomainInput] = useState("");

  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const loadSiteDetails = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/sites/${siteId}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load site");

      setSite(data.site);
      setNginxConfigText(data.nginxConfig);
      setPhpPoolConfigText(data.phpPoolConfig);
      setLogs(data.logs);
      setDnsReport(data.dnsReport);
      setVpsIpv4(data.vpsIpv4);
      setAdminerPort(data.adminerPort || 7071);

      setNginxForm(data.site.nginxOptions);
      setPhpForm(data.site.phpOptions);
      setSmtpForm(data.site.smtpConfig);
      setSearchFrom(`http://${data.site.domain}`);
      setSearchTo(`https://${data.site.domain}`);
    } catch (err: unknown) {
      notify(
        err instanceof Error ? err.message : "Could not load site",
        "error"
      );
    } finally {
      setLoading(false);
    }
  }, [siteId, notify]);

  useEffect(() => {
    void loadSiteDetails();
  }, [loadSiteDetails]);

  function copyText(key: string, value: string) {
    void navigator.clipboard.writeText(value);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1800);
  }

  async function handleSaveNginx(e: React.FormEvent) {
    e.preventDefault();
    if (!nginxForm) return;
    setBusyAction("nginx");
    try {
      const res = await fetch(`/api/sites/${siteId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update_nginx",
          nginxOptions: nginxForm,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to update Nginx config");
      setSite(data.site);
      setNginxConfigText(data.configContent);
      onSiteUpdated();
      notify(
        `Generated /opt/wpcloud/nginx/sites/${data.site.domain}.conf, passed nginx -t & reloaded Nginx!`
      );
    } catch (err: unknown) {
      notify(err instanceof Error ? err.message : "Nginx update failed", "error");
    } finally {
      setBusyAction(null);
    }
  }

  async function handleSavePhp(e: React.FormEvent) {
    e.preventDefault();
    if (!phpForm) return;
    setBusyAction("php");
    try {
      const res = await fetch(`/api/sites/${siteId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update_php",
          phpOptions: phpForm,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to update PHP pool");
      setSite(data.site);
      setPhpPoolConfigText(data.poolContent);
      onSiteUpdated();
      notify(
        `Switched ${data.site.domain} to PHP ${data.site.phpVersion}-FPM & reloaded pool!`
      );
    } catch (err: unknown) {
      notify(err instanceof Error ? err.message : "PHP update failed", "error");
    } finally {
      setBusyAction(null);
    }
  }

  async function handleCheckDns() {
    setBusyAction("dns");
    try {
      const res = await fetch(`/api/sites/${siteId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "check_dns" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "DNS check failed");
      setDnsReport(data.dnsReport);
      onSiteUpdated();
      notify(
        data.dnsReport.readyForSsl
          ? `DNS verified! ${site?.domain} points to ${vpsIpv4}.`
          : `Checked live DNS via 1.1.1.1 & 8.8.8.8 — see record status below.`
      );
    } catch (err: unknown) {
      notify(err instanceof Error ? err.message : "DNS check failed", "error");
    } finally {
      setBusyAction(null);
    }
  }

  async function handleIssueSsl() {
    setBusyAction("ssl");
    try {
      const res = await fetch(`/api/sites/${siteId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "issue_ssl", force: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "SSL issuance failed");
      await loadSiteDetails();
      onSiteUpdated();
      notify(
        `Let's Encrypt SSL certificate issued for ${site?.domain} via certbot --webroot!`
      );
    } catch (err: unknown) {
      notify(err instanceof Error ? err.message : "SSL issuance failed", "error");
    } finally {
      setBusyAction(null);
    }
  }

  async function handleRunWpCli(
    operation: string,
    params?: Record<string, string>
  ) {
    setBusyAction(`wp_${operation}`);
    try {
      const res = await fetch(`/api/sites/${siteId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "wp_cli",
          operation,
          params,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "WP-CLI command failed");
      setWpCliOutput(data.output);
      await loadSiteDetails();
      notify("WP-CLI command executed successfully.");
    } catch (err: unknown) {
      notify(err instanceof Error ? err.message : "WP-CLI failed", "error");
    } finally {
      setBusyAction(null);
    }
  }

  async function handleSaveSmtp(e: React.FormEvent) {
    e.preventDefault();
    if (!smtpForm) return;
    setBusyAction("smtp");
    try {
      const res = await fetch(`/api/sites/${siteId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update_smtp",
          smtpConfig: smtpForm,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save SMTP config");
      setSite(data.site);
      notify(`Updated WordPress SMTP mu-plugin (${data.muPluginPath})!`);
    } catch (err: unknown) {
      notify(err instanceof Error ? err.message : "SMTP update failed", "error");
    } finally {
      setBusyAction(null);
    }
  }

  async function handleToggleStatus() {
    if (!site) return;
    const nextAction = site.status === "running" ? "disable" : "enable";
    setBusyAction("status");
    try {
      const res = await fetch(`/api/sites/${siteId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: nextAction }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Status change failed");
      setSite(data.site);
      onSiteUpdated();
      notify(
        nextAction === "enable"
          ? `Site ${site.domain} enabled and Nginx reloaded.`
          : `Site ${site.domain} disabled.`
      );
    } catch (err: unknown) {
      notify(err instanceof Error ? err.message : "Failed", "error");
    } finally {
      setBusyAction(null);
    }
  }

  async function handleDeleteSite() {
    if (!site || confirmDomainInput.trim() !== site.domain) return;
    setBusyAction("delete");
    try {
      const res = await fetch(`/api/sites/${siteId}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Delete failed");
      setDeleteDialogOpen(false);
      onSiteUpdated();
      notify(
        `Deleted ${site.domain}. Snapshot archived in ${data.backupPath}.`
      );
      onBack();
    } catch (err: unknown) {
      notify(err instanceof Error ? err.message : "Delete failed", "error");
    } finally {
      setBusyAction(null);
    }
  }

  if (loading || !site) {
    return (
      <div className="rounded-2xl border border-slate-200/80 bg-white p-8 shadow-2xs">
        <div className="flex items-center gap-3 text-sm text-slate-500">
          <RefreshCw className="h-4 w-4 animate-spin text-indigo-600" />
          Loading WordPress site workspace...
        </div>
      </div>
    );
  }

  const tabs: { id: SiteTab; label: string; icon: React.ReactNode }[] = [
    {
      id: "overview",
      label: "Overview",
      icon: <Globe className="h-4 w-4" />,
    },
    {
      id: "dns",
      label: "Domain, DNS & Titan Guard",
      icon: <ShieldCheck className="h-4 w-4" />,
    },
    {
      id: "ssl",
      label: "SSL (Let's Encrypt)",
      icon: <Lock className="h-4 w-4" />,
    },
    {
      id: "nginx",
      label: "Automated Nginx",
      icon: <FileCode2 className="h-4 w-4" />,
    },
    {
      id: "php",
      label: `PHP ${site.phpVersion}-FPM`,
      icon: <Cpu className="h-4 w-4" />,
    },
    {
      id: "wpcli",
      label: "WP-CLI Tools",
      icon: <Wrench className="h-4 w-4" />,
    },
    {
      id: "wpmail",
      label: "WordPress Mail",
      icon: <Mail className="h-4 w-4" />,
    },
    {
      id: "logs",
      label: "Logs",
      icon: <FileText className="h-4 w-4" />,
    },
    {
      id: "database",
      label: "Database (Adminer)",
      icon: <Database className="h-4 w-4" />,
    },
  ];

  const siteUrl = `${site.sslEnabled ? "https" : "http"}://${site.domain}`;
  const previewUrl =
    site.previewPort && vpsIpv4 ? `http://${vpsIpv4}:${site.previewPort}` : null;

  return (
    <div className="space-y-6">
      {/* Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-200/80 bg-white p-5 shadow-2xs">
        <div className="flex items-center gap-3.5">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-100"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            All Sites
          </button>
          <div>
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-xl font-bold tracking-tight text-slate-900">
                {site.domain}
              </h1>
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                  site.status === "running"
                    ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-600/20"
                    : "bg-amber-50 text-amber-700 ring-1 ring-amber-600/20"
                }`}
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    site.status === "running"
                      ? "bg-emerald-500"
                      : "bg-amber-500"
                  }`}
                />
                {site.status === "running" ? "Running" : "Disabled"}
              </span>
              <span className="rounded-full bg-indigo-50 px-2.5 py-0.5 text-xs font-medium text-indigo-700">
                PHP {site.phpVersion}
              </span>
              <span
                className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                  site.sslEnabled
                    ? "bg-emerald-50 text-emerald-700"
                    : "bg-amber-50 text-amber-700"
                }`}
              >
                {site.sslEnabled ? "HTTPS / Let's Encrypt" : "HTTP (Pending SSL)"}
              </span>
            </div>
            <p className="mt-1 font-mono text-xs text-slate-500">
              Folder: {site.rootPath} • Nginx: {site.nginxConfigPath}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {previewUrl && (
            <a
              href={previewUrl}
              target="_blank"
              rel="noreferrer"
              title="Preview site directly via VPS IP before DNS cutover without canonical redirect loops"
              className="inline-flex items-center gap-1.5 rounded-xl border border-indigo-200 bg-indigo-50/80 px-3 py-2 text-xs font-semibold text-indigo-700 transition hover:bg-indigo-100"
            >
              <Sparkles className="h-3.5 w-3.5 text-indigo-600" />
              IP Preview (Port {site.previewPort}) <ExternalLink className="h-3 w-3" />
            </a>
          )}
          <a
            href={siteUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            Visit Site <ExternalLink className="h-3.5 w-3.5" />
          </a>
          <a
            href={`${siteUrl}/wp-admin`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-3.5 py-2 text-xs font-semibold text-white shadow-2xs transition hover:from-indigo-500 hover:to-violet-500"
          >
            WP Admin <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="flex flex-wrap gap-1.5 rounded-2xl border border-slate-200/80 bg-white p-1.5 shadow-2xs">
        {tabs.map((tab) => {
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-semibold transition ${
                active
                  ? "bg-indigo-600 text-white shadow-2xs"
                  : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
              }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* TAB 1: OVERVIEW */}
      {activeTab === "overview" && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            {previewUrl && (
              <div className="rounded-2xl border border-indigo-200/90 bg-gradient-to-r from-indigo-50/80 via-violet-50/50 to-white p-5 shadow-2xs">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="flex items-start gap-3.5">
                    <div className="rounded-xl bg-indigo-600 p-2.5 text-white shadow-xs">
                      <Sparkles className="h-5 w-5" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h2 className="text-sm font-bold text-slate-900">
                          Instant IP Preview URL (Test Before DNS Pointing)
                        </h2>
                        <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-indigo-700">
                          Live on Port {site.previewPort}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-slate-600 max-w-2xl leading-relaxed">
                        Preview and test your WordPress website right now on your Ubuntu VPS without changing any domain DNS records. WPCloud uses a dedicated preview port ({site.previewPort}) and an automated bypass mu-plugin so WordPress will not trigger canonical redirects back to the live domain.
                      </p>
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <code className="rounded-lg border border-indigo-200 bg-white px-3 py-1.5 font-mono text-xs font-semibold text-indigo-900 select-all">
                          {previewUrl}
                        </code>
                        <button
                          type="button"
                          onClick={() => copyText("preview_url", previewUrl)}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 shadow-2xs transition hover:bg-slate-50"
                        >
                          {copiedKey === "preview_url" ? (
                            <Check className="h-3.5 w-3.5 text-emerald-600" />
                          ) : (
                            <Copy className="h-3.5 w-3.5" />
                          )}
                          {copiedKey === "preview_url" ? "Copied" : "Copy URL"}
                        </button>
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <a
                      href={previewUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white shadow-2xs transition hover:bg-indigo-500"
                    >
                      Open Preview <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                    <a
                      href={`${previewUrl}/wp-admin`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-xl border border-indigo-200 bg-white px-3.5 py-2 text-xs font-semibold text-indigo-700 transition hover:bg-indigo-50"
                    >
                      WP Admin Preview <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  </div>
                </div>
              </div>
            )}

            <div className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-2xs">
              <h2 className="text-base font-semibold text-slate-900">
                WordPress Isolation &amp; Paths inside{" "}
                <code className="font-mono text-indigo-600">/opt/wpcloud</code>
              </h2>
              <p className="mt-1 text-xs text-slate-500">
                All files, Nginx configs, PHP pools, and logs for this site live
                strictly inside{" "}
                <code className="font-mono">/opt/wpcloud</code>.
              </p>

              <dl className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="rounded-xl border border-slate-100 bg-slate-50/70 p-3.5">
                  <dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                    WordPress Webroot
                  </dt>
                  <dd className="mt-1 font-mono text-xs font-medium text-slate-800">
                    {site.rootPath}
                  </dd>
                </div>
                <div className="rounded-xl border border-slate-100 bg-slate-50/70 p-3.5">
                  <dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                    Automated Nginx Vhost
                  </dt>
                  <dd className="mt-1 font-mono text-xs font-medium text-slate-800">
                    {site.nginxConfigPath}
                  </dd>
                </div>
                <div className="rounded-xl border border-slate-100 bg-slate-50/70 p-3.5">
                  <dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                    Isolated PHP-FPM Pool
                  </dt>
                  <dd className="mt-1 font-mono text-xs font-medium text-slate-800">
                    {site.phpPoolConfigPath}
                  </dd>
                </div>
                <div className="rounded-xl border border-slate-100 bg-slate-50/70 p-3.5">
                  <dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                    Dedicated Linux User
                  </dt>
                  <dd className="mt-1 font-mono text-xs font-medium text-slate-800">
                    {site.linuxUser} (Socket: /run/php/wpcloud-{site.domain}.sock)
                  </dd>
                </div>
                <div className="rounded-xl border border-slate-100 bg-slate-50/70 p-3.5">
                  <dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                    WP Admin Account
                  </dt>
                  <dd className="mt-1 text-xs font-medium text-slate-800">
                    <span className="font-mono">{site.wpAdminUser}</span> (
                    {site.wpAdminEmail})
                    {site.wpAdminPassword && (
                      <div className="mt-1 font-mono text-[11px] text-indigo-700">
                        Password: {site.wpAdminPassword}
                      </div>
                    )}
                  </dd>
                </div>
                <div className="rounded-xl border border-slate-100 bg-slate-50/70 p-3.5">
                  <dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                    Email / MX Status
                  </dt>
                  <dd className="mt-1 text-xs font-medium text-slate-800">
                    {site.detectedEmailProvider || "External / Titan Mail Safe"}
                  </dd>
                </div>
              </dl>
            </div>

            <div className="rounded-2xl border border-indigo-200/80 bg-indigo-50/50 p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-sm font-semibold text-indigo-950">
                    Test this site before switching your live domain DNS
                  </h3>
                  <p className="mt-1 text-xs text-indigo-900/80">
                    Add this line to your computer&apos;s{" "}
                    <code className="font-mono">/etc/hosts</code> file (or{" "}
                    <code className="font-mono">
                      C:\Windows\System32\drivers\etc\hosts
                    </code>
                    ) to preview{" "}
                    <span className="font-semibold">{site.domain}</span>{" "}
                    directly from your Ubuntu VPS before changing DNS at
                    Hostinger/Cloudflare:
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    copyText(
                      "hosts",
                      `${vpsIpv4} ${site.domain} www.${site.domain}`
                    )
                  }
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-white px-3 py-1.5 text-xs font-semibold text-indigo-700 shadow-2xs ring-1 ring-indigo-200 hover:bg-indigo-50"
                >
                  {copiedKey === "hosts" ? (
                    <>
                      <Check className="h-3.5 w-3.5 text-emerald-600" /> Copied
                    </>
                  ) : (
                    <>
                      <Copy className="h-3.5 w-3.5" /> Copy hosts line
                    </>
                  )}
                </button>
              </div>
              <pre className="mt-3 overflow-x-auto rounded-xl bg-slate-900 px-4 py-2.5 font-mono text-xs text-emerald-300">
                {vpsIpv4} {site.domain} www.{site.domain}
              </pre>
            </div>
          </div>

          <div className="space-y-6">
            <div className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-2xs">
              <h3 className="text-sm font-semibold text-slate-900">
                Quick Setup Checklist
              </h3>
              <ul className="mt-4 space-y-3 text-xs">
                <li className="flex items-center justify-between rounded-xl bg-slate-50 px-3.5 py-2.5">
                  <span className="font-medium text-slate-700">
                    1. Files &amp; DB in /opt/wpcloud
                  </span>
                  <span className="inline-flex items-center gap-1 font-semibold text-emerald-600">
                    <CheckCircle2 className="h-4 w-4" /> Ready
                  </span>
                </li>
                <li className="flex items-center justify-between rounded-xl bg-slate-50 px-3.5 py-2.5">
                  <span className="font-medium text-slate-700">
                    2. Automated Nginx Vhost
                  </span>
                  <span className="inline-flex items-center gap-1 font-semibold text-emerald-600">
                    <CheckCircle2 className="h-4 w-4" /> Active
                  </span>
                </li>
                <li className="flex items-center justify-between rounded-xl bg-slate-50 px-3.5 py-2.5">
                  <span className="font-medium text-slate-700">
                    3. Domain DNS Pointed
                  </span>
                  <button
                    type="button"
                    onClick={() => setActiveTab("dns")}
                    className={`font-semibold underline ${
                      site.dnsVerified ? "text-emerald-600" : "text-amber-600"
                    }`}
                  >
                    {site.dnsVerified ? "Verified" : "View DNS Instructions →"}
                  </button>
                </li>
                <li className="flex items-center justify-between rounded-xl bg-slate-50 px-3.5 py-2.5">
                  <span className="font-medium text-slate-700">
                    4. Let&apos;s Encrypt SSL
                  </span>
                  <button
                    type="button"
                    onClick={() => setActiveTab("ssl")}
                    className={`font-semibold underline ${
                      site.sslEnabled ? "text-emerald-600" : "text-indigo-600"
                    }`}
                  >
                    {site.sslEnabled ? "Active" : "Issue SSL →"}
                  </button>
                </li>
              </ul>
            </div>

            <div className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-2xs">
              <h3 className="text-sm font-semibold text-slate-900">
                Site Lifecycle &amp; Safety
              </h3>
              <p className="mt-1 text-xs text-slate-500">
                Disabling removes only this site&apos;s Nginx vhost and reloads
                Nginx cleanly. Deleting archives a snapshot to{" "}
                <code className="font-mono">/opt/wpcloud/backups/</code> first.
              </p>
              <div className="mt-4 flex flex-col gap-2.5">
                <button
                  type="button"
                  disabled={busyAction === "status"}
                  onClick={handleToggleStatus}
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-100"
                >
                  {site.status === "running"
                    ? "Disable Site Vhost"
                    : "Enable Site Vhost"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setConfirmDomainInput("");
                    setDeleteDialogOpen(true);
                  }}
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-xs font-semibold text-rose-700 transition hover:bg-rose-100"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete Site (Saves Backup Snapshot)
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: DOMAIN, DNS & TITAN EMAIL GUARD */}
      {activeTab === "dns" && (
        <div className="space-y-6">
          {/* Titan Mail / Existing Email Protection Banner */}
          <div className="rounded-2xl border border-amber-300/80 bg-amber-50/70 p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
                <div>
                  <h3 className="text-sm font-bold text-amber-950">
                    Titan Mail &amp; Existing Email Record Protector (
                    {dnsReport?.emailProtection.providerName ||
                      "Titan Mail / External MX"}
                    )
                  </h3>
                  <p className="mt-1 text-xs leading-relaxed text-amber-900">
                    {dnsReport?.emailProtection.warningMessage}
                  </p>
                  {dnsReport?.emailProtection.mxRecords && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {dnsReport.emailProtection.mxRecords.map((mx) => (
                        <span
                          key={mx}
                          className="rounded-lg bg-white/90 px-2.5 py-1 font-mono text-[11px] font-medium text-amber-900 ring-1 ring-amber-300"
                        >
                          MX: {mx}
                        </span>
                      ))}
                      {dnsReport.emailProtection.spfRecord && (
                        <span className="rounded-lg bg-white/90 px-2.5 py-1 font-mono text-[11px] font-medium text-amber-900 ring-1 ring-amber-300">
                          SPF: {dnsReport.emailProtection.spfRecord}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() => onOpenMailTab(site.domain)}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-amber-900 px-3.5 py-2 text-xs font-semibold text-white shadow-2xs transition hover:bg-amber-800"
              >
                <Mail className="h-3.5 w-3.5" />
                Backup Titan Emails / Create Mailbox →
              </button>
            </div>
          </div>

          {/* Copyable DNS Table */}
          <div className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-2xs">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h2 className="text-base font-semibold text-slate-900">
                  DNS Records to Configure for{" "}
                  <span className="text-indigo-600">{site.domain}</span>
                </h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  Point your domain&apos;s <code className="font-mono">A</code>{" "}
                  and <code className="font-mono">www</code> records to your
                  Ubuntu VPS IP (<code className="font-mono">{vpsIpv4}</code>).
                  Leave your <code className="font-mono">MX</code> and{" "}
                  <code className="font-mono">TXT (SPF/DKIM)</code> records
                  untouched so email keeps working.
                </p>
                {previewUrl && (
                  <p className="mt-2 text-xs font-medium text-indigo-700">
                    💡 Testing before updating DNS? You can preview and edit the site immediately via{" "}
                    <a
                      href={previewUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="font-mono font-bold underline hover:text-indigo-900"
                    >
                      {previewUrl}
                    </a>
                    .
                  </p>
                )}
              </div>
              <button
                type="button"
                disabled={busyAction === "dns"}
                onClick={handleCheckDns}
                className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-xs font-semibold text-white shadow-2xs transition hover:bg-indigo-500 disabled:opacity-60"
              >
                <RefreshCw
                  className={`h-3.5 w-3.5 ${
                    busyAction === "dns" ? "animate-spin" : ""
                  }`}
                />
                {busyAction === "dns"
                  ? "Checking 1.1.1.1 & 8.8.8.8..."
                  : "Check Live DNS Now"}
              </button>
            </div>

            <div
              tabIndex={0}
              role="region"
              aria-labelledby="dns-records-caption"
              className="table-wrapper mt-5 rounded-xl border border-slate-200/80"
            >
              <table
                style={
                  {
                    "--label-2": "Name / Host",
                    "--label-3": "Value / Target",
                    "--label-4": "TTL",
                    "--label-5": "Purpose",
                    "--label-6": "Status",
                  } as React.CSSProperties
                }
              >
                <caption id="dns-records-caption" className="sr-only">
                  Required DNS records for {site.domain}
                </caption>
                <thead className="bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Type</th>
                    <th className="px-4 py-3">Name / Host</th>
                    <th className="px-4 py-3">Value / Target</th>
                    <th className="px-4 py-3">TTL</th>
                    <th className="px-4 py-3">Purpose</th>
                    <th className="px-4 py-3 text-right">Status / Copy</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs">
                  {(dnsReport?.instructions || []).map((rec, idx) => (
                    <tr key={`${rec.type}-${rec.name}-${idx}`}>
                      <th className="px-4 py-3 font-mono font-bold text-indigo-700">
                        {rec.type}
                      </th>
                      <td className="px-4 py-3 font-mono font-semibold text-slate-900">
                        {rec.name}
                      </td>
                      <td className="px-4 py-3 font-mono text-slate-800">
                        {rec.value}
                      </td>
                      <td className="px-4 py-3 font-mono text-slate-500">
                        {rec.ttl}s
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {rec.purpose}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="inline-flex items-center gap-2">
                          {rec.status === "matched" && (
                            <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700">
                              Matched
                            </span>
                          )}
                          {rec.status === "protected" && (
                            <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-[11px] font-semibold text-amber-800">
                              Keep Intact
                            </span>
                          )}
                          {(rec.status === "missing" ||
                            rec.status === "mismatch") && (
                            <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-medium text-slate-600">
                              Point to {vpsIpv4}
                            </span>
                          )}
                          <button
                            type="button"
                            onClick={() =>
                              copyText(`dns_${idx}`, rec.value)
                            }
                            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
                          >
                            {copiedKey === `dns_${idx}` ? (
                              <>
                                <Check className="h-3 w-3 text-emerald-600" />{" "}
                                Copied
                              </>
                            ) : (
                              <>
                                <Copy className="h-3 w-3" /> Copy
                              </>
                            )}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-3">
              <div className="rounded-xl border border-slate-100 bg-slate-50/70 p-4">
                <h4 className="text-xs font-bold text-slate-900">
                  Migrating from Hostinger?
                </h4>
                <p className="mt-1 text-xs leading-relaxed text-slate-600">
                  In Hostinger hPanel → <strong>DNS Zone Editor</strong>, edit
                  only the <code className="font-mono">@</code> A record to{" "}
                  <code className="font-mono">{vpsIpv4}</code>. Keep{" "}
                  <code className="font-mono">mx1.titan.email</code> and{" "}
                  <code className="font-mono">spf.titan.email</code> untouched.
                </p>
              </div>
              <div className="rounded-xl border border-slate-100 bg-slate-50/70 p-4">
                <h4 className="text-xs font-bold text-slate-900">
                  Using Cloudflare DNS?
                </h4>
                <p className="mt-1 text-xs leading-relaxed text-slate-600">
                  Set the proxy cloud to <strong>DNS Only (Grey Cloud)</strong>{" "}
                  when clicking &ldquo;Issue Let&apos;s Encrypt SSL&rdquo;. Once
                  the certificate is issued, you can turn the Orange Cloud back
                  on with SSL mode set to <strong>Full (Strict)</strong>.
                </p>
              </div>
              <div className="rounded-xl border border-slate-100 bg-slate-50/70 p-4">
                <h4 className="text-xs font-bold text-slate-900">
                  Namecheap / GoDaddy
                </h4>
                <p className="mt-1 text-xs leading-relaxed text-slate-600">
                  Open <strong>Advanced DNS</strong>, set Host{" "}
                  <code className="font-mono">@</code> to{" "}
                  <code className="font-mono">{vpsIpv4}</code> (TTL 5 min /
                  Automatic) and Host <code className="font-mono">www</code>{" "}
                  CNAME to <code className="font-mono">{site.domain}</code>.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: SSL / HTTPS */}
      {activeTab === "ssl" && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-2xs">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-slate-900">
                Let&apos;s Encrypt SSL Certificate
              </h2>
              <span
                className={`rounded-full px-3 py-1 text-xs font-semibold ${
                  site.sslEnabled
                    ? "bg-emerald-50 text-emerald-700"
                    : "bg-amber-50 text-amber-700"
                }`}
              >
                {site.sslEnabled ? "Active & Auto-Renewing" : "Not Issued Yet"}
              </span>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              WPCloud issues certificates using{" "}
              <code className="font-mono">certbot certonly --webroot</code> — it
              never runs <code className="font-mono">certbot --nginx</code>, so
              none of your existing Next.js or custom Nginx files are ever
              touched.
            </p>

            {site.sslEnabled ? (
              <div className="mt-5 space-y-3 rounded-xl border border-emerald-200 bg-emerald-50/60 p-4 text-xs">
                <div className="flex justify-between">
                  <span className="text-emerald-900/70">Certificate Issuer</span>
                  <span className="font-semibold text-emerald-950">
                    {site.sslIssuer || "Let's Encrypt"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-emerald-900/70">Covered Hosts</span>
                  <span className="font-mono font-semibold text-emerald-950">
                    {site.domain}
                    {site.nginxOptions.includeWww ? `, www.${site.domain}` : ""}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-emerald-900/70">Expires At</span>
                  <span className="font-mono font-semibold text-emerald-950">
                    {site.sslExpiresAt
                      ? new Date(site.sslExpiresAt).toLocaleDateString()
                      : "90 days"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-emerald-900/70">Renewal Hook</span>
                  <span className="font-mono text-emerald-950">
                    nginx -t &amp;&amp; systemctl reload nginx
                  </span>
                </div>
              </div>
            ) : (
              <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50/70 p-4 text-xs text-amber-900">
                Point your domain&apos;s A record to{" "}
                <code className="font-mono font-bold">{vpsIpv4}</code>, then
                click below to verify DNS and automatically issue your free
                Let&apos;s Encrypt SSL certificate.
              </div>
            )}

            <div className="mt-5 flex flex-wrap gap-3">
              <button
                type="button"
                disabled={busyAction === "ssl"}
                onClick={handleIssueSsl}
                className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-4 py-2.5 text-xs font-semibold text-white shadow-2xs transition hover:from-indigo-500 hover:to-violet-500 disabled:opacity-60"
              >
                <Lock className="h-3.5 w-3.5" />
                {busyAction === "ssl"
                  ? "Running certbot --webroot..."
                  : site.sslEnabled
                    ? "Renew / Re-Issue SSL Certificate"
                    : "Check DNS & Issue Let's Encrypt SSL"}
              </button>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-2xs">
            <h3 className="text-sm font-semibold text-slate-900">
              How WPCloud Protects Existing Nginx Vhosts During SSL
            </h3>
            <ul className="mt-4 space-y-3 text-xs text-slate-600">
              <li className="flex items-start gap-2.5">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                <span>
                  Uses ACME HTTP-01 challenge inside{" "}
                  <code className="font-mono">
                    {site.rootPath}/.well-known/acme-challenge/
                  </code>
                </span>
              </li>
              <li className="flex items-start gap-2.5">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                <span>
                  Rebuilds only{" "}
                  <code className="font-mono">{site.nginxConfigPath}</code> from
                  our template with HTTP/2 &amp; TLS 1.2/1.3 enabled
                </span>
              </li>
              <li className="flex items-start gap-2.5">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                <span>
                  Automatically updates WordPress{" "}
                  <code className="font-mono">siteurl</code> and{" "}
                  <code className="font-mono">home</code> to{" "}
                  <code className="font-mono">https://{site.domain}</code> via
                  WP-CLI so mixed-content warnings don&apos;t occur
                </span>
              </li>
            </ul>
          </div>
        </div>
      )}

      {/* TAB 4: AUTOMATED NGINX CONFIGURATOR */}
      {activeTab === "nginx" && nginxForm && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <form
            onSubmit={handleSaveNginx}
            className="space-y-5 rounded-2xl border border-slate-200/80 bg-white p-6 shadow-2xs lg:col-span-5"
          >
            <div>
              <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2.5 py-0.5 text-[11px] font-semibold text-indigo-700">
                <Sparkles className="h-3 w-3" /> Zero Manual Config Needed
              </span>
              <h2 className="mt-2 text-base font-semibold text-slate-900">
                Automated Nginx Settings
              </h2>
              <p className="mt-0.5 text-xs text-slate-500">
                Choose what your site needs below. WPCloud generates{" "}
                <code className="font-mono">{site.nginxConfigPath}</code>,
                verifies it with <code className="font-mono">nginx -t</code>,
                and reloads Nginx safely.
              </p>
            </div>

            <div>
              <label
                htmlFor="nginx-canonical"
                className="block text-xs font-semibold text-slate-700"
              >
                Canonical Domain Redirect
              </label>
              <select
                id="nginx-canonical"
                value={nginxForm.canonicalHost}
                onChange={(e) =>
                  setNginxForm({
                    ...nginxForm,
                    canonicalHost: e.target.value as NginxSiteOptions["canonicalHost"],
                  })
                }
                className="mt-1.5 block w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-900"
              >
                <option value="apex">
                  Redirect www.{site.domain} → {site.domain} (Recommended)
                </option>
                <option value="www">
                  Redirect {site.domain} → www.{site.domain}
                </option>
                <option value="none">
                  Serve both without canonical redirect
                </option>
              </select>
            </div>

            <div>
              <label
                htmlFor="nginx-upload-mb"
                className="block text-xs font-semibold text-slate-700"
              >
                Max Upload Body Size (MB) — synced with PHP-FPM
              </label>
              <input
                id="nginx-upload-mb"
                type="number"
                min={8}
                max={2048}
                value={nginxForm.clientMaxBodySizeMb}
                onChange={(e) =>
                  setNginxForm({
                    ...nginxForm,
                    clientMaxBodySizeMb: Number(e.target.value) || 128,
                  })
                }
                className="mt-1.5 block w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-900"
              />
            </div>

            <div>
              <label
                htmlFor="nginx-cache-days"
                className="block text-xs font-semibold text-slate-700"
              >
                Static Assets Browser Cache (Days)
              </label>
              <input
                id="nginx-cache-days"
                type="number"
                min={0}
                max={365}
                value={nginxForm.staticCacheDays}
                onChange={(e) =>
                  setNginxForm({
                    ...nginxForm,
                    staticCacheDays: Number(e.target.value) || 0,
                  })
                }
                className="mt-1.5 block w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-900"
              />
            </div>

            <div className="space-y-2.5 pt-1">
              <label className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50/70 px-3.5 py-2.5 text-xs">
                <span className="font-medium text-slate-700">
                  Include <code className="font-mono">www.{site.domain}</code>{" "}
                  alias
                </span>
                <input
                  type="checkbox"
                  checked={nginxForm.includeWww}
                  onChange={(e) =>
                    setNginxForm({
                      ...nginxForm,
                      includeWww: e.target.checked,
                    })
                  }
                  className="h-4 w-4 rounded accent-indigo-600"
                />
              </label>

              <label className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50/70 px-3.5 py-2.5 text-xs">
                <span className="font-medium text-slate-700">
                  Block <code className="font-mono">xmlrpc.php</code> attacks
                </span>
                <input
                  type="checkbox"
                  checked={nginxForm.blockXmlRpc}
                  onChange={(e) =>
                    setNginxForm({
                      ...nginxForm,
                      blockXmlRpc: e.target.checked,
                    })
                  }
                  className="h-4 w-4 rounded accent-indigo-600"
                />
              </label>

              <label className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50/70 px-3.5 py-2.5 text-xs">
                <span className="font-medium text-slate-700">
                  Enable Gzip compression
                </span>
                <input
                  type="checkbox"
                  checked={nginxForm.enableGzip}
                  onChange={(e) =>
                    setNginxForm({
                      ...nginxForm,
                      enableGzip: e.target.checked,
                    })
                  }
                  className="h-4 w-4 rounded accent-indigo-600"
                />
              </label>

              <label className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50/70 px-3.5 py-2.5 text-xs">
                <span className="font-medium text-slate-700">
                  Strict-Transport-Security (HSTS)
                </span>
                <input
                  type="checkbox"
                  checked={nginxForm.enableHsts}
                  onChange={(e) =>
                    setNginxForm({
                      ...nginxForm,
                      enableHsts: e.target.checked,
                    })
                  }
                  className="h-4 w-4 rounded accent-indigo-600"
                />
              </label>
            </div>

            <div>
              <label
                htmlFor="nginx-extra"
                className="block text-xs font-semibold text-slate-700"
              >
                Optional Custom Server Directives (Validated via{" "}
                <code className="font-mono">nginx -t</code>)
              </label>
              <textarea
                id="nginx-extra"
                rows={3}
                placeholder="# e.g. rewrite ^/old-page$ /new-page permanent;"
                value={nginxForm.extraDirectives}
                onChange={(e) =>
                  setNginxForm({
                    ...nginxForm,
                    extraDirectives: e.target.value,
                  })
                }
                className="mt-1.5 block w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-xs text-slate-900"
              />
            </div>

            <button
              type="submit"
              disabled={busyAction === "nginx"}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-xs font-semibold text-white shadow-2xs transition hover:bg-indigo-500 disabled:opacity-60"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${
                  busyAction === "nginx" ? "animate-spin" : ""
                }`}
              />
              {busyAction === "nginx"
                ? "Testing with nginx -t & Reloading..."
                : "Regenerate Config, Test (nginx -t) & Reload"}
            </button>
          </form>

          <div className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-2xs lg:col-span-7">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">
                  Generated File Preview:{" "}
                  <code className="font-mono text-xs text-indigo-600">
                    {site.nginxConfigPath}
                  </code>
                </h3>
                <p className="mt-0.5 text-xs text-slate-500">
                  Automatically included via{" "}
                  <code className="font-mono">/etc/nginx/conf.d/wpcloud.conf</code>
                </p>
              </div>
              <button
                type="button"
                onClick={() => copyText("nginx_conf", nginxConfigText)}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                {copiedKey === "nginx_conf" ? (
                  <>
                    <Check className="h-3.5 w-3.5 text-emerald-600" /> Copied
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5" /> Copy Config
                  </>
                )}
              </button>
            </div>
            <pre className="mt-4 max-h-[540px] overflow-auto rounded-xl bg-slate-900 p-4 font-mono text-xs leading-relaxed text-slate-100">
              {nginxConfigText}
            </pre>
          </div>
        </div>
      )}

      {/* TAB 5: PHP VERSION & POOL */}
      {activeTab === "php" && phpForm && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <form
            onSubmit={handleSavePhp}
            className="space-y-4 rounded-2xl border border-slate-200/80 bg-white p-6 shadow-2xs lg:col-span-5"
          >
            <h2 className="text-base font-semibold text-slate-900">
              Per-Site PHP-FPM Version &amp; Pool
            </h2>
            <p className="text-xs text-slate-500">
              Switch PHP versions at any time. WPCloud moves the pool file to{" "}
              <code className="font-mono">
                /opt/wpcloud/php/{phpForm.phpVersion}/{site.domain}.conf
              </code>{" "}
              and reloads FPM cleanly.
            </p>

            <div>
              <label className="block text-xs font-semibold text-slate-700">
                Select PHP Version
              </label>
              <div className="mt-2 grid grid-cols-3 gap-2.5">
                {(["8.1", "8.2", "8.3"] as PhpVersion[]).map((ver) => (
                  <button
                    key={ver}
                    type="button"
                    onClick={() =>
                      setPhpForm({ ...phpForm, phpVersion: ver })
                    }
                    className={`rounded-xl border px-3 py-2.5 text-xs font-bold transition ${
                      phpForm.phpVersion === ver
                        ? "border-indigo-600 bg-indigo-50 text-indigo-700"
                        : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                    }`}
                  >
                    PHP {ver}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label
                htmlFor="php-mem"
                className="block text-xs font-semibold text-slate-700"
              >
                PHP Memory Limit (MB)
              </label>
              <input
                id="php-mem"
                type="number"
                min={64}
                max={4096}
                value={phpForm.memoryLimitMb}
                onChange={(e) =>
                  setPhpForm({
                    ...phpForm,
                    memoryLimitMb: Number(e.target.value) || 256,
                  })
                }
                className="mt-1.5 block w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs"
              />
            </div>

            <div>
              <label
                htmlFor="php-exec"
                className="block text-xs font-semibold text-slate-700"
              >
                Max Execution Time (Seconds)
              </label>
              <input
                id="php-exec"
                type="number"
                min={30}
                max={3600}
                value={phpForm.maxExecutionTime}
                onChange={(e) =>
                  setPhpForm({
                    ...phpForm,
                    maxExecutionTime: Number(e.target.value) || 300,
                  })
                }
                className="mt-1.5 block w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs"
              />
            </div>

            <div>
              <label
                htmlFor="php-children"
                className="block text-xs font-semibold text-slate-700"
              >
                Max FPM Worker Children (<code className="font-mono">pm.max_children</code>)
              </label>
              <input
                id="php-children"
                type="number"
                min={2}
                max={100}
                value={phpForm.maxChildren}
                onChange={(e) =>
                  setPhpForm({
                    ...phpForm,
                    maxChildren: Number(e.target.value) || 10,
                  })
                }
                className="mt-1.5 block w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs"
              />
            </div>

            <button
              type="submit"
              disabled={busyAction === "php"}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-xs font-semibold text-white shadow-2xs transition hover:bg-indigo-500 disabled:opacity-60"
            >
              <Cpu className="h-3.5 w-3.5" />
              {busyAction === "php"
                ? "Switching PHP Pool..."
                : `Apply PHP ${phpForm.phpVersion}-FPM Pool Settings`}
            </button>
          </form>

          <div className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-2xs lg:col-span-7">
            <h3 className="text-sm font-semibold text-slate-900">
              Generated PHP-FPM Pool Config:{" "}
              <code className="font-mono text-xs text-indigo-600">
                {site.phpPoolConfigPath}
              </code>
            </h3>
            <pre className="mt-4 max-h-[460px] overflow-auto rounded-xl bg-slate-900 p-4 font-mono text-xs leading-relaxed text-slate-100">
              {phpPoolConfigText}
            </pre>
          </div>
        </div>
      )}

      {/* TAB 6: WP-CLI TOOLS */}
      {activeTab === "wpcli" && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <div className="space-y-4 rounded-2xl border border-slate-200/80 bg-white p-6 shadow-2xs lg:col-span-7">
            <h2 className="text-base font-semibold text-slate-900">
              One-Click WP-CLI Operations
            </h2>
            <p className="text-xs text-slate-500">
              Runs as isolated user <code className="font-mono">{site.linuxUser}</code>{" "}
              inside <code className="font-mono">{site.rootPath}</code>.
            </p>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => handleRunWpCli("update_core")}
                className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 text-left text-xs font-semibold text-slate-800 transition hover:border-indigo-300 hover:bg-indigo-50/40"
              >
                <span>Update WordPress Core</span>
                <Play className="h-3.5 w-3.5 text-indigo-600" />
              </button>

              <button
                type="button"
                onClick={() => handleRunWpCli("update_plugins")}
                className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 text-left text-xs font-semibold text-slate-800 transition hover:border-indigo-300 hover:bg-indigo-50/40"
              >
                <span>Update All Installed Plugins</span>
                <Play className="h-3.5 w-3.5 text-indigo-600" />
              </button>

              <button
                type="button"
                onClick={() => handleRunWpCli("flush_cache")}
                className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 text-left text-xs font-semibold text-slate-800 transition hover:border-indigo-300 hover:bg-indigo-50/40"
              >
                <span>Flush Object Cache &amp; Permalinks</span>
                <Play className="h-3.5 w-3.5 text-indigo-600" />
              </button>

              <button
                type="button"
                onClick={() => handleRunWpCli("reset_admin_password")}
                className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 text-left text-xs font-semibold text-slate-800 transition hover:border-indigo-300 hover:bg-indigo-50/40"
              >
                <span>Reset WP Admin Password ({site.wpAdminUser})</span>
                <Play className="h-3.5 w-3.5 text-indigo-600" />
              </button>
            </div>

            <div className="mt-4 rounded-xl border border-slate-200/80 bg-slate-50/60 p-4">
              <h3 className="text-xs font-bold text-slate-800">
                Serialized-Safe Domain / URL Search &amp; Replace (
                <code className="font-mono">wp search-replace --precise</code>)
              </h3>
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="sr-from"
                    className="block text-[11px] font-semibold text-slate-600"
                  >
                    Find URL / String
                  </label>
                  <input
                    id="sr-from"
                    type="text"
                    value={searchFrom}
                    onChange={(e) => setSearchFrom(e.target.value)}
                    className="mt-1 block w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 font-mono text-xs"
                  />
                </div>
                <div>
                  <label
                    htmlFor="sr-to"
                    className="block text-[11px] font-semibold text-slate-600"
                  >
                    Replace With
                  </label>
                  <input
                    id="sr-to"
                    type="text"
                    value={searchTo}
                    onChange={(e) => setSearchTo(e.target.value)}
                    className="mt-1 block w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 font-mono text-xs"
                  />
                </div>
              </div>
              <button
                type="button"
                onClick={() =>
                  handleRunWpCli("search_replace", {
                    fromUrl: searchFrom,
                    toUrl: searchTo,
                  })
                }
                className="mt-3 inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-indigo-500"
              >
                <Terminal className="h-3.5 w-3.5" /> Run Search &amp; Replace
              </button>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-2xs lg:col-span-5">
            <h3 className="text-sm font-semibold text-slate-900">
              WP-CLI Console Output
            </h3>
            <pre className="mt-3 min-h-[260px] overflow-auto rounded-xl bg-slate-900 p-4 font-mono text-xs leading-relaxed text-emerald-300">
              {wpCliOutput ||
                `# Ready to run WP-CLI on ${site.rootPath}\n# Click any action on the left to execute.`}
            </pre>
          </div>
        </div>
      )}

      {/* TAB 7: WORDPRESS OUTBOUND MAIL (SMTP MU-PLUGIN) */}
      {activeTab === "wpmail" && smtpForm && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <form
            onSubmit={handleSaveSmtp}
            className="space-y-4 rounded-2xl border border-slate-200/80 bg-white p-6 shadow-2xs lg:col-span-7"
          >
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold text-slate-900">
                  WordPress Outbound Email (SMTP MU-Plugin)
                </h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  Routes WordPress contact forms, WooCommerce emails, and
                  password resets via{" "}
                  <code className="font-mono">
                    wp-content/mu-plugins/wpcloud-smtp.php
                  </code>{" "}
                  — no bloated SMTP plugin needed.
                </p>
              </div>
              <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-800">
                <input
                  type="checkbox"
                  checked={smtpForm.enabled}
                  onChange={(e) =>
                    setSmtpForm({ ...smtpForm, enabled: e.target.checked })
                  }
                  className="h-4 w-4 rounded accent-indigo-600"
                />
                Enabled
              </label>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700">
                Mail Provider Preset
              </label>
              <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {[
                  {
                    id: "panel_mailbox",
                    label: "WPCloud Mailbox",
                    host: "127.0.0.1",
                    port: 587,
                  },
                  {
                    id: "titan",
                    label: "Titan Mail",
                    host: "smtp.titan.email",
                    port: 587,
                  },
                  {
                    id: "brevo",
                    label: "Brevo Relay",
                    host: "smtp-relay.brevo.com",
                    port: 587,
                  },
                  {
                    id: "ses",
                    label: "Amazon SES",
                    host: "email-smtp.eu-central-1.amazonaws.com",
                    port: 587,
                  },
                ].map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() =>
                      setSmtpForm({
                        ...smtpForm,
                        enabled: true,
                        provider: preset.id as WpSmtpConfig["provider"],
                        host: preset.host,
                        port: preset.port,
                      })
                    }
                    className={`rounded-xl border px-3 py-2 text-xs font-semibold transition ${
                      smtpForm.provider === preset.id
                        ? "border-indigo-600 bg-indigo-50 text-indigo-700"
                        : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                    }`}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="sm:col-span-2">
                <label
                  htmlFor="smtp-host"
                  className="block text-xs font-semibold text-slate-700"
                >
                  SMTP Host
                </label>
                <input
                  id="smtp-host"
                  type="text"
                  value={smtpForm.host}
                  onChange={(e) =>
                    setSmtpForm({ ...smtpForm, host: e.target.value })
                  }
                  className="mt-1 block w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-xs"
                />
              </div>
              <div>
                <label
                  htmlFor="smtp-port"
                  className="block text-xs font-semibold text-slate-700"
                >
                  SMTP Port
                </label>
                <input
                  id="smtp-port"
                  type="number"
                  value={smtpForm.port}
                  onChange={(e) =>
                    setSmtpForm({
                      ...smtpForm,
                      port: Number(e.target.value) || 587,
                    })
                  }
                  className="mt-1 block w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-xs"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label
                  htmlFor="smtp-user"
                  className="block text-xs font-semibold text-slate-700"
                >
                  Mailbox Username (e.g. me@{site.domain})
                </label>
                <input
                  id="smtp-user"
                  type="text"
                  value={smtpForm.username}
                  onChange={(e) =>
                    setSmtpForm({
                      ...smtpForm,
                      username: e.target.value,
                      fromEmail: smtpForm.fromEmail || e.target.value,
                    })
                  }
                  className="mt-1 block w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-xs"
                />
              </div>
              <div>
                <label
                  htmlFor="smtp-pass"
                  className="block text-xs font-semibold text-slate-700"
                >
                  Mailbox / SMTP Password
                </label>
                <input
                  id="smtp-pass"
                  type="password"
                  value={smtpForm.password}
                  onChange={(e) =>
                    setSmtpForm({ ...smtpForm, password: e.target.value })
                  }
                  className="mt-1 block w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-xs"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label
                  htmlFor="smtp-from-email"
                  className="block text-xs font-semibold text-slate-700"
                >
                  From Email Address
                </label>
                <input
                  id="smtp-from-email"
                  type="email"
                  value={smtpForm.fromEmail}
                  onChange={(e) =>
                    setSmtpForm({ ...smtpForm, fromEmail: e.target.value })
                  }
                  className="mt-1 block w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-xs"
                />
              </div>
              <div>
                <label
                  htmlFor="smtp-from-name"
                  className="block text-xs font-semibold text-slate-700"
                >
                  From Display Name
                </label>
                <input
                  id="smtp-from-name"
                  type="text"
                  value={smtpForm.fromName}
                  onChange={(e) =>
                    setSmtpForm({ ...smtpForm, fromName: e.target.value })
                  }
                  className="mt-1 block w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={busyAction === "smtp"}
              className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-xs font-semibold text-white hover:bg-indigo-500"
            >
              <Mail className="h-3.5 w-3.5" />
              {busyAction === "smtp"
                ? "Writing MU-Plugin..."
                : "Save & Inject WordPress SMTP MU-Plugin"}
            </button>
          </form>

          <div className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-2xs lg:col-span-5">
            <h3 className="text-sm font-semibold text-slate-900">
              Need to create <code className="font-mono">me@{site.domain}</code>{" "}
              or back up Titan Mail?
            </h3>
            <p className="mt-1.5 text-xs leading-relaxed text-slate-600">
              Open WPCloud&apos;s <strong>Mail Server &amp; Titan Backup</strong>{" "}
              module to create custom mailboxes on your Contabo VPS or copy
              existing emails from <code className="font-mono">imap.titan.email</code>.
            </p>
            <button
              type="button"
              onClick={() => onOpenMailTab(site.domain)}
              className="mt-4 inline-flex items-center gap-1.5 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-2 text-xs font-semibold text-indigo-700 hover:bg-indigo-100"
            >
              Open Mail Server for {site.domain} →
            </button>
          </div>
        </div>
      )}

      {/* TAB 8: LOGS */}
      {activeTab === "logs" && (
        <div className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-2xs">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              {(
                [
                  { id: "access", label: "nginx access.log" },
                  { id: "error", label: "nginx error.log" },
                  { id: "phpError", label: "php-error.log" },
                ] as const
              ).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setSelectedLogType(item.id)}
                  className={`rounded-xl px-3.5 py-2 font-mono text-xs font-semibold transition ${
                    selectedLogType === item.id
                      ? "bg-slate-900 text-white"
                      : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={loadSiteDetails}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              <RefreshCw className="h-3.5 w-3.5" /> Refresh Logs
            </button>
          </div>
          <p className="mt-2 font-mono text-[11px] text-slate-400">
            Path: {site.logsPath}/
            {selectedLogType === "phpError"
              ? "php-error.log"
              : `${selectedLogType}.log`}
          </p>
          <pre className="mt-3 max-h-[420px] overflow-auto rounded-xl bg-slate-900 p-4 font-mono text-xs leading-relaxed text-slate-200">
            {logs[selectedLogType]}
          </pre>
        </div>
      )}

      {/* TAB 9: DATABASE (ADMINER) */}
      {activeTab === "database" && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-2xs">
            <h2 className="text-base font-semibold text-slate-900">
              MariaDB / MySQL Credentials
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              Bound strictly to <code className="font-mono">127.0.0.1</code> and
              synchronized with{" "}
              <code className="font-mono">{site.rootPath}/wp-config.php</code>.
            </p>

            <dl className="mt-4 space-y-2.5 text-xs">
              <div className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3">
                <dt className="font-medium text-slate-500">Database Name</dt>
                <dd className="font-mono font-bold text-slate-900">
                  {site.dbName}
                </dd>
              </div>
              <div className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3">
                <dt className="font-medium text-slate-500">Database User</dt>
                <dd className="font-mono font-bold text-slate-900">
                  {site.dbUser}
                </dd>
              </div>
              <div className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3">
                <dt className="font-medium text-slate-500">Database Password</dt>
                <dd className="flex items-center gap-2 font-mono text-slate-900">
                  <span>{site.dbPassword}</span>
                  <button
                    type="button"
                    onClick={() => copyText("db_pass", site.dbPassword)}
                    className="rounded border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-semibold"
                  >
                    {copiedKey === "db_pass" ? "Copied" : "Copy"}
                  </button>
                </dd>
              </div>
              <div className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3">
                <dt className="font-medium text-slate-500">Table Prefix</dt>
                <dd className="font-mono font-bold text-slate-900">
                  {site.tablePrefix}
                </dd>
              </div>
            </dl>

            <div className="mt-5 flex flex-wrap gap-3">
              <a
                href={`http://${vpsIpv4}:${adminerPort}/?server=127.0.0.1&username=${encodeURIComponent(
                  site.dbUser
                )}&db=${encodeURIComponent(site.dbName)}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-xs font-semibold text-white shadow-2xs hover:bg-indigo-500"
              >
                <Database className="h-3.5 w-3.5" />
                Open in Adminer (Port {adminerPort})
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-2xs">
            <h3 className="text-sm font-semibold text-slate-900">
              Snapshots &amp; SQL Backups
            </h3>
            <p className="mt-1 text-xs text-slate-500">
              All SQL dumps and site archives are stored inside{" "}
              <code className="font-mono">
                /opt/wpcloud/backups/{site.domain}/
              </code>
              .
            </p>
            <div className="mt-4 rounded-xl border border-slate-100 bg-slate-50 p-4 text-xs text-slate-600">
              <div className="flex items-center gap-2 font-semibold text-slate-800">
                <HardDrive className="h-4 w-4 text-indigo-600" />
                Current Disk Usage: {site.diskUsageMb} MB
              </div>
              <p className="mt-1">
                Includes WordPress core, <code className="font-mono">wp-content/uploads</code>,
                and logs inside <code className="font-mono">/opt/wpcloud/sites/{site.domain}</code>.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal using Native <dialog> (follows dialog & light-dismiss-a-dialog guides) */}
      <NativeModalDialog
        open={deleteDialogOpen}
        onClose={() => setDeleteDialogOpen(false)}
        title={`Delete ${site.domain}?`}
        subtitle="A full backup snapshot of files and DB metadata will be saved to /opt/wpcloud/backups/ first."
      >
        <div className="space-y-4">
          <div className="flex items-start gap-2.5 rounded-xl border border-rose-200 bg-rose-50 p-3.5 text-xs text-rose-800">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
            <span>
              Type <strong className="font-mono">{site.domain}</strong> below to
              confirm removing the active Nginx vhost and PHP-FPM pool.
            </span>
          </div>

          <div>
            <label
              htmlFor="confirm-delete-domain"
              className="block text-xs font-semibold text-slate-700"
            >
              Confirm Domain Name
            </label>
            <input
              id="confirm-delete-domain"
              type="text"
              value={confirmDomainInput}
              onChange={(e) => setConfirmDomainInput(e.target.value)}
              placeholder={site.domain}
              className="mt-1.5 block w-full rounded-xl border border-slate-200 px-3.5 py-2 font-mono text-xs"
            />
          </div>

          {/* Follows dialog guide: autofocus placed on the safe Cancel action in a destructive confirmation */}
          <div className="flex items-center justify-end gap-2.5 pt-2">
            <button
              type="button"
              autoFocus
              onClick={() => setDeleteDialogOpen(false)}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={
                confirmDomainInput.trim() !== site.domain ||
                busyAction === "delete"
              }
              onClick={handleDeleteSite}
              className="rounded-xl bg-rose-600 px-4 py-2 text-xs font-semibold text-white hover:bg-rose-500 disabled:opacity-50"
            >
              {busyAction === "delete"
                ? "Archiving & Deleting..."
                : "Archive Snapshot & Delete Site"}
            </button>
          </div>
        </div>
      </NativeModalDialog>
    </div>
  );
}

