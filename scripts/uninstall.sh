#!/usr/bin/env bash
# ==============================================================================
# WPCloud Clean Uninstaller
# Preserves /opt/wpcloud/sites and /opt/wpcloud/backups by default unless
# --purge-sites is explicitly passed.
# ==============================================================================
set -euo pipefail

WPCLOUD_ROOT="/opt/wpcloud"
PURGE_SITES=0

if [[ "${1:-}" == "--purge-sites" ]]; then
  PURGE_SITES=1
fi

if [[ "${EUID}" -ne 0 ]]; then
  echo "[ERROR] Please run with sudo: sudo ./scripts/uninstall.sh"
  exit 1
fi

echo "Stopping WPCloud systemd services..."
systemctl stop wpcloud-panel.service wpcloud-agent.service 2>/dev/null || true
systemctl disable wpcloud-panel.service wpcloud-agent.service 2>/dev/null || true
rm -f /etc/systemd/system/wpcloud-panel.service /etc/systemd/system/wpcloud-agent.service
systemctl daemon-reload

rm -f /usr/local/bin/wpcloud

if [[ "${PURGE_SITES}" -eq 1 ]]; then
  echo "Removing /etc/nginx/conf.d/wpcloud.conf and purging ${WPCLOUD_ROOT}..."
  rm -f /etc/nginx/conf.d/wpcloud.conf
  rm -f /etc/php/*/fpm/pool.d/wpcloud-*.conf
  rm -rf "${WPCLOUD_ROOT}"
  nginx -t && systemctl reload nginx
  echo "WPCloud and all managed sites removed."
else
  echo "Keeping ${WPCLOUD_ROOT}/sites, ${WPCLOUD_ROOT}/nginx, and ${WPCLOUD_ROOT}/backups intact."
  rm -rf "${WPCLOUD_ROOT}/app" "${WPCLOUD_ROOT}/runtime" "${WPCLOUD_ROOT}/data"
  echo "WPCloud Panel removed. Your WordPress sites continue running safely."
fi

