import net from "node:net";
import tls from "node:tls";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

export interface ImapFolderInfo {
  rawName: string;
  displayName: string;
  delimiter: string;
  flags: string[];
  maildirSubdir: string;
}

export interface ImapSyncProgress {
  currentFolder: string;
  foldersSynced: number;
  totalFolders: number;
  totalMessages: number;
  messagesCopied: number;
  skippedExisting: number;
}

export interface ImapSyncResult {
  foldersSynced: number;
  totalMessages: number;
  messagesCopied: number;
  skippedExisting: number;
  bytesWritten: number;
}

interface ParsedImapResponse {
  lines: string[];
  literals: Buffer[];
  statusLine: string;
  tagStatus: "OK" | "NO" | "BAD";
}

interface SyncStateFile {
  folders: Record<
    string,
    {
      uidValidity: string;
      uids: number[];
    }
  >;
  messageIds: string[];
}

/**
 * Decodes IMAP Modified UTF-7 (RFC 3501 section 5.1.3) folder names to UTF-8.
 */
export function decodeImapUtf7(input: string): string {
  return input.replace(/&([^-]*)-/g, (_match, encoded: string) => {
    if (encoded === "") return "&";
    const b64 = encoded.replace(/,/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    const buf = Buffer.from(padded, "base64");
    // UTF-16BE to UTF-8
    let out = "";
    for (let i = 0; i + 1 < buf.length; i += 2) {
      out += String.fromCharCode((buf[i] << 8) | buf[i + 1]);
    }
    return out;
  });
}

/**
 * Maps an IMAP folder name into a safe Maildir++ subdirectory name.
 * INBOX maps to "" (the Maildir root itself); other folders map to ".Name".
 */
export function folderToMaildirSubdir(displayName: string, delimiter = "/"): string {
  const trimmed = displayName.trim();
  if (!trimmed || trimmed.toUpperCase() === "INBOX") {
    return "";
  }

  const lower = trimmed.toLowerCase();
  if (lower === "sent" || lower === "sent items" || lower === "sent messages") {
    return ".Sent";
  }
  if (lower === "drafts" || lower === "draft") {
    return ".Drafts";
  }
  if (lower === "trash" || lower === "deleted items" || lower === "deleted messages" || lower === "bin") {
    return ".Trash";
  }
  if (lower === "archive" || lower === "archives") {
    return ".Archive";
  }
  if (lower === "junk" || lower === "spam" || lower === "junk e-mail" || lower === "bulk mail") {
    return ".Junk";
  }

  const parts = (delimiter ? trimmed.split(delimiter) : [trimmed])
    .map((p) => p.trim())
    .filter((p) => p.length > 0 && p !== "." && p !== "..")
    .map((p) => p.replace(/[/.\\\x00-\x1f]/g, "_").replace(/^\.+/, "").trim())
    .filter((p) => p.length > 0 && p !== "." && p !== "..");

  if (parts.length === 0) return ".Recovered";
  return "." + parts.join(".");
}

function escapeImapQuoted(val: string): string {
  return `"${val.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function needsImapLiteral(val: string): boolean {
  return /[\r\n\x00-\x1f\x7f-\xff]/.test(val);
}

/**
 * Minimal, strict Buffer-based IMAP4rev1 client over TLS/TCP.
 * Handles literal `{byteLen}\r\n<rawBytes>` framing accurately without UTF-8 corruption.
 */
class MinimalImapClient {
  private socket: net.Socket | tls.TLSSocket | null = null;
  private buffer: Buffer = Buffer.alloc(0);
  private tagCounter = 0;
  private waitData: (() => void) | null = null;
  private socketError: Error | null = null;
  private closed = false;

  public async connect(options: {
    host: string;
    port: number;
    useTls: boolean;
    rejectUnauthorized?: boolean;
    timeoutMs?: number;
  }): Promise<string> {
    const timeoutMs = options.timeoutMs ?? 30_000;

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Connection to ${options.host}:${options.port} timed out`));
      }, timeoutMs);

      const onConnect = () => {
        clearTimeout(timer);
        resolve();
      };

      const sock = options.useTls
        ? tls.connect(
            {
              host: options.host,
              port: options.port,
              servername: options.host,
              rejectUnauthorized: options.rejectUnauthorized ?? true,
            },
            onConnect
          )
        : net.connect({ host: options.host, port: options.port }, onConnect);

      this.socket = sock;
      sock.setTimeout(120_000);

      sock.on("data", (chunk: Buffer) => {
        this.buffer = Buffer.concat([this.buffer, chunk]);
        if (this.waitData) {
          const cb = this.waitData;
          this.waitData = null;
          cb();
        }
      });

      sock.on("error", (err) => {
        clearTimeout(timer);
        this.socketError = err;
        if (this.waitData) {
          const cb = this.waitData;
          this.waitData = null;
          cb();
        }
        reject(err);
      });

      sock.on("timeout", () => {
        const err = new Error(`IMAP socket idle timeout on ${options.host}:${options.port}`);
        this.socketError = err;
        sock.destroy(err);
      });

      sock.on("close", () => {
        this.closed = true;
        if (this.waitData) {
          const cb = this.waitData;
          this.waitData = null;
          cb();
        }
      });
    });

    const greeting = await this.readLine();
    if (!greeting.startsWith("* OK") && !greeting.startsWith("* PREAUTH")) {
      throw new Error(`Unexpected IMAP greeting from ${options.host}: ${greeting}`);
    }
    return greeting;
  }

  private async ensureBytes(minBytes: number): Promise<void> {
    while (this.buffer.length < minBytes) {
      if (this.socketError) throw this.socketError;
      if (this.closed) throw new Error("IMAP connection closed unexpectedly");
      await new Promise<void>((resolve) => {
        this.waitData = resolve;
      });
    }
  }

  private async readLine(): Promise<string> {
    while (true) {
      const idx = this.buffer.indexOf("\r\n");
      if (idx !== -1) {
        const line = this.buffer.subarray(0, idx).toString("utf8");
        this.buffer = this.buffer.subarray(idx + 2);
        return line;
      }
      if (this.socketError) throw this.socketError;
      if (this.closed) throw new Error("IMAP connection closed while reading line");
      await new Promise<void>((resolve) => {
        this.waitData = resolve;
      });
    }
  }

  private async readExact(byteLen: number): Promise<Buffer> {
    await this.ensureBytes(byteLen);
    const slice = Buffer.from(this.buffer.subarray(0, byteLen));
    this.buffer = this.buffer.subarray(byteLen);
    return slice;
  }

  private writeRaw(data: string | Buffer): void {
    if (!this.socket || this.closed) {
      throw new Error("IMAP socket is not open");
    }
    this.socket.write(data);
  }

  public async command(cmd: string): Promise<ParsedImapResponse> {
    const tag = `A${String(++this.tagCounter).padStart(4, "0")}`;
    this.writeRaw(`${tag} ${cmd}\r\n`);
    return this.readTaggedResponse(tag);
  }

  public async login(username: string, password: string): Promise<void> {
    let resp: ParsedImapResponse;
    if (!needsImapLiteral(username) && !needsImapLiteral(password)) {
      resp = await this.command(
        `LOGIN ${escapeImapQuoted(username)} ${escapeImapQuoted(password)}`
      );
    } else {
      const tag = `A${String(++this.tagCounter).padStart(4, "0")}`;
      const userBuf = Buffer.from(username, "utf8");
      const passBuf = Buffer.from(password, "utf8");
      this.writeRaw(`${tag} LOGIN {${userBuf.length}}\r\n`);
      const cont1 = await this.readLine();
      if (!cont1.startsWith("+")) {
        throw new Error(`IMAP LOGIN failed before username literal: ${cont1}`);
      }
      this.writeRaw(userBuf);
      this.writeRaw(` {${passBuf.length}}\r\n`);
      const cont2 = await this.readLine();
      if (!cont2.startsWith("+")) {
        throw new Error(`IMAP LOGIN failed before password literal: ${cont2}`);
      }
      this.writeRaw(passBuf);
      this.writeRaw("\r\n");
      resp = await this.readTaggedResponse(tag);
    }

    if (resp.tagStatus !== "OK") {
      throw new Error(`IMAP authentication failed: ${resp.statusLine}`);
    }
  }

  private async readTaggedResponse(tag: string): Promise<ParsedImapResponse> {
    const lines: string[] = [];
    const literals: Buffer[] = [];

    while (true) {
      let line = await this.readLine();
      lines.push(line);

      // Handle any `{N}` literal payloads embedded in this response item
      while (/\{(\d+)\}$/.test(line)) {
        const match = line.match(/\{(\d+)\}$/);
        if (!match) break;
        const literalLen = Number(match[1]);
        const payload = await this.readExact(literalLen);
        literals.push(payload);
        // After a literal, IMAP continues the same logical response line until \r\n
        line = await this.readLine();
        lines.push(line);
      }

      if (line.startsWith(`${tag} `)) {
        const rest = line.slice(tag.length + 1);
        const tagStatus = rest.startsWith("OK")
          ? "OK"
          : rest.startsWith("NO")
            ? "NO"
            : "BAD";
        return {
          lines,
          literals,
          statusLine: rest,
          tagStatus,
        };
      }
    }
  }

  public async listFolders(): Promise<ImapFolderInfo[]> {
    const resp = await this.command(`LIST "" "*"`);
    if (resp.tagStatus !== "OK") {
      throw new Error(`IMAP LIST failed: ${resp.statusLine}`);
    }

    const folders: ImapFolderInfo[] = [];
    let literalIdx = 0;

    for (let i = 0; i < resp.lines.length; i++) {
      const line = resp.lines[i];
      if (!line.startsWith("* LIST ")) continue;

      const match = line.match(/^\* LIST \(([^)]*)\)\s+(NIL|"[^"]*")\s+(.+)$/);
      if (!match) continue;

      const flags = match[1]
        .split(/\s+/)
        .map((f) => f.trim())
        .filter(Boolean);
      const delimiterRaw = match[2] === "NIL" ? "/" : match[2].slice(1, -1);
      let rawNameToken = match[3].trim();

      let rawName: string;
      let literalArg: string | null = null;
      if (/^\{\d+\}$/.test(rawNameToken)) {
        const buf = resp.literals[literalIdx++];
        rawName = buf ? buf.toString("utf8") : "";
        literalArg = rawName;
      } else if (rawNameToken.startsWith('"') && rawNameToken.endsWith('"')) {
        rawName = rawNameToken.slice(1, -1).replace(/\\(["\\])/g, "$1");
      } else {
        rawName = rawNameToken;
      }

      if (flags.some((f) => f.toLowerCase() === "\\noselect")) {
        continue;
      }

      const displayName = decodeImapUtf7(rawName);
      folders.push({
        rawName: literalArg ?? rawName,
        displayName,
        delimiter: delimiterRaw || "/",
        flags,
        maildirSubdir: folderToMaildirSubdir(displayName, delimiterRaw || "/"),
      });
    }

    // Ensure INBOX is always first
    folders.sort((a, b) => {
      if (a.maildirSubdir === "") return -1;
      if (b.maildirSubdir === "") return 1;
      return a.displayName.localeCompare(b.displayName);
    });

    return folders;
  }

  public async examineFolder(rawName: string): Promise<{ uidValidity: string }> {
    let resp: ParsedImapResponse;
    if (!needsImapLiteral(rawName)) {
      resp = await this.command(`EXAMINE ${escapeImapQuoted(rawName)}`);
    } else {
      const tag = `A${String(++this.tagCounter).padStart(4, "0")}`;
      const buf = Buffer.from(rawName, "utf8");
      this.writeRaw(`${tag} EXAMINE {${buf.length}}\r\n`);
      const cont = await this.readLine();
      if (!cont.startsWith("+")) {
        throw new Error(`IMAP EXAMINE literal rejected: ${cont}`);
      }
      this.writeRaw(buf);
      this.writeRaw("\r\n");
      resp = await this.readTaggedResponse(tag);
    }

    if (resp.tagStatus !== "OK") {
      throw new Error(`IMAP EXAMINE "${rawName}" failed: ${resp.statusLine}`);
    }

    let uidValidity = "0";
    for (const line of resp.lines) {
      const m = line.match(/\[UIDVALIDITY\s+(\d+)\]/i);
      if (m) {
        uidValidity = m[1];
        break;
      }
    }
    return { uidValidity };
  }

  public async searchAllUids(): Promise<number[]> {
    const resp = await this.command("UID SEARCH ALL");
    if (resp.tagStatus !== "OK") {
      throw new Error(`IMAP UID SEARCH ALL failed: ${resp.statusLine}`);
    }
    const uids: number[] = [];
    for (const line of resp.lines) {
      if (line.startsWith("* SEARCH")) {
        const parts = line.slice("* SEARCH".length).trim().split(/\s+/);
        for (const part of parts) {
          const num = Number(part);
          if (Number.isInteger(num) && num > 0) {
            uids.push(num);
          }
        }
      }
    }
    return uids;
  }

  public async fetchMessage(uid: number): Promise<{
    flags: string[];
    internalDate: Date;
    rawRfc822: Buffer;
  } | null> {
    const resp = await this.command(`UID FETCH ${uid} (FLAGS INTERNALDATE RFC822)`);
    if (resp.tagStatus !== "OK") {
      throw new Error(`IMAP UID FETCH ${uid} failed: ${resp.statusLine}`);
    }
    if (resp.literals.length === 0) {
      return null;
    }

    const joinedMeta = resp.lines.join(" ");
    const flagsMatch = joinedMeta.match(/FLAGS\s*\(([^)]*)\)/i);
    const flags = flagsMatch
      ? flagsMatch[1]
          .split(/\s+/)
          .map((f) => f.trim())
          .filter(Boolean)
      : [];

    const dateMatch = joinedMeta.match(/INTERNALDATE\s+"([^"]+)"/i);
    const parsedDate = dateMatch ? new Date(dateMatch[1]) : new Date();
    const internalDate = Number.isNaN(parsedDate.getTime()) ? new Date() : parsedDate;

    return {
      flags,
      internalDate,
      rawRfc822: resp.literals[0],
    };
  }

  public async logout(): Promise<void> {
    try {
      if (this.socket && !this.closed) {
        await this.command("LOGOUT");
      }
    } catch {
      // ignore logout errors
    } finally {
      this.socket?.destroy();
      this.closed = true;
    }
  }
}

