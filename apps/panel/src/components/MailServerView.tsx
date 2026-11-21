"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowRightLeft,
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
  Globe,
  Inbox,
  KeyRound,
  Mail,
  Plus,
  RefreshCw,
  Send,
  Server,
  ShieldCheck,
  Wrench,
} from "lucide-react";
import type {
  DnsRecordInstruction,
  MailboxRecord,
  MailServerState,
} from "@wpcloud/shared";
import { NativeModalDialog } from "./NativeModalDialog";

interface MailServerViewProps {
  initialDomainFilter?: string;
  notify: (msg: string, tone?: "success" | "error") => void;
}

export function MailServerView({
  initialDomainFilter,
  notify,
}: MailServerViewProps) {
  const [mailServer, setMailServer] = useState<MailServerState | null>(null);
  const [vpsIpv4, setVpsIpv4] = useState("194.163.148.72");
  const [domainDnsMap, setDomainDnsMap] = useState<
    Record<string, DnsRecordInstruction[]>
  >({});
  const [selectedDomainId, setSelectedDomainId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Add domain modal
  const [addDomainOpen, setAddDomainOpen] = useState(false);
  const [newDomainInput, setNewDomainInput] = useState("");

  // Create mailbox modal
  const [createMailboxOpen, setCreateMailboxOpen] = useState(false);
  const [mbDomainId, setMbDomainId] = useState("");
  const [mbLocalPart, setMbLocalPart] = useState("me");
  const [mbDisplayName, setMbDisplayName] = useState("");
  const [mbPassword, setMbPassword] = useState("");
  const [mbQuotaMb, setMbQuotaMb] = useState(5120);

  // Titan Mail / IMAP backup modal
  const [titanSyncOpen, setTitanSyncOpen] = useState(false);
  const [sourceHost, setSourceHost] = useState("imap.titan.email");
  const [sourceEmail, setSourceEmail] = useState("");
  const [sourcePassword, setSourcePassword] = useState("");
  const [targetEmail, setTargetEmail] = useState("");

  // Relay settings state
  const [deliveryMode, setDeliveryMode] = useState<"direct" | "relay">("direct");
  const [relayProvider, setRelayProvider] = useState<
    "brevo" | "ses" | "mailgun" | "custom"
  >("brevo");
  const [relayHost, setRelayHost] = useState("smtp-relay.brevo.com");
  const [relayPort, setRelayPort] = useState(587);
  const [relayUser, setRelayUser] = useState("");
  const [relayPass, setRelayPass] = useState("");

  // Client setup modal (Gmail / Outlook / Apple Mail)
  const [clientSetupMailbox, setClientSetupMailbox] =
    useState<MailboxRecord | null>(null);
  const [clientSetupTab, setClientSetupTab] = useState<"imap" | "gmail_web">("imap");

  const loadMailData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/mail");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load mail state");
      setMailServer(data.mailServer);
      setVpsIpv4(data.vpsIpv4);
      setDomainDnsMap(data.domainDnsMap || {});
      setDeliveryMode(data.mailServer.deliveryMode);
      setRelayProvider(data.mailServer.relayConfig.provider);
      setRelayHost(data.mailServer.relayConfig.host);
      setRelayPort(data.mailServer.relayConfig.port);
      setRelayUser(data.mailServer.relayConfig.username);
      setRelayPass(data.mailServer.relayConfig.password);

      const domains = data.mailServer.domains || [];
      if (initialDomainFilter) {
        const match = domains.find(
          (d: { domain: string }) => d.domain === initialDomainFilter
        );
        if (match) {
          setSelectedDomainId(match.id);
          setMbDomainId(match.id);
        } else if (domains[0]) {
          setSelectedDomainId(domains[0].id);
          setMbDomainId(domains[0].id);
        }
      } else if (domains[0] && !selectedDomainId) {
        setSelectedDomainId(domains[0].id);
        setMbDomainId(domains[0].id);
      }

      if (data.mailServer.mailboxes?.[0] && !targetEmail) {
        setTargetEmail(data.mailServer.mailboxes[0].email);
        setSourceEmail(data.mailServer.mailboxes[0].email);
      }
    } catch (err: unknown) {
      notify(err instanceof Error ? err.message : "Failed to load mail", "error");
    } finally {
      setLoading(false);
    }
  }, [initialDomainFilter, notify, selectedDomainId, targetEmail]);

  useEffect(() => {
    void loadMailData();
  }, [loadMailData]);

  // Poll live sync progress while a Titan IMAP backup job is running
  const hasRunningSync = Boolean(
    mailServer?.syncJobs?.some((j) => j.status === "running")
  );
  useEffect(() => {
    if (!hasRunningSync) return;
    const timer = setInterval(async () => {
      try {
        const res = await fetch("/api/mail");
        if (!res.ok) return;
        const data = await res.json();
        setMailServer(data.mailServer);
      } catch {
        // ignore transient poll error
      }
    }, 2000);
    return () => clearInterval(timer);
  }, [hasRunningSync]);

  function copyText(key: string, val: string) {
    void navigator.clipboard.writeText(val);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1800);
  }

  async function handleAddDomain(e: React.FormEvent) {
    e.preventDefault();
    setBusy("add_domain");
    try {
      const res = await fetch("/api/mail", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "add_domain", domain: newDomainInput }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not add domain");
      setAddDomainOpen(false);
      setNewDomainInput("");
      await loadMailData();
      setSelectedDomainId(data.domain.id);
      notify(`Attached mail domain ${data.domain.domain} & generated 2048-bit DKIM key!`);
    } catch (err: unknown) {
      notify(err instanceof Error ? err.message : "Failed", "error");
    } finally {
      setBusy(null);
    }
  }

  async function handleCreateMailbox(e: React.FormEvent) {
    e.preventDefault();
    setBusy("create_mailbox");
    try {
      const res = await fetch("/api/mail", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create_mailbox",
          domainId: mbDomainId,
          localPart: mbLocalPart,
          displayName: mbDisplayName,
          password: mbPassword,
          quotaMb: mbQuotaMb,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not create mailbox");
      setCreateMailboxOpen(false);
      setMbLocalPart("me");
      setMbDisplayName("");
      setMbPassword("");
      await loadMailData();
      notify(`Created mailbox ${data.mailbox.email}!`);
    } catch (err: unknown) {
      notify(err instanceof Error ? err.message : "Failed", "error");
    } finally {
      setBusy(null);
    }
  }

  async function handleTitanSync(e: React.FormEvent) {
    e.preventDefault();
    setBusy("titan_sync");
    try {
      const res = await fetch("/api/mail", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "titan_imapsync",
          sourceHost,
          sourceEmail,
          sourcePassword,
          targetEmail,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "IMAP sync failed");
      setTitanSyncOpen(false);
      setSourcePassword("");
      await loadMailData();
      notify(
        data.syncJob.status === "running"
          ? `Connected to ${sourceHost}! Backing up ${sourceEmail} into ${targetEmail} in the background...`
          : `Backed up ${data.syncJob.messagesCopied.toLocaleString()} emails from ${sourceHost} (${sourceEmail}) into ${targetEmail}!`
      );
    } catch (err: unknown) {
      notify(err instanceof Error ? err.message : "Sync failed", "error");
    } finally {
      setBusy(null);
    }
  }

  async function handleSetupMailStack() {
    setBusy("setup_mail");
    try {
      const res = await fetch("/api/mail", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "setup_mail_stack" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to set up mail stack");
      setMailServer(data.mailServer);
      notify("Postfix (SMTP 25/465/587), Dovecot (IMAP 993 / POP3 995), and OpenDKIM are active!");
    } catch (err: unknown) {
      notify(err instanceof Error ? err.message : "Mail server setup failed", "error");
    } finally {
      setBusy(null);
    }
  }

  async function handleIssueMailSsl(domainId: string) {
    setBusy(`ssl_${domainId}`);
    try {
      const res = await fetch("/api/mail", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "issue_mail_ssl", domainId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to issue mail SSL");
      setMailServer(data.mailServer);
      notify(`Issued Let's Encrypt SSL for ${data.domain.mailHostname} & wired into Dovecot/Postfix!`);
    } catch (err: unknown) {
      notify(err instanceof Error ? err.message : "Mail SSL issuance failed", "error");
    } finally {
      setBusy(null);
    }
  }

  async function handleSaveDeliveryMode(e: React.FormEvent) {
    e.preventDefault();
    setBusy("delivery");
    try {
      const res = await fetch("/api/mail", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update_delivery_mode",
          deliveryMode,
          relayConfig: {
            provider: relayProvider,
            host: relayHost,
            port: relayPort,
            username: relayUser,
            password: relayPass,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to update delivery mode");
      setMailServer(data.mailServer);
      notify(
        deliveryMode === "direct"
          ? "Outgoing mail set to Direct Delivery (Port 25 on Contabo VPS)."
          : `Outgoing mail routed through ${relayProvider.toUpperCase()} SMTP Relay (${relayHost}).`
      );
    } catch (err: unknown) {
      notify(err instanceof Error ? err.message : "Failed", "error");
    } finally {
      setBusy(null);
    }
  }

  if (loading || !mailServer) {
    return (
      <div className="rounded-2xl border border-slate-200/80 bg-white p-8 shadow-2xs">
        <div className="flex items-center gap-3 text-sm text-slate-500">
          <RefreshCw className="h-4 w-4 animate-spin text-indigo-600" />
          Loading Mail Server &amp; Titan IMAP Backup module...
        </div>
      </div>
    );
  }

  const activeDomain =
    mailServer.domains.find((d) => d.id === selectedDomainId) ||
    mailServer.domains[0];
  const activeDnsRecords = activeDomain
    ? domainDnsMap[activeDomain.id] || []
    : [];

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-200/80 bg-white p-6 shadow-2xs">
        <div>
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-xl font-bold tracking-tight text-slate-900">
              Multi-Domain Mail Server &amp; Titan Mail Backup
            </h1>
            {mailServer.installed ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-600/20">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                Postfix SMTP + Dovecot IMAP Active
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-800 ring-1 ring-amber-600/20">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                Maildir Backup &amp; Webmail Ready (External IMAP/SMTP Not Installed)
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-slate-500">
            Create client mailboxes like{" "}
            <code className="font-mono text-indigo-600">me@example.com</code>,
            back up existing emails from <strong>Titan Mail (Hostinger)</strong> over IMAP (
            <code className="font-mono">imap.titan.email</code>), and read them in{" "}
            <Link href="/mail" className="font-semibold text-indigo-600 hover:underline">
              WPCloud Webmail
            </Link>
            .
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <Link
            href="/mail"
            target="_blank"
            className="inline-flex items-center gap-1.5 rounded-xl border border-indigo-200 bg-indigo-50 px-3.5 py-2 text-xs font-semibold text-indigo-700 hover:bg-indigo-100"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Open Webmail (/mail)
          </Link>
          {!mailServer.installed && (
            <button
              type="button"
              disabled={busy === "setup_mail"}
              onClick={() => void handleSetupMailStack()}
              className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-300 bg-emerald-50 px-3.5 py-2 text-xs font-semibold text-emerald-800 hover:bg-emerald-100"
            >
              <Wrench className="h-3.5 w-3.5" />
              {busy === "setup_mail"
                ? "Installing Dovecot + Postfix..."
                : "Setup IMAP/SMTP Server"}
            </button>
          )}
          <button
            type="button"
            onClick={() => setAddDomainOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            <Globe className="h-3.5 w-3.5 text-indigo-600" />
            Attach Mail Domain
          </button>
          <button
            type="button"
            onClick={() => setTitanSyncOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-xl border border-amber-300 bg-amber-50 px-3.5 py-2 text-xs font-semibold text-amber-900 hover:bg-amber-100"
          >
            <ArrowRightLeft className="h-3.5 w-3.5 text-amber-700" />
            Backup / Sync from Titan Mail
          </button>
          <button
            type="button"
            onClick={() => setCreateMailboxOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-4 py-2 text-xs font-semibold text-white shadow-2xs hover:from-indigo-500 hover:to-violet-500"
          >
            <Plus className="h-3.5 w-3.5" />
            Create Mailbox (me@domain)
          </button>
        </div>
      </div>

      {/* Mailboxes Table + Titan Sync History */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-2xs lg:col-span-8">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                Hosted Client Mailboxes ({mailServer.mailboxes.length})
              </h2>
              <p className="mt-0.5 text-xs text-slate-500">
                Clients can sign in via Webmail or any mail app using IMAP (993
                SSL) &amp; SMTP (587 STARTTLS) on{" "}
                <code className="font-mono">mail.&lt;domain&gt;</code>.
              </p>
            </div>
          </div>

          <div
            tabIndex={0}
            role="region"
            aria-labelledby="mailboxes-table-caption"
            className="table-wrapper mt-4 rounded-xl border border-slate-200/80"
          >
            <table
              style={
                {
                  "--label-2": "Domain",
                  "--label-3": "Storage Quota",
                  "--label-4": "Titan / IMAP Backup Status",
                  "--label-5": "Actions",
                } as React.CSSProperties
              }
            >
              <caption id="mailboxes-table-caption" className="sr-only">
                Hosted client mailboxes across all domains
              </caption>
              <thead className="bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-4 py-3">Email Address</th>
                  <th className="px-4 py-3">Domain</th>
                  <th className="px-4 py-3">Quota Usage</th>
                  <th className="px-4 py-3">Titan / IMAP Backup Status</th>
                  <th className="px-4 py-3 text-right">Quick Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {mailServer.mailboxes.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-10 text-center">
                      <Mail className="mx-auto h-8 w-8 text-slate-300" />
                      <p className="mt-2 text-xs font-bold text-slate-800">
                        No client mailboxes created yet
                      </p>
                      <p className="mt-0.5 text-[11px] text-slate-500">
                        Click &ldquo;Create Mailbox (me@domain)&rdquo; above to set up your first email address.
                      </p>
                    </td>
                  </tr>
                ) : (
                  mailServer.mailboxes.map((mb) => (
                    <tr key={mb.id}>
                      <th className="px-4 py-3.5 text-left font-mono font-semibold text-slate-900">
                        <div>{mb.email}</div>
                        <div className="font-sans text-[11px] font-normal text-slate-500">
                          {mb.displayName}
                        </div>
                      </th>
                      <td className="px-4 py-3.5 font-mono text-slate-700">
                        {mb.domain}
                      </td>
                      <td className="px-4 py-3.5 text-slate-700">
                        <span className="font-semibold">{mb.usedMb} MB</span> /{" "}
                        {mb.quotaMb} MB
                      </td>
                      <td className="px-4 py-3.5">
                        {mb.lastSyncedFrom ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-medium text-emerald-700">
                            <CheckCircle2 className="h-3 w-3" />{" "}
                            {mb.lastSyncedFrom}
                          </span>
                        ) : (
                          <span className="text-slate-400">
                            Fresh mailbox (no IMAP import run yet)
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3.5 text-right">
                        <div className="inline-flex flex-wrap justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => {
                              setClientSetupMailbox(mb);
                              setClientSetupTab("imap");
                            }}
                            className="inline-flex items-center gap-1 rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-[11px] font-semibold text-indigo-700 hover:bg-indigo-100"
                          >
                            <KeyRound className="h-3 w-3" />
                            Gmail / App Setup
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setTargetEmail(mb.email);
                              setSourceEmail(mb.email);
                              setTitanSyncOpen(true);
                            }}
                            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
                          >
                            <ArrowRightLeft className="h-3 w-3 text-indigo-600" />
                            Pull from Titan
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

        {/* Outgoing Delivery Mode (Contabo Port 25 vs SMTP Relay) */}
        <form
          onSubmit={handleSaveDeliveryMode}
          className="space-y-4 rounded-2xl border border-slate-200/80 bg-white p-6 shadow-2xs lg:col-span-4"
        >
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-900">
              Contabo Outbound Mail Delivery
            </h3>
            <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700">
              Port 25 Open
            </span>
          </div>
          <p className="text-xs text-slate-500">
            Send directly from your Contabo VPS on Port 25 (with PTR rDNS{" "}
            <code className="font-mono">{mailServer.ptrRecordHost}</code>), or
            switch to an SMTP relay if a client&apos;s emails land in Gmail/Outlook
            spam.
          </p>

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setDeliveryMode("direct")}
              className={`rounded-xl border px-3 py-2.5 text-xs font-semibold transition ${
                deliveryMode === "direct"
                  ? "border-indigo-600 bg-indigo-50 text-indigo-700"
                  : "border-slate-200 bg-white text-slate-700"
              }`}
            >
              Direct (Port 25)
            </button>
            <button
              type="button"
              onClick={() => setDeliveryMode("relay")}
              className={`rounded-xl border px-3 py-2.5 text-xs font-semibold transition ${
                deliveryMode === "relay"
                  ? "border-indigo-600 bg-indigo-50 text-indigo-700"
                  : "border-slate-200 bg-white text-slate-700"
              }`}
            >
              SMTP Relay Fallback
            </button>
          </div>

          {deliveryMode === "relay" && (
            <div className="space-y-3 rounded-xl border border-slate-100 bg-slate-50 p-3.5">
              <div>
                <label className="block text-[11px] font-semibold text-slate-600">
                  Relay Provider
                </label>
                <select
                  value={relayProvider}
                  onChange={(e) => {
                    const p = e.target.value as typeof relayProvider;
                    setRelayProvider(p);
                    if (p === "brevo") setRelayHost("smtp-relay.brevo.com");
                    if (p === "ses")
                      setRelayHost("email-smtp.eu-central-1.amazonaws.com");
                    if (p === "mailgun") setRelayHost("smtp.mailgun.org");
                  }}
                  className="mt-1 block w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs"
                >
                  <option value="brevo">Brevo (300/day free tier)</option>
                  <option value="ses">Amazon SES</option>
                  <option value="mailgun">Mailgun</option>
                  <option value="custom">Custom SMTP Relay</option>
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-600">
                  Relay Host &amp; Port
                </label>
                <div className="mt-1 flex gap-2">
                  <input
                    type="text"
                    value={relayHost}
                    onChange={(e) => setRelayHost(e.target.value)}
                    className="block w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-mono text-xs"
                  />
                  <input
                    type="number"
                    value={relayPort}
                    onChange={(e) => setRelayPort(Number(e.target.value) || 587)}
                    className="block w-20 rounded-lg border border-slate-200 bg-white px-2 py-1.5 font-mono text-xs"
                  />
                </div>
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-600">
                  Relay Username / API Key
                </label>
                <input
                  type="text"
                  value={relayUser}
                  onChange={(e) => setRelayUser(e.target.value)}
                  className="mt-1 block w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-mono text-xs"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-600">
                  Relay SMTP Password / Secret
                </label>
                <input
                  type="password"
                  value={relayPass}
                  onChange={(e) => setRelayPass(e.target.value)}
                  placeholder="SMTP key or password"
                  className="mt-1 block w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-mono text-xs"
                />
              </div>
            </div>
          )}

          <button
            type="submit"
            disabled={busy === "delivery"}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-xs font-semibold text-white hover:bg-slate-800"
          >
            <Send className="h-3.5 w-3.5" />
            Save Outgoing Delivery Mode
          </button>
        </form>
      </div>

      {/* Titan Mail IMAP Backup Jobs Log */}
      {mailServer.syncJobs.length > 0 && (
        <div className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-2xs">
          <h2 className="text-base font-semibold text-slate-900">
            Titan Mail / IMAP Backup Jobs ({mailServer.syncJobs.length})
          </h2>
          <div className="mt-3 space-y-2">
            {mailServer.syncJobs.slice(0, 8).map((job) => (
              <div
                key={job.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-100 bg-slate-50 px-4 py-2.5 text-xs"
              >
                <div className="flex items-center gap-2.5">
                  {job.status === "running" ? (
                    <RefreshCw className="h-4 w-4 animate-spin text-indigo-600" />
                  ) : job.status === "completed" ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  ) : (
                    <Server className="h-4 w-4 text-rose-600" />
                  )}
                  <div>
                    <span className="font-mono font-semibold text-slate-900">
                      {job.sourceEmail}
                    </span>{" "}
                    <span className="text-slate-500">({job.sourceHost})</span> →{" "}
                    <span className="font-mono font-semibold text-indigo-700">
                      {job.targetEmail}
                    </span>
                    {job.error && (
                      <div className="mt-0.5 text-[11px] font-medium text-rose-700">
                        {job.error}
                      </div>
                    )}
                  </div>
                </div>
                <div className="font-mono text-[11px] text-slate-600">
                  {job.status === "running" ? (
                    <span>
                      Syncing {job.currentFolder || "INBOX"} • {job.messagesCopied.toLocaleString()}
                      {job.totalMessages ? ` / ${job.totalMessages.toLocaleString()}` : ""} copied
                    </span>
                  ) : job.status === "completed" ? (
                    <span>
                      {job.messagesCopied.toLocaleString()} copied
                      {job.skippedExisting ? ` • ${job.skippedExisting.toLocaleString()} skipped` : ""}
                      {job.foldersSynced ? ` • ${job.foldersSynced} folders` : ""}
                    </span>
                  ) : (
                    <span className="font-semibold text-rose-700">Failed</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Per-Domain Mail DNS Records (MX, SPF, DKIM 2048-bit, DMARC, Contabo PTR) */}
      <div className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-2xs">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              Mail DNS Records (MX, SPF, 2048-bit DKIM, DMARC &amp; Contabo rDNS)
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Only add these records if you want <strong>this VPS</strong> to
              receive email for the domain instead of Titan Mail.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {activeDomain && (
              activeDomain.sslEnabled ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-3 py-1 text-[11px] font-semibold text-emerald-700">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  SSL Active ({activeDomain.mailHostname})
                </span>
              ) : (
                <button
                  type="button"
                  disabled={busy === `ssl_${activeDomain.id}`}
                  onClick={() => void handleIssueMailSsl(activeDomain.id)}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-800 hover:bg-emerald-100"
                >
                  <ShieldCheck className="h-3.5 w-3.5" />
                  {busy === `ssl_${activeDomain.id}`
                    ? "Issuing SSL..."
                    : `Issue SSL (${activeDomain.mailHostname})`}
                </button>
              )
            )}
            {mailServer.domains.map((d) => (
              <button
                key={d.id}
                type="button"
                onClick={() => setSelectedDomainId(d.id)}
                className={`rounded-xl px-3.5 py-2 text-xs font-semibold transition ${
                  activeDomain?.id === d.id
                    ? "bg-indigo-600 text-white"
                    : "border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100"
                }`}
              >
                {d.domain}
              </button>
            ))}
          </div>
        </div>

        <div
          tabIndex={0}
          role="region"
          aria-labelledby="mail-dns-caption"
          className="table-wrapper mt-4 rounded-xl border border-slate-200/80"
        >
          <table
            style={
              {
                "--label-2": "Name",
                "--label-3": "Value",
                "--label-4": "Purpose",
                "--label-5": "Copy",
              } as React.CSSProperties
            }
          >
            <caption id="mail-dns-caption" className="sr-only">
              Mail DNS records for {activeDomain?.domain}
            </caption>
            <thead className="bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Name / Host</th>
                <th className="px-4 py-3">Value</th>
                <th className="px-4 py-3">Purpose</th>
                <th className="px-4 py-3 text-right">Copy</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {activeDnsRecords.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-10 text-center">
                    <Globe className="mx-auto h-8 w-8 text-slate-300" />
                    <p className="mt-2 text-xs font-bold text-slate-800">
                      No mail domains attached yet
                    </p>
                    <p className="mt-0.5 text-[11px] text-slate-500">
                      Click &ldquo;Attach Mail Domain&rdquo; above to generate MX, SPF, and 2048-bit DKIM records.
                    </p>
                  </td>
                </tr>
              ) : (
                activeDnsRecords.map((rec, i) => (
                  <tr key={`${rec.type}-${rec.name}-${i}`}>
                    <th className="px-4 py-3 font-mono font-bold text-indigo-700">
                      {rec.type}
                    </th>
                    <td className="px-4 py-3 font-mono font-semibold text-slate-900">
                      {rec.name}
                    </td>
                    <td className="max-w-md break-all px-4 py-3 font-mono text-[11px] text-slate-800">
                      {rec.value}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{rec.purpose}</td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => copyText(`mdns_${i}`, rec.value)}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
                      >
                        {copiedKey === `mdns_${i}` ? (
                          <>
                            <Check className="h-3 w-3 text-emerald-600" /> Copied
                          </>
                        ) : (
                          <>
                            <Copy className="h-3 w-3" /> Copy
                          </>
                        )}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal 1: Attach Mail Domain */}
      <NativeModalDialog
        open={addDomainOpen}
        onClose={() => setAddDomainOpen(false)}
        title="Attach Domain to Mail Server"
        subtitle="Generates a dedicated 2048-bit DKIM signing key and mail.<domain> configuration."
      >
        <form onSubmit={handleAddDomain} className="space-y-4">
          <div>
            <label
              htmlFor="mail-new-domain"
              className="block text-xs font-semibold text-slate-700"
            >
              Domain Name
            </label>
            <input
              id="mail-new-domain"
              type="text"
              required
              placeholder="example.com"
              value={newDomainInput}
              onChange={(e) => setNewDomainInput(e.target.value)}
              className="mt-1.5 block w-full rounded-xl border border-slate-200 px-3.5 py-2 font-mono text-xs"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setAddDomainOpen(false)}
              className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy === "add_domain"}
              className="rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-500"
            >
              {busy === "add_domain" ? "Adding..." : "Attach Domain"}
            </button>
          </div>
        </form>
      </NativeModalDialog>

      {/* Modal 2: Create Mailbox (me@example.com) */}
      <NativeModalDialog
        open={createMailboxOpen}
        onClose={() => setCreateMailboxOpen(false)}
        title="Create Client Mailbox (e.g. me@example.com)"
        subtitle="Set the email address, password, and storage quota that your client will use."
      >
        <form onSubmit={handleCreateMailbox} className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label
                htmlFor="mb-local"
                className="block text-xs font-semibold text-slate-700"
              >
                Mailbox Username
              </label>
              <input
                id="mb-local"
                type="text"
                required
                placeholder="me"
                value={mbLocalPart}
                onChange={(e) => setMbLocalPart(e.target.value)}
                className="mt-1.5 block w-full rounded-xl border border-slate-200 px-3.5 py-2 font-mono text-xs"
              />
            </div>
            <div>
              <label
                htmlFor="mb-domain"
                className="block text-xs font-semibold text-slate-700"
              >
                @ Domain
              </label>
              <select
                id="mb-domain"
                value={mbDomainId}
                onChange={(e) => setMbDomainId(e.target.value)}
                className="mt-1.5 block w-full rounded-xl border border-slate-200 bg-white px-3 py-2 font-mono text-xs"
              >
                {mailServer.domains.length === 0 ? (
                  <option value="">-- No domains attached yet (Attach one first) --</option>
                ) : (
                  mailServer.domains.map((d) => (
                    <option key={d.id} value={d.id}>
                      @{d.domain}
                    </option>
                  ))
                )}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label
                htmlFor="mb-display"
                className="block text-xs font-semibold text-slate-700"
              >
                Display Name
              </label>
              <input
                id="mb-display"
                type="text"
                placeholder="Client Name"
                value={mbDisplayName}
                onChange={(e) => setMbDisplayName(e.target.value)}
                className="mt-1.5 block w-full rounded-xl border border-slate-200 px-3.5 py-2 text-xs"
              />
            </div>
            <div>
              <label
                htmlFor="mb-quota"
                className="block text-xs font-semibold text-slate-700"
              >
                Quota (MB)
              </label>
              <input
                id="mb-quota"
                type="number"
                value={mbQuotaMb}
                onChange={(e) => setMbQuotaMb(Number(e.target.value) || 5120)}
                className="mt-1.5 block w-full rounded-xl border border-slate-200 px-3.5 py-2 text-xs"
              />
            </div>
          </div>

          <div>
            <label
              htmlFor="mb-pass"
              className="block text-xs font-semibold text-slate-700"
            >
              Mailbox Password for Client
            </label>
            <input
              id="mb-pass"
              type="text"
              required
              placeholder="Strong password for IMAP/SMTP & Webmail"
              value={mbPassword}
              onChange={(e) => setMbPassword(e.target.value)}
              className="mt-1.5 block w-full rounded-xl border border-slate-200 px-3.5 py-2 font-mono text-xs"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setCreateMailboxOpen(false)}
              className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy === "create_mailbox"}
              className="rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-500"
            >
              {busy === "create_mailbox"
                ? "Creating Mailbox..."
                : "Create Mailbox"}
            </button>
          </div>
        </form>
      </NativeModalDialog>

      {/* Modal 3: One-Click Titan Mail / External IMAP Sync */}
      <NativeModalDialog
        open={titanSyncOpen}
        onClose={() => setTitanSyncOpen(false)}
        title="Backup & Copy Emails from Titan Mail (IMAP SSL)"
        subtitle="Connects to imap.titan.email (port 993 SSL) and copies all folders, attachments, and read states into your WPCloud Maildir mailbox."
      >
        <form onSubmit={handleTitanSync} className="space-y-4">
          <div>
            <label
              htmlFor="sync-host"
              className="block text-xs font-semibold text-slate-700"
            >
              Source IMAP Server (Titan Mail Default)
            </label>
            <input
              id="sync-host"
              type="text"
              required
              value={sourceHost}
              onChange={(e) => setSourceHost(e.target.value)}
              className="mt-1.5 block w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2 font-mono text-xs"
            />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label
                htmlFor="sync-src-email"
                className="block text-xs font-semibold text-slate-700"
              >
                Titan Email Address
              </label>
              <input
                id="sync-src-email"
                type="email"
                required
                placeholder="me@example.com"
                value={sourceEmail}
                onChange={(e) => setSourceEmail(e.target.value)}
                className="mt-1.5 block w-full rounded-xl border border-slate-200 px-3.5 py-2 font-mono text-xs"
              />
            </div>
            <div>
              <label
                htmlFor="sync-src-pass"
                className="block text-xs font-semibold text-slate-700"
              >
                Titan Email Password
              </label>
              <input
                id="sync-src-pass"
                type="password"
                required
                placeholder="Titan mailbox password"
                value={sourcePassword}
                onChange={(e) => setSourcePassword(e.target.value)}
                className="mt-1.5 block w-full rounded-xl border border-slate-200 px-3.5 py-2 font-mono text-xs"
              />
            </div>
          </div>

          <div>
            <label
              htmlFor="sync-target"
              className="block text-xs font-semibold text-slate-700"
            >
              Target WPCloud Mailbox (Destination for Backup)
            </label>
            <select
              id="sync-target"
              value={targetEmail}
              onChange={(e) => setTargetEmail(e.target.value)}
              className="mt-1.5 block w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2 font-mono text-xs"
            >
              {mailServer.mailboxes.length === 0 ? (
                <option value="">-- No local mailbox created yet (Create one first) --</option>
              ) : (
                mailServer.mailboxes.map((mb) => (
                  <option key={mb.id} value={mb.email}>
                    {mb.email} ({mb.displayName})
                  </option>
                ))
              )}
            </select>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setTitanSyncOpen(false)}
              className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy === "titan_sync"}
              className="rounded-xl bg-amber-600 px-4 py-2 text-xs font-semibold text-white hover:bg-amber-500"
            >
              {busy === "titan_sync"
                ? "Connecting to Titan IMAP..."
                : "Start Titan Mail Backup"}
            </button>
          </div>
        </form>
      </NativeModalDialog>

      {/* Modal 4: Connect Gmail, Outlook, Apple Mail, Thunderbird (IMAP / POP3 / SMTP) */}
      <NativeModalDialog
        open={Boolean(clientSetupMailbox)}
        onClose={() => setClientSetupMailbox(null)}
        title={`Connect ${clientSetupMailbox?.email || "Mailbox"} to Gmail or Mail Apps`}
        subtitle="Use these settings in Gmail, Apple Mail, Outlook, Thunderbird, iPhone, or Android."
        maxWidthClass="max-w-2xl"
      >
        {clientSetupMailbox && (() => {
          const dom = mailServer.domains.find(
            (d) => d.id === clientSetupMailbox.domainId
          );
          const mailHost = dom?.mailHostname || `mail.${clientSetupMailbox.domain}`;
          const hasSsl = Boolean(dom?.sslEnabled);

          return (
            <div className="space-y-4 text-xs">
              {/* Server & SSL Readiness Checklist */}
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 space-y-2">
                <div className="font-semibold text-slate-800">
                  Server Readiness for Gmail &amp; External Mail Apps
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-slate-600">
                    1. Mail Server (Dovecot IMAP/POP3 + Postfix SMTP):{" "}
                    <strong className={mailServer.installed ? "text-emerald-700" : "text-amber-700"}>
                      {mailServer.installed ? "Running" : "Not Installed"}
                    </strong>
                  </span>
                  {!mailServer.installed && (
                    <button
                      type="button"
                      disabled={busy === "setup_mail"}
                      onClick={() => void handleSetupMailStack()}
                      className="rounded-lg bg-emerald-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-emerald-500"
                    >
                      {busy === "setup_mail" ? "Installing..." : "Setup IMAP/SMTP Server"}
                    </button>
                  )}
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-slate-600">
                    2. Trusted Let&apos;s Encrypt SSL on{" "}
                    <code className="font-mono">{mailHost}</code>:{" "}
                    <strong className={hasSsl ? "text-emerald-700" : "text-amber-700"}>
                      {hasSsl ? "Active" : "Self-Signed (Required for Gmail)"}
                    </strong>
                  </span>
                  {dom && !hasSsl && (
                    <button
                      type="button"
                      disabled={busy === `ssl_${dom.id}`}
                      onClick={() => void handleIssueMailSsl(dom.id)}
                      className="rounded-lg bg-indigo-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-indigo-500"
                    >
                      {busy === `ssl_${dom.id}` ? "Issuing SSL..." : "Issue Mail SSL"}
                    </button>
                  )}
                </div>
              </div>

              {/* Tabs: IMAP Apps vs Gmail Web */}
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setClientSetupTab("imap")}
                  className={`rounded-xl border px-3 py-2 font-semibold transition ${
                    clientSetupTab === "imap"
                      ? "border-indigo-600 bg-indigo-50 text-indigo-700"
                      : "border-slate-200 bg-white text-slate-700"
                  }`}
                >
                  IMAP + SMTP (Gmail App, Apple Mail, Outlook)
                </button>
                <button
                  type="button"
                  onClick={() => setClientSetupTab("gmail_web")}
                  className={`rounded-xl border px-3 py-2 font-semibold transition ${
                    clientSetupTab === "gmail_web"
                      ? "border-indigo-600 bg-indigo-50 text-indigo-700"
                      : "border-slate-200 bg-white text-slate-700"
                  }`}
                >
                  Gmail Web (mail.google.com)
                </button>
              </div>

              {clientSetupTab === "imap" ? (
                <div className="space-y-3">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="rounded-xl border border-slate-200 p-3.5 space-y-2">
                      <div className="font-bold text-slate-900">Incoming Mail (IMAP)</div>
                      {[
                        { label: "Server / Host", val: mailHost, k: "imap_host" },
                        { label: "Port", val: "993", k: "imap_port" },
                        { label: "Security", val: "SSL / TLS", k: "imap_sec" },
                        { label: "Username", val: clientSetupMailbox.email, k: "imap_user" },
                      ].map((row) => (
                        <div key={row.k} className="flex items-center justify-between gap-2">
                          <span className="text-slate-500">{row.label}:</span>
                          <button
                            type="button"
                            onClick={() => copyText(row.k, row.val)}
                            className="inline-flex items-center gap-1 font-mono font-semibold text-slate-900 hover:text-indigo-600"
                          >
                            {row.val}
                            {copiedKey === row.k ? (
                              <Check className="h-3 w-3 text-emerald-600" />
                            ) : (
                              <Copy className="h-3 w-3 text-slate-400" />
                            )}
                          </button>
                        </div>
                      ))}
                    </div>

                    <div className="rounded-xl border border-slate-200 p-3.5 space-y-2">
                      <div className="font-bold text-slate-900">Outgoing Mail (SMTP)</div>
                      {[
                        { label: "Server / Host", val: mailHost, k: "smtp_host" },
                        { label: "Port (TLS / SSL)", val: "587 (or 465 SSL)", k: "smtp_port" },
                        { label: "Auth Required", val: "Yes (Same password)", k: "smtp_auth" },
                        { label: "Username", val: clientSetupMailbox.email, k: "smtp_user" },
                      ].map((row) => (
                        <div key={row.k} className="flex items-center justify-between gap-2">
                          <span className="text-slate-500">{row.label}:</span>
                          <button
                            type="button"
                            onClick={() => copyText(row.k, row.val)}
                            className="inline-flex items-center gap-1 font-mono font-semibold text-slate-900 hover:text-indigo-600"
                          >
                            {row.val}
                            {copiedKey === row.k ? (
                              <Check className="h-3 w-3 text-emerald-600" />
                            ) : (
                              <Copy className="h-3 w-3 text-slate-400" />
                            )}
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-indigo-100 bg-indigo-50/70 px-4 py-3">
                    <div className="text-[11px] text-indigo-900">
                      Using <strong>Mac / iPhone / iPad</strong>? Download a 1-click Apple Mail configuration profile:
                    </div>
                    <a
                      href={`/api/mail?action=mobileconfig&mailboxId=${encodeURIComponent(
                        clientSetupMailbox.id
                      )}`}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-indigo-500"
                    >
                      Download .mobileconfig
                    </a>
                  </div>
                </div>
              ) : (
                <div className="space-y-3 rounded-xl border border-slate-200 p-4 text-xs leading-relaxed text-slate-700">
                  <p className="text-[11px] text-slate-500">
                    Note: Gmail&apos;s desktop web UI uses <strong>POP3 (995 SSL)</strong> for{" "}
                    <em>Check mail from other accounts</em> and <strong>SMTP (465 SSL / 587 TLS)</strong> for{" "}
                    <em>Send mail as</em>. (Gmail Android/iOS mobile apps support IMAP 993 directly.)
                  </p>
                  <div>
                    <div className="font-bold text-slate-900">
                      Step A — Receive emails inside Gmail Web:
                    </div>
                    <ol className="mt-1 list-decimal space-y-1 pl-5">
                      <li>
                        Open Gmail → <strong>Settings (gear) → See all settings → Accounts and Import</strong>.
                      </li>
                      <li>
                        Under <strong>Check mail from other accounts</strong>, click{" "}
                        <strong>Add a mail account</strong> and enter{" "}
                        <code className="font-mono font-semibold">{clientSetupMailbox.email}</code>.
                      </li>
                      <li>
                        Select <strong>Import emails from my other account (POP3)</strong>.
                      </li>
                      <li>
                        POP Server: <code className="font-mono font-semibold">{mailHost}</code> • Port:{" "}
                        <code className="font-mono font-semibold">995</code> • Check{" "}
                        <strong>Always use a secure connection (SSL)</strong>.
                      </li>
                    </ol>
                  </div>
                  <div>
                    <div className="font-bold text-slate-900">
                      Step B — Send emails as {clientSetupMailbox.email}:
                    </div>
                    <ol className="mt-1 list-decimal space-y-1 pl-5">
                      <li>
                        Under <strong>Send mail as</strong>, click{" "}
                        <strong>Add another email address</strong>.
                      </li>
                      <li>
                        SMTP Server: <code className="font-mono font-semibold">{mailHost}</code> • Port:{" "}
                        <code className="font-mono font-semibold">465</code> (SSL) or{" "}
                        <code className="font-mono font-semibold">587</code> (TLS).
                      </li>
                      <li>
                        Username: <code className="font-mono font-semibold">{clientSetupMailbox.email}</code> •
                        Password: your WPCloud mailbox password.
                      </li>
                    </ol>
                  </div>
                </div>
              )}

              <div className="flex justify-end pt-1">
                <button
                  type="button"
                  onClick={() => setClientSetupMailbox(null)}
                  className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Close
                </button>
              </div>
            </div>
          );
        })()}
      </NativeModalDialog>
    </div>
  );
}

