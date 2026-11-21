import net from "node:net";
import fs from "node:fs/promises";
import path from "node:path";
import { AgentEngine } from "./engine.js";

export { AgentEngine } from "./engine.js";
export type { CommandAuditEntry, MailStackStatus } from "./engine.js";
export {
  decodeImapUtf7,
  folderToMaildirSubdir,
  syncImapToMaildir,
  testImapLogin,
} from "./imap-backup.js";
export type {
  ImapFolderInfo,
  ImapSyncProgress,
  ImapSyncResult,
} from "./imap-backup.js";
export {
  appendSentToMaildir,
  listMaildirFolders,
  listMaildirMessages,
  readMaildirMessage,
  sanitizeEmailHtml,
  sendSmtpMessage,
} from "./maildir-reader.js";
export type {
  MaildirAttachment,
  MaildirFolderSummary,
  MaildirMessageDetail,
  MaildirMessageSummary,
} from "./maildir-reader.js";

const SOCKET_PATH =
  process.env.WPCLOUD_AGENT_SOCKET ||
  (process.platform === "linux"
    ? "/run/wpcloud/agent.sock"
    : path.join(process.cwd(), ".wpcloud-runtime", "agent.sock"));

async function startSocketDaemon() {
  const engine = new AgentEngine();
  await engine.ensureDirectoryLayout();

  await fs.mkdir(path.dirname(SOCKET_PATH), { recursive: true });
  await fs.rm(SOCKET_PATH, { force: true });

  const server = net.createServer((socket) => {
    let buffer = "";
    socket.on("data", async (chunk) => {
      buffer += chunk.toString("utf8");
      if (!buffer.includes("\n")) return;

      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const req = JSON.parse(line) as {
            id: string;
            action: string;
            payload: Record<string, unknown>;
          };
          let result: unknown = null;

          if (req.action === "server.metrics") {
            result = await engine.getServerMetrics();
          } else if (req.action === "dns.check") {
            result = await engine.checkDomainDns(
              req.payload as Parameters<typeof engine.checkDomainDns>[0]
            );
          } else if (req.action === "nginx.inspect") {
            result = await engine.inspectExternalNginxDomains();
          } else if (req.action === "audit.list") {
            result = engine.getAuditLog();
          } else {
            throw new Error(`Unknown action: ${req.action}`);
          }

          socket.write(
            JSON.stringify({ id: req.id, ok: true, result }) + "\n"
          );
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          socket.write(JSON.stringify({ ok: false, error: message }) + "\n");
        }
      }
    });
  });

  server.listen(SOCKET_PATH, async () => {
    try {
      await fs.chmod(SOCKET_PATH, 0o666);
    } catch {
      // ignore chmod in non-root dev environments
    }
    console.log(
      `[wpcloud-agent] Listening on Unix socket: ${SOCKET_PATH} (root=${engine.wpcloudRoot}, dryRun=${engine.isDryRun})`
    );
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startSocketDaemon().catch((err) => {
    console.error("[wpcloud-agent] Fatal error:", err);
    process.exit(1);
  });
}
