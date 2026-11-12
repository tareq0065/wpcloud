"use client";

import React, { useState } from "react";
import {
  CheckCircle2,
  Cpu,
  Database,
  FileArchive,
  FolderGit2,
  Globe,
  PlusCircle,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  UploadCloud,
} from "lucide-react";
import type {
  AgentJob,
  CanonicalHost,
  PhpVersion,
  SiteRecord,
} from "@wpcloud/shared";

interface WizardProps {
  mode: "create" | "import";
  onCreated: (site: SiteRecord, job: AgentJob) => void;
  notify: (msg: string, tone?: "success" | "error") => void;
}

export function CreateAndImportWizards({
  mode,
  onCreated,
  notify,
}: WizardProps) {
  const [domain, setDomain] = useState("");
  const [siteTitle, setSiteTitle] = useState("My WordPress Website");
  const [wpAdminUser, setWpAdminUser] = useState("wpadmin");
  const [wpAdminEmail, setWpAdminEmail] = useState("admin@example.com");
  const [wpAdminPassword, setWpAdminPassword] = useState("");

  // Import-specific state
  const [filesArchiveName, setFilesArchiveName] = useState(
    "wordpress-site-files.zip"
  );
  const [sqlDumpName, setSqlDumpName] = useState("database-backup.sql");
  const [tablePrefix, setTablePrefix] = useState("wp_");
  const [replaceDomain, setReplaceDomain] = useState(false); // Defaults to keeping the same domain!
  const [oldDomain, setOldDomain] = useState("");
  const [dbName, setDbName] = useState("");
  const [dbUser, setDbUser] = useState("");
  const [dbPassword, setDbPassword] = useState("");
  const [customDbConfig, setCustomDbConfig] = useState(false);
  const [uploadingFiles, setUploadingFiles] = useState(false);
  const [uploadingSql, setUploadingSql] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number>(0);

  // Automated Nginx Options (system asks user what's needed instead of writing config)
  const [includeWww, setIncludeWww] = useState(true);
  const [canonicalHost, setCanonicalHost] = useState<CanonicalHost>("apex");
  const [clientMaxBodySizeMb, setClientMaxBodySizeMb] = useState(128);
  const [blockXmlRpc, setBlockXmlRpc] = useState(true);
  const [staticCacheDays, setStaticCacheDays] = useState(30);
  const [enableGzip, setEnableGzip] = useState(true);

  // PHP-FPM Options
  const [phpVersion, setPhpVersion] = useState<PhpVersion>("8.3");
  const [memoryLimitMb, setMemoryLimitMb] = useState(256);

  const [submitting, setSubmitting] = useState(false);

  async function handleChunkedFileUpload(
    file: File,
    kind: "archive" | "sql"
  ) {
    const chunkSize = 8 * 1024 * 1024; // 8 MB chunks in browser
    const totalChunks = Math.max(1, Math.ceil(file.size / chunkSize));

    if (kind === "archive") setUploadingFiles(true);
    else setUploadingSql(true);
    setUploadProgress(0);

    try {
      for (let i = 0; i < totalChunks; i++) {
        const slice = file.slice(i * chunkSize, (i + 1) * chunkSize);
        const form = new FormData();
        form.append("file", slice, file.name);
        form.append("fileName", file.name);
        form.append("chunkIndex", String(i));
        form.append("totalChunks", String(totalChunks));

        const res = await fetch("/api/upload", {
          method: "POST",
          body: form,
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Upload failed");

        setUploadProgress(Math.round(((i + 1) / totalChunks) * 100));

        if (kind === "archive") {
          setFilesArchiveName(data.fileName);
          if (data.detectedDbName) setDbName(data.detectedDbName);
          if (data.detectedDbUser) setDbUser(data.detectedDbUser);
          if (data.detectedDbPassword) setDbPassword(data.detectedDbPassword);
          if (data.detectedTablePrefix) setTablePrefix(data.detectedTablePrefix);
        } else {
          setSqlDumpName(data.fileName);
          if (data.detectedDbName && !dbName) setDbName(data.detectedDbName);
          if (data.detectedDbUser && !dbUser) setDbUser(data.detectedDbUser);
          if (data.detectedDbPassword && !dbPassword) setDbPassword(data.detectedDbPassword);
          if (data.detectedTablePrefix) {
            setTablePrefix(data.detectedTablePrefix);
          }
          if (data.detectedOldDomain) {
            setOldDomain(data.detectedOldDomain);
            if (!domain) setDomain(data.detectedOldDomain);
          }
        }
      }
      notify(
        `Uploaded ${file.name} to /opt/wpcloud/data/uploads/${file.name}`
      );
    } catch (err: unknown) {
      notify(err instanceof Error ? err.message : "Upload failed", "error");
    } finally {
      setUploadingFiles(false);
      setUploadingSql(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const payload =
        mode === "create"
          ? {
              mode: "fresh",
              domain,
              siteTitle,
              wpAdminUser,
              wpAdminEmail,
              wpAdminPassword: wpAdminPassword || undefined,
              dbName: dbName.trim() || undefined,
              dbUser: dbUser.trim() || undefined,
              dbPassword: dbPassword.trim() || undefined,
              nginxOptions: {
                includeWww,
                canonicalHost,
                httpsRedirect: true,
                clientMaxBodySizeMb,
                blockXmlRpc,
                staticCacheDays,
                enableGzip,
                enableHsts: false,
                extraDirectives: "",
              },
              phpOptions: {
                phpVersion,
                memoryLimitMb,
                maxExecutionTime: 300,
                uploadMaxFilesizeMb: clientMaxBodySizeMb,
                maxChildren: 10,
              },
            }
          : {
              mode: "import",
              domain,
              oldDomain,
              replaceDomain,
              forceHttpsReplace: false,
              tablePrefix,
              filesArchiveName,
              sqlDumpName,
              dbName: dbName.trim() || undefined,
              dbUser: dbUser.trim() || undefined,
              dbPassword: dbPassword.trim() || undefined,
              nginxOptions: {
                includeWww,
                canonicalHost,
                httpsRedirect: true,
                clientMaxBodySizeMb,
                blockXmlRpc,
                staticCacheDays,
                enableGzip,
                enableHsts: false,
                extraDirectives: "",
              },
              phpOptions: {
                phpVersion,
                memoryLimitMb,
                maxExecutionTime: 300,
                uploadMaxFilesizeMb: clientMaxBodySizeMb,
                maxChildren: 10,
              },
            };

      const res = await fetch("/api/sites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to provision site");

      notify(
        mode === "create"
          ? `Created WordPress site ${data.site.domain} in /opt/wpcloud/sites/${data.site.domain}!`
          : `Imported ${data.site.domain} into /opt/wpcloud/sites/${data.site.domain}!`
      );
      onCreated(data.site, data.job);
    } catch (err: unknown) {
      notify(err instanceof Error ? err.message : "Failed", "error");
    } finally {
      setSubmitting(false);
    }
  }

  const cleanPreviewDomain =
    domain.trim().toLowerCase() || "yourclientdomain.com";

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-2xs">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-700">
              {mode === "create" ? (
                <>
                  <PlusCircle className="h-3.5 w-3.5" /> Fresh WordPress
                  Installer
                </>
              ) : (
                <>
                  <UploadCloud className="h-3.5 w-3.5" /> Existing WordPress
                  Site &amp; SQL Importer
                </>
              )}
            </span>
            <h1 className="mt-2 text-xl font-bold tracking-tight text-slate-900">
              {mode === "create"
                ? "Create a New WordPress Website"
                : "Import an Existing WordPress Website (.zip/.tar.gz + .sql)"}
            </h1>
            <p className="mt-1 text-xs text-slate-500">
              Everything is provisioned inside{" "}
              <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-slate-800">
                /opt/wpcloud/sites/{cleanPreviewDomain}
              </code>{" "}
              with an automated Nginx config tested via{" "}
              <code className="font-mono">nginx -t</code>.
            </p>
          </div>
        </div>

        {/* STEP 1: Domain & WordPress / Archive Settings */}
        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="space-y-4 rounded-xl border border-slate-200/80 bg-slate-50/50 p-5">
            <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
              <Globe className="h-4 w-4 text-indigo-600" />
              1. Domain &amp;{" "}
              {mode === "create"
                ? "WordPress Admin Account"
                : "Archive / Database Upload"}
            </div>

            <div>
              <label
                htmlFor="wiz-domain"
                className="block text-xs font-semibold text-slate-700"
              >
                Domain Name (bare domain without https://)
              </label>
              <input
                id="wiz-domain"
                type="text"
                required
                placeholder="example.com"
                value={domain}
                onChange={(e) => {
                  const val = e.target.value;
                  setDomain(val);
                  if (val.includes(".")) {
                    setWpAdminEmail(`admin@${val.trim().toLowerCase()}`);
                  }
                }}
                className="mt-1.5 block w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 font-mono text-sm text-slate-900 focus:border-indigo-500 focus:outline-none"
              />
              <p className="mt-1 font-mono text-[11px] text-slate-500">
                Target folder: /opt/wpcloud/sites/{cleanPreviewDomain}/public
              </p>
            </div>

            {mode === "create" ? (
              <>
                <div>
                  <label
                    htmlFor="wiz-title"
                    className="block text-xs font-semibold text-slate-700"
                  >
                    Website Title
                  </label>
                  <input
                    id="wiz-title"
                    type="text"
                    required
                    value={siteTitle}
                    onChange={(e) => setSiteTitle(e.target.value)}
                    className="mt-1.5 block w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs text-slate-900"
                  />
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label
                      htmlFor="wiz-admin-user"
                      className="block text-xs font-semibold text-slate-700"
                    >
                      WP Admin Username
                    </label>
                    <input
                      id="wiz-admin-user"
                      type="text"
                      required
                      value={wpAdminUser}
                      onChange={(e) => setWpAdminUser(e.target.value)}
                      className="mt-1.5 block w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2 font-mono text-xs text-slate-900"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="wiz-admin-email"
                      className="block text-xs font-semibold text-slate-700"
                    >
                      WP Admin Email
                    </label>
                    <input
                      id="wiz-admin-email"
                      type="email"
                      required
                      value={wpAdminEmail}
                      onChange={(e) => setWpAdminEmail(e.target.value)}
                      className="mt-1.5 block w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2 font-mono text-xs text-slate-900"
                    />
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="wiz-admin-pass"
                    className="block text-xs font-semibold text-slate-700"
                  >
                    WP Admin Password (leave blank to auto-generate strong
                    password)
                  </label>
                  <input
                    id="wiz-admin-pass"
                    type="text"
                    placeholder="Auto-generated if left empty"
                    value={wpAdminPassword}
                    onChange={(e) => setWpAdminPassword(e.target.value)}
                    className="mt-1.5 block w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2 font-mono text-xs text-slate-900"
                  />
                </div>

                <div className="pt-1">
                  <button
                    type="button"
                    onClick={() => setCustomDbConfig(!customDbConfig)}
                    className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 flex items-center gap-1"
                  >
                    {customDbConfig
                      ? "− Use auto-generated database credentials"
                      : "+ Custom MariaDB Database Name & User (Optional)"}
                  </button>
                  {customDbConfig && (
                    <div className="mt-2.5 rounded-xl border border-slate-200 bg-white p-3.5 space-y-2.5 shadow-2xs">
                      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
                        <div>
                          <label className="block text-[11px] font-semibold text-slate-700">
                            Database Name
                          </label>
                          <input
                            type="text"
                            placeholder="Auto: wp_<domain>"
                            value={dbName}
                            onChange={(e) => setDbName(e.target.value)}
                            className="mt-1 block w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 font-mono text-xs text-slate-900 focus:bg-white focus:outline-none focus:border-indigo-500"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] font-semibold text-slate-700">
                            Database User
                          </label>
                          <input
                            type="text"
                            placeholder="Auto: u_<domain>"
                            value={dbUser}
                            onChange={(e) => setDbUser(e.target.value)}
                            className="mt-1 block w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 font-mono text-xs text-slate-900 focus:bg-white focus:outline-none focus:border-indigo-500"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] font-semibold text-slate-700">
                            Database Password
                          </label>
                          <input
                            type="text"
                            placeholder="Auto-generated"
                            value={dbPassword}
                            onChange={(e) => setDbPassword(e.target.value)}
                            className="mt-1 block w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 font-mono text-xs text-slate-900 focus:bg-white focus:outline-none focus:border-indigo-500"
                          />
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="rounded-xl border border-dashed border-indigo-300 bg-white p-3.5">
                    <div className="flex items-center gap-2 text-xs font-bold text-slate-800">
                      <FileArchive className="h-4 w-4 text-indigo-600" />
                      WordPress Files (.zip / .tar.gz)
                    </div>
                    <p className="mt-1 font-mono text-[11px] text-slate-500">
                      Selected: {filesArchiveName}
                    </p>
                    <label className="mt-2.5 inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-100">
                      <UploadCloud className="h-3.5 w-3.5" />
                      {uploadingFiles
                        ? `Uploading (${uploadProgress}%)...`
                        : "Choose Archive"}
                      <input
                        type="file"
                        accept=".zip,.tar.gz,.tgz"
                        className="sr-only"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) void handleChunkedFileUpload(f, "archive");
                        }}
                      />
                    </label>
                  </div>

                  <div className="rounded-xl border border-dashed border-indigo-300 bg-white p-3.5">
                    <div className="flex items-center gap-2 text-xs font-bold text-slate-800">
                      <Database className="h-4 w-4 text-violet-600" />
                      Database Dump (.sql / .sql.gz)
                    </div>
                    <p className="mt-1 font-mono text-[11px] text-slate-500">
                      Selected: {sqlDumpName}
                    </p>
                    <label className="mt-2.5 inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-violet-50 px-3 py-1.5 text-xs font-semibold text-violet-700 hover:bg-violet-100">
                      <UploadCloud className="h-3.5 w-3.5" />
                      {uploadingSql
                        ? `Uploading (${uploadProgress}%)...`
                        : "Choose .sql Dump"}
                      <input
                        type="file"
                        accept=".sql,.gz"
                        className="sr-only"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) void handleChunkedFileUpload(f, "sql");
                        }}
                      />
                    </label>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label
                      htmlFor="wiz-prefix"
                      className="block text-xs font-semibold text-slate-700"
                    >
                      Detected DB Table Prefix
                    </label>
                    <input
                      id="wiz-prefix"
                      type="text"
                      value={tablePrefix}
                      onChange={(e) => setTablePrefix(e.target.value)}
                      className="mt-1 block w-full rounded-xl border border-slate-200 bg-white px-3 py-2 font-mono text-xs"
                    />
                  </div>
                  <div className="flex flex-col justify-end">
                    <label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700">
                      <input
                        type="checkbox"
                        checked={replaceDomain}
                        onChange={(e) => setReplaceDomain(e.target.checked)}
                        className="h-4 w-4 rounded accent-indigo-600"
                      />
                      Moving to a new domain? (search-replace)
                    </label>
                  </div>
                </div>

                <div className="rounded-xl border border-indigo-100 bg-indigo-50/50 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                      <Database className="h-3.5 w-3.5 text-indigo-600" />
                      Preserved Database Credentials (from old site)
                    </span>
                    <span className="inline-flex items-center gap-1 rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-semibold text-indigo-700">
                      Auto-detected
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500">
                    Keeps your original database name, user, and password from your old host so all SQL tables and wp-config remain completely synchronized.
                  </p>
                  <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-700">
                        Database Name
                      </label>
                      <input
                        type="text"
                        placeholder="e.g. u530443961_2zRlP"
                        value={dbName}
                        onChange={(e) => setDbName(e.target.value)}
                        className="mt-1 block w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-mono text-xs text-slate-900 focus:outline-none focus:border-indigo-500"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-700">
                        Database User
                      </label>
                      <input
                        type="text"
                        placeholder="e.g. u530443961_2zRlP"
                        value={dbUser}
                        onChange={(e) => setDbUser(e.target.value)}
                        className="mt-1 block w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-mono text-xs text-slate-900 focus:outline-none focus:border-indigo-500"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-700">
                        Database Password
                      </label>
                      <input
                        type="text"
                        placeholder="Password from wp-config"
                        value={dbPassword}
                        onChange={(e) => setDbPassword(e.target.value)}
                        className="mt-1 block w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-mono text-xs text-slate-900 focus:outline-none focus:border-indigo-500"
                      />
                    </div>
                  </div>
                </div>

                {replaceDomain && (
                  <div>
                    <label
                      htmlFor="wiz-old-domain"
                      className="block text-xs font-semibold text-slate-700"
                    >
                      Previous Domain in SQL Dump (will be replaced with{" "}
                      {cleanPreviewDomain})
                    </label>
                    <input
                      id="wiz-old-domain"
                      type="text"
                      placeholder="old-domain.com"
                      value={oldDomain}
                      onChange={(e) => setOldDomain(e.target.value)}
                      className="mt-1 block w-full rounded-xl border border-slate-200 bg-white px-3 py-2 font-mono text-xs"
                    />
                  </div>
                )}
              </>
            )}
          </div>

          {/* STEP 2: Automated Nginx & PHP-FPM Questionnaire */}
          <div className="space-y-4 rounded-xl border border-slate-200/80 bg-slate-50/50 p-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
                <Sparkles className="h-4 w-4 text-indigo-600" />
                2. Automated Nginx &amp; PHP-FPM Setup
              </div>
              <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700">
                Auto-Generated Template
              </span>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-semibold text-slate-700">
                  PHP-FPM Version
                </label>
                <div className="mt-1.5 grid grid-cols-3 gap-2">
                  {(["8.1", "8.2", "8.3"] as PhpVersion[]).map((ver) => (
                    <button
                      key={ver}
                      type="button"
                      onClick={() => setPhpVersion(ver)}
                      className={`rounded-xl border py-2 text-xs font-bold transition ${
                        phpVersion === ver
                          ? "border-indigo-600 bg-indigo-600 text-white"
                          : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                      }`}
                    >
                      {ver}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label
                  htmlFor="wiz-upload-size"
                  className="block text-xs font-semibold text-slate-700"
                >
                  Max Upload Size (Nginx + PHP MB)
                </label>
                <select
                  id="wiz-upload-size"
                  value={clientMaxBodySizeMb}
                  onChange={(e) =>
                    setClientMaxBodySizeMb(Number(e.target.value))
                  }
                  className="mt-1.5 block w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs"
                >
                  <option value={64}>64 MB</option>
                  <option value={128}>128 MB (Recommended)</option>
                  <option value={256}>256 MB (All-in-One / Large Media)</option>
                  <option value={512}>512 MB</option>
                  <option value={1024}>1024 MB (1 GB)</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label
                  htmlFor="wiz-canonical"
                  className="block text-xs font-semibold text-slate-700"
                >
                  Canonical Host Redirect
                </label>
                <select
                  id="wiz-canonical"
                  value={canonicalHost}
                  onChange={(e) =>
                    setCanonicalHost(e.target.value as CanonicalHost)
                  }
                  className="mt-1.5 block w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs"
                >
                  <option value="apex">
                    www.{cleanPreviewDomain} → {cleanPreviewDomain} (Default)
                  </option>
                  <option value="www">
                    {cleanPreviewDomain} → www.{cleanPreviewDomain}
                  </option>
                  <option value="none">No redirect</option>
                </select>
              </div>

              <div>
                <label
                  htmlFor="wiz-mem"
                  className="block text-xs font-semibold text-slate-700"
                >
                  PHP Memory Limit
                </label>
                <select
                  id="wiz-mem"
                  value={memoryLimitMb}
                  onChange={(e) => setMemoryLimitMb(Number(e.target.value))}
                  className="mt-1.5 block w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs"
                >
                  <option value={128}>128 MB</option>
                  <option value={256}>256 MB (Recommended)</option>
                  <option value={512}>512 MB (WooCommerce / Builders)</option>
                  <option value={1024}>1024 MB</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <label className="flex items-center justify-between rounded-xl border border-slate-200/80 bg-white px-3.5 py-2 text-xs">
                <span className="font-medium text-slate-700">
                  Serve <code className="font-mono">www</code> alias
                </span>
                <input
                  type="checkbox"
                  checked={includeWww}
                  onChange={(e) => setIncludeWww(e.target.checked)}
                  className="h-4 w-4 rounded accent-indigo-600"
                />
              </label>

              <label className="flex items-center justify-between rounded-xl border border-slate-200/80 bg-white px-3.5 py-2 text-xs">
                <span className="font-medium text-slate-700">
                  Block <code className="font-mono">xmlrpc.php</code>
                </span>
                <input
                  type="checkbox"
                  checked={blockXmlRpc}
                  onChange={(e) => setBlockXmlRpc(e.target.checked)}
                  className="h-4 w-4 rounded accent-indigo-600"
                />
              </label>

              <label className="flex items-center justify-between rounded-xl border border-slate-200/80 bg-white px-3.5 py-2 text-xs">
                <span className="font-medium text-slate-700">
                  Enable Gzip compression
                </span>
                <input
                  type="checkbox"
                  checked={enableGzip}
                  onChange={(e) => setEnableGzip(e.target.checked)}
                  className="h-4 w-4 rounded accent-indigo-600"
                />
              </label>

              <label className="flex items-center justify-between rounded-xl border border-slate-200/80 bg-white px-3.5 py-2 text-xs">
                <span className="font-medium text-slate-700">
                  30-Day Static Caching
                </span>
                <input
                  type="checkbox"
                  checked={staticCacheDays > 0}
                  onChange={(e) =>
                    setStaticCacheDays(e.target.checked ? 30 : 0)
                  }
                  className="h-4 w-4 rounded accent-indigo-600"
                />
              </label>
            </div>

            <div className="rounded-xl border border-indigo-100 bg-indigo-50/70 p-3 text-[11px] text-indigo-900">
              <div className="flex items-center gap-1.5 font-semibold">
                <ShieldCheck className="h-3.5 w-3.5 text-indigo-600" />
                Guaranteed Non-Interference
              </div>
              <p className="mt-0.5 text-indigo-800/90">
                Writes only{" "}
                <code className="font-mono">
                  /opt/wpcloud/nginx/sites/{cleanPreviewDomain}.conf
                </code>{" "}
                and{" "}
                <code className="font-mono">
                  /opt/wpcloud/php/{phpVersion}/{cleanPreviewDomain}.conf
                </code>
                . Existing Next.js, Node, and PM2 services are never touched.
              </p>
            </div>
          </div>
        </div>

        <div className="mt-6 flex items-center justify-end gap-3 border-t border-slate-100 pt-5">
          <button
            type="submit"
            disabled={submitting}
            className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-6 py-3 text-xs font-semibold text-white shadow-sm shadow-indigo-500/20 transition hover:from-indigo-500 hover:to-violet-500 disabled:opacity-60"
          >
            {submitting ? (
              <>
                <RefreshCw className="h-4 w-4 animate-spin" />
                Provisioning inside /opt/wpcloud...
              </>
            ) : mode === "create" ? (
              <>
                <PlusCircle className="h-4 w-4" />
                Create WordPress Site &amp; Generate Nginx Config
              </>
            ) : (
              <>
                <UploadCloud className="h-4 w-4" />
                Import Site, Configure Database &amp; Generate Nginx Config
              </>
            )}
          </button>
        </div>
      </div>
    </form>
  );
}

