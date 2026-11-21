import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import {
  AgentEngine,
  decodeImapUtf7,
  folderToMaildirSubdir,
  listMaildirFolders,
  listMaildirMessages,
  readMaildirMessage,
  syncImapToMaildir,
} from "../dist/index.js";

test("decodeImapUtf7 and folderToMaildirSubdir map standard and custom folders safely", () => {
  assert.equal(decodeImapUtf7("INBOX"), "INBOX");
  assert.equal(decodeImapUtf7("R&AOk-sum&AOk-"), "Résumé");
  assert.equal(decodeImapUtf7("Q&-A"), "Q&A");

  assert.equal(folderToMaildirSubdir("INBOX"), "");
  assert.equal(folderToMaildirSubdir("Sent Items"), ".Sent");
  assert.equal(folderToMaildirSubdir("Drafts"), ".Drafts");
  assert.equal(folderToMaildirSubdir("Deleted Items"), ".Trash");
  assert.equal(folderToMaildirSubdir("Archive"), ".Archive");
  assert.equal(folderToMaildirSubdir("Clients/Acme"), ".Clients.Acme");
  assert.equal(folderToMaildirSubdir("../../etc/passwd"), ".etc.passwd");
});

test("AgentEngine provisions Maildir mailbox, generates real 2048-bit RSA DKIM key, and verifies credentials", async () => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "wpcloud-mail-test-"));
  try {
    const engine = new AgentEngine({ wpcloudRoot: tmpRoot, dryRun: true });
    const dkim = await engine.generateMailDomainDkim("example.com");
    assert.ok(dkim.publicKeyBase64.length > 250);
    const privPem = await fs.readFile(dkim.privateKeyPath, "utf8");
    assert.match(privPem, /BEGIN PRIVATE KEY/);

    const mb = await engine.provisionMailboxAccount({
      domain: "example.com",
      localPart: "info",
      email: "info@example.com",
      password: "TitanBackupPassword!2026",
      quotaMb: 2048,
    });

    const passwdText = await fs.readFile(path.join(tmpRoot, "mail", "users.passwd"), "utf8");
    assert.match(passwdText, /^info@example\.com:\{SSHA256\}/m);
    assert.match(passwdText, /storage=2048M/);

    const okAuth = await engine.verifyMailboxCredentials(
      "info@example.com",
      "TitanBackupPassword!2026"
    );
    assert.equal(okAuth.valid, true);
    assert.equal(okAuth.domain, "example.com");
    assert.equal(okAuth.localPart, "info");

    const badAuth = await engine.verifyMailboxCredentials("info@example.com", "wrong");
    assert.equal(badAuth.valid, false);

    const folders = await listMaildirFolders(mb.maildirRoot);
    assert.ok(folders.some((f) => f.id === "INBOX"));
    assert.ok(folders.some((f) => f.id === ".Sent"));
  } finally {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  }
});

