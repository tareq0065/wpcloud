"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Download,
  Folder,
  Inbox,
  Lock,
  LogOut,
  Mail,
  Paperclip,
  RefreshCw,
  Search,
  Send,
} from "lucide-react";
import type {
  MaildirFolderSummary,
  MaildirMessageDetail,
  MaildirMessageSummary,
} from "@wpcloud/agent/maildir-reader";
import { NativeModalDialog } from "@/components/NativeModalDialog";

export default function WebmailPage() {
  const [checking, setChecking] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);
  const [email, setEmail] = useState("");
  const [folders, setFolders] = useState<MaildirFolderSummary[]>([]);
  const [canSendSmtp, setCanSendSmtp] = useState(false);

  // Login form
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [loggingIn, setLoggingIn] = useState(false);

  // Mail browser state
  const [activeFolder, setActiveFolder] = useState("INBOX");
  const [searchQuery, setSearchQuery] = useState("");
  const [messages, setMessages] = useState<MaildirMessageSummary[]>([]);
  const [totalMessages, setTotalMessages] = useState(0);
  const [loadingMessages, setLoadingMessages] = useState(false);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedDetail, setSelectedDetail] = useState<MaildirMessageDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  // Compose modal
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeTo, setComposeTo] = useState("");
  const [composeSubject, setComposeSubject] = useState("");
  const [composeBody, setComposeBody] = useState("");
  const [sending, setSending] = useState(false);
  const [banner, setBanner] = useState<{ text: string; tone: "success" | "error" } | null>(null);

  const loadSession = useCallback(async () => {
    setChecking(true);
    try {
      const res = await fetch("/api/webmail?action=session");
      const data = await res.json();
      setAuthenticated(Boolean(data.authenticated));
      if (data.authenticated) {
        setEmail(data.email || "");
        setFolders(data.folders || []);
        setCanSendSmtp(Boolean(data.canSendSmtp));
      }
    } finally {
      setChecking(false);
    }
  }, []);

  const loadFolderMessages = useCallback(
    async (folder: string, q: string) => {
      setLoadingMessages(true);
      try {
        const params = new URLSearchParams({
          action: "messages",
          folder,
          limit: "80",
          q,
        });
        const res = await fetch(`/api/webmail?${params.toString()}`);
        const data = await res.json();
        if (res.ok) {
          setMessages(data.messages || []);
          setTotalMessages(data.total || 0);
        }
      } finally {
        setLoadingMessages(false);
      }
    },
    []
  );

  useEffect(() => {
    void loadSession();
  }, [loadSession]);

  useEffect(() => {
    if (authenticated) {
      void loadFolderMessages(activeFolder, searchQuery);
    }
  }, [authenticated, activeFolder, searchQuery, loadFolderMessages]);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoginError("");
    setLoggingIn(true);
    try {
      const res = await fetch("/api/webmail", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "login",
          email: loginEmail,
          password: loginPassword,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Sign in failed");
      }
      setLoginPassword("");
      await loadSession();
    } catch (err: unknown) {
      setLoginError(err instanceof Error ? err.message : "Sign in failed");
    } finally {
      setLoggingIn(false);
    }
  }

  async function handleLogout() {
    await fetch("/api/webmail", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "logout" }),
    });
    setAuthenticated(false);
    setSelectedId(null);
    setSelectedDetail(null);
  }

  async function openMessage(msg: MaildirMessageSummary) {
    setSelectedId(msg.id);
    setLoadingDetail(true);
    try {
      const params = new URLSearchParams({
        action: "message",
        folder: msg.folder,
        id: msg.id,
      });
      const res = await fetch(`/api/webmail?${params.toString()}`);
      const data = await res.json();
      if (res.ok) {
        setSelectedDetail(data.message);
      }
    } finally {
      setLoadingDetail(false);
    }
  }

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    setSending(true);
    setBanner(null);
    try {
      const res = await fetch("/api/webmail", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "send",
          to: composeTo,
          subject: composeSubject,
          text: composeBody,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Send failed");
      setComposeOpen(false);
      setComposeTo("");
      setComposeSubject("");
      setComposeBody("");
      setBanner({ text: "Email sent & saved to Sent folder.", tone: "success" });
      await loadSession();
      if (activeFolder === ".Sent") {
        await loadFolderMessages(".Sent", searchQuery);
      }
    } catch (err: unknown) {
      setBanner({
        text: err instanceof Error ? err.message : "Failed to send email",
        tone: "error",
      });
    } finally {
      setSending(false);
    }
  }

  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#FAFAFB] text-sm text-slate-500">
        <RefreshCw className="mr-2 h-4 w-4 animate-spin text-indigo-600" />
        Loading WPCloud Webmail...
      </div>
    );
  }

  if (!authenticated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#FAFAFB] p-4">
        <div className="w-full max-w-md rounded-2xl border border-slate-200/80 bg-white p-8 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-600 to-violet-600 text-white">
              <Mail className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-slate-900">WPCloud Webmail</h1>
              <p className="text-xs text-slate-500">
                Sign in with your mailbox email &amp; password
              </p>
            </div>
          </div>

          <form onSubmit={handleLogin} className="mt-6 space-y-4">
            <div>
              <label
                htmlFor="wm-email"
                className="block text-xs font-semibold text-slate-700"
              >
                Email Address
              </label>
              <input
                id="wm-email"
                type="email"
                required
                autoComplete="email"
                placeholder="me@example.com"
                value={loginEmail}
                onChange={(e) => setLoginEmail(e.target.value)}
                className="mt-1.5 block w-full rounded-xl border border-slate-200 px-3.5 py-2.5 font-mono text-xs"
              />
            </div>

            <div>
              <label
                htmlFor="wm-pass"
                className="block text-xs font-semibold text-slate-700"
              >
                Mailbox Password
              </label>
              <div className="relative mt-1.5">
                <Lock className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                <input
                  id="wm-pass"
                  type="password"
                  required
                  autoComplete="current-password"
                  placeholder="Enter mailbox password"
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                  className="block w-full rounded-xl border border-slate-200 pl-9 pr-3.5 py-2.5 font-mono text-xs"
                />
              </div>
            </div>

            {loginError && (
              <div className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs font-medium text-rose-700">
                {loginError}
              </div>
            )}

            <button
              type="submit"
              disabled={loggingIn}
              className="w-full rounded-xl bg-indigo-600 px-4 py-2.5 text-xs font-semibold text-white hover:bg-indigo-500"
            >
              {loggingIn ? "Signing in..." : "Sign In to Mailbox"}
            </button>
          </form>

          <div className="mt-5 border-t border-slate-100 pt-4 text-center">
            <Link
              href="/"
              className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-indigo-600"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Back to WPCloud Admin Panel
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-[#FAFAFB]">
      {/* Header */}
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-5 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-white">
            <Mail className="h-4 w-4" />
          </div>
          <div>
            <div className="text-sm font-bold text-slate-900">WPCloud Webmail</div>
            <div className="font-mono text-[11px] text-slate-500">{email}</div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              void loadSession();
              void loadFolderMessages(activeFolder, searchQuery);
            }}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </button>
          <button
            type="button"
            onClick={() => setComposeOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-indigo-500"
          >
            <Send className="h-3.5 w-3.5" />
            Compose
          </button>
          <Link
            href="/"
            className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
          >
            Panel
          </Link>
          <button
            type="button"
            onClick={handleLogout}
            className="inline-flex items-center gap-1 rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
          >
            <LogOut className="h-3.5 w-3.5" />
            Sign Out
          </button>
        </div>
      </header>

      {banner && (
        <div
          className={`mx-5 mt-3 rounded-xl border px-4 py-2.5 text-xs font-medium ${
            banner.tone === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border-rose-200 bg-rose-50 text-rose-800"
          }`}
        >
          {banner.text}
        </div>
      )}

      {/* 3-pane mail layout */}
      <div className="grid flex-1 grid-cols-1 gap-4 p-4 lg:grid-cols-12">
        {/* Folders */}
        <aside className="rounded-2xl border border-slate-200/80 bg-white p-3 lg:col-span-2">
          <div className="px-2 pb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            Folders
          </div>
          <nav className="space-y-1">
            {folders.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => {
                  setActiveFolder(f.id);
                  setSelectedId(null);
                  setSelectedDetail(null);
                }}
                className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-xs font-semibold transition ${
                  activeFolder === f.id
                    ? "bg-indigo-50 text-indigo-700"
                    : "text-slate-700 hover:bg-slate-50"
                }`}
              >
                <span className="flex items-center gap-2 truncate">
                  {f.id === "INBOX" ? (
                    <Inbox className="h-3.5 w-3.5 shrink-0" />
                  ) : (
                    <Folder className="h-3.5 w-3.5 shrink-0" />
                  )}
                  <span className="truncate">{f.label}</span>
                </span>
                <span className="ml-2 shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-600">
                  {f.totalCount}
                </span>
              </button>
            ))}
          </nav>
        </aside>

        {/* Message List */}
        <section className="flex flex-col rounded-2xl border border-slate-200/80 bg-white p-3 lg:col-span-4">
          <div className="relative mb-3">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
            <input
              type="search"
              placeholder="Search sender, subject..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="block w-full rounded-xl border border-slate-200 bg-slate-50 pl-8 pr-3 py-2 text-xs focus:border-indigo-500 focus:bg-white focus:outline-none"
            />
          </div>

          <div className="mb-2 flex items-center justify-between px-1 text-[11px] text-slate-500">
            <span>
              {activeFolder === "INBOX" ? "INBOX" : activeFolder.slice(1)} ({totalMessages})
            </span>
            {loadingMessages && <RefreshCw className="h-3 w-3 animate-spin" />}
          </div>

          <div className="flex-1 divide-y divide-slate-100 overflow-y-auto max-h-[72vh]">
            {messages.length === 0 ? (
              <div className="px-4 py-12 text-center text-xs text-slate-400">
                No messages in this folder yet.
              </div>
            ) : (
              messages.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => void openMessage(m)}
                  className={`w-full px-3 py-3 text-left transition hover:bg-slate-50 ${
                    selectedId === m.id ? "bg-indigo-50/70" : ""
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className={`truncate text-xs ${
                        m.unread ? "font-bold text-slate-900" : "font-medium text-slate-700"
                      }`}
                    >
                      {m.from}
                    </span>
                    <span className="shrink-0 text-[10px] text-slate-400">
                      {new Date(m.date).toLocaleDateString()}
                    </span>
                  </div>
                  <div
                    className={`mt-0.5 truncate text-xs ${
                      m.unread ? "font-semibold text-slate-900" : "text-slate-600"
                    }`}
                  >
                    {m.subject}
                  </div>
                </button>
              ))
            )}
          </div>
        </section>

        {/* Reading Pane */}
        <main className="flex flex-col rounded-2xl border border-slate-200/80 bg-white p-5 lg:col-span-6">
          {loadingDetail ? (
            <div className="flex flex-1 items-center justify-center text-xs text-slate-500">
              <RefreshCw className="mr-2 h-4 w-4 animate-spin text-indigo-600" />
              Loading email...
            </div>
          ) : !selectedDetail ? (
            <div className="flex flex-1 flex-col items-center justify-center text-center text-xs text-slate-400">
              <Mail className="mb-2 h-10 w-10 text-slate-200" />
              Select an email from the list to read its contents and attachments.
            </div>
          ) : (
            <div className="flex h-full flex-col">
              <div className="border-b border-slate-100 pb-4">
                <h2 className="text-base font-bold text-slate-900">
                  {selectedDetail.subject}
                </h2>
                <div className="mt-2 space-y-1 text-xs text-slate-600">
                  <div>
                    <span className="font-semibold text-slate-700">From:</span>{" "}
                    <span className="font-mono">{selectedDetail.from}</span>
                  </div>
                  <div>
                    <span className="font-semibold text-slate-700">To:</span>{" "}
                    <span className="font-mono">{selectedDetail.to}</span>
                  </div>
                  <div>
                    <span className="font-semibold text-slate-700">Date:</span>{" "}
                    {new Date(selectedDetail.date).toLocaleString()}
                  </div>
                </div>

                {selectedDetail.attachments.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {selectedDetail.attachments.map((att) => (
                      <a
                        key={att.index}
                        href={`/api/webmail?action=attachment&folder=${encodeURIComponent(
                          selectedDetail.folder
                        )}&id=${encodeURIComponent(selectedDetail.id)}&index=${att.index}`}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100"
                      >
                        <Paperclip className="h-3 w-3 text-indigo-600" />
                        {att.filename} ({Math.max(1, Math.round(att.sizeBytes / 1024))} KB)
                        <Download className="h-3 w-3" />
                      </a>
                    ))}
                  </div>
                )}
              </div>

              <div className="mt-4 flex-1 overflow-auto">
                {selectedDetail.htmlBody ? (
                  <iframe
                    title="Email content"
                    sandbox=""
                    srcDoc={selectedDetail.htmlBody}
                    className="h-[60vh] w-full rounded-xl border border-slate-100 bg-white"
                  />
                ) : (
                  <pre className="whitespace-pre-wrap font-sans text-xs leading-relaxed text-slate-800">
                    {selectedDetail.textBody || "(Empty message body)"}
                  </pre>
                )}
              </div>
            </div>
          )}
        </main>
      </div>

      {/* Compose Modal */}
      <NativeModalDialog
        open={composeOpen}
        onClose={() => setComposeOpen(false)}
        title="Compose Email"
        subtitle={
          canSendSmtp
            ? `Sending from ${email}`
            : "Note: Configure Postfix or an SMTP Relay in WPCloud Mail Server to send outbound email."
        }
      >
        <form onSubmit={handleSend} className="space-y-4">
          <div>
            <label htmlFor="cmp-to" className="block text-xs font-semibold text-slate-700">
              To
            </label>
            <input
              id="cmp-to"
              type="email"
              required
              placeholder="recipient@example.com"
              value={composeTo}
              onChange={(e) => setComposeTo(e.target.value)}
              className="mt-1 block w-full rounded-xl border border-slate-200 px-3 py-2 font-mono text-xs"
            />
          </div>
          <div>
            <label htmlFor="cmp-sub" className="block text-xs font-semibold text-slate-700">
              Subject
            </label>
            <input
              id="cmp-sub"
              type="text"
              required
              value={composeSubject}
              onChange={(e) => setComposeSubject(e.target.value)}
              className="mt-1 block w-full rounded-xl border border-slate-200 px-3 py-2 text-xs"
            />
          </div>
          <div>
            <label htmlFor="cmp-body" className="block text-xs font-semibold text-slate-700">
              Message
            </label>
            <textarea
              id="cmp-body"
              rows={6}
              required
              value={composeBody}
              onChange={(e) => setComposeBody(e.target.value)}
              className="mt-1 block w-full rounded-xl border border-slate-200 px-3 py-2 text-xs"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setComposeOpen(false)}
              className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={sending}
              className="rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-500"
            >
              {sending ? "Sending..." : "Send Email"}
            </button>
          </div>
        </form>
      </NativeModalDialog>
    </div>
  );
}

