import http from "node:http";
import https from "node:https";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import next from "next";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dev = process.env.NODE_ENV !== "production";
const hostname = "0.0.0.0";
const port = Number(process.env.WPCLOUD_PANEL_PORT || process.env.PORT || 7070);
const wpcloudRoot = process.env.WPCLOUD_ROOT || "/opt/wpcloud";

const app = next({ dev, hostname, port, dir: __dirname });
const handle = app.getRequestHandler();

await app.prepare();

const certPath = path.join(wpcloudRoot, "ssl", "panel", "cert.pem");
const keyPath = path.join(wpcloudRoot, "ssl", "panel", "key.pem");
const configPath = path.join(wpcloudRoot, "config", "config.json");

let useHttps = process.env.WPCLOUD_PANEL_HTTPS !== "false";
try {
  if (fs.existsSync(configPath)) {
    const cfg = JSON.parse(fs.readFileSync(configPath, "utf8"));
    if (typeof cfg.panelHttps === "boolean") {
      useHttps = cfg.panelHttps;
    }
  }
} catch {
  // default to HTTPS if cert exists
}

if (useHttps && fs.existsSync(certPath) && fs.existsSync(keyPath)) {
  const httpsOptions = {
    key: fs.readFileSync(keyPath),
    cert: fs.readFileSync(certPath),
  };

  const server = https.createServer(httpsOptions, (req, res) => {
    handle(req, res);
  });

  // If a browser connects using plain http://, redirect to https://
  server.on("clientError", (err, socket) => {
    if (
      err &&
      (err.code === "ERR_SSL_HTTP_REQUEST" ||
        (err.message && err.message.includes("http request")))
    ) {
      const vpsIp =
        process.env.WPCLOUD_VPS_IPV4 ||
        (socket.localAddress
          ? socket.localAddress.replace(/^::ffff:/, "")
          : "localhost");
      socket.end(
        `HTTP/1.1 307 Temporary Redirect\r\nLocation: https://${vpsIp}:${port}/\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`
      );
      return;
    }
    socket.destroy(err);
  });

  server.listen(port, hostname, () => {
    console.log(
      `[wpcloud-panel] Ready on https://${hostname}:${port} (self-signed HTTPS active)`
    );
  });
} else {
  const server = http.createServer((req, res) => {
    handle(req, res);
  });
  server.listen(port, hostname, () => {
    console.log(`[wpcloud-panel] Ready on http://${hostname}:${port}`);
  });
}

