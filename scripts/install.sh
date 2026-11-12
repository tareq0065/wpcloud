#!/usr/bin/env bash
# ==============================================================================
# WPCloud Installer for Ubuntu 24.04 LTS
# - Everything lives inside /opt/wpcloud
# - Reuses your nvm Node v24.12.0 binary (copied into /opt/wpcloud/runtime/bin/node)
# - Never touches existing nginx.conf, sites-enabled/*, or PM2 processes
# ==============================================================================
set -euo pipefail

WPCLOUD_ROOT="/opt/wpcloud"
PANEL_PORT="${WPCLOUD_PANEL_PORT:-7070}"
ADMINER_PORT="${WPCLOUD_ADMINER_PORT:-7071}"

echo "=================================================================="
echo "  WPCloud Installer — Self-Hosted WordPress & Mail Panel"
echo "  Target root directory: ${WPCLOUD_ROOT}"
echo "=================================================================="

if [[ "${EUID}" -ne 0 ]]; then
  echo "[ERROR] Please run this installer with sudo: sudo ./scripts/install.sh"
  exit 1
fi

# 1. Preflight check: Ubuntu version & baseline nginx -t
echo ""
echo "[1/7] Running non-interference preflight checks..."
if [[ -f /etc/os-release ]]; then
  . /etc/os-release
  echo "  • Detected OS: ${PRETTY_NAME}"
fi

if command -v nginx >/dev/null 2>&1; then
  echo "  • Existing nginx detected. Verifying baseline config with 'nginx -t'..."
  if ! nginx -t >/dev/null 2>&1; then
    echo "[ABORT] Your existing nginx configuration currently fails 'nginx -t'."
    echo "        WPCloud refuses to touch a server with a broken baseline nginx config."
    nginx -t
    exit 1
  fi
  echo "  • Baseline 'nginx -t' passed. Existing vhosts in /etc/nginx/sites-enabled/ will NOT be modified."
fi

echo "  • Checking active listening ports (including any PM2 / Next.js apps)..."
# If WPCloud is already installed and running, temporarily stop it so re-install / upgrade succeeds
if systemctl is-active --quiet wpcloud-panel.service 2>/dev/null; then
  echo "  • Temporarily stopping active wpcloud-panel service for installer update..."
  systemctl stop wpcloud-panel.service || true
fi
if systemctl is-active --quiet wpcloud-agent.service 2>/dev/null; then
  systemctl stop wpcloud-agent.service || true
fi

if ss -ltn | awk '{print $4}' | grep -qE ":${PANEL_PORT}$"; then
  echo "[ABORT] Port ${PANEL_PORT} is already in use. Set WPCLOUD_PANEL_PORT=<free_port> and re-run."
  exit 1
fi

if ss -ltn | awk '{print $4}' | grep -qE ":${ADMINER_PORT}$"; then
  if [[ -f "${WPCLOUD_ROOT}/nginx/sites/00-adminer.conf" ]] && grep -q "${ADMINER_PORT}" "${WPCLOUD_ROOT}/nginx/sites/00-adminer.conf" 2>/dev/null; then
    echo "  • Port ${ADMINER_PORT} is already configured for WPCloud Adminer (Nginx)."
  else
    echo "[ABORT] Port ${ADMINER_PORT} is already in use by an external application. Set WPCLOUD_ADMINER_PORT=<free_port> and re-run."
    exit 1
  fi
fi
echo "  • Ports ${PANEL_PORT} (Panel) and ${ADMINER_PORT} (Adminer) are verified."

if command -v ufw >/dev/null 2>&1 && ufw status | grep -q "Status: active"; then
  echo "  • UFW firewall is active. Allowing TCP ports ${PANEL_PORT} (Panel), ${ADMINER_PORT} (Adminer), and 38080-38200 (Site Previews)..."
  ufw allow "${PANEL_PORT}/tcp" comment "WPCloud Panel" >/dev/null 2>&1 || true
  ufw allow "${ADMINER_PORT}/tcp" comment "WPCloud Adminer" >/dev/null 2>&1 || true
  ufw allow 38080:38200/tcp comment "WPCloud Site Previews" >/dev/null 2>&1 || true