test("syncImapToMaildir downloads all folders, attachments, and flags with deduplication", async () => {
  const eml1 = [
    "From: Alice <alice@titan-source.test>",
    "To: info@example.com",
    "Subject: =?UTF-8?B?SGVsbG8gVGl0YW4gQmFja3Vw?=",
    "Message-ID: <msg-1@titan-source.test>",
    "Date: Thu, 20 Nov 2026 10:00:00 +0000",
    "MIME-Version: 1.0",
    'Content-Type: multipart/mixed; boundary="BOUND42"',
    "",
    "--BOUND42",
    "Content-Type: text/html; charset=utf-8",
    "",
    '<div><p>Hello <b>Titan</b>!</p><script>alert(1)</script></div>',
    "--BOUND42",
    "Content-Type: text/plain; name=\"invoice.txt\"",
    "Content-Disposition: attachment; filename=\"invoice.txt\"",
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from("Invoice #1001 - Paid", "utf8").toString("base64"),
    "--BOUND42--",
    "",
  ].join("\r\n");

  const eml2 = [
    "From: info@example.com",
    "To: client@example.org",
    "Subject: Sent Quote",
    "Message-ID: <msg-2@titan-source.test>",
    "Date: Fri, 21 Nov 2026 12:30:00 +0000",
    "Content-Type: text/plain; charset=utf-8",
    "",
    "Please find the attached quote.",
    "",
  ].join("\r\n");

  // Start lightweight mock IMAP server
  let currentFolder = "INBOX";
  const server = net.createServer((socket) => {
    socket.write("* OK Mock Titan IMAP4rev1 ready\r\n");
    let buf = "";
    socket.on("data", (chunk) => {
      buf += chunk.toString("utf8");
      while (buf.includes("\r\n")) {
        const idx = buf.indexOf("\r\n");
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const space = line.indexOf(" ");
        const tag = line.slice(0, space);
        const cmd = line.slice(space + 1);

        if (cmd.startsWith("LOGIN ")) {
          if (cmd.includes('"secret"pass"'.replace(/"/g, '\\"')) || cmd.includes("secretpass")) {
            socket.write(`${tag} OK LOGIN completed\r\n`);
          } else {
            socket.write(`${tag} NO Invalid credentials\r\n`);
          }
        } else if (cmd.startsWith("LIST ")) {
          socket.write('* LIST (\\HasNoChildren) "/" "INBOX"\r\n');
          socket.write('* LIST (\\Sent) "/" "Sent Items"\r\n');
          socket.write(`${tag} OK LIST completed\r\n`);
        } else if (cmd.startsWith("EXAMINE ")) {
          currentFolder = cmd.includes("Sent Items") ? "Sent Items" : "INBOX";
          socket.write(`* OK [UIDVALIDITY ${currentFolder === "INBOX" ? "101" : "202"}] UIDs valid\r\n`);
          socket.write(`${tag} OK [READ-ONLY] EXAMINE completed\r\n`);
        } else if (cmd === "UID SEARCH ALL") {
          socket.write(`* SEARCH ${currentFolder === "INBOX" ? "10" : "20"}\r\n`);
          socket.write(`${tag} OK UID SEARCH completed\r\n`);
        } else if (cmd.startsWith("UID FETCH ")) {
          const payload = currentFolder === "INBOX" ? eml1 : eml2;
          const rawBuf = Buffer.from(payload, "utf8");
          const flags = currentFolder === "INBOX" ? "\\Seen \\Flagged" : "\\Seen";
          socket.write(
            `* 1 FETCH (UID ${currentFolder === "INBOX" ? "10" : "20"} FLAGS (${flags}) INTERNALDATE "20-Nov-2026 10:00:00 +0000" RFC822 {${rawBuf.length}}\r\n`
          );
          socket.write(rawBuf);
          socket.write(")\r\n");
          socket.write(`${tag} OK UID FETCH completed\r\n`);
        } else if (cmd === "LOGOUT") {
          socket.write("* BYE logging out\r\n");
          socket.write(`${tag} OK LOGOUT completed\r\n`);
          socket.end();
        } else {
          socket.write(`${tag} BAD Unknown command\r\n`);
        }
      }
    });
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;

  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "wpcloud-imap-sync-"));
  try {
    const engine = new AgentEngine({ wpcloudRoot: tmpRoot, dryRun: true });
    const mb = await engine.provisionMailboxAccount({
      domain: "example.com",
      localPart: "info",
      email: "info@example.com",
      password: "localPassword123",
      quotaMb: 1024,
    });

    // First sync: copies 2 messages across 2 folders
    const first = await syncImapToMaildir({
      sourceHost: "127.0.0.1",
      sourcePort: port,
      useTls: false,
      sourceEmail: "info@example.com",
      sourcePassword: "secretpass",
      mailboxRoot: mb.mailboxRoot,
    });
    assert.equal(first.foldersSynced, 2);
    assert.equal(first.totalMessages, 2);
    assert.equal(first.messagesCopied, 2);
    assert.equal(first.skippedExisting, 0);

    // Second sync: deduplicates both messages!
    const second = await syncImapToMaildir({
      sourceHost: "127.0.0.1",
      sourcePort: port,
      useTls: false,
      sourceEmail: "info@example.com",
      sourcePassword: "secretpass",
      mailboxRoot: mb.mailboxRoot,
    });
    assert.equal(second.messagesCopied, 0);
    assert.equal(second.skippedExisting, 2);

    // Verify Maildir reader loads INBOX & Sent, sanitizes <script>, and extracts attachment
    const inboxList = await listMaildirMessages(mb.maildirRoot, "INBOX");
    assert.equal(inboxList.total, 1);
    assert.equal(inboxList.messages[0].subject, "Hello Titan Backup");
    assert.equal(inboxList.messages[0].unread, false);
    assert.equal(inboxList.messages[0].flagged, true);

    const { detail, attachmentPayloads } = await readMaildirMessage(
      mb.maildirRoot,
      "INBOX",
      inboxList.messages[0].id
    );
    assert.match(detail.htmlBody, /Hello <b>Titan<\/b>!/);
    assert.doesNotMatch(detail.htmlBody, /<script>/i);
    assert.equal(detail.attachments.length, 1);
    assert.equal(detail.attachments[0].filename, "invoice.txt");
    assert.equal(attachmentPayloads[0].data.toString("utf8"), "Invoice #1001 - Paid");

    const sentList = await listMaildirMessages(mb.maildirRoot, ".Sent");
    assert.equal(sentList.total, 1);
    assert.equal(sentList.messages[0].subject, "Sent Quote");
  } finally {
    await fs.rm(tmpRoot, { recursive: true, force: true });
    server.close();
  }
});

