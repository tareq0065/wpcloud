# WPCloud — Self-Hosted WordPress, Automated Nginx & Mail Control Panel

A private, production-grade Next.js 16 + Tailwind CSS control panel engineered for Ubuntu 24.04 LTS VPS environments. WPCloud provides automated WordPress provisioning, lossless site migrations (`.zip`/`.tar.gz` + `.sql`), isolated PHP-FPM pools (8.1, 8.2, 8.3), automated Nginx virtual hosts with zero-downtime rollback, Let's Encrypt SSL, instant IP preview URLs before DNS propagation, and an integrated multi-domain mail server (Postfix SMTP + Dovecot IMAP + OpenDKIM + WPCloud Webmail + Titan Mail IMAP backup).

---

## Non-Interference Guarantee

WPCloud is designed specifically to run safely on servers hosting existing production applications (such as Next.js, Node.js, Express, PM2, Python, or custom PHP apps):

1. **Strictly Isolated in `/opt/wpcloud`:**
   - Webroots: `/opt/wpcloud/sites/<domain>/public`
   - Nginx Vhosts: `/opt/wpcloud/nginx/sites/<domain>.conf`
   - PHP-FPM Pools: `/opt/wpcloud/php/{8.1,8.2,8.3}/<domain>.conf`
   - Logs: `/opt/wpcloud/sites/<domain>/logs/{access,error}.log`
   - Backups & Snapshots: `/opt/wpcloud/backups/`
2. **PM2 & Node Apps Untouched:**
   - WPCloud never runs any `pm2` command and never inspects or modifies `~/.pm2`.
3. **Existing Nginx Configs Protected:**
   - `/etc/nginx/nginx.conf` and `/etc/nginx/sites-enabled/*` are never modified.
   - WPCloud integrates via a single include file: `/etc/nginx/conf.d/wpcloud.conf`.
   - Every change is pre-tested with `nginx -t` before reloading. If syntax validation fails, WPCloud automatically rolls back without taking any site down.
4. **Independent Databases:**
   - External MariaDB/MySQL databases and non-WPCloud users are completely untouched.
5. **No System Package Deletions:**
   - System packages (Nginx, MariaDB, PHP, Node) are never uninstalled during updates or removal.

---

## Ports Used by WPCloud