fi

# 2. Create /opt/wpcloud folder hierarchy
echo ""
echo "[2/7] Creating ${WPCLOUD_ROOT} directory hierarchy..."
mkdir -p \
  "${WPCLOUD_ROOT}/app" \
  "${WPCLOUD_ROOT}/runtime/bin" \
  "${WPCLOUD_ROOT}/sites" \
  "${WPCLOUD_ROOT}/nginx/sites" \
  "${WPCLOUD_ROOT}/nginx/snippets" \
  "${WPCLOUD_ROOT}/php/8.1" \
  "${WPCLOUD_ROOT}/php/8.2" \
  "${WPCLOUD_ROOT}/php/8.3" \
  "${WPCLOUD_ROOT}/adminer" \
  "${WPCLOUD_ROOT}/ssl/panel" \
  "${WPCLOUD_ROOT}/data/uploads" \
  "${WPCLOUD_ROOT}/backups" \
  "${WPCLOUD_ROOT}/config" \
  "${WPCLOUD_ROOT}/mail"

if ! id -u wpcloud >/dev/null 2>&1; then
  useradd --system --home-dir "${WPCLOUD_ROOT}" --shell /usr/sbin/nologin wpcloud
fi

# 3. Locate and copy the user's nvm Node v24.12.0 binary and npm
echo ""
echo "[3/7] Locating Node.js & npm runtime (preserving your nvm setup)..."
INVOKING_USER="${SUDO_USER:-root}"
INVOKING_HOME=$(getent passwd "${INVOKING_USER}" | cut -d: -f6)
DETECTED_NODE=""
DETECTED_NPM=""

# Check invoking user's nvm first
if [[ -x "${INVOKING_HOME}/.nvm/versions/node/v24.12.0/bin/node" ]]; then
  DETECTED_NODE="${INVOKING_HOME}/.nvm/versions/node/v24.12.0/bin/node"
elif [[ -d "${INVOKING_HOME}/.nvm/versions/node" ]]; then
  LATEST_NVM_NODE=$(find "${INVOKING_HOME}/.nvm/versions/node" -maxdepth 3 -name node -type f 2>/dev/null | sort -V | tail -n 1 || true)
  if [[ -n "${LATEST_NVM_NODE}" ]]; then
    DETECTED_NODE="${LATEST_NVM_NODE}"
  fi
fi

# Fallback: check root's nvm if run directly
if [[ -z "${DETECTED_NODE}" && -d "/root/.nvm/versions/node" ]]; then
  LATEST_ROOT_NODE=$(find "/root/.nvm/versions/node" -maxdepth 3 -name node -type f 2>/dev/null | sort -V | tail -n 1 || true)
  if [[ -n "${LATEST_ROOT_NODE}" ]]; then
    DETECTED_NODE="${LATEST_ROOT_NODE}"
  fi
fi

# Fallback: check system PATH
if [[ -z "${DETECTED_NODE}" ]] && command -v node >/dev/null 2>&1; then
  DETECTED_NODE=$(command -v node)
fi

if [[ -z "${DETECTED_NODE}" ]]; then
  echo "[ABORT] Could not locate Node.js in ${INVOKING_HOME}/.nvm, /root/.nvm, or PATH."
  echo "        Please ensure Node.js is installed or run: nvm install 24"
  exit 1
fi

DETECTED_NODE_DIR="$(dirname "${DETECTED_NODE}")"

# Copy Node binary to /opt/wpcloud/runtime/bin
cp -f "${DETECTED_NODE}" "${WPCLOUD_ROOT}/runtime/bin/node"
chmod 755 "${WPCLOUD_ROOT}/runtime/bin/node"

# Locate npm
if [[ -x "${DETECTED_NODE_DIR}/npm" ]]; then
  DETECTED_NPM="${DETECTED_NODE_DIR}/npm"
