#!/usr/bin/env bash
# ==============================================================================
# WPCloud Installer & Updater for Ubuntu 24.04 LTS
# - Everything lives inside /opt/wpcloud
# - Uses the server's manually installed Node.js (>= 22) & npm directly
# - Never bundles, copies, symlinks, or wraps node, npm, or npx
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
  echo "  • UFW firewall is active. Allowing TCP ports ${PANEL_PORT} (Panel), ${ADMINER_PORT} (Adminer), 38080-38200 (Site Previews), and mail ports (25,465,587,993,995)..."
  ufw allow "${PANEL_PORT}/tcp" comment "WPCloud Panel" >/dev/null 2>&1 || true
  ufw allow "${ADMINER_PORT}/tcp" comment "WPCloud Adminer" >/dev/null 2>&1 || true
  ufw allow 38080:38200/tcp comment "WPCloud Site Previews" >/dev/null 2>&1 || true
  ufw allow 25/tcp comment "WPCloud Mail SMTP" >/dev/null 2>&1 || true
  ufw allow 465/tcp comment "WPCloud Mail SMTPS" >/dev/null 2>&1 || true
  ufw allow 587/tcp comment "WPCloud Mail Submission" >/dev/null 2>&1 || true
  ufw allow 993/tcp comment "WPCloud Mail IMAPS" >/dev/null 2>&1 || true
  ufw allow 995/tcp comment "WPCloud Mail POP3S" >/dev/null 2>&1 || true
fi

# 2. Create /opt/wpcloud folder hierarchy
echo ""
echo "[2/7] Creating ${WPCLOUD_ROOT} directory hierarchy..."
mkdir -p \
  "${WPCLOUD_ROOT}/app" \
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

# Remove any legacy /opt/wpcloud/runtime directory from older versions so WPCloud never shadows system node/npm
rm -rf "${WPCLOUD_ROOT}/runtime"

if ! id -u wpcloud >/dev/null 2>&1; then
  useradd --system --home-dir "${WPCLOUD_ROOT}" --shell /usr/sbin/nologin wpcloud
fi

# 3. Verify manually installed system Node.js (>=22) & npm directly (no bundled runtime, no fallback)
echo ""
echo "[3/7] Verifying manually installed system Node.js (>=22) & npm..."
INVOKING_USER="${SUDO_USER:-root}"
INVOKING_HOME=$(getent passwd "${INVOKING_USER}" | cut -d: -f6)
DETECTED_NODE=""
DETECTED_NPM=""

node_major_version() {
  local bin="$1"
  local ver
  ver=$("${bin}" -p "process.versions.node.split('.')[0]" 2>/dev/null || echo "0")
  if [[ "${ver}" =~ ^[0-9]+$ ]]; then
    echo "${ver}"
  else
    echo "0"
  fi
}

resolve_nvm_node() {
  local nvm_dir="$1"
  local candidate=""
  local ver=""

  if [[ -f "${nvm_dir}/alias/default" ]]; then
    local alias_val
    alias_val=$(tr -d '[:space:]' < "${nvm_dir}/alias/default" 2>/dev/null || true)
    if [[ "${alias_val}" =~ ^v?[0-9] ]]; then
      candidate=$(find "${nvm_dir}/versions/node" -maxdepth 3 -path "*/v${alias_val#v}*/bin/node" \( -type f -o -type l \) 2>/dev/null | sort -V | tail -n 1 || true)
      if [[ -n "${candidate}" && -x "${candidate}" ]]; then
        ver=$(node_major_version "${candidate}")
        if [[ "${ver}" -ge 22 ]]; then
          echo "${candidate}"
          return 0
        fi
      fi
    fi
  fi

  if [[ -d "${nvm_dir}/versions/node" ]]; then
    while IFS= read -r candidate; do
      if [[ -x "${candidate}" ]]; then
        ver=$(node_major_version "${candidate}")
        if [[ "${ver}" -ge 22 ]]; then
          echo "${candidate}"
          return 0
        fi
      fi
    done < <(find "${nvm_dir}/versions/node" -maxdepth 3 -name node \( -type f -o -type l \) 2>/dev/null | sort -Vr)
  fi

  return 1
}

