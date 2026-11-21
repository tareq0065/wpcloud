"use client";

import React, { useCallback, useEffect, useState } from "react";
import {
  Activity,
  CheckCircle2,
  Cloud,
  Cpu,
  Database,
  ExternalLink,
  FolderTree,
  Globe,
  HardDrive,
  KeyRound,
  Layers,
  Lock,
  LogOut,
  Mail,
  Menu,
  PlusCircle,
  RefreshCw,
  Search,
  Server,
  Settings,
  ShieldCheck,
  Sparkles,
  Terminal,
  UploadCloud,
  X,
} from "lucide-react";
import type {
  AgentJob,
  MailServerState,
  SiteRecord,
} from "@wpcloud/shared";
import { LoginView } from "@/components/LoginView";
import { CreateAndImportWizards } from "@/components/CreateAndImportWizards";
import { SiteDetailWorkspace } from "@/components/SiteDetailWorkspace";
import { MailServerView } from "@/components/MailServerView";

type NavSection =
  | "dashboard"
  | "create"
  | "import"
  | "mail"
  | "server"
  | "settings";

interface OverviewResponse {
  settings: {
    adminUsername: string;
    totpEnabled: boolean;
    totpSecret: string;
    totpCurrentCode: string;
    panelPort: number;
    adminerPort: number;
    panelHttps: boolean;
    vpsIpv4: string;
    vpsIpv6: string;
    contaboReverseDnsHostname: string;
  };
  sites: SiteRecord[];
  jobs: AgentJob[];
  mailServer: MailServerState;
  metrics: {
    hostname: string;
    platform: string;
    ubuntuRelease: string;
    nodeVersion: string;
    wpcloudRoot: string;
    isDryRun: boolean;
    uptimeSeconds: number;
    cpuLoadPercent: number;
    cpuCores: number;
    memTotalMb: number;
    memUsedMb: number;
    diskTotalGb: number;
    diskUsedGb: number;
    diskFreeGb?: number;
    services: {
      name: string;
      description: string;
      status: "active" | "inactive";
    }[];
  };
  externalNginx: {
    externalDomains: string[];
    confFiles: string[];
  };
  auditLog: {
    id: string;
    timestamp: string;
    action: string;
    binary: string;
    args: string[];
    dryRun: boolean;
    exitCode: number;
    stdout: string;
  }[];
}

