import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth";
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getAgentEngine } from "@/lib/store";

const execFileAsync = promisify(execFile);

export async function POST(req: NextRequest) {
  const authError = requireAdminSession(req);
  if (authError) return authError;

  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const fileNameOverride = formData.get("fileName") as string | null;
    const chunkIndex = Number(formData.get("chunkIndex") || 0);
    const totalChunks = Number(formData.get("totalChunks") || 1);

    if (!file) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }

    const engine = getAgentEngine();
    await engine.ensureDirectoryLayout();

    const safeName = path
      .basename(fileNameOverride || file.name)
      .replace(/[^a-zA-Z0-9._-]/g, "_");
    if (
      !/^[a-zA-Z0-9][a-zA-Z0-9._-]*\.(?:zip|tar\.gz|tgz|tar|sql|sql\.gz)$/i.test(
        safeName
      )
    ) {
      return NextResponse.json(
        {
          error:
            "Unsupported upload file extension. Allowed: .zip, .tar.gz, .tgz, .tar, .sql, .sql.gz.",
        },
        { status: 400 }
      );
    }
    const uploadDir = path.join(engine.wpcloudRoot, "data", "uploads");
    await fs.mkdir(uploadDir, { recursive: true });

    const targetPath = path.join(uploadDir, safeName);
    const bytes = Buffer.from(await file.arrayBuffer());

    if (chunkIndex === 0) {
      await fs.writeFile(targetPath, bytes);
    } else {
      await fs.appendFile(targetPath, bytes);
    }

    const isCompleted = chunkIndex + 1 >= totalChunks;
    let detectedDbName = "";
    let detectedDbUser = "";
    let detectedDbPassword = "";
    let detectedTablePrefix = "wp_";
    let detectedOldDomain = "";

    // If an archive (.zip) was uploaded and completed, inspect wp-config.php inside it
    if (isCompleted && safeName.toLowerCase().endsWith(".zip")) {
      try {
        const { stdout } = await execFileAsync(
          "unzip",
          ["-p", targetPath, "*wp-config.php"],
          { timeout: 15_000, maxBuffer: 2 * 1024 * 1024 }
        );
        if (stdout) {
          const dbNameMatch = stdout.match(
            /define\s*\(\s*['"]DB_NAME['"]\s*,\s*['"]([^'"]+)['"]\s*\)/i
          );
          if (dbNameMatch && dbNameMatch[1]) detectedDbName = dbNameMatch[1];

          const dbUserMatch = stdout.match(
            /define\s*\(\s*['"]DB_USER['"]\s*,\s*['"]([^'"]+)['"]\s*\)/i
          );
          if (dbUserMatch && dbUserMatch[1]) detectedDbUser = dbUserMatch[1];

          const dbPassMatch = stdout.match(
            /define\s*\(\s*['"]DB_PASSWORD['"]\s*,\s*['"]([^'"]*)['"]\s*\)/i
          );
          if (dbPassMatch && dbPassMatch[1]) detectedDbPassword = dbPassMatch[1];

          const prefixMatch = stdout.match(
            /\$table_prefix\s*=\s*['"]([^'"]+)['"]\s*;/i
          );
          if (prefixMatch && prefixMatch[1]) detectedTablePrefix = prefixMatch[1];
        }
      } catch {
        // wp-config.php may be absent or named differently; proceed gracefully
      }
    }

    // If this is a SQL dump on the first or final chunk, inspect sample content for database name, table prefix & siteurl
    if (
      (safeName.toLowerCase().endsWith(".sql") ||
        safeName.toLowerCase().endsWith(".sql.gz")) &&
      (chunkIndex === 0 || isCompleted)
    ) {
      let snippet = "";
      try {
        const fd = await fs.open(targetPath, "r");
        const buf = Buffer.alloc(131072);
        const { bytesRead } = await fd.read(buf, 0, 131072, 0);
        await fd.close();
        snippet = buf.subarray(0, bytesRead).toString("utf8");
      } catch {
        snippet = bytes.subarray(0, Math.min(bytes.length, 65536)).toString("utf8");
      }

      const prefixMatch = snippet.match(
        /CREATE TABLE (?:IF NOT EXISTS )?`?([a-zA-Z0-9_]+?)options`?/i
      );
      if (prefixMatch && prefixMatch[1]) {
        detectedTablePrefix = prefixMatch[1];
      }
      const urlMatch = snippet.match(
        /'siteurl'\s*,\s*'https?:\/\/([^/'"]+)/i
      );
      if (urlMatch && urlMatch[1]) {
        detectedOldDomain = urlMatch[1].toLowerCase();
      }

      const dbMatch = snippet.match(
        /(?:CREATE DATABASE (?:IF NOT EXISTS )?|USE |Database:\s*`?|Current Database:\s*`?)([a-zA-Z0-9_]+)/i
      );
      if (
        dbMatch &&
        dbMatch[1] &&
        !["information_schema", "mysql", "performance_schema", "sys"].includes(
          dbMatch[1].toLowerCase()
        )
      ) {
        detectedDbName = dbMatch[1];
      } else {
        const fileDbMatch = safeName.match(
          /([a-zA-Z0-9_]+db_[a-zA-Z0-9_]+|u\d+_[a-zA-Z0-9]+)/i
        );
        if (fileDbMatch && fileDbMatch[1]) {
          const candidate = fileDbMatch[1].replace(/^[a-zA-Z0-9_]+db_/i, "");
          if (candidate) detectedDbName = candidate;
        }
      }

      if (detectedDbName && !detectedDbUser) {
        detectedDbUser = detectedDbName;
      }
    }

    return NextResponse.json({
      ok: true,
      fileName: safeName,
      savedPath: `/opt/wpcloud/data/uploads/${safeName}`,
      chunkIndex,
      totalChunks,
      completed: isCompleted,
      detectedDbName,
      detectedDbUser,
      detectedDbPassword,
      detectedTablePrefix,
      detectedOldDomain,
    });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Upload failed" },
      { status: 400 }
    );
  }
}

