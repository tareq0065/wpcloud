import fs from "node:fs/promises";
import path from "node:path";
import net from "node:net";
import tls from "node:tls";
import crypto from "node:crypto";

export interface MaildirFolderSummary {
  id: string;
  label: string;
  totalCount: number;
  unreadCount: number;
}

export interface MaildirMessageSummary {
  id: string;
  folder: string;
  from: string;
  to: string;
  subject: string;
  date: string;
  timestamp: number;
  unread: boolean;
  flagged: boolean;
  replied: boolean;
  sizeBytes: number;
}

export interface MaildirAttachment {
  index: number;
  filename: string;
  contentType: string;
  sizeBytes: number;
}

export interface MaildirMessageDetail extends MaildirMessageSummary {
  cc: string;
  messageId: string;
  textBody: string;
  htmlBody: string;
  attachments: MaildirAttachment[];
}

function validateFolderId(folder: string): string {
  if (!folder || folder === "INBOX") return "";
  if (!/^\.[A-Za-z0-9._ -]+$/.test(folder) || folder.includes("..")) {
    throw new Error("Invalid folder identifier");
  }
  return folder;
}

function validateMailFilename(filename: string): string {
  if (!filename || filename.includes("/") || filename.includes("\\") || filename.includes("..")) {
    throw new Error("Invalid message identifier");
  }
  return filename;
}

function decodeRfc2047(value: string): string {
  return value.replace(
    /=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g,
    (_m, charset: string, encoding: string, text: string) => {
      try {
        let buf: Buffer;
        if (encoding.toUpperCase() === "B") {
          buf = Buffer.from(text, "base64");
        } else {
          const qp = text.replace(/_/g, " ").replace(/=([0-9A-Fa-f]{2})/g, (_h, hex: string) =>
            String.fromCharCode(parseInt(hex, 16))
          );
          buf = Buffer.from(qp, "latin1");
        }
        const norm = charset.toLowerCase();
        if (norm.includes("iso-8859-1") || norm.includes("latin1")) {
          return buf.toString("latin1");
        }
        return buf.toString("utf8");
      } catch {
        return text;
      }
    }
  );
}

function parseHeaders(headerRaw: string): Record<string, string> {
  const unfolded = headerRaw.replace(/\r?\n[ \t]+/g, " ");
  const headers: Record<string, string> = {};
  for (const line of unfolded.split(/\r?\n/)) {
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    const val = decodeRfc2047(line.slice(colon + 1).trim());
    if (!(key in headers)) {
      headers[key] = val;
    }
  }
  return headers;
}

function splitHeaderAndBody(raw: string): { headerRaw: string; bodyRaw: string } {
  const crlfIdx = raw.indexOf("\r\n\r\n");
  if (crlfIdx !== -1) {
    return {
      headerRaw: raw.slice(0, crlfIdx),
      bodyRaw: raw.slice(crlfIdx + 4),
    };
  }
  const lfIdx = raw.indexOf("\n\n");
  if (lfIdx !== -1) {
    return {
      headerRaw: raw.slice(0, lfIdx),
      bodyRaw: raw.slice(lfIdx + 2),
    };
  }
  return { headerRaw: raw, bodyRaw: "" };
}

