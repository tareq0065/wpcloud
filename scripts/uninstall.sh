#!/usr/bin/env bash
# ==============================================================================
# WPCloud Clean Uninstaller
# - Preserves existing Next.js, PM2, and custom /etc/nginx/sites-enabled/* vhosts
# - Preserves external MariaDB databases and system packages
# - Default: removes WPCloud Panel while keeping /opt/wpcloud/sites/ running
# - Pass --full or --purge-all to completely remove /opt/wpcloud
# ==============================================================================
set -euo pipefail

WPCLOUD_ROOT="/opt/wpcloud"
PURGE_SITES=0

for arg in "$@"; do
  if [[ "${arg}" == "--full" || "${arg}" == "--purge-sites" || "${arg}" == "--purge-all" ]]; then
    PURGE_SITES=1
  fi
done

if [[ "${EUID}" -ne 0 ]]; then
  echo "[ERROR] Please run with sudo: sudo ./scripts/uninstall.sh"
  exit 1
fi

echo "=================================================================="
echo "  WPCloud Uninstaller (Non-Interference Mode)"
echo "=================================================================="

# 1. Stop and remove WPCloud systemd services
echo "[1/4] Stopping and removing WPCloud systemd services..."
systemctl stop wpcloud-panel.service wpcloud-agent.service 2>/dev/null || true
systemctl disable wpcloud-panel.service wpcloud-agent.service 2>/dev/null || true
rm -f /etc/systemd/system/wpcloud-panel.service /etc/systemd/system/wpcloud-agent.service
systemctl daemon-reload

# 2. Remove CLI symlink
echo "[2/4] Removing wpcloud CLI..."
rm -f /usr/local/bin/wpcloud

# 3. Clean up UFW firewall rules added by WPCloud
if command -v ufw >/dev/null 2>&1 && ufw status | grep -q "Status: active"; then
  echo "[3/4] Cleaning WPCloud ports from UFW firewall..."
  ufw delete allow 7070/tcp >/dev/null 2>&1 || true
  ufw delete allow 7071/tcp >/dev/null 2>&1 || true
  ufw delete allow 38080:38200/tcp >/dev/null 2>&1 || true
fi

# 4. Remove WPCloud directories & Nginx integration
echo "[4/4] Processing /opt/wpcloud removal..."
if [[ "${PURGE_SITES}" -eq 1 ]]; then
  echo "  • Removing /etc/nginx/conf.d/wpcloud.conf..."
  rm -f /etc/nginx/conf.d/wpcloud.conf
  rm -f /etc/php/*/fpm/pool.d/wpcloud-*.conf
  for VER in 8.1 8.2 8.3; do
    systemctl reload "php${VER}-fpm" 2>/dev/null || true
  done
  echo "  • Purging entire ${WPCLOUD_ROOT} directory..."
  rm -rf "${WPCLOUD_ROOT}"
  if command -v nginx >/dev/null 2>&1; then
    nginx -t && systemctl reload nginx
  fi
  echo ""
  echo "=================================================================="
  echo "  WPCloud and all managed sites have been completely removed."
  echo "  Existing Next.js apps, PM2, and /etc/nginx/sites-enabled/ were UNTOUCHED."
  echo "=================================================================="
else
  echo "  • Preserving ${WPCLOUD_ROOT}/sites, ${WPCLOUD_ROOT}/nginx, and ${WPCLOUD_ROOT}/backups."
  echo "  • Removing only WPCloud control panel app & data..."
  rm -rf "${WPCLOUD_ROOT}/app" "${WPCLOUD_ROOT}/runtime" "${WPCLOUD_ROOT}/data"
  echo ""
  echo "=================================================================="
  echo "  WPCloud Panel removed. Your WordPress sites remain running safely."
  echo "  (To completely remove all sites and files, run: sudo ./scripts/uninstall.sh --full)"
  echo "=================================================================="
fi