elif command -v npm >/dev/null 2>&1; then
  DETECTED_NPM=$(command -v npm)
elif [[ -x "${INVOKING_HOME}/.nvm/versions/node/v24.12.0/bin/npm" ]]; then
  DETECTED_NPM="${INVOKING_HOME}/.nvm/versions/node/v24.12.0/bin/npm"
fi

# Clean up any legacy wrapper scripts
rm -f "${WPCLOUD_ROOT}/runtime/bin/npm" "${WPCLOUD_ROOT}/runtime/bin/npx"

# Crucial: Export PATH with the actual node & npm directory from nvm
export PATH="${DETECTED_NODE_DIR}:${WPCLOUD_ROOT}/runtime/bin:/usr/local/bin:/usr/bin:/bin:${PATH}"

echo "  • Copied Node binary ($("${WPCLOUD_ROOT}/runtime/bin/node" -v)) -> ${WPCLOUD_ROOT}/runtime/bin/node"
if [[ -n "${DETECTED_NPM}" ]]; then
  echo "  • Located npm runtime -> ${DETECTED_NPM}"
fi
echo "  • Your nvm installation in ${INVOKING_HOME}/.nvm remains completely untouched."

# 4. Install only missing system packages (PHP 8.1/8.2/8.3 FPM, MariaDB, Certbot, WP-CLI)
echo ""
echo "[4/7] Checking and installing missing WordPress runtime packages..."
export DEBIAN_FRONTEND=noninteractive

ALL_PACKAGES_PRESENT=true
if ! command -v nginx >/dev/null 2>&1; then ALL_PACKAGES_PRESENT=false; fi
if ! command -v mysql >/dev/null 2>&1; then ALL_PACKAGES_PRESENT=false; fi
if ! command -v certbot >/dev/null 2>&1; then ALL_PACKAGES_PRESENT=false; fi
if ! command -v wp >/dev/null 2>&1; then ALL_PACKAGES_PRESENT=false; fi
for VER in 8.1 8.2 8.3; do
  if ! dpkg -s "php${VER}-fpm" >/dev/null 2>&1; then
    ALL_PACKAGES_PRESENT=false
  fi
done

if [[ "${ALL_PACKAGES_PRESENT}" == "true" ]]; then
  echo "  • All required system packages (Nginx, MariaDB, PHP 8.1-8.3 FPM, Certbot, WP-CLI) already installed."
else
  echo "  • Installing missing packages via apt-get..."
  apt-get update -y -q
  apt-get install -y -q software-properties-common curl unzip openssl ca-certificates

  if ! command -v nginx >/dev/null 2>&1; then
    apt-get install -y -q nginx
  fi

  if ! command -v mysql >/dev/null 2>&1; then
    apt-get install -y -q mariadb-server
    systemctl enable --now mariadb
  fi

  if ! apt-cache policy | grep -q "ondrej/php"; then
    add-apt-repository -y ppa:ondrej/php
    apt-get update -y -q
  fi

  for VER in 8.1 8.2 8.3; do
    apt-get install -y -q \
      "php${VER}-fpm" "php${VER}-mysql" "php${VER}-curl" "php${VER}-gd" \
      "php${VER}-imagick" "php${VER}-intl" "php${VER}-mbstring" "php${VER}-xml" \
      "php${VER}-zip" "php${VER}-bcmath" "php${VER}-opcache"
    systemctl enable --now "php${VER}-fpm"
  done

  if ! command -v certbot >/dev/null 2>&1; then
    apt-get install -y -q certbot
  fi
fi

if ! command -v wp >/dev/null 2>&1; then
  curl -fsSL https://raw.githubusercontent.com/wp-cli/builds/gh-pages/phar/wp-cli.phar -o /usr/local/bin/wp
  chmod +x /usr/local/bin/wp
fi

if [[ ! -f "${WPCLOUD_ROOT}/adminer/index.php" ]]; then
  curl -fsSL https://github.com/vrana/adminer/releases/download/v4.8.1/adminer-4.8.1-mysql-en.php -o "${WPCLOUD_ROOT}/adminer/index.php" || true