# 1) Always check active system PATH first (no fallback if an incompatible system Node is active)
if command -v node >/dev/null 2>&1; then
  SYS_NODE=$(command -v node)
  SYS_NODE_MAJOR=$(node_major_version "${SYS_NODE}")
  if [[ "${SYS_NODE_MAJOR}" -lt 22 ]]; then
    echo "[ABORT] Found system Node.js $("${SYS_NODE}" -v 2>/dev/null || true) at ${SYS_NODE}, but WPCloud requires Node.js >= 22."
    echo "        WPCloud does not install or bundle its own Node.js. Please upgrade Node.js manually and re-run."
    exit 1
  fi
  DETECTED_NODE="${SYS_NODE}"
fi

# 2) If sudo stripped nvm from PATH, locate the user's or root's existing nvm Node directly (without copying/wrapping)
if [[ -z "${DETECTED_NODE}" && -d "${INVOKING_HOME}/.nvm" ]]; then
  DETECTED_NODE=$(resolve_nvm_node "${INVOKING_HOME}/.nvm" || true)
fi
if [[ -z "${DETECTED_NODE}" && -d "/root/.nvm" ]]; then
  DETECTED_NODE=$(resolve_nvm_node "/root/.nvm" || true)
fi

if [[ -z "${DETECTED_NODE}" || ! -x "${DETECTED_NODE}" ]]; then
  echo "[ABORT] Node.js v22+ is not installed on this server."
  echo "        WPCloud requires you to install Node.js (>= 22) and npm manually before running this installer."
  echo "        Example: install Node.js 22/24 via NodeSource or nvm, then re-run sudo ./scripts/install.sh"
  exit 1
fi

DETECTED_NODE_DIR="$(dirname "${DETECTED_NODE}")"

# Pair npm with the detected Node.js installation
if [[ -x "${DETECTED_NODE_DIR}/npm" ]]; then
  DETECTED_NPM="${DETECTED_NODE_DIR}/npm"
elif command -v npm >/dev/null 2>&1; then
  DETECTED_NPM=$(command -v npm)
fi

if [[ -z "${DETECTED_NPM}" || ! -x "${DETECTED_NPM}" ]]; then
  echo "[ABORT] Found Node.js (${DETECTED_NODE}), but 'npm' is missing."
  echo "        Please install npm manually alongside Node.js and re-run."
  exit 1
fi

# Guard against self-referencing shell wrapper scripts replacing npm-cli.js
NPM_REAL=$(readlink -f "${DETECTED_NPM}" 2>/dev/null || echo "${DETECTED_NPM}")
if head -n 1 "${NPM_REAL}" 2>/dev/null | grep -qE '^#!.*(sh|bash)' && grep -qE 'exec .*/npm' "${NPM_REAL}" 2>/dev/null; then
  echo "[ABORT] Detected a corrupted shell-wrapper npm at ${NPM_REAL}."
  echo "        Restore a clean npm installation (linked to npm-cli.js) before running WPCloud."
  exit 1
fi

# Export PATH with system Node/npm first while preserving standard sbin paths
export PATH="${DETECTED_NODE_DIR}:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:${PATH}"

ISOLATED_NPM_TMP=$(mktemp -d /tmp/wpcloud-install-npm.XXXXXX)
cleanup_npm_tmp() {
  rm -rf "${ISOLATED_NPM_TMP:-}"
}
trap cleanup_npm_tmp EXIT

if ! timeout 10 env HOME="${ISOLATED_NPM_TMP}" npm_config_cache="${ISOLATED_NPM_TMP}/npm-cache" npm_config_update_notifier=false "${DETECTED_NPM}" --version >/dev/null 2>&1; then
  echo "[ABORT] Node.js was found (${DETECTED_NODE}), but '${DETECTED_NPM} --version' failed or timed out."
  echo "        Please ensure npm is working cleanly on your server and re-run."
  exit 1