function flagsToMaildirSuffix(flags: string[]): string {
  const chars = new Set<string>();
  for (const flag of flags) {
    const lower = flag.toLowerCase();
    if (lower === "\\draft") chars.add("D");
    if (lower === "\\flagged") chars.add("F");
    if (lower === "\\answered") chars.add("R");
    if (lower === "\\seen") chars.add("S");
    if (lower === "\\deleted") chars.add("T");
  }
  return Array.from(chars).sort().join("");
}

function extractMessageIdHeader(raw: Buffer): string | null {
  // Inspect only headers (before first \r\n\r\n or \n\n)
  const headerEnd = raw.indexOf("\r\n\r\n");
  const headerText = raw
    .subarray(0, headerEnd !== -1 ? headerEnd : Math.min(raw.length, 16_384))
    .toString("utf8")
    .replace(/\r?\n[ \t]+/g, " ");
  const m = headerText.match(/^Message-ID:\s*([^\r\n]+)/im);
  return m ? m[1].trim() : null;
}

async function ensureMaildirFolder(maildirRoot: string, subdir: string): Promise<string> {
  const base = subdir ? path.join(maildirRoot, subdir) : maildirRoot;
  await fs.mkdir(path.join(base, "cur"), { recursive: true });
  await fs.mkdir(path.join(base, "new"), { recursive: true });
  await fs.mkdir(path.join(base, "tmp"), { recursive: true });
  if (subdir) {
    // Maildir++ marker file so Dovecot recognizes the subfolder
    try {
      await fs.writeFile(path.join(base, "maildirfolder"), "", { flag: "wx" });
    } catch {
      // already exists
    }
  }
  return base;
}

