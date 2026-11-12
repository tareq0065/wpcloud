"use client";

import React, { useState } from "react";
import {
  Cloud,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  Server,
  ShieldCheck,
  Terminal,
} from "lucide-react";

interface LoginViewProps {
  totpEnabled: boolean;
  onSuccess: () => void;
}

export function LoginView({ totpEnabled, onSuccess }: LoginViewProps) {
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("wpcloud-admin-2026");
  const [totpCode, setTotpCode] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [requireTotp, setRequireTotp] = useState(totpEnabled);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password, totpCode }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.requireTotp) setRequireTotp(true);
        throw new Error(data.error || "Sign in failed");
      }
      onSuccess();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Sign in failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col justify-center bg-[#FAFAFB] px-4 py-12 sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-md">
        <div className="flex items-center justify-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-600 to-violet-600 text-white shadow-md shadow-indigo-500/20">
            <Cloud className="h-6 w-6" />
          </div>
          <div>
            <span className="text-xl font-bold tracking-tight text-slate-900">
              WPCloud
            </span>
            <span className="ml-2 rounded-full bg-indigo-50 px-2.5 py-0.5 text-xs font-medium text-indigo-700 ring-1 ring-indigo-600/15">
              Ubuntu 24.04 VPS
            </span>
          </div>
        </div>

        <h1 className="mt-6 text-center text-2xl font-semibold tracking-tight text-slate-900">
          Sign in to your WordPress Panel
        </h1>
        <p className="mt-1.5 text-center text-sm text-slate-500">
          Everything isolated inside{" "}
          <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-700">
            /opt/wpcloud
          </code>{" "}
          — existing Nginx &amp; PM2 apps untouched
        </p>

        <div className="mt-7 rounded-2xl border border-slate-200/80 bg-white p-7 shadow-sm">
          {error && (
            <div
              role="alert"
              className="mb-5 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-medium text-rose-700"
            >
              {error}
            </div>
          )}

          {/* Follows autofill-sign-in-form: semantic <form>, <label for>, autocomplete="username" & "current-password", spellcheck="false", Show password toggle */}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label
                htmlFor="wpcloud-username"
                className="block text-xs font-semibold uppercase tracking-wider text-slate-600"
              >
                Admin Username
              </label>
              <input
                id="wpcloud-username"
                name="username"
                type="text"
                autoComplete="username"
                spellCheck={false}
                autoCapitalize="none"
                autoCorrect="off"
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="mt-1.5 block w-full rounded-xl border border-slate-200 bg-slate-50/60 px-3.5 py-2.5 text-sm text-slate-900 transition focus:border-indigo-500 focus:bg-white focus:outline-none focus:ring-3 focus:ring-indigo-500/15"
              />
            </div>

            <div>
              <div className="flex items-center justify-between">
                <label
                  htmlFor="wpcloud-password"
                  className="block text-xs font-semibold uppercase tracking-wider text-slate-600"
                >
                  Password
                </label>
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  className="inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-700"
                >
                  {showPassword ? (
                    <>
                      <EyeOff className="h-3.5 w-3.5" /> Hide password
                    </>
                  ) : (
                    <>
                      <Eye className="h-3.5 w-3.5" /> Show password
                    </>
                  )}
                </button>
              </div>
              <div className="relative mt-1.5">
                <input
                  id="wpcloud-password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  enterKeyHint={requireTotp ? "next" : "done"}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="block w-full rounded-xl border border-slate-200 bg-slate-50/60 px-3.5 py-2.5 text-sm text-slate-900 transition focus:border-indigo-500 focus:bg-white focus:outline-none focus:ring-3 focus:ring-indigo-500/15"
                />
              </div>
            </div>

            {requireTotp && (
              <div>
                <label
                  htmlFor="wpcloud-totp"
                  className="block text-xs font-semibold uppercase tracking-wider text-slate-600"
                >
                  6-Digit Authenticator Code (TOTP 2FA)
                </label>
                <input
                  id="wpcloud-totp"
                  name="totp"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="123456"
                  maxLength={6}
                  value={totpCode}
                  onChange={(e) => setTotpCode(e.target.value)}
                  className="mt-1.5 block w-full rounded-xl border border-slate-200 bg-slate-50/60 px-3.5 py-2.5 font-mono text-sm tracking-widest text-slate-900 focus:border-indigo-500 focus:bg-white focus:outline-none focus:ring-3 focus:ring-indigo-500/15"
                />
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm shadow-indigo-500/20 transition hover:from-indigo-500 hover:to-violet-500 disabled:opacity-60"
            >
              <Lock className="h-4 w-4" />
              {loading ? "Signing in..." : "Sign In"}
            </button>
          </form>

          <div className="mt-6 rounded-xl border border-slate-100 bg-slate-50/80 p-3.5 text-xs text-slate-600">
            <div className="flex items-center gap-1.5 font-semibold text-slate-700">
              <Terminal className="h-3.5 w-3.5 text-indigo-600" />
              Locked out on your VPS?
            </div>
            <p className="mt-1 leading-relaxed text-slate-500">
              Run{" "}
              <code className="rounded bg-white px-1.5 py-0.5 font-mono text-[11px] text-slate-800 shadow-2xs">
                sudo wpcloud reset-password
              </code>{" "}
              over SSH to generate a fresh admin password anytime.
            </p>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-3 gap-2 text-center text-[11px] text-slate-500">
          <div className="flex items-center justify-center gap-1.5 rounded-xl border border-slate-200/60 bg-white px-2.5 py-2">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
            <span>PM2 Untouched</span>
          </div>
          <div className="flex items-center justify-center gap-1.5 rounded-xl border border-slate-200/60 bg-white px-2.5 py-2">
            <Server className="h-3.5 w-3.5 text-indigo-600" />
            <span>Node v24.12.0</span>
          </div>
          <div className="flex items-center justify-center gap-1.5 rounded-xl border border-slate-200/60 bg-white px-2.5 py-2">
            <KeyRound className="h-3.5 w-3.5 text-violet-600" />
            <span>Auto Nginx + SSL</span>
          </div>
        </div>
      </div>
    </div>
  );
}