fi

echo "  • Using system Node.js ($("${DETECTED_NODE}" -v)) -> ${DETECTED_NODE}"
echo "  • Using system npm (v$(env HOME="${ISOLATED_NPM_TMP}" npm_config_cache="${ISOLATED_NPM_TMP}/npm-cache" npm_config_update_notifier=false "${DETECTED_NPM}" --version)) -> ${DETECTED_NPM}"
echo "  • No bundled node/npm/npx binaries created; ${INVOKING_HOME}/.npm remains untouched."

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
  apt-get update --allow-releaseinfo-change -y -q
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
    apt-get update --allow-releaseinfo-change -y -q
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
  rsync -a --delete --exclude '.wpcloud-runtime' --exclude '.history' "${SCRIPT_DIR}/" "${WPCLOUD_ROOT}/app/"
fi

cd "${WPCLOUD_ROOT}/app"

ARCH_SUFFIX="x64"
if [[ "$(uname -m)" == "aarch64" ]]; then
  ARCH_SUFFIX="arm64"
fi

# Reinstall/refresh node_modules if missing, lockfile updated, missing Linux binaries, or containing foreign OS binaries (e.g. macOS/Windows)
NEEDS_NPM_INSTALL=false
if [[ ! -d "node_modules" || ! -x "node_modules/.bin/tsc" || ! -x "node_modules/.bin/next" ]]; then
  NEEDS_NPM_INSTALL=true
elif [[ -f "package-lock.json" && -f "node_modules/.package-lock.json" && "package-lock.json" -nt "node_modules/.package-lock.json" ]]; then
  NEEDS_NPM_INSTALL=true
elif [[ ! -d "node_modules/@next/swc-linux-${ARCH_SUFFIX}-gnu" ]]; then
  NEEDS_NPM_INSTALL=true
elif find node_modules -maxdepth 3 \( -name '*-darwin-*' -o -name '*-win32-*' \) 2>/dev/null | grep -q .; then
  NEEDS_NPM_INSTALL=true
fi

if [[ "${NEEDS_NPM_INSTALL}" == "true" ]]; then
  echo "  • Installing clean Linux (${ARCH_SUFFIX}) dependencies in isolated npm cache..."
  rm -rf node_modules apps/panel/.next packages/shared/dist apps/agent/dist
  if [[ -f "package-lock.json" ]]; then
    HOME="${ISOLATED_NPM_TMP}" \
    npm_config_cache="${ISOLATED_NPM_TMP}/npm-cache" \
    npm_config_userconfig="${ISOLATED_NPM_TMP}/npmrc" \
    npm_config_update_notifier=false \
    npm_config_fund=false \
    npm_config_audit=false \
      "${DETECTED_NPM}" ci --no-audit --no-fund
  else
    HOME="${ISOLATED_NPM_TMP}" \
    npm_config_cache="${ISOLATED_NPM_TMP}/npm-cache" \
    npm_config_userconfig="${ISOLATED_NPM_TMP}/npmrc" \
    npm_config_update_notifier=false \
    npm_config_fund=false \
    npm_config_audit=false \
      "${DETECTED_NPM}" install --no-audit --no-fund
  fi
fi

# Always compile @wpcloud/shared, @wpcloud/agent, and Next.js 16 panel on install/update unless explicitly skipped
if [[ "${WPCLOUD_SKIP_BUILD:-0}" == "1" && -f "apps/panel/.next/BUILD_ID" && -d "packages/shared/dist" && -d "apps/agent/dist" ]]; then
  echo "  • Pre-compiled production build detected (WPCLOUD_SKIP_BUILD=1) — skipping rebuild."