fi

# Adminer database manager on port 7071
mkdir -p "${WPCLOUD_ROOT}/logs"
cat > "${WPCLOUD_ROOT}/nginx/sites/00-adminer.conf" <<EOF
server {
    listen ${ADMINER_PORT};
    listen [::]:${ADMINER_PORT};
    server_name _;
    root ${WPCLOUD_ROOT}/adminer;
    index index.php;

    access_log ${WPCLOUD_ROOT}/logs/adminer-access.log;
    error_log ${WPCLOUD_ROOT}/logs/adminer-error.log warn;

    location / {
        try_files \$uri \$uri/ =404;
    }

    location ~ \.php\$ {
        include fastcgi_params;
        fastcgi_param SCRIPT_FILENAME \$document_root\$fastcgi_script_name;
        fastcgi_pass unix:/run/php/php8.3-fpm.sock;
    }
}
EOF

# 5. Generate self-signed HTTPS certificate for the Panel & configure Nginx 1-line include
echo ""
echo "[5/7] Generating self-signed TLS cert & linking /etc/nginx/conf.d/wpcloud.conf..."
PUBLIC_IPV4=$(curl -4 -fsSL --max-time 5 https://ifconfig.me || hostname -I | awk '{print $1}')

if [[ ! -f "${WPCLOUD_ROOT}/ssl/panel/cert.pem" ]]; then
  openssl req -x509 -nodes -days 3650 -newkey rsa:2048 \
    -keyout "${WPCLOUD_ROOT}/ssl/panel/key.pem" \
    -out "${WPCLOUD_ROOT}/ssl/panel/cert.pem" \
    -subj "/CN=${PUBLIC_IPV4}/O=WPCloud Self-Hosted Panel" >/dev/null 2>&1
  chmod 600 "${WPCLOUD_ROOT}/ssl/panel/key.pem"
  chown -R wpcloud:wpcloud "${WPCLOUD_ROOT}/ssl/panel"
fi

cat > /etc/nginx/conf.d/wpcloud.conf <<EOF
# Managed by WPCloud — includes only /opt/wpcloud/nginx/sites/*.conf
include ${WPCLOUD_ROOT}/nginx/sites/*.conf;
EOF

if ! nginx -t; then
  rm -f /etc/nginx/conf.d/wpcloud.conf
  echo "[ABORT] nginx -t failed after adding /etc/nginx/conf.d/wpcloud.conf — rolled back."
  exit 1
fi
systemctl reload nginx

# 6. Copy app source, build, and configure secrets
echo ""
echo "[6/7] Building WPCloud Panel & Agent in ${WPCLOUD_ROOT}/app..."
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ "${SCRIPT_DIR}" != "${WPCLOUD_ROOT}/app" ]]; then
  rsync -a --delete --exclude '.wpcloud-runtime' "${SCRIPT_DIR}/" "${WPCLOUD_ROOT}/app/"
fi

cd "${WPCLOUD_ROOT}/app"

ARCH_SUFFIX="x64"
if [[ "$(uname -m)" == "aarch64" ]]; then
  ARCH_SUFFIX="arm64"
fi

# Reinstall/refresh node_modules if missing, or if uploaded from macOS (contains darwin binary instead of linux binary)
if [[ ! -d "node_modules" || -d "node_modules/@next/swc-darwin-arm64" || ! -d "node_modules/@next/swc-linux-${ARCH_SUFFIX}-gnu" ]]; then
  echo "  • Installing/refreshing project dependencies for Linux (${ARCH_SUFFIX})..."
  npm install --no-audit --no-fund
fi

# If pre-compiled production build exists, skip building; otherwise run tsc and next build directly
if [[ -f "apps/panel/.next/BUILD_ID" && -d "packages/shared/dist" && -d "apps/agent/dist" ]]; then
  echo "  • Pre-compiled production build detected — ready instantly!"
else
  echo "  • Compiling @wpcloud/shared, @wpcloud/agent, and Next.js 16 panel directly..."
  ./node_modules/.bin/tsc -p packages/shared/tsconfig.json
  ./node_modules/.bin/tsc -p apps/agent/tsconfig.json
  ./node_modules/.bin/next build apps/panel --webpack
fi

SESSION_SECRET=$(openssl rand -hex 32)
INITIAL_PASSWORD=$(openssl rand -base64 12)

cat > "${WPCLOUD_ROOT}/config/config.json" <<EOF
{
  "wpcloudRoot": "${WPCLOUD_ROOT}",
  "panelPort": ${PANEL_PORT},
  "adminerPort": ${ADMINER_PORT},
  "panelHttps": true,
  "vpsIpv4": "${PUBLIC_IPV4}"
}
EOF

cat > "${WPCLOUD_ROOT}/config/secrets.env" <<EOF
WPCLOUD_ROOT=${WPCLOUD_ROOT}
WPCLOUD_PANEL_PORT=${PANEL_PORT}
WPCLOUD_ADMINER_PORT=${ADMINER_PORT}
WPCLOUD_SESSION_SECRET=${SESSION_SECRET}
WPCLOUD_INITIAL_ADMIN_PASSWORD=${INITIAL_PASSWORD}
WPCLOUD_VPS_IPV4=${PUBLIC_IPV4}
EOF
chmod 600 "${WPCLOUD_ROOT}/config/secrets.env"

ln -sf "${WPCLOUD_ROOT}/app/scripts/wpcloud" /usr/local/bin/wpcloud
chmod +x /usr/local/bin/wpcloud

# 7. Install systemd services (never touches PM2)
echo ""
echo "[7/7] Registering systemd units (wpcloud-agent & wpcloud-panel)..."
cat > /etc/systemd/system/wpcloud-agent.service <<EOF
[Unit]
Description=WPCloud Privileged Root Agent (Unix Socket)
After=network.target nginx.service mariadb.service

[Service]
Type=simple
User=root
WorkingDirectory=${WPCLOUD_ROOT}/app
EnvironmentFile=${WPCLOUD_ROOT}/config/secrets.env
ExecStart=${WPCLOUD_ROOT}/runtime/bin/node ${WPCLOUD_ROOT}/app/apps/agent/dist/index.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

cat > /etc/systemd/system/wpcloud-panel.service <<EOF
[Unit]
Description=WPCloud Next.js 16 Management Panel
After=network.target wpcloud-agent.service

[Service]
Type=simple
User=root
Group=root
WorkingDirectory=${WPCLOUD_ROOT}/app/apps/panel
EnvironmentFile=${WPCLOUD_ROOT}/config/secrets.env
Environment=NODE_ENV=production
Environment=PORT=${PANEL_PORT}
ExecStart=${WPCLOUD_ROOT}/runtime/bin/node ${WPCLOUD_ROOT}/app/apps/panel/server.mjs
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

chown -R root:root "${WPCLOUD_ROOT}"
chown -R root:root "${WPCLOUD_ROOT}/runtime"
chmod -R 750 "${WPCLOUD_ROOT}/data"
chmod 644 "${WPCLOUD_ROOT}/ssl/panel/cert.pem" 2>/dev/null || true
chmod 600 "${WPCLOUD_ROOT}/ssl/panel/key.pem" 2>/dev/null || true
systemctl daemon-reload
systemctl enable --now wpcloud-agent.service wpcloud-panel.service

echo ""
echo "=================================================================="
echo "  WPCloud Installed Successfully!"
echo "  Panel URL (HTTPS): https://${PUBLIC_IPV4}:${PANEL_PORT}"
echo "  Panel URL (HTTP):  http://${PUBLIC_IPV4}:${PANEL_PORT}"
echo "  Admin Username:    admin"
echo "  Admin Password:    ${INITIAL_PASSWORD}"
echo "  Root Directory:    ${WPCLOUD_ROOT}"
echo "  Recovery CLI:      sudo wpcloud reset-password"
echo "=================================================================="
