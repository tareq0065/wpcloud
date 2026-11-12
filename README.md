# WPCloud — Self-Hosted WordPress, Automated Nginx & Mail Control Panel

A private Next.js 16 + Tailwind CSS 4 control panel for Ubuntu 24.04 LTS that lets you **create new WordPress sites**, **import existing WordPress sites (`.zip`/`.tar.gz` + `.sql`)**, automatically generate and test **Nginx + PHP-FPM** configs, verify **DNS & Titan Mail records**, issue **Let's Encrypt SSL**, and manage **custom mailboxes (`me@example.com`) + Titan Mail IMAP backups** — all strictly isolated inside `/opt/wpcloud`.

---

## Key Guarantees

1. **Everything Lives in `/opt/wpcloud`:**
   - `/opt/wpcloud/sites/<domain>/public` — WordPress files (freshly installed or uploaded)
   - `/opt/wpcloud/nginx/sites/<domain>.conf` — Automated Nginx vhosts
   - `/opt/wpcloud/php/{8.1,8.2,8.3}/<domain>.conf` — Isolated per-site PHP-FPM pools
   - `/opt/wpcloud/backups/<domain>/` — Pre-delete and database snapshots
   - `/opt/wpcloud/runtime/bin/node` — Copy of your `nvm` Node `v24.12.0` binary (your `nvm` setup is never modified)
2. **Never Breaks Existing Next.js, Node.js, PM2, or Nginx Setups:**
   - Never runs any `pm2` command and never touches `~/.pm2`.
   - Never edits `/etc/nginx/nginx.conf` or any file in `/etc/nginx/sites-enabled/`.
   - Adds only a 1-line `/etc/nginx/conf.d/wpcloud.conf` (`include /opt/wpcloud/nginx/sites/*.conf;`).
   - Tests every change with `nginx -t` before `systemctl reload nginx`, automatically rolling back if `nginx -t` fails.
3. **Zero Manual Nginx Editing:**
   - Choose canonical redirect (`www` → apex), upload limit (MB), `xmlrpc.php` protection, caching, and Gzip in the UI; WPCloud generates, tests, and reloads Nginx automatically.
4. **Titan Mail & Multi-Domain Email Support:**
   - Inspects existing `MX` (`mx1.titan.email`) and `SPF` records on the DNS tab so migrating a website from Hostinger never breaks client email.
   - Includes a per-site **WordPress Outbound SMTP MU-Plugin** (`wpcloud-smtp.php`) and a **Mail Server & Titan Backup (`imapsync`)** module to create `me@example.com` mailboxes or copy emails from `imap.titan.email`.

---

## Quick Start on Your Contabo Ubuntu 24.04 VPS

```bash
# 1. Upload this folder to your VPS (e.g. via scp, rsync, or git clone)
scp -r ./wpcloud user@YOUR_VPS_IP:~/wpcloud

# 2. Run the installer (detects your nvm Node v24.12.0, checks nginx -t, sets up /opt/wpcloud)
cd ~/wpcloud
sudo ./scripts/install.sh
```

After installation completes, open:
- **Panel URL (Self-Signed HTTPS):** `https://YOUR_VPS_IP:7070`
- **Adminer URL:** `http://YOUR_VPS_IP:7071`

---

## Local Development / Preview on macOS

```bash
npm install
npm run dev
# Open http://localhost:7070 (Default login: admin / wpcloud-admin-2026)
```