function decodeQuotedPrintableBuffer(input: string): Buffer {
  const cleaned = input.replace(/=\r?\n/g, "");
  const bytes: number[] = [];
  for (let i = 0; i < cleaned.length; i++) {
    if (cleaned[i] === "=" && i + 2 < cleaned.length && /^[0-9A-Fa-f]{2}$/.test(cleaned.slice(i + 1, i + 3))) {
      bytes.push(parseInt(cleaned.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      bytes.push(cleaned.charCodeAt(i) & 0xff);
    }
  }
  return Buffer.from(bytes);
}

function decodeBodyBytes(bodyRaw: string, transferEncoding: string): Buffer {
  const enc = transferEncoding.trim().toLowerCase();
  if (enc === "base64") {
    return Buffer.from(bodyRaw.replace(/\s+/g, ""), "base64");
  }
  if (enc === "quoted-printable") {
    return decodeQuotedPrintableBuffer(bodyRaw);
  }
  return Buffer.from(bodyRaw, "latin1");
}

function decodeTextBuffer(buf: Buffer, contentType: string): string {
  const charsetMatch = contentType.match(/charset=["']?([^"';\s]+)/i);
  const charset = (charsetMatch?.[1] || "utf-8").toLowerCase();
  if (charset.includes("iso-8859-1") || charset.includes("latin1") || charset.includes("windows-1252")) {
    return buf.toString("latin1");
  }
  return buf.toString("utf8");
}

/**
 * Strips scripts, iframes, objects, and inline event handlers before rendering in a sandboxed iframe.
 */
export function sanitizeEmailHtml(html: string): string {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, "")
    .replace(/<(?:object|embed|applet|meta|base)\b[^>]*>/gi, "")
    .replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/(href|src)\s*=\s*(["'])\s*javascript:[^"']*\2/gi, '$1="#"');
}

interface ExtractedMimeData {
  textBody: string;
  htmlBody: string;
  attachments: {
    filename: string;
    contentType: string;
    data: Buffer;
  }[];
}

function extractMimeParts(rawPart: string): ExtractedMimeData {
  const { headerRaw, bodyRaw } = splitHeaderAndBody(rawPart);
  const headers = parseHeaders(headerRaw);
  const contentType = headers["content-type"] || "text/plain; charset=utf-8";
  const transferEncoding = headers["content-transfer-encoding"] || "7bit";
  const disposition = headers["content-disposition"] || "";

  const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;\s]+))/i);
  if (boundaryMatch && contentType.toLowerCase().includes("multipart/")) {
    const boundary = boundaryMatch[1] || boundaryMatch[2];
    const marker = `--${boundary}`;
    const sections = bodyRaw.split(marker);
    const result: ExtractedMimeData = {
      textBody: "",
      htmlBody: "",
      attachments: [],
    };
    for (const sec of sections) {
      const trimmed = sec.trimStart();
      if (!trimmed || trimmed.startsWith("--")) continue;
      const sub = extractMimeParts(trimmed);
      if (sub.textBody && !result.textBody) result.textBody = sub.textBody;
      if (sub.htmlBody && !result.htmlBody) result.htmlBody = sub.htmlBody;
      result.attachments.push(...sub.attachments);
    }
    return result;
  }

  const mimeBase = contentType.split(";")[0].trim().toLowerCase();
  const dispFilenameMatch =
    disposition.match(/filename\*?=(?:utf-8''|"?)([^";\r\n]+)/i) ||
    contentType.match(/name="?([^";\r\n]+)/i);
  const filename = dispFilenameMatch ? decodeRfc2047(dispFilenameMatch[1].replace(/"$/g, "")) : "";
  const isAttachment =
    disposition.toLowerCase().includes("attachment") ||
    (filename.length > 0 && mimeBase !== "text/plain" && mimeBase !== "text/html");

  const bytes = decodeBodyBytes(bodyRaw, transferEncoding);

  if (isAttachment) {
    return {
      textBody: "",
      htmlBody: "",
      attachments: [
        {
          filename: filename || `attachment-${crypto.randomBytes(2).toString("hex")}`,
          contentType: mimeBase || "application/octet-stream",
          data: bytes,
        },
      ],
    };
  }

  if (mimeBase === "text/html") {
    return {
      textBody: "",
      htmlBody: decodeTextBuffer(bytes, contentType),
      attachments: [],
    };
  }

  if (mimeBase === "text/plain" || mimeBase === "") {
    return {
      textBody: decodeTextBuffer(bytes, contentType),
      htmlBody: "",
      attachments: [],
    };
  }

  return {
    textBody: "",
    htmlBody: "",
    attachments: [],
  };
}

function parseMaildirFlags(filename: string, isNewDir: boolean): {
  unread: boolean;
  flagged: boolean;
  replied: boolean;
} {
  if (isNewDir) {
    return { unread: true, flagged: false, replied: false };
  }
  const flagIdx = filename.lastIndexOf(":2,");
  const flagStr = flagIdx !== -1 ? filename.slice(flagIdx + 3) : "";
  return {
    unread: !flagStr.includes("S"),
    flagged: flagStr.includes("F"),
    replied: flagStr.includes("R"),
  };
}

async function listFolderEntries(folderDir: string): Promise<
  { filePath: string; filename: string; isNewDir: boolean }[]
> {
  const entries: { filePath: string; filename: string; isNewDir: boolean }[] = [];
  for (const sub of ["cur", "new"] as const) {
    const dir = path.join(folderDir, sub);
    try {
      const names = await fs.readdir(dir);
      for (const name of names) {
        if (name.startsWith(".")) continue;
        entries.push({
          filePath: path.join(dir, name),
          filename: name,
          isNewDir: sub === "new",
        });
      }
    } catch {
      // ignore missing cur/new
    }
  }
  return entries;
}

export async function listMaildirFolders(
  maildirRoot: string
): Promise<MaildirFolderSummary[]> {
  const folders: MaildirFolderSummary[] = [];

  const inboxEntries = await listFolderEntries(maildirRoot);
  folders.push({
    id: "INBOX",
    label: "INBOX",
    totalCount: inboxEntries.length,
    unreadCount: inboxEntries.filter((e) => parseMaildirFlags(e.filename, e.isNewDir).unread)
      .length,
  });

  try {
    const dirItems = await fs.readdir(maildirRoot, { withFileTypes: true });
    const subdirs = dirItems
      .filter((d) => d.isDirectory() && d.name.startsWith(".") && d.name !== "." && d.name !== "..")
      .map((d) => d.name)
      .sort((a, b) => a.localeCompare(b));

    for (const sub of subdirs) {
      const entries = await listFolderEntries(path.join(maildirRoot, sub));
      folders.push({
        id: sub,
        label: sub.slice(1).replace(/\./g, " / "),
        totalCount: entries.length,
        unreadCount: entries.filter((e) => parseMaildirFlags(e.filename, e.isNewDir).unread)
          .length,
      });
    }
  } catch {
    // Maildir not created yet
  }

  return folders;
}

export async function listMaildirMessages(
  maildirRoot: string,
  folder: string,
  options?: { limit?: number; offset?: number; query?: string }
): Promise<{ total: number; messages: MaildirMessageSummary[] }> {
  const subdir = validateFolderId(folder);
  const folderDir = subdir ? path.join(maildirRoot, subdir) : maildirRoot;
  const entries = await listFolderEntries(folderDir);

  const summaries: MaildirMessageSummary[] = [];
  const q = (options?.query || "").trim().toLowerCase();

  for (const entry of entries) {
    try {
      const stat = await fs.stat(entry.filePath);
      const fh = await fs.open(entry.filePath, "r");
      const buf = Buffer.alloc(Math.min(stat.size, 8192));
      await fh.read(buf, 0, buf.length, 0);
      await fh.close();

      const { headerRaw } = splitHeaderAndBody(buf.toString("utf8"));
      const headers = parseHeaders(headerRaw);
      const dateStr = headers["date"] || stat.mtime.toUTCString();
      const parsedTs = new Date(dateStr).getTime();
      const timestamp = Number.isNaN(parsedTs) ? stat.mtimeMs : parsedTs;
      const flags = parseMaildirFlags(entry.filename, entry.isNewDir);

      const summary: MaildirMessageSummary = {
        id: entry.filename,
        folder: folder || "INBOX",
        from: headers["from"] || "(Unknown sender)",
        to: headers["to"] || "",
        subject: headers["subject"] || "(No subject)",
        date: new Date(timestamp).toISOString(),
        timestamp,
        unread: flags.unread,
        flagged: flags.flagged,
        replied: flags.replied,
        sizeBytes: stat.size,
      };

      if (q) {
        const hay = `${summary.from} ${summary.to} ${summary.subject}`.toLowerCase();
        if (!hay.includes(q)) continue;
      }
      summaries.push(summary);
    } catch {
      // skip unreadable entry
    }
  }

  summaries.sort((a, b) => b.timestamp - a.timestamp);
  const offset = Math.max(0, options?.offset ?? 0);
  const limit = Math.min(200, Math.max(1, options?.limit ?? 50));

  return {
    total: summaries.length,
    messages: summaries.slice(offset, offset + limit),
  };
}

export async function readMaildirMessage(
  maildirRoot: string,
  folder: string,
  filename: string
): Promise<{
  detail: MaildirMessageDetail;
  attachmentPayloads: { filename: string; contentType: string; data: Buffer }[];
}> {
  const subdir = validateFolderId(folder);
  const safeName = validateMailFilename(filename);
  const folderDir = subdir ? path.join(maildirRoot, subdir) : maildirRoot;

  let filePath = path.join(folderDir, "cur", safeName);
  let isNewDir = false;
  try {
    await fs.access(filePath);
  } catch {
    filePath = path.join(folderDir, "new", safeName);
    isNewDir = true;
  }

  const stat = await fs.stat(filePath);
  const raw = await fs.readFile(filePath, "utf8");
  const { headerRaw } = splitHeaderAndBody(raw);
  const headers = parseHeaders(headerRaw);
  const extracted = extractMimeParts(raw);

  const dateStr = headers["date"] || stat.mtime.toUTCString();
  const parsedTs = new Date(dateStr).getTime();
  const timestamp = Number.isNaN(parsedTs) ? stat.mtimeMs : parsedTs;
  const flags = parseMaildirFlags(safeName, isNewDir);

  return {
    detail: {
      id: safeName,
      folder: folder || "INBOX",
      from: headers["from"] || "(Unknown sender)",
      to: headers["to"] || "",
      cc: headers["cc"] || "",
      messageId: headers["message-id"] || "",
      subject: headers["subject"] || "(No subject)",
      date: new Date(timestamp).toISOString(),
      timestamp,
      unread: flags.unread,
      flagged: flags.flagged,
      replied: flags.replied,
      sizeBytes: stat.size,
      textBody: extracted.textBody,
      htmlBody: extracted.htmlBody ? sanitizeEmailHtml(extracted.htmlBody) : "",
      attachments: extracted.attachments.map((att, index) => ({
        index,
        filename: att.filename,
        contentType: att.contentType,
        sizeBytes: att.data.length,
      })),
    },
    attachmentPayloads: extracted.attachments,
  };
}

export async function appendSentToMaildir(
  maildirRoot: string,
  rawRfc822: string
): Promise<void> {
  const sentCur = path.join(maildirRoot, ".Sent", "cur");
  await fs.mkdir(sentCur, { recursive: true });
  const filename = `${Math.floor(Date.now() / 1000)}.${crypto.randomBytes(4).toString("hex")}.wpcloud:2,S`;
  await fs.writeFile(path.join(sentCur, filename), rawRfc822, "utf8");
}

/**
 * Lightweight RFC 5321 SMTP client over Node net/tls (STARTTLS + SSL + AUTH PLAIN/LOGIN).
 */
export async function sendSmtpMessage(params: {
  host: string;
  port: number;
  secure?: boolean;
  username?: string;
  password?: string;
  from: string;
  to: string;
  subject: string;
  text: string;
}): Promise<{ rawMessage: string }> {
  const cleanFrom = params.from.replace(/[\r\n]/g, "").trim();
  const cleanTo = params.to.replace(/[\r\n]/g, "").trim();
  const cleanSubject = params.subject.replace(/[\r\n]/g, " ").trim();
  const domain = cleanFrom.split("@")[1] || "localhost";
  const msgId = `<${crypto.randomUUID()}@${domain}>`;
  const nowStr = new Date().toUTCString();

  const rawMessage = [
    `From: ${cleanFrom}`,
    `To: ${cleanTo}`,
    `Subject: ${cleanSubject}`,
    `Date: ${nowStr}`,
    `Message-ID: ${msgId}`,
    `MIME-Version: 1.0`,
    `Content-Type: text/plain; charset=UTF-8`,
    ``,
    params.text.replace(/\r?\n/g, "\r\n"),
    ``,
  ].join("\r\n");

  const useImplicitTls = params.secure ?? params.port === 465;

  let socket: net.Socket | tls.TLSSocket = await new Promise((resolve, reject) => {
    const s = useImplicitTls
      ? tls.connect({ host: params.host, port: params.port, servername: params.host }, () =>
          resolve(s)
        )
      : net.connect({ host: params.host, port: params.port }, () => resolve(s));
    s.setTimeout(20_000);
    s.on("error", reject);
  });

  let buf = "";
  const readResp = (): Promise<{ code: number; text: string }> =>
    new Promise((resolve, reject) => {
      const onData = (chunk: Buffer) => {
        buf += chunk.toString("utf8");
        const lines = buf.split("\r\n");
        for (let i = 0; i < lines.length - 1; i++) {
          const line = lines[i];
          if (/^\d{3} /.test(line)) {
            const consumed = lines.slice(0, i + 1).join("\r\n") + "\r\n";
            buf = buf.slice(consumed.length);
            cleanup();
            resolve({ code: Number(line.slice(0, 3)), text: lines.slice(0, i + 1).join("\n") });
            return;
          }
        }
      };
      const onErr = (err: Error) => {
        cleanup();
        reject(err);
      };
      const cleanup = () => {
        socket.off("data", onData);
        socket.off("error", onErr);
      };
      socket.on("data", onData);
      socket.on("error", onErr);
    });

  const sendCmd = async (cmd: string, expectedCodes: number[]) => {
    socket.write(`${cmd}\r\n`);
    const r = await readResp();
    if (!expectedCodes.includes(r.code)) {
      throw new Error(`SMTP error (${r.code}): ${r.text}`);
    }
    return r;
  };

  try {
    const greeting = await readResp();
    if (greeting.code !== 220) {
      throw new Error(`Unexpected SMTP greeting (${greeting.code}): ${greeting.text}`);
    }

    let ehlo = await sendCmd(`EHLO ${domain}`, [250]);

    if (!useImplicitTls && ehlo.text.toUpperCase().includes("STARTTLS")) {
      await sendCmd("STARTTLS", [220]);
      socket = await new Promise<tls.TLSSocket>((resolve, reject) => {
        const tlsSock = tls.connect(
          {
            socket,
            servername: params.host,
            rejectUnauthorized: params.host !== "127.0.0.1" && params.host !== "localhost",
          },
          () => resolve(tlsSock)
        );
        tlsSock.on("error", reject);
      });
      buf = "";
      ehlo = await sendCmd(`EHLO ${domain}`, [250]);
    }

    if (params.username && params.password) {
      const authPlain = Buffer.from(`\0${params.username}\0${params.password}`, "utf8").toString(
        "base64"
      );
      await sendCmd(`AUTH PLAIN ${authPlain}`, [235]);
    }

    await sendCmd(`MAIL FROM:<${cleanFrom}>`, [250]);
    await sendCmd(`RCPT TO:<${cleanTo}>`, [250, 251]);
    await sendCmd("DATA", [354]);
    const dotStuffed = rawMessage.replace(/^\./gm, "..");
    socket.write(`${dotStuffed}\r\n.\r\n`);
    const dataResp = await readResp();
    if (dataResp.code !== 250) {
      throw new Error(`SMTP DATA rejected (${dataResp.code}): ${dataResp.text}`);
    }
    await sendCmd("QUIT", [221]);
    return { rawMessage };
  } finally {
    socket.destroy();
  }
}