else
  echo "  • Compiling @wpcloud/shared, @wpcloud/agent, and Next.js 16 panel..."
  HOME="${ISOLATED_NPM_TMP}" NEXT_TELEMETRY_DISABLED=1 ./node_modules/.bin/tsc -p packages/shared/tsconfig.json
  HOME="${ISOLATED_NPM_TMP}" NEXT_TELEMETRY_DISABLED=1 ./node_modules/.bin/tsc -p apps/agent/tsconfig.json
  HOME="${ISOLATED_NPM_TMP}" NEXT_TELEMETRY_DISABLED=1 ./node_modules/.bin/next build apps/panel --webpack
fi

IS_EXISTING_INSTALL=false
if [[ -f "${WPCLOUD_ROOT}/config/secrets.env" ]]; then
  IS_EXISTING_INSTALL=true
  set -a
  # shellcheck disable=SC1091
  source "${WPCLOUD_ROOT}/config/secrets.env"
  set +a
fi

SESSION_SECRET="${WPCLOUD_SESSION_SECRET:-$(openssl rand -hex 32)}"
INITIAL_PASSWORD="${WPCLOUD_INITIAL_ADMIN_PASSWORD:-$(openssl rand -base64 12)}"

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

# 7. Install systemd services using the system Node.js directly (never touches PM2)
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
Environment=PATH=${DETECTED_NODE_DIR}:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
ExecStart=${DETECTED_NODE} ${WPCLOUD_ROOT}/app/apps/agent/dist/index.js
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
Environment=PATH=${DETECTED_NODE_DIR}:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
ExecStart=${DETECTED_NODE} ${WPCLOUD_ROOT}/app/apps/panel/server.mjs
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

chown -R root:root "${WPCLOUD_ROOT}"
chmod -R 750 "${WPCLOUD_ROOT}/data"
chmod 644 "${WPCLOUD_ROOT}/ssl/panel/cert.pem" 2>/dev/null || true
chmod 600 "${WPCLOUD_ROOT}/ssl/panel/key.pem" 2>/dev/null || true
systemctl daemon-reload
systemctl enable --now wpcloud-agent.service wpcloud-panel.service

if [[ "${INVOKING_USER}" != "root" && -d "${INVOKING_HOME}/.npm" ]] && find "${INVOKING_HOME}/.npm" -maxdepth 3 -user root -print -quit 2>/dev/null | grep -q .; then
  echo ""
  echo "[NOTE] Existing root-owned files were detected in ${INVOKING_HOME}/.npm (likely from an earlier 'sudo npm' run)."
  echo "       WPCloud did NOT touch your home directory. To repair npm for '${INVOKING_USER}', run:"
  echo "       sudo chown -R ${INVOKING_USER}: \"${INVOKING_HOME}/.npm\""
fi

echo ""
echo "=================================================================="
if [[ "${IS_EXISTING_INSTALL}" == "true" ]]; then
  echo "  WPCloud Updated Successfully!"
  echo "  Panel URL (HTTPS): https://${PUBLIC_IPV4}:${PANEL_PORT}"
  echo "  Panel URL (HTTP):  http://${PUBLIC_IPV4}:${PANEL_PORT}"
  echo "  Admin Credentials: Preserved existing password in ${WPCLOUD_ROOT}/config/secrets.env"
else
  echo "  WPCloud Installed Successfully!"
  echo "  Panel URL (HTTPS): https://${PUBLIC_IPV4}:${PANEL_PORT}"
  echo "  Panel URL (HTTP):  http://${PUBLIC_IPV4}:${PANEL_PORT}"
  echo "  Admin Username:    admin"
  echo "  Admin Password:    ${INITIAL_PASSWORD}"
fi
echo "  Node.js Runtime:   ${DETECTED_NODE} ($("${DETECTED_NODE}" -v))"
echo "  Root Directory:    ${WPCLOUD_ROOT}"
echo "  Recovery CLI:      sudo wpcloud reset-password"
echo "=================================================================="