/**
 * Verifies IMAP login & lists selectable folders (used for fast credential validation).
 */
export async function testImapLogin(params: {
  host: string;
  port?: number;
  useTls?: boolean;
  rejectUnauthorized?: boolean;
  email: string;
  password: string;
}): Promise<{ folders: ImapFolderInfo[] }> {
  const client = new MinimalImapClient();
  const port = params.port ?? 993;
  const useTls = params.useTls ?? port === 993;
  try {
    await client.connect({
      host: params.host,
      port,
      useTls,
      rejectUnauthorized: params.rejectUnauthorized,
    });
    await client.login(params.email, params.password);
    const folders = await client.listFolders();
    return { folders };
  } finally {
    await client.logout();
  }
}

/**
 * Connects to an external IMAP server (e.g. imap.titan.email:993) and backs up all
 * folders and messages into standard Maildir++ format with UID + Message-ID deduplication.
 */
export async function syncImapToMaildir(params: {
  sourceHost: string;
  sourcePort?: number;
  useTls?: boolean;
  rejectUnauthorized?: boolean;
  sourceEmail: string;
  sourcePassword: string;
  mailboxRoot: string;
  onProgress?: (progress: ImapSyncProgress) => Promise<void> | void;
}): Promise<ImapSyncResult> {
  const maildirRoot = path.join(params.mailboxRoot, "Maildir");
  await ensureMaildirFolder(maildirRoot, "");

  const statePath = path.join(params.mailboxRoot, ".titan-sync-state.json");
  let syncState: SyncStateFile = { folders: {}, messageIds: [] };
  try {
    const rawState = await fs.readFile(statePath, "utf8");
    const parsed = JSON.parse(rawState) as SyncStateFile;
    syncState = {
      folders: parsed.folders || {},
      messageIds: Array.isArray(parsed.messageIds) ? parsed.messageIds : [],
    };
  } catch {
    syncState = { folders: {}, messageIds: [] };
  }

  const knownMessageIds = new Set<string>(syncState.messageIds);
  const client = new MinimalImapClient();
  const port = params.sourcePort ?? 993;
  const useTls = params.useTls ?? port === 993;

  let foldersSynced = 0;
  let totalMessages = 0;
  let messagesCopied = 0;
  let skippedExisting = 0;
  let bytesWritten = 0;

  try {
    await client.connect({
      host: params.sourceHost,
      port,
      useTls,
      rejectUnauthorized: params.rejectUnauthorized,
    });
    await client.login(params.sourceEmail, params.sourcePassword);
    const folders = await client.listFolders();

    // Update Dovecot subscriptions file
    const subscriptionNames = folders
      .map((f) => f.maildirSubdir.replace(/^\./, ""))
      .filter((name) => name.length > 0);
    if (subscriptionNames.length > 0) {
      await fs.writeFile(
        path.join(maildirRoot, "subscriptions"),
        Array.from(new Set(["Sent", "Drafts", "Trash", ...subscriptionNames])).join("\n") + "\n",
        "utf8"
      );
    }

    // First pass: examine each folder to get UIDs so progress totals are accurate
    const folderPlans: {
      folder: ImapFolderInfo;
      uidValidity: string;
      allUids: number[];
      pendingUids: number[];
      stateKey: string;
      knownUidSet: Set<number>;
    }[] = [];

    for (const folder of folders) {
      const { uidValidity } = await client.examineFolder(folder.rawName);
      const allUids = await client.searchAllUids();
      const stateKey = `${params.sourceHost}|${params.sourceEmail}|${folder.rawName}|${uidValidity}`;
      const existing = syncState.folders[stateKey]?.uids || [];
      const knownUidSet = new Set<number>(existing);
      const pendingUids = allUids.filter((u) => !knownUidSet.has(u));

      totalMessages += allUids.length;
      skippedExisting += allUids.length - pendingUids.length;

      folderPlans.push({
        folder,
        uidValidity,
        allUids,
        pendingUids,
        stateKey,
        knownUidSet,
      });
    }

    if (params.onProgress) {
      await params.onProgress({
        currentFolder: folders[0]?.displayName || "INBOX",
        foldersSynced: 0,
        totalFolders: folders.length,
        totalMessages,
        messagesCopied,
        skippedExisting,
      });
    }

    let seq = 0;
    for (const plan of folderPlans) {
      const folderDir = await ensureMaildirFolder(maildirRoot, plan.folder.maildirSubdir);
      const curDir = path.join(folderDir, "cur");
      const tmpDir = path.join(folderDir, "tmp");

      if (plan.pendingUids.length > 0) {
        await client.examineFolder(plan.folder.rawName);
      }

      for (const uid of plan.pendingUids) {
        const fetched = await client.fetchMessage(uid);
        if (!fetched) continue;

        const msgId = extractMessageIdHeader(fetched.rawRfc822);
        const dedupKey = msgId ? `${plan.folder.maildirSubdir || "INBOX"}::${msgId}` : null;
        if (dedupKey && knownMessageIds.has(dedupKey)) {
          plan.knownUidSet.add(uid);
          skippedExisting++;
          continue;
        }

        seq++;
        const suffix = flagsToMaildirSuffix(fetched.flags);
        const tsSec = Math.floor(fetched.internalDate.getTime() / 1000);
        const uniqueToken = crypto.randomBytes(4).toString("hex");
        const baseName = `${tsSec}.U${uid}S${seq}_${uniqueToken}.wpcloud`;
        const tmpFile = path.join(tmpDir, baseName);
        const destFile = path.join(curDir, `${baseName}:2,${suffix}`);

        await fs.writeFile(tmpFile, fetched.rawRfc822);
        await fs.utimes(tmpFile, fetched.internalDate, fetched.internalDate);
        await fs.rename(tmpFile, destFile);

        bytesWritten += fetched.rawRfc822.length;
        messagesCopied++;
        plan.knownUidSet.add(uid);
        if (dedupKey) {
          knownMessageIds.add(dedupKey);
        }

        if (messagesCopied % 10 === 0) {
          syncState.folders[plan.stateKey] = {
            uidValidity: plan.uidValidity,
            uids: Array.from(plan.knownUidSet),
          };
          syncState.messageIds = Array.from(knownMessageIds);
          await fs.writeFile(statePath, JSON.stringify(syncState), "utf8");
          if (params.onProgress) {
            await params.onProgress({
              currentFolder: plan.folder.displayName,
              foldersSynced,
              totalFolders: folders.length,
              totalMessages,
              messagesCopied,
              skippedExisting,
            });
          }
        }
      }

      syncState.folders[plan.stateKey] = {
        uidValidity: plan.uidValidity,
        uids: Array.from(plan.knownUidSet),
      };
      foldersSynced++;

      if (params.onProgress) {
        await params.onProgress({
          currentFolder: plan.folder.displayName,
          foldersSynced,
          totalFolders: folders.length,
          totalMessages,
          messagesCopied,
          skippedExisting,
        });
      }
    }

    syncState.messageIds = Array.from(knownMessageIds);
    await fs.writeFile(statePath, JSON.stringify(syncState), "utf8");

    return {
      foldersSynced,
      totalMessages,
      messagesCopied,
      skippedExisting,
      bytesWritten,
    };
  } finally {
    await client.logout();
  }
}