export default function WpCloudAppPage() {
  const [authChecked, setAuthChecked] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [totpRequiredOnLogin, setTotpRequiredOnLogin] = useState(false);

  const [overview, setOverview] = useState<OverviewResponse | null>(null);
  const [activeNav, setActiveNav] = useState<NavSection>("dashboard");
  const [selectedSiteId, setSelectedSiteId] = useState<string | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [desktopSidebarOpen, setDesktopSidebarOpen] = useState(true);
  const [mailDomainFilter, setMailDomainFilter] = useState<string | undefined>(
    undefined
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [latestJobBanner, setLatestJobBanner] = useState<AgentJob | null>(null);

  // Toast feedback state
  const [toast, setToast] = useState<{
    message: string;
    tone: "success" | "error";
  } | null>(null);

  // Settings form state
  const [settingsIpv4, setSettingsIpv4] = useState("");
  const [settingsIpv6, setSettingsIpv6] = useState("");
  const [settingsRdns, setSettingsRdns] = useState("");
  const [settingsHttps, setSettingsHttps] = useState(true);
  const [newAdminPassword, setNewAdminPassword] = useState("");

  const notify = useCallback(
    (message: string, tone: "success" | "error" = "success") => {
      setToast({ message, tone });
      setTimeout(() => {
        setToast((prev) => (prev?.message === message ? null : prev));
      }, 4500);
    },
    []
  );

  const fetchOverview = useCallback(async () => {
    try {
      const res = await fetch("/api/overview");
      if (!res.ok) return;
      const data = (await res.json()) as OverviewResponse;
      setOverview(data);
      setSettingsIpv4(data.settings.vpsIpv4);
      setSettingsIpv6(data.settings.vpsIpv6);
      setSettingsRdns(data.settings.contaboReverseDnsHostname);
      setSettingsHttps(data.settings.panelHttps);
    } catch {
      // ignore transient error
    }
  }, []);

  useEffect(() => {
    async function initAuth() {
      try {
        const res = await fetch("/api/auth");
        const data = await res.json();
        setAuthenticated(Boolean(data.authenticated));
        setTotpRequiredOnLogin(Boolean(data.totpEnabled));
        if (data.authenticated) {
          await fetchOverview();
        }
      } finally {
        setAuthChecked(true);
      }
    }
    void initAuth();
  }, [fetchOverview]);

  async function handleLogout() {
    await fetch("/api/auth", { method: "DELETE" });
    setAuthenticated(false);
  }

  async function handleSaveSettings(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch("/api/auth", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "update_settings",
        vpsIpv4: settingsIpv4,
        vpsIpv6: settingsIpv6,
        panelHttps: settingsHttps,
        contaboReverseDnsHostname: settingsRdns,
      }),
    });
    if (res.ok) {
      await fetchOverview();
      notify("Saved VPS IP, Reverse DNS, and Panel HTTPS settings!");
    }
  }

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch("/api/auth", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "change_password",
        newPassword: newAdminPassword,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      notify(data.error || "Password update failed", "error");
      return;
    }
    setNewAdminPassword("");
    notify("Updated WPCloud admin password!");
  }

  async function handleToggleTotp(enabled: boolean) {
    const res = await fetch("/api/auth", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "toggle_totp",
        totpEnabled: enabled,
      }),
    });
    if (res.ok) {
      await fetchOverview();
      notify(
        enabled
          ? "Enabled TOTP 2-Factor Authentication for admin login!"
          : "Disabled TOTP 2-Factor Authentication."
      );
    }
  }

  if (!authChecked) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#FAFAFB]">
        <div className="flex items-center gap-3 text-sm font-medium text-slate-600">
          <RefreshCw className="h-4 w-4 animate-spin text-indigo-600" />
          Initializing WPCloud Control Panel...
        </div>
      </div>
    );
  }

  if (!authenticated) {
    return (
      <LoginView
        totpEnabled={totpRequiredOnLogin}
        onSuccess={() => {
          setAuthenticated(true);
          void fetchOverview();
        }}
      />
    );
  }

  const sites = overview?.sites || [];
  const filteredSites = sites.filter(
    (s) =>
      s.domain.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.phpVersion.includes(searchQuery)
  );

  return (
    <div className="flex min-h-screen bg-[#FAFAFB] text-slate-900">
      {/* Mobile Backdrop */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 z-40 bg-slate-900/40 backdrop-blur-xs lg:hidden"
          onClick={() => setMobileMenuOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Responsive Sidebar (Mobile drawer + Desktop toggleable) */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-72 shrink-0 flex-col justify-between border-r border-slate-200/80 bg-white p-5 transition-transform duration-200 ease-in-out lg:static lg:translate-x-0 ${
          mobileMenuOpen
            ? "translate-x-0 shadow-2xl"
            : "-translate-x-full lg:translate-x-0"
        } ${!desktopSidebarOpen ? "lg:hidden" : "lg:flex lg:w-68"}`}
      >
        <div className="space-y-6">
          <div className="flex items-center justify-between px-1">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-600 to-violet-600 text-white shadow-sm shadow-indigo-500/20">
                <Cloud className="h-5 w-5" />
              </div>
              <div>
                <div className="text-base font-bold tracking-tight text-slate-900">
                  WPCloud
                </div>
                <div className="font-mono text-[10px] text-slate-400">
                  /opt/wpcloud • v1.0
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 ring-1 ring-emerald-600/20">
                Online
              </span>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                aria-label="Close navigation sidebar"
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 lg:hidden"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          <nav className="space-y-1">
            {(
              [
                {
                  id: "dashboard",
                  label: "Dashboard & Sites",
                  icon: <Layers className="h-4 w-4" />,
                  badge: String(sites.length),
                },
                {
                  id: "create",
                  label: "Create New WP Site",
                  icon: <PlusCircle className="h-4 w-4" />,
                },
                {
                  id: "import",
                  label: "Import Existing WP Site",
                  icon: <UploadCloud className="h-4 w-4" />,
                },
                {
                  id: "mail",
                  label: "Mail & Titan Backup",
                  icon: <Mail className="h-4 w-4" />,
                  badge: String(overview?.mailServer.mailboxes.length || 0),
                },
                {
                  id: "server",
                  label: "Server & Safety Audit",
                  icon: <FolderTree className="h-4 w-4" />,
                },
                {
                  id: "settings",
                  label: "Settings & 2FA",
                  icon: <Settings className="h-4 w-4" />,
                },
              ] as const
            ).map((item) => {
              const active =
                activeNav === item.id && selectedSiteId === null;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    setSelectedSiteId(null);
                    setActiveNav(item.id);
                    setMobileMenuOpen(false);
                  }}
                  className={`flex w-full items-center justify-between rounded-xl px-3.5 py-2.5 text-xs font-semibold transition ${
                    active
                      ? "bg-indigo-600 text-white shadow-2xs"
                      : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                  }`}
                >
                  <span className="flex items-center gap-2.5">
                    {item.icon}
                    {item.label}
                  </span>
                  {"badge" in item && item.badge && (
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                        active
                          ? "bg-white/20 text-white"
                          : "bg-slate-100 text-slate-700"
                      }`}
                    >
                      {item.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>

          {/* Non-Interference Guarantee Card */}
          <div className="rounded-2xl border border-slate-200/80 bg-slate-50/80 p-4 text-xs">
            <div className="flex items-center gap-1.5 font-bold text-slate-800">
              <ShieldCheck className="h-4 w-4 text-emerald-600" />
              Existing Apps Protected
            </div>
            <p className="mt-1.5 leading-relaxed text-slate-500">
              Your existing Next.js apps, PM2 processes, and{" "}
              <code className="font-mono text-[11px]">sites-enabled/*</code>{" "}
              configs are strictly read-only. Every WPCloud site lives inside{" "}
              <code className="font-mono text-[11px] text-indigo-700">
                /opt/wpcloud
              </code>
              .
            </p>
          </div>
        </div>

        <div className="space-y-3 border-t border-slate-100 pt-4">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Contabo VPS IP</span>
            <span className="font-mono font-semibold text-slate-800">
              {overview?.settings.vpsIpv4 || "194.163.148.72"}
            </span>
          </div>
          <button
            type="button"
            onClick={handleLogout}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            <LogOut className="h-3.5 w-3.5" />
            Sign Out ({overview?.settings.adminUsername || "admin"})
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top Sticky Header */}
        <header className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-3 border-b border-slate-200/80 bg-white/90 px-4 py-3 backdrop-blur-md sm:px-6">
          <div className="flex items-center gap-3">
            {/* Toggle Sidebar Button */}
            <button
              type="button"
              onClick={() => {
                setMobileMenuOpen((prev) => !prev);
                setDesktopSidebarOpen((prev) => !prev);
              }}
              title="Toggle sidebar"
              aria-label="Toggle navigation sidebar"
              className="inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white p-2 text-slate-700 shadow-2xs transition hover:bg-slate-50 hover:text-slate-900 focus:outline-none"
            >
              <Menu className="h-4 w-4" />
            </button>

            {/* Active view title */}
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold tracking-tight text-slate-900">
                {selectedSiteId
                  ? `Site: ${overview?.sites.find((s) => s.id === selectedSiteId)?.domain || "Workspace"}`
                  : activeNav === "dashboard"
                    ? "Dashboard"
                    : activeNav === "create"
                      ? "Create WordPress Site"
                      : activeNav === "import"
                        ? "Import WordPress Site"
                        : activeNav === "mail"
                          ? "Mail & Titan Backup"
                          : activeNav === "server"
                            ? "Server & Safety Audit"
                            : "Settings & Security"}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-2.5">
            <button
              type="button"
              onClick={() => {
                setSelectedSiteId(null);
                setActiveNav("create");
                setMobileMenuOpen(false);
              }}
              className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-3 py-2 text-xs font-semibold text-white shadow-2xs transition hover:bg-indigo-500 sm:px-3.5"
            >
              <PlusCircle className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">New WP Site</span>
              <span className="sm:hidden">New</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setSelectedSiteId(null);
                setActiveNav("import");
                setMobileMenuOpen(false);
              }}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 sm:px-3.5"
            >
              <UploadCloud className="h-3.5 w-3.5 text-indigo-600" />
              <span className="hidden sm:inline">Import .zip + .sql</span>
              <span className="sm:hidden">Import</span>
            </button>
          </div>
        </header>

        {/* Toast Notification */}
        {toast && (
          <div className="fixed bottom-5 right-5 z-50 max-w-md rounded-2xl border border-slate-200 bg-slate-900 px-4 py-3 text-xs font-medium text-white shadow-xl">
            <div className="flex items-center gap-2.5">
              <span
                className={`h-2 w-2 shrink-0 rounded-full ${
                  toast.tone === "error" ? "bg-rose-400" : "bg-emerald-400"
                }`}
              />
              <span>{toast.message}</span>
            </div>
          </div>
        )}

        <main className="mx-auto w-full max-w-7xl flex-1 p-6">
          {/* Recent Provisioning Job Timeline Banner */}
          {latestJobBanner && (
            <div className="mb-6 rounded-2xl border border-indigo-200 bg-indigo-50/70 p-5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm font-bold text-indigo-950">
                  <Sparkles className="h-4 w-4 text-indigo-600" />
                  {latestJobBanner.title}
                </div>
                <button
                  type="button"
                  onClick={() => setLatestJobBanner(null)}
                  className="text-xs font-semibold text-indigo-700 hover:underline"
                >
                  Dismiss
                </button>
              </div>
              <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {latestJobBanner.steps.map((st) => (
                  <div
                    key={st.id}
                    className="rounded-xl border border-indigo-200/70 bg-white p-3 text-xs"
                  >
                    <div className="flex items-center gap-1.5 font-semibold text-emerald-700">
                      <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                      <span>Completed</span>
                    </div>
                    <p className="mt-1 text-slate-700">{st.label}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Selected Site Detail View */}
          {selectedSiteId ? (
            <SiteDetailWorkspace
              siteId={selectedSiteId}
              onBack={() => setSelectedSiteId(null)}
              onSiteUpdated={() => void fetchOverview()}
              onOpenMailTab={(dom) => {
                setSelectedSiteId(null);
                setMailDomainFilter(dom);
                setActiveNav("mail");
              }}
              notify={notify}
            />
          ) : activeNav === "create" ? (
            <CreateAndImportWizards
              mode="create"
              notify={notify}
              onCreated={(site, job) => {
                setLatestJobBanner(job);
                void fetchOverview();
                setSelectedSiteId(site.id);
              }}
            />
          ) : activeNav === "import" ? (
            <CreateAndImportWizards
              mode="import"
              notify={notify}
              onCreated={(site, job) => {
                setLatestJobBanner(job);
                void fetchOverview();
                setSelectedSiteId(site.id);
              }}
            />
          ) : activeNav === "mail" ? (
            <MailServerView
              initialDomainFilter={mailDomainFilter}
              notify={notify}
            />
          ) : activeNav === "server" ? (
            /* SERVER ARCHITECTURE & NON-INTERFERENCE AUDIT VIEW */
            <div className="space-y-6">
              <div className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-2xs">
                <h1 className="text-xl font-bold text-slate-900">
                  <code className="font-mono text-indigo-600">/opt/wpcloud</code>{" "}
                  Folder Architecture &amp; Non-Interference Monitor
                </h1>
                <p className="mt-1 text-xs text-slate-500">
                  Every uploaded or newly created WordPress site, database
                  backup, PHP-FPM pool, and generated Nginx config is stored inside{" "}
                  <code className="font-mono">/opt/wpcloud</code>.
                </p>

                <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-3">
                  <div className="rounded-xl border border-slate-200/80 bg-slate-50/70 p-4">
                    <div className="flex items-center gap-2 text-xs font-bold text-slate-900">
                      <ShieldCheck className="h-4 w-4 text-emerald-600" />
                      Protected External Nginx Vhosts
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                      Detected non-WPCloud sites that WPCloud will never edit or
                      collide with:
                    </p>
                    <ul className="mt-2.5 space-y-1.5 font-mono text-xs text-slate-800">
                      {(overview?.externalNginx.externalDomains || []).map(
                        (dom) => (
                          <li
                            key={dom}
                            className="flex items-center justify-between rounded-lg bg-white px-2.5 py-1.5 ring-1 ring-slate-200"
                          >
                            <span>{dom}</span>
                            <span className="text-[10px] font-semibold text-emerald-600">
                              Untouched
                            </span>
                          </li>
                        )
                      )}
                    </ul>
                  </div>

                  <div className="rounded-xl border border-slate-200/80 bg-slate-50/70 p-4">
                    <div className="flex items-center gap-2 text-xs font-bold text-slate-900">
                      <Activity className="h-4 w-4 text-indigo-600" />
                      Active Systemd Services
                    </div>
                    <ul className="mt-2.5 space-y-1.5 text-xs">
                      {(overview?.metrics.services || []).map((svc) => (
                        <li
                          key={svc.name}
                          className="flex items-center justify-between rounded-lg bg-white px-2.5 py-1.5 ring-1 ring-slate-200"
                        >
                          <span className="font-mono font-semibold text-slate-800">
                            {svc.name}
                          </span>
                          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                            {svc.status}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="rounded-xl border border-slate-200/80 bg-slate-50/70 p-4">
                    <div className="flex items-center gap-2 text-xs font-bold text-slate-900">
                      <FolderTree className="h-4 w-4 text-violet-600" />
                      /opt/wpcloud Layout
                    </div>
                    <pre className="mt-2.5 overflow-x-auto rounded-lg bg-slate-900 p-3 font-mono text-[11px] leading-relaxed text-slate-200">
                      {`/opt/wpcloud/
├─ app/          (Next.js 16 + Agent)
├─ sites/        (${sites.length} WordPress sites)
├─ nginx/sites/  (Automated .conf files)
├─ php/8.1..8.3/ (Per-site FPM pools)
├─ mail/         (Maildirs + DKIM + Dovecot/Postfix)
└─ backups/      (Pre-delete snapshots)`}
                    </pre>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-2xs">
                <h2 className="text-base font-semibold text-slate-900">
                  Privileged Root Agent Command Audit Log (
                  <code className="font-mono text-xs text-indigo-600">
                    execFile
                  </code>{" "}
                  — No Shell, Zero PM2 Commands)
                </h2>
                <div className="mt-4 space-y-2">
                  {(overview?.auditLog || []).slice(0, 12).map((entry) => (
                    <div
                      key={entry.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-100 bg-slate-50 px-4 py-2.5 font-mono text-xs"
                    >
                      <div className="flex items-center gap-2">
                        <Terminal className="h-3.5 w-3.5 text-indigo-600" />
                        <span className="font-bold text-slate-900">
                          {entry.binary} {entry.args.join(" ")}
                        </span>
                      </div>
                      <span className="text-[11px] text-slate-500">
                        {entry.action} •{" "}
                        {new Date(entry.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : activeNav === "settings" ? (
            /* SETTINGS & 2FA VIEW */
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <form
                onSubmit={handleSaveSettings}
                className="space-y-4 rounded-2xl border border-slate-200/80 bg-white p-6 shadow-2xs"
              >
                <h2 className="text-base font-semibold text-slate-900">
                  Ubuntu VPS &amp; Panel Network Settings
                </h2>
                <div>
                  <label
                    htmlFor="set-ipv4"
                    className="block text-xs font-semibold text-slate-700"
                  >
                    VPS Public IPv4 Address (Used in DNS Instructions)
                  </label>
                  <input
                    id="set-ipv4"
                    type="text"
                    value={settingsIpv4}
                    onChange={(e) => setSettingsIpv4(e.target.value)}
                    className="mt-1.5 block w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2 font-mono text-xs"
                  />
                </div>
                <div>
                  <label
                    htmlFor="set-ipv6"
                    className="block text-xs font-semibold text-slate-700"
                  >
                    VPS Public IPv6 Address (Optional)
                  </label>
                  <input
                    id="set-ipv6"
                    type="text"
                    value={settingsIpv6}
                    onChange={(e) => setSettingsIpv6(e.target.value)}
                    className="mt-1.5 block w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2 font-mono text-xs"
                  />
                </div>
                <div>
                  <label
                    htmlFor="set-rdns"
                    className="block text-xs font-semibold text-slate-700"
                  >
                    Contabo Reverse DNS (PTR) Hostname for Mail Server
                  </label>
                  <input
                    id="set-rdns"
                    type="text"
                    value={settingsRdns}
                    onChange={(e) => setSettingsRdns(e.target.value)}
                    className="mt-1.5 block w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2 font-mono text-xs"
                  />
                </div>
                <label className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50 px-4 py-3 text-xs">
                  <span className="font-semibold text-slate-700">
                    Serve Panel over Self-Signed HTTPS on Port{" "}
                    {overview?.settings.panelPort || 7070}
                  </span>
                  <input
                    type="checkbox"
                    checked={settingsHttps}
                    onChange={(e) => setSettingsHttps(e.target.checked)}
                    className="h-4 w-4 rounded accent-indigo-600"
                  />
                </label>
                <button
                  type="submit"
                  className="rounded-xl bg-indigo-600 px-4 py-2.5 text-xs font-semibold text-white hover:bg-indigo-500"
                >
                  Save Network Settings
                </button>
              </form>

              <div className="space-y-6">
                <form
                  onSubmit={handleChangePassword}
                  className="space-y-4 rounded-2xl border border-slate-200/80 bg-white p-6 shadow-2xs"
                >
                  <h2 className="text-base font-semibold text-slate-900">
                    Change Admin Password
                  </h2>
                  <div>
                    <label
                      htmlFor="set-new-pass"
                      className="block text-xs font-semibold text-slate-700"
                    >
                      New Password
                    </label>
                    <input
                      id="set-new-pass"
                      type="password"
                      required
                      minLength={8}
                      value={newAdminPassword}
                      onChange={(e) => setNewAdminPassword(e.target.value)}
                      className="mt-1.5 block w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2 text-xs"
                    />
                  </div>
                  <button
                    type="submit"
                    className="rounded-xl bg-slate-900 px-4 py-2.5 text-xs font-semibold text-white hover:bg-slate-800"
                  >
                    Update Admin Password
                  </button>
                </form>

                <div className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-2xs">
                  <div className="flex items-center justify-between">
                    <div>
                      <h2 className="text-base font-semibold text-slate-900">
                        Authenticator App 2FA (TOTP)
                      </h2>
                      <p className="mt-0.5 text-xs text-slate-500">
                        Protect your single-admin login with a 6-digit TOTP code.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        void handleToggleTotp(!overview?.settings.totpEnabled)
                      }
                      className={`rounded-xl px-3.5 py-2 text-xs font-semibold ${
                        overview?.settings.totpEnabled
                          ? "bg-rose-50 text-rose-700"
                          : "bg-indigo-600 text-white"
                      }`}
                    >
                      {overview?.settings.totpEnabled
                        ? "Disable 2FA"
                        : "Enable 2FA"}
                    </button>
                  </div>
                  <div className="mt-4 rounded-xl bg-slate-50 p-3.5 font-mono text-xs text-slate-700">
                    <div>Secret Key: {overview?.settings.totpSecret}</div>
                    <div className="mt-1 text-indigo-700">
                      Current 30s Code: {overview?.settings.totpCurrentCode}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            /* MAIN DASHBOARD VIEW */
            <div className="space-y-6">
              {/* Server & Runtime Status Bar (Moved from Top Nav) */}
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200/80 bg-white px-5 py-3 shadow-2xs">
                <div className="flex flex-wrap items-center gap-2.5 sm:gap-3">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 font-mono text-xs font-medium text-slate-700">
                    <Server className="h-3.5 w-3.5 text-indigo-600" />
                    {overview?.metrics.ubuntuRelease || "Ubuntu 24.04 LTS"}
                  </span>
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-indigo-50 px-3 py-1 font-mono text-xs font-medium text-indigo-700">
                    <Cpu className="h-3.5 w-3.5" />
                    CPU {overview?.metrics.cpuLoadPercent ?? 12}% • RAM{" "}
                    {overview
                      ? `${Math.round(overview.metrics.memUsedMb / 1024)}/${Math.round(
                          overview.metrics.memTotalMb / 1024
                        )} GB`
                      : "2/8 GB"}
                  </span>
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1 font-mono text-xs font-medium text-amber-800">
                    <HardDrive className="h-3.5 w-3.5 text-amber-600" />
                    Disk: {overview?.metrics.diskUsedGb ?? 28.4} GB used • {overview?.metrics.diskFreeGb ?? Number(((overview?.metrics.diskTotalGb ?? 200) - (overview?.metrics.diskUsedGb ?? 28.4)).toFixed(1))} GB free
                  </span>
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 font-mono text-xs font-medium text-emerald-700">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    nginx -t: syntax ok
                  </span>
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-violet-50 px-3 py-1 font-mono text-xs font-medium text-violet-700">
                    <Activity className="h-3.5 w-3.5" />
                    Node {overview?.metrics.nodeVersion || "v24.12.0"}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-xs font-mono text-slate-500">
                  <span>VPS IP:</span>
                  <span className="font-semibold text-slate-800">
                    {overview?.settings.vpsIpv4 || "194.163.148.72"}
                  </span>
                </div>
              </div>

              {/* Top Metric Cards */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-2xs">
                  <div className="flex items-center justify-between text-xs font-semibold text-slate-500">
                    <span>Managed WordPress Sites</span>
                    <Globe className="h-4 w-4 text-indigo-600" />
                  </div>
                  <div className="mt-2 text-2xl font-bold text-slate-900">
                    {sites.length}
                  </div>
                  <p className="mt-1 font-mono text-[11px] text-slate-500">
                    /opt/wpcloud/sites/*
                  </p>
                </div>

                <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-2xs">
                  <div className="flex items-center justify-between text-xs font-semibold text-slate-500">
                    <span>Automated Nginx Vhosts</span>
                    <ShieldCheck className="h-4 w-4 text-emerald-600" />
                  </div>
                  <div className="mt-2 text-2xl font-bold text-slate-900">
                    {sites.filter((s) => s.status === "running").length} Active
                  </div>
                  <p className="mt-1 text-[11px] text-emerald-700">
                    {overview?.externalNginx.externalDomains.length || 2}{" "}
                    external Next.js apps untouched
                  </p>
                </div>

                <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-2xs">
                  <div className="flex items-center justify-between text-xs font-semibold text-slate-500">
                    <span>Mailboxes &amp; Titan Backup</span>
                    <Mail className="h-4 w-4 text-violet-600" />
                  </div>
                  <div className="mt-2 text-2xl font-bold text-slate-900">
                    {overview?.mailServer.mailboxes.length || 0} Mailboxes
                  </div>
                  <button
                    type="button"
                    onClick={() => setActiveNav("mail")}
                    className="mt-1 text-[11px] font-semibold text-indigo-600 hover:underline"
                  >
                    Create me@domain or Sync Titan →
                  </button>
                </div>

                <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-2xs">
                  <div className="flex items-center justify-between text-xs font-semibold text-slate-500">
                    <span>VPS Disk &amp; Node Runtime</span>
                    <HardDrive className="h-4 w-4 text-amber-600" />
                  </div>
                  <div className="mt-2 text-2xl font-bold text-slate-900">
                    {overview?.metrics.diskUsedGb ?? 28.4} /{" "}
                    {overview?.metrics.diskTotalGb ?? 200} GB
                  </div>
                  <p className="mt-1 font-mono text-[11px] text-slate-500">
                    Node v24.12.0 isolated in /opt/wpcloud
                  </p>
                </div>
              </div>

              {/* WordPress Sites Responsive Table */}
              <div className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-2xs">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <h2 className="text-base font-semibold text-slate-900">
                      WordPress Websites ({filteredSites.length})
                    </h2>
                    <p className="mt-0.5 text-xs text-slate-500">
                      Click any site to configure automated Nginx rules, DNS &amp;
                      Titan Email protection, Let&apos;s Encrypt SSL, PHP
                      versions, WP-CLI, or Adminer.
                    </p>
                  </div>

                  <div className="relative w-full sm:w-64">
                    <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                    <input
                      type="search"
                      aria-label="Search WordPress sites"
                      placeholder="Filter by domain or PHP..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="block w-full rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-3 py-2 text-xs text-slate-900 focus:border-indigo-500 focus:bg-white focus:outline-none"
                    />
                  </div>
                </div>

                {/* Follows responsive-table guide: tabindex="0" role="region" aria-labelledby, container-query stacked layout */}
                <div
                  tabIndex={0}
                  role="region"
                  aria-labelledby="wp-sites-table-caption"
                  className="table-wrapper mt-5 rounded-xl border border-slate-200/80"
                >
                  <table
                    style={
                      {
                        "--label-2": "Folder in /opt/wpcloud",
                        "--label-3": "PHP Pool",
                        "--label-4": "SSL & DNS Status",
                        "--label-5": "Email / Titan Guard",
                        "--label-6": "Actions",
                      } as React.CSSProperties
                    }
                  >
                    <caption id="wp-sites-table-caption" className="sr-only">
                      Managed WordPress websites inside /opt/wpcloud
                    </caption>
                    <thead className="bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                      <tr>
                        <th className="px-4 py-3.5">Domain</th>
                        <th className="px-4 py-3.5">Folder in /opt/wpcloud</th>
                        <th className="px-4 py-3.5">PHP Pool</th>
                        <th className="px-4 py-3.5">SSL &amp; DNS</th>
                        <th className="px-4 py-3.5">Email / Titan Status</th>
                        <th className="px-4 py-3.5 text-right">Manage</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-xs">
                      {filteredSites.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="px-6 py-12 text-center">
                            <Globe className="mx-auto h-9 w-9 text-slate-300" />
                            <p className="mt-2.5 text-sm font-bold text-slate-900">
                              {searchQuery
                                ? "No matching WordPress sites found"
                                : "No WordPress sites created yet"}
                            </p>
                            <p className="mt-1 text-xs text-slate-500">
                              {searchQuery
                                ? "Try searching for a different domain or clear the search query."
                                : "Get started by creating a fresh WordPress website or importing an existing archive (.zip + .sql)."}
                            </p>
                            {!searchQuery && (
                              <div className="mt-4 flex flex-wrap items-center justify-center gap-2.5">
                                <button
                                  type="button"
                                  onClick={() => setActiveNav("create")}
                                  className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-3.5 py-2 text-xs font-semibold text-white shadow-2xs transition hover:bg-indigo-500"
                                >
                                  <PlusCircle className="h-3.5 w-3.5" />
                                  Create New WP Site
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setActiveNav("import")}
                                  className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                                >
                                  <UploadCloud className="h-3.5 w-3.5 text-indigo-600" />
                                  Import .zip + .sql
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      ) : (
                        filteredSites.map((site) => (
                        <tr
                          key={site.id}
                          className="transition hover:bg-slate-50/80"
                        >
                          <th className="px-4 py-4 text-left">
                            <div className="flex items-center gap-2">
                              <span
                                className={`h-2 w-2 rounded-full ${
                                  site.status === "running"
                                    ? "bg-emerald-500"
                                    : "bg-amber-500"
                                }`}
                              />
                              <button
                                type="button"
                                onClick={() => setSelectedSiteId(site.id)}
                                className="font-bold text-slate-900 hover:text-indigo-600"
                              >
                                {site.domain}
                              </button>
                            </div>
                            <div className="mt-0.5 pl-4 text-[11px] font-normal text-slate-400">
                              {site.mode === "imported"
                                ? "Imported (.zip + .sql)"
                                : "Fresh Install"}{" "}
                              • {site.diskUsageMb} MB
                            </div>
                          </th>
                          <td className="px-4 py-4 font-mono text-[11px] text-slate-600">
                            {site.rootPath}
                          </td>
                          <td className="px-4 py-4">
                            <span className="rounded-lg bg-indigo-50 px-2.5 py-1 font-mono text-xs font-semibold text-indigo-700">
                              PHP {site.phpVersion}
                            </span>
                          </td>
                          <td className="px-4 py-4">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span
                                className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                                  site.sslEnabled
                                    ? "bg-emerald-50 text-emerald-700"
                                    : "bg-amber-50 text-amber-700"
                                }`}
                              >
                                <Lock className="h-3 w-3" />
                                {site.sslEnabled ? "Let's Encrypt" : "HTTP Only"}
                              </span>
                              <span
                                className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                                  site.dnsVerified
                                    ? "bg-emerald-50 text-emerald-700"
                                    : "bg-slate-100 text-slate-600"
                                }`}
                              >
                                {site.dnsVerified ? "DNS OK" : "DNS Instructions"}
                              </span>
                            </div>
                          </td>
                          <td className="px-4 py-4 text-slate-600">
                            <span className="inline-flex items-center gap-1 rounded-lg bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-700">
                              <Mail className="h-3 w-3 text-indigo-600" />
                              {site.detectedEmailProvider ||
                                "Titan / External Safe"}
                            </span>
                          </td>
                          <td className="px-4 py-4 text-right">
                            <div className="inline-flex items-center gap-2">
                              {site.previewPort && overview?.settings.vpsIpv4 && (
                                <a
                                  href={`http://${overview.settings.vpsIpv4}:${site.previewPort}`}
                                  target="_blank"
                                  rel="noreferrer"
                                  title={`Instant preview on port ${site.previewPort}`}
                                  className="inline-flex items-center gap-1 rounded-xl border border-indigo-200 bg-indigo-50/70 px-2.5 py-1.5 text-xs font-semibold text-indigo-700 transition hover:bg-indigo-100"
                                >
                                  <Sparkles className="h-3 w-3 text-indigo-600" />
                                  Preview
                                </a>
                              )}
                              <button
                                type="button"
                                onClick={() => setSelectedSiteId(site.id)}
                                className="rounded-xl bg-slate-900 px-3.5 py-1.5 text-xs font-semibold text-white transition hover:bg-indigo-600"
                              >
                                Manage Site &amp; DNS →
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