| Port | Protocol | Purpose | Access |
| :--- | :--- | :--- | :--- |
| **`7070`** | HTTPS | WPCloud Next.js Management Panel | Public / Admin (Self-signed or custom SSL) |
| **`7071`** | HTTP | Adminer Web Database Manager | Public / Admin |
| **`80`** | HTTP | WordPress Web traffic & Let's Encrypt ACME challenges | Public |
| **`443`** | HTTPS | WordPress Secure traffic (Let's Encrypt SSL) | Public |
| **`38081–38200`** | HTTP | **Instant IP Preview Ports** (1 dedicated port per site) | Public / Testing prior to DNS cutover |
| **`993`** | IMAP (SSL) | Incoming email sync for Gmail, Outlook, Apple Mail | Public / Authenticated Clients |
| **`587`** | SMTP (STARTTLS) | Outgoing email sending from mail clients | Public / Authenticated Clients |
| **`25`** | SMTP | Direct server-to-server mail delivery (or via SMTP Relay) | Outbound |

---

## Clean Installation from Scratch (0 to 100)

### Prerequisites on Ubuntu 24.04 LTS:
- Ubuntu 24.04 LTS VPS (Contabo, Hetzner, DigitalOcean, Linode, AWS, etc.).
- Root or sudo privileges.
- **Node.js `>= 22` and `npm` installed manually beforehand** (e.g. via NodeSource or `nvm`).
  > **Strict System Runtime Policy:** WPCloud **never** installs, copies, symlinks, or wraps `node`, `npm`, or `npx`, and has **no bundled Node.js fallback**. It always uses your server's existing Node.js & `npm` directly (`npm` runs with an isolated temporary cache during builds so `~/.npm` is never modified by `sudo`). If Node.js `< 22` or `npm` is missing, the installer aborts immediately.
- Git installed (`sudo apt update && sudo apt install -y git`).

### 1. Clone the Repository
```bash
sudo git clone https://github.com/tareq0065/wpcloud.git /opt/wpcloud/app
cd /opt/wpcloud/app
```

### 2. Run the Automated Installer
```bash
sudo ./scripts/install.sh
```

What the installer does automatically:
- Verifies system baseline and validates `nginx -t`.
- Verifies your manually installed system Node.js (`>= 22`) and `npm` (uses them directly without copying or wrapping binaries).
- Installs any missing WordPress runtime packages (PHP 8.1, 8.2, 8.3 FPM, MariaDB, Certbot, WP-CLI).
- Configures UFW firewall rules for panel (`7070`), Adminer (`7071`), and preview ports (`38080:38200`).
- Installs dependencies via `npm ci` (in an isolated temp cache) and compiles `@wpcloud/shared`, `@wpcloud/agent`, and the Next.js 16 panel.
- Registers and starts systemd units (`wpcloud-agent.service` and `wpcloud-panel.service`) pointing directly to your system `node` binary.
- Generates a random, secure admin password on first install (preserved on future updates).

### 3. Log In to the Panel
Open in your browser:
👉 **`https://YOUR_VPS_IP:7070`**

- **Username:** `admin`
- **Password:** *(Printed in terminal at the end of `install.sh`)*
- If you ever forget the password, run:
  ```bash
  sudo wpcloud reset-password
  ```

---

## Instant IP Preview URL (Test Before Changing DNS)

When creating or importing a WordPress site (e.g. `greenbaylandmark.com`), the domain's DNS is usually still pointing to an old host. Normally, accessing WordPress via IP triggers canonical 301/302 redirects back to the live domain.

### How WPCloud Solves This:
- Each site is assigned a dedicated high-range preview port starting at **`38081`** (e.g. `http://YOUR_VPS_IP:38081`).
- WPCloud provisions an automated Nginx preview vhost on that port.
- An automated Must-Use plugin (`wpcloud-preview.php`) in `wp-content/mu-plugins/`:
  1. Overrides `option_home` and `option_siteurl` dynamically for preview requests.
  2. Removes `redirect_canonical` so WordPress never bounces you to the live domain.
  3. Rewrites hardcoded domain URLs in the output buffer so CSS, JS, images, and links resolve over the preview port.
  4. Rewrites login and admin redirects so `wp-admin` functions seamlessly.
- **Production Safety:** For normal visits arriving on port 80/443, the preview helper is completely dormant.

---

## WordPress Migration & Site Importer

WPCloud makes migrating existing WordPress sites effortless:

1. Click **Import Existing WP Site** in the panel.
2. Enter the domain name (e.g. `greenbaylandmark.com`).
3. Upload your archive (`.zip`, `.tar.gz`) and your database dump (`.sql`, `.sql.gz`).
4. **Database Preservation:** WPCloud auto-detects `DB_NAME`, `DB_USER`, `DB_PASSWORD`, and `$table_prefix` from your uploaded `wp-config.php` and SQL dump, preserving original credentials so themes and plugins don't break.
5. WPCloud unzips files, cleans nested folders (like `wordpress/` or `public_html/`), streams SQL directly into MariaDB, sets Linux file permissions (`755` dirs / `644` files), and generates an automated Nginx vhost.
6. Test your imported site immediately using the **Instant IP Preview URL** before switching nameservers!

---

## Complete Email & Mailbox Setup Guide

WPCloud includes an isolated Maildir storage & virtual auth system (`/opt/wpcloud/mail/`), a built-in Webmail client (`https://YOUR_VPS_IP:7070/mail`), a native TLS IMAP backup client for Titan Mail (Hostinger), and one-click provisioning for **Postfix (SMTP 25/587) + Dovecot (IMAP 993) + OpenDKIM**.

### 1. Attaching a Domain & Configuring DNS Records
In the WPCloud Panel under the **Mail Server** tab:
1. Click **Attach Mail Domain** and enter your domain (e.g. `yourdomain.com`).
2. WPCloud generates a real 2048-bit RSA DKIM keypair in `/opt/wpcloud/mail/dkim/<domain>/` and provides copyable DNS records.
3. Add these records in your domain's DNS management (Cloudflare, Namecheap, GoDaddy, Hostinger) **only when ready to switch live mail delivery to your VPS**:

| Type | Name / Host | Target / Value | Priority / TTL | Purpose |
| :--- | :--- | :--- | :--- | :--- |
| **`MX`** | `@` | `mail.yourdomain.com` | `10` (TTL 3600) | Routes incoming mail to your VPS |
| **`A`** | `mail` | `YOUR_VPS_IP` | TTL 300 | Points mail hostname to your VPS |
| **`TXT`** | `@` | `v=spf1 ip4:YOUR_VPS_IP mx ~all` | TTL 3600 | SPF authorization record |
| **`TXT`** | `wpcloud2026._domainkey` | `v=DKIM1; k=rsa; p=MIIBIjANBgkq...` | TTL 3600 | 2048-bit DKIM cryptographic signature |
| **`TXT`** | `_dmarc` | `v=DMARC1; p=quarantine; rua=mailto:postmaster@yourdomain.com` | TTL 3600 | DMARC anti-spoofing policy |

### 2. Set Reverse DNS (rDNS / PTR) on Contabo VPS
Gmail, Outlook, and Yahoo require your server's IP reverse DNS to match your mail hostname:
1. Log in to your **Contabo Customer Control Panel**.
2. Go to **IP Management**.
3. Click **Reverse DNS (PTR)** next to your server IP (`161.97.154.141`).
4. Enter: `mail.yourdomain.com` and save.

### 3. Outgoing Mail Delivery: Direct vs. SMTP Relay
In WPCloud under **Mail Server $\rightarrow$ Contabo Outbound Mail Delivery**:
- **Direct Delivery (Port 25):** Sends emails directly from your VPS.
- **SMTP Relay (Zero-Spam Option):** If sending to strict corporate inboxes and your IP is fresh, toggle to **SMTP Relay** (Brevo, Amazon SES, SendGrid, Mailgun). Outgoing emails are routed through authenticated high-reputation delivery networks while incoming emails continue delivering to your server via IMAP.

### 4. Client Email App Connection Settings
Users can connect their inboxes to **Gmail, Outlook, Apple Mail, Thunderbird, iPhone, and Android**:

#### Incoming Server (IMAP):
- **Server Name:** `mail.yourdomain.com` *(or your VPS IP)*
- **Port:** `993`
- **Security / Encryption:** `SSL / TLS`
- **Username:** Full email address (e.g. `info@yourdomain.com`)
- **Password:** Mailbox password configured in WPCloud

#### Outgoing Server (SMTP):
- **Server Name:** `mail.yourdomain.com` *(or your VPS IP)*
- **Port:** `587`
- **Security / Encryption:** `STARTTLS` *(or port `465` with SSL)*
- **Authentication:** Required (Same username & password as incoming)

### 5. Migrating Existing Emails from Titan Mail (Hostinger)
If your client previously had email on Titan Mail:
1. Click **Attach Mail Domain** and **Create Mailbox (me@domain)** in the WPCloud Mail Server tab.
2. Click **Backup / Sync from Titan Mail** and enter the source Titan credentials (`imap.titan.email`, `info@yourdomain.com`, password).
3. Select your target WPCloud mailbox.
4. WPCloud connects directly over IMAP TLS (`993`), downloads all folders, messages, read/unread flags, and attachments into `/opt/wpcloud/mail/mailboxes/<domain>/<user>/Maildir/` (with UID & Message-ID deduplication so re-runs never create duplicates).
5. Open **`https://YOUR_VPS_IP:7070/mail`** and sign in with your mailbox email & password to browse, search, and read all backed-up emails immediately.
6. To connect external apps (Gmail, Outlook, Apple Mail) over IMAP/SMTP, click **Setup IMAP/SMTP Server** in the panel (or run `sudo wpcloud setup-mail`) to install and configure Dovecot + Postfix + OpenDKIM.

---

## Clean Uninstaller & Full Removal

WPCloud includes a dedicated uninstallation script designed with strict non-interference.

### Option A: Remove Panel Only (Keeps WordPress Sites Running)
```bash
sudo ./scripts/uninstall.sh
```
- Stops and disables `wpcloud-panel.service` and `wpcloud-agent.service`.
- Removes `/usr/local/bin/wpcloud`.
- Cleans up UFW firewall rules for panel and preview ports (`7070`, `7071`, `38080:38200`).
- Removes `/opt/wpcloud/app` and `/opt/wpcloud/data` (plus any legacy `/opt/wpcloud/runtime` from older versions).
- **Leaves `/opt/wpcloud/sites/` and automated Nginx configs completely intact** so client sites remain active.

### Option B: Full Clean Purge
```bash
sudo ./scripts/uninstall.sh --full
```
- Stops and deletes all WPCloud systemd services.
- Removes `/etc/nginx/conf.d/wpcloud.conf` and reloads Nginx cleanly.
- Cleans PHP-FPM pool configurations and reloads PHP.
- Cleans all WPCloud UFW rules.
- Completely purges `/opt/wpcloud`.
- **Existing external Next.js apps, PM2, Node.js/npm, and `/etc/nginx/sites-enabled/` remain 100% untouched.**

---

## Administration CLI (`wpcloud`)

When WPCloud is installed, a CLI helper is registered at `/usr/local/bin/wpcloud`:

```bash
# Check service status
sudo wpcloud status

# Health check, Nginx syntax, and npm cache ownership inspection
sudo wpcloud doctor

# Pull latest git changes, rebuild with system Node/npm, and restart services
sudo wpcloud update

# Rebuild from current /opt/wpcloud/app source and restart services
sudo wpcloud rebuild

# Point WPCloud systemd units to an upgraded system Node.js binary
sudo wpcloud update-node [path-to-node]

# Reset admin password
sudo wpcloud reset-password

# Restart WPCloud services
sudo wpcloud restart

# Stream live service logs
sudo wpcloud logs
```

---

## Updating WPCloud from Git on Ubuntu

### Option 1: One-Command Update (if cloned in `/opt/wpcloud/app`)
```bash
sudo wpcloud update
```
This pulls the latest commits (`git pull --ff-only`), updates dependencies cleanly if `package-lock.json` changed (using an isolated temporary npm cache), rebuilds all packages, removes any legacy `/opt/wpcloud/runtime`, and restarts `wpcloud-agent` and `wpcloud-panel`.

### Option 2: Pull Manually & Re-run Installer (from any clone folder)
```bash
cd /opt/wpcloud/app   # or your local git clone directory
git pull origin main
sudo ./scripts/install.sh
```
`install.sh` is idempotent on updates: it preserves your existing `/opt/wpcloud/config/secrets.env` (admin password & session secret), preserves existing WordPress sites and Nginx configs, rebuilds with your system Node.js (`>= 22`) & `npm`, and restarts the services.

---

## License
MIT License. Built for agency developers, freelancers, and VPS administrators managing high-performance self-hosted WordPress websites on Ubuntu.
