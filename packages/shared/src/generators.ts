import type {
  DnsRecordInstruction,
  MailDomainRecord,
  NginxSiteOptions,
  PhpPoolOptions,
  SiteRecord,
  WpSmtpConfig,
} from "./schemas.js";

export interface WpCloudPaths {
  wpcloudRoot: string; // Default: /opt/wpcloud
  sitesDir: string; // /opt/wpcloud/sites
  nginxSitesDir: string; // /opt/wpcloud/nginx/sites
  nginxSnippetsDir: string; // /opt/wpcloud/nginx/snippets
  phpPoolsDir: string; // /opt/wpcloud/php
  backupsDir: string; // /opt/wpcloud/backups
  dataDir: string; // /opt/wpcloud/data
}

export function getDefaultPaths(root = "/opt/wpcloud"): WpCloudPaths {
  return {
    wpcloudRoot: root,
    sitesDir: `${root}/sites`,
    nginxSitesDir: `${root}/nginx/sites`,
    nginxSnippetsDir: `${root}/nginx/snippets`,
    phpPoolsDir: `${root}/php`,
    backupsDir: `${root}/backups`,
    dataDir: `${root}/data`,
  };
}

/**
 * Generates the single 1-line include file placed at /etc/nginx/conf.d/wpcloud.conf.
 * Existing nginx.conf and sites-enabled/* are NEVER modified.
 */
export function generateNginxMasterInclude(wpcloudRoot = "/opt/wpcloud"): string {
  return [
    "# Managed by WPCloud — DO NOT EDIT MANUALLY",
    "# Includes only WPCloud-managed WordPress vhosts inside /opt/wpcloud/nginx/sites/",
    "# Existing Next.js, PM2, and custom vhosts in /etc/nginx/sites-enabled/ are never touched.",
    `include ${wpcloudRoot}/nginx/sites/*.conf;`,
    "",
  ].join("\n");
}

/**
 * Generates the automated nginx vhost configuration for a WordPress site.
 * Users never write this by hand; they choose options in the UI and WPCloud renders,
 * validates with `nginx -t`, and reloads nginx with automatic rollback on failure.
 */
export function generateNginxSiteConfig(params: {
  domain: string;
  wpcloudRoot?: string;
  phpVersion: string;
  sslEnabled: boolean;
  sslCertPath?: string;
  sslKeyPath?: string;
  previewPort?: number;
  options: NginxSiteOptions;
}): string {
  const {
    domain,
    wpcloudRoot = "/opt/wpcloud",
    sslEnabled,
    options,
  } = params;

  const siteDir = `${wpcloudRoot}/sites/${domain}`;
  const publicDir = `${siteDir}/public`;
  const logsDir = `${siteDir}/logs`;
  const phpSocket = `/run/php/wpcloud-${domain}.sock`;

  const sslCert =
    params.sslCertPath || `/etc/letsencrypt/live/${domain}/fullchain.pem`;
  const sslKey =
    params.sslKeyPath || `/etc/letsencrypt/live/${domain}/privkey.pem`;

  const wwwDomain = `www.${domain}`;
  const serverNames = options.includeWww ? `${domain} ${wwwDomain}` : domain;
  const canonicalTarget =
    options.canonicalHost === "www" && options.includeWww ? wwwDomain : domain;
  const nonCanonicalHost =
    options.canonicalHost === "www" && options.includeWww ? domain : wwwDomain;

  const lines: string[] = [
    `# ============================================================================`,
    `# WPCloud Automated Nginx Config for: ${domain}`,
    `# File: ${wpcloudRoot}/nginx/sites/${domain}.conf`,
    `# Generated automatically from UI settings — tested with \`nginx -t\` before reload`,
    `# ============================================================================`,
    ``,
  ];

  // Canonical host redirect block (www -> apex or apex -> www)
  if (options.includeWww && options.canonicalHost !== "none") {
    lines.push(
      `server {`,
      `    listen 80;`,
      `    listen [::]:80;`,
      ...(sslEnabled
        ? [
            `    listen 443 ssl;`,
            `    listen [::]:443 ssl;`,
            `    http2 on;`,
            `    ssl_certificate ${sslCert};`,
            `    ssl_certificate_key ${sslKey};`,
          ]
        : []),
      `    server_name ${nonCanonicalHost};`,
      ``,
      `    # Allow Let's Encrypt ACME HTTP-01 challenge before redirecting`,
      `    location ^~ /.well-known/acme-challenge/ {`,
      `        root ${publicDir};`,
      `        allow all;`,
      `    }`,
      ``,
      `    location / {`,
      `        return 301 ${sslEnabled && options.httpsRedirect ? "https" : "$scheme"}://${canonicalTarget}$request_uri;`,
      `    }`,
      `}`,
      ``
    );
  }

  // HTTP -> HTTPS redirect block when SSL is enabled
  if (sslEnabled && options.httpsRedirect) {
    lines.push(
      `server {`,
      `    listen 80;`,
      `    listen [::]:80;`,
      `    server_name ${ options.includeWww && options.canonicalHost !== "none" ? canonicalTarget : serverNames };`,
      ``,
      `    location ^~ /.well-known/acme-challenge/ {`,
      `        root ${publicDir};`,
      `        allow all;`,
      `    }`,
      ``,
      `    location / {`,
      `        return 301 https://${canonicalTarget}$request_uri;`,
      `    }`,
      `}`,
      ``
    );
  }

  // Primary WordPress server block
  lines.push(`server {`);
  if (!sslEnabled || !options.httpsRedirect) {
    lines.push(`    listen 80;`, `    listen [::]:80;`);
  }
  if (sslEnabled) {
    lines.push(
      `    listen 443 ssl;`,
      `    listen [::]:443 ssl;`,
      `    http2 on;`,
      `    ssl_certificate ${sslCert};`,
      `    ssl_certificate_key ${sslKey};`,
      `    ssl_protocols TLSv1.2 TLSv1.3;`,
      `    ssl_prefer_server_ciphers on;`,
      `    ssl_session_cache shared:WPCloudSSL:10m;`,
      `    ssl_session_timeout 1d;`
    );
  }

  const primaryServerName =
    options.includeWww && options.canonicalHost !== "none"
      ? canonicalTarget
      : serverNames;

  lines.push(
    `    server_name ${primaryServerName};`,
    `    root ${publicDir};`,
    `    index index.php index.html;`,
    `    autoindex off;`,
    ``,
    `    access_log ${logsDir}/access.log;`,
    `    error_log ${logsDir}/error.log warn;`,
    ``,
    `    client_max_body_size ${options.clientMaxBodySizeMb}M;`,
    ``
  );

  // Security headers
  lines.push(
    `    # Security headers`,
    `    add_header X-Frame-Options "SAMEORIGIN" always;`,
    `    add_header X-Content-Type-Options "nosniff" always;`,
    `    add_header Referrer-Policy "strict-origin-when-cross-origin" always;`
  );
  if (sslEnabled && options.enableHsts) {
    lines.push(
      `    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;`
    );
  }
  lines.push(``);

  if (options.enableGzip) {
    lines.push(
      `    # Gzip compression`,
      `    gzip on;`,
      `    gzip_vary on;`,
      `    gzip_proxied any;`,
      `    gzip_comp_level 5;`,
      `    gzip_types text/plain text/css text/xml application/json application/javascript application/xml+rss application/atom+xml image/svg+xml;`,
      ``
    );
  }

  // ACME challenge for Let's Encrypt certbot --webroot
  lines.push(
    `    # Let's Encrypt Webroot Challenge (certbot certonly --webroot)`,
    `    location ^~ /.well-known/acme-challenge/ {`,
    `        allow all;`,
    `        default_type "text/plain";`,
    `    }`,
    ``
  );

  // Hardening rules MUST precede `location ~ \.php$` because Nginx evaluates regex locations in file order (first match wins)
  lines.push(
    `    # Hardening: block hidden files, sensitive WP files, writable-dir PHP, and arbitrary scripts`,
    `    location ~ /\\.(?!well-known).* {`,
    `        deny all;`,
    `    }`,
    `    location ~* ^/(?:wp-config(?:-sample)?\\.php|wp-cli\\.ya?ml|readme\\.html|license\\.txt)$ {`,
    `        deny all;`,
    `    }`,
    `    location ~* /(?:uploads|files|blogs\\.dir|upgrade|cache|backups?)/.*\\.(?:php\\d*|phtml|phar|pl|py|rb|cgi|sh|bash)$ {`,
    `        deny all;`,
    `    }`,
    `    location ~* \\.(?:phtml|phar|php[3-8]|pl|py|rb|cgi|sh|bash)$ {`,
    `        deny all;`,
    `    }`
  );

  if (options.blockXmlRpc) {
    lines.push(
      `    # Block XML-RPC brute-force and pingback abuse`,
      `    location = /xmlrpc.php {`,
      `        deny all;`,
      `        access_log off;`,
      `        log_not_found off;`,
      `    }`
    );
  }
  lines.push(``);

  // WordPress permalinks
  lines.push(
    `    # WordPress front controller`,
    `    location / {`,
    `        try_files $uri $uri/ /index.php?$args;`,
    `    }`,
    ``
  );

  // PHP-FPM FastCGI handler
  lines.push(
    `    # Isolated per-site PHP-FPM socket`,
    `    location ~ \\.php$ {`,
    `        try_files $uri =404;`,
    `        include snippets/fastcgi-php.conf;`,
    `        fastcgi_pass unix:${phpSocket};`,
    `        fastcgi_param SCRIPT_FILENAME $realpath_root$fastcgi_script_name;`,
    `        fastcgi_read_timeout 300s;`,
    `        fastcgi_buffers 16 16k;`,
    `        fastcgi_buffer_size 32k;`,
    `    }`,
    ``
  );

  if (options.staticCacheDays > 0) {
    lines.push(
      `    # Static asset browser caching`,
      `    location ~* \\.(?:css|js|jpg|jpeg|gif|png|ico|cur|gz|svg|svgz|mp4|ogg|ogv|webm|htc|woff2|woff|webp|avif)$ {`,
      `        expires ${options.staticCacheDays}d;`,
      `        access_log off;`,
      `        add_header Cache-Control "public, no-transform";`,
      `    }`,
      ``
    );
  }

  if (options.extraDirectives && options.extraDirectives.trim().length > 0) {
    lines.push(
      `    # Custom per-site directives (validated by nginx -t)`,
      ...options.extraDirectives
        .trim()
        .split("\n")
        .map((line) => `    ${line}`),
      ``
    );
  }

  lines.push(`}`, ``);

  // Dedicated preview server block for instant IP-based inspection before DNS cutover
  if (params.previewPort && params.previewPort > 0) {
    lines.push(
      `# ----------------------------------------------------------------------------`,
      `# WPCloud Instant IP Preview (Port ${params.previewPort})`,
      `# Allows site inspection via http://<vps-ip>:${params.previewPort}/ before DNS cutover`,
      `# ----------------------------------------------------------------------------`,
      `server {`,
      `    listen ${params.previewPort};`,
      `    listen [::]:${params.previewPort};`,
      `    server_name _;`,
      `    root ${publicDir};`,
      `    index index.php index.html;`,
      `    autoindex off;`,
      ``,
      `    access_log ${logsDir}/preview_access.log;`,
      `    error_log ${logsDir}/preview_error.log warn;`,
      ``,
      `    client_max_body_size ${options.clientMaxBodySizeMb}M;`,
      ``,
      `    # Security headers`,
      `    add_header X-Frame-Options "SAMEORIGIN" always;`,
      `    add_header X-Content-Type-Options "nosniff" always;`,
      `    add_header X-WPCloud-Preview "1" always;`,
      ``,
      `    # Hardening: block hidden files, sensitive WP files, writable-dir PHP, and arbitrary scripts`,
      `    location ~ /\\.(?!well-known).* {`,
      `        deny all;`,
      `    }`,
      `    location ~* ^/(?:wp-config(?:-sample)?\\.php|wp-cli\\.ya?ml|readme\\.html|license\\.txt)$ {`,
      `        deny all;`,
      `    }`,
      `    location ~* /(?:uploads|files|blogs\\.dir|upgrade|cache|backups?)/.*\\.(?:php\\d*|phtml|phar|pl|py|rb|cgi|sh|bash)$ {`,
      `        deny all;`,
      `    }`,
      `    location ~* \\.(?:phtml|phar|php[3-8]|pl|py|rb|cgi|sh|bash)$ {`,
      `        deny all;`,
      `    }`,
      ``,
      `    # WordPress front controller`,
      `    location / {`,
      `        try_files $uri $uri/ /index.php?$args;`,
      `    }`,
      ``,
      `    # Isolated per-site PHP-FPM socket with preview indicator flag`,
      `    location ~ \\.php$ {`,
      `        try_files $uri =404;`,
      `        include snippets/fastcgi-php.conf;`,
      `        fastcgi_pass unix:${phpSocket};`,
      `        fastcgi_param SCRIPT_FILENAME $realpath_root$fastcgi_script_name;`,
      `        fastcgi_param HTTP_X_WPCLOUD_PREVIEW "1";`,
      `        fastcgi_read_timeout 300s;`,
      `        fastcgi_buffers 16 16k;`,
      `        fastcgi_buffer_size 32k;`,
      `    }`,
      ``,
      `    # Static asset handling`,
      `    location ~* \\.(?:css|js|jpg|jpeg|gif|png|ico|cur|gz|svg|svgz|mp4|ogg|ogv|webm|htc|woff2|woff|webp|avif)$ {`,
      `        expires 1h;`,
      `        access_log off;`,
      `        add_header Cache-Control "public, no-transform";`,
      `    }`,
      `}`,
      ``
    );
  }

  return lines.join("\n");
}

/**
 * Generates an isolated PHP-FPM pool config stored at /opt/wpcloud/php/<ver>/<domain>.conf
 * and symlinked into /etc/php/<ver>/fpm/pool.d/wpcloud-<domain>.conf
 */
export function generatePhpFpmPoolConfig(params: {
  domain: string;
  linuxUser: string;
  wpcloudRoot?: string;
  phpOptions: PhpPoolOptions;
}): string {
  const {
    domain,
    linuxUser,
    wpcloudRoot = "/opt/wpcloud",
    phpOptions,
  } = params;
  const siteDir = `${wpcloudRoot}/sites/${domain}`;
  const poolName = `wpcloud_${domain.replace(/[^a-z0-9]/gi, "_")}`;

  return [
    `; ============================================================================`,
    `; WPCloud Isolated PHP-FPM Pool for: ${domain} (PHP ${phpOptions.phpVersion})`,
    `; File: ${wpcloudRoot}/php/${phpOptions.phpVersion}/${domain}.conf`,
    `; ============================================================================`,
    `[${poolName}]`,
    `user = ${linuxUser}`,
    `group = ${linuxUser}`,
    `listen = /run/php/wpcloud-${domain}.sock`,
    `listen.owner = www-data`,
    `listen.group = www-data`,
    `listen.mode = 0660`,
    ``,
    `pm = dynamic`,
    `pm.max_children = ${phpOptions.maxChildren}`,
    `pm.start_servers = 2`,
    `pm.min_spare_servers = 1`,
    `pm.max_spare_servers = 4`,
    `pm.max_requests = 500`,
    ``,
    `chdir = ${siteDir}/public`,
    `security.limit_extensions = .php`,
    ``,
    `; Per-site PHP overrides & strict script-execution isolation`,
    `php_admin_value[memory_limit] = ${phpOptions.memoryLimitMb}M`,
    `php_admin_value[max_execution_time] = ${phpOptions.maxExecutionTime}`,
    `php_admin_value[upload_max_filesize] = ${phpOptions.uploadMaxFilesizeMb}M`,
    `php_admin_value[post_max_size] = ${phpOptions.uploadMaxFilesizeMb}M`,
    `php_admin_value[error_log] = ${siteDir}/logs/php-error.log`,
    `php_admin_flag[log_errors] = on`,
    `php_admin_flag[allow_url_include] = off`,
    `php_admin_flag[expose_php] = off`,
    `php_admin_value[disable_functions] = exec,passthru,shell_exec,system,proc_open,popen,pcntl_exec,pcntl_fork,pcntl_signal,pcntl_waitpid,pcntl_wexitstatus,pcntl_wifexited,pcntl_wifsignaled,pcntl_wifstopped,pcntl_wstopsig,pcntl_wtermsig,dl,posix_kill,posix_mkfifo,posix_setpgid,posix_setsid,posix_setuid,show_source,highlight_file`,
    `php_admin_value[sys_temp_dir] = ${siteDir}/tmp`,
    `php_admin_value[upload_tmp_dir] = ${siteDir}/tmp`,
    `php_admin_value[session.save_path] = ${siteDir}/tmp`,
    `php_admin_value[open_basedir] = ${siteDir}/public:${siteDir}/tmp:/usr/share/php`,
    ``,
  ].join("\n");
}

/**
 * Generates the WordPress MU-Plugin that routes wp_mail() through the configured
 * panel mailbox, Titan Mail SMTP, or external SMTP relay without needing third-party plugins.
 */
export function generateWpSmtpMuPlugin(
  domain: string,
  smtp: WpSmtpConfig
): string {
  const safeHost = smtp.host.replace(/'/g, "\\'");
  const safeUser = smtp.username.replace(/'/g, "\\'");
  const safePass = smtp.password.replace(/'/g, "\\'");
  const safeFromEmail = (smtp.fromEmail || `wordpress@${domain}`).replace(
    /'/g,
    "\\'"
  );
  const safeFromName = (smtp.fromName || domain).replace(/'/g, "\\'");
  const safeSecure = smtp.encryption === "none" ? "" : smtp.encryption;

  return `<?php
/**
 * Plugin Name: WPCloud Managed Outbound SMTP
 * Description: Automatically routes WordPress transactional emails (password resets, forms, WooCommerce) via WPCloud configured SMTP (${smtp.provider}).
 * Version: 1.0.0
 * Author: WPCloud Panel
 */

if (!defined('ABSPATH')) {
    exit;
}

add_action('phpmailer_init', function ($phpmailer) {
    $phpmailer->isSMTP();
    $phpmailer->Host       = '${safeHost}';
    $phpmailer->Port       = ${Number(smtp.port) || 587};
    $phpmailer->SMTPAuth   = ${smtp.username ? "true" : "false"};
    $phpmailer->Username   = '${safeUser}';
    $phpmailer->Password   = '${safePass}';
    $phpmailer->SMTPSecure = '${safeSecure}';
    $phpmailer->From       = '${safeFromEmail}';
    $phpmailer->FromName   = '${safeFromName}';
}, 999);
`;
}

/**
 * Generates the WordPress MU-Plugin that enables instant IP preview via dedicated port
 * without triggering WordPress canonical redirect loops back to the apex domain.
 */
export function generateWpPreviewMuPlugin(
  domain: string,
  previewPort?: number
): string {
  const safeDomain = domain.replace(/'/g, "\\'");
  const portCondition = previewPort
    ? `(isset($_SERVER['SERVER_PORT']) && (int)$_SERVER['SERVER_PORT'] === ${previewPort}) || `
    : "";

  return `<?php
/**
 * Plugin Name: WPCloud Instant IP Preview Helper
 * Description: Enables previewing WordPress sites via VPS IP before DNS propagation, without canonical redirect loops.
 * Version: 1.0.0
 * Author: WPCloud Panel
 */

if (!defined('ABSPATH')) {
    exit;
}

$is_preview = (
    ${portCondition}(isset($_SERVER['HTTP_X_WPCLOUD_PREVIEW']) && $_SERVER['HTTP_X_WPCLOUD_PREVIEW'] === '1') ||
    (isset($_SERVER['SERVER_PORT']) && (int)$_SERVER['SERVER_PORT'] >= 38080 && (int)$_SERVER['SERVER_PORT'] <= 38200)
);

if ($is_preview) {
    $preview_host = $_SERVER['HTTP_HOST'] ?? '';
    if (!empty($preview_host)) {
        $scheme = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
        $preview_url = $scheme . '://' . $preview_host;

        // 1. Dynamic home and siteurl override for preview requests
        add_filter('option_home', function() use ($preview_url) {
            return $preview_url;
        }, 9999);

        add_filter('option_siteurl', function() use ($preview_url) {
            return $preview_url;
        }, 9999);

        // 2. Disable canonical redirect so WordPress doesn't bounce visitor to the apex domain
        remove_action('template_redirect', 'redirect_canonical');
        add_filter('redirect_canonical', '__return_false', 9999);

        // 3. Keep internal HTML links and assets pointed to preview URL
        add_action('template_redirect', function() use ($preview_url) {
            ob_start(function($buffer) use ($preview_url) {
                if (empty($buffer) || !is_string($buffer)) {
                    return $buffer;
                }
                $target_domain = '${safeDomain}';
                if (!empty($target_domain)) {
                    $patterns = array(
                        'https://' . $target_domain,
                        'http://' . $target_domain,
                        'https://www.' . $target_domain,
                        'http://www.' . $target_domain,
                        '//' . $target_domain,
                        '//www.' . $target_domain,
                    );
                    $buffer = str_replace($patterns, $preview_url, $buffer);
                }
                return $buffer;
            });
        }, 1);

        // 4. Ensure wp-admin / wp-login redirects stay within preview URL
        add_filter('wp_redirect', function($location) use ($preview_url) {
            $target_domain = '${safeDomain}';
            if (!empty($target_domain) && is_string($location)) {
                $patterns = array(
                    'https://' . $target_domain,
                    'http://' . $target_domain,
                    'https://www.' . $target_domain,
                    'http://' . $target_domain,
                );
                $location = str_replace($patterns, $preview_url, $location);
            }
            return $location;
        }, 9999);
    }
}
`;
}

/**
 * Generates DNS records table for pointing a domain to the VPS while protecting existing email records.
 */
export function buildSiteDnsInstructions(params: {
  domain: string;
  vpsIpv4: string;
  vpsIpv6?: string;
  includeWww: boolean;
  canonicalHost: string;
  existingMx?: string[];
  existingSpf?: string;
}): DnsRecordInstruction[] {
  const { domain, vpsIpv4, vpsIpv6, includeWww } = params;
  const records: DnsRecordInstruction[] = [
    {
      type: "A",
      name: "@",
      value: vpsIpv4,
      ttl: 300,
      purpose: `Points bare domain (${domain}) to your Ubuntu VPS`,
    },
  ];

  if (includeWww) {
    records.push({
      type: "CNAME",
      name: "www",
      value: domain,
      ttl: 300,
      purpose: `Points www.${domain} to ${domain} (or use an A record -> ${vpsIpv4})`,
    });
  }

  if (vpsIpv6 && vpsIpv6.trim().length > 0) {
    records.push({
      type: "AAAA",
      name: "@",
      value: vpsIpv6,
      ttl: 300,
      purpose: "IPv6 address for your Ubuntu VPS (optional)",
    });
  }

  if (params.existingMx && params.existingMx.length > 0) {
    for (const mx of params.existingMx) {
      records.push({
        type: "MX",
        name: "@",
        value: mx,
        ttl: 3600,
        purpose: "KEEP UNCHANGED — preserves your existing email delivery (e.g. Titan Mail)",
        status: "protected",
      });
    }
  }

  if (params.existingSpf) {
    records.push({
      type: "TXT",
      name: "@",
      value: params.existingSpf,
      ttl: 3600,
      purpose: "KEEP UNCHANGED — preserves existing SPF authorization for your email provider",
      status: "protected",
    });
  }

  return records;
}

/**
 * Generates DNS records required when hosting email for a domain on WPCloud's Stalwart Mail Server.
 */
export function buildMailDomainDnsInstructions(
  mailDomain: MailDomainRecord,
  vpsIpv4: string
): DnsRecordInstruction[] {
  return [
    {
      type: "A",
      name: "mail",
      value: vpsIpv4,
      ttl: 300,
      purpose: `Points ${mailDomain.mailHostname} (IMAP/SMTP & Webmail) to your VPS`,
    },
    {
      type: "MX",
      name: "@",
      value: `10 ${mailDomain.mailHostname}`,
      ttl: 3600,
      purpose: `Routes incoming emails for @${mailDomain.domain} to your WPCloud Mail Server`,
    },
    {
      type: "TXT",
      name: "@",
      value: `v=spf1 ip4:${vpsIpv4} mx ~all`,
      ttl: 3600,
      purpose: "SPF record authorizing your VPS to send email for this domain",
    },
    {
      type: "TXT",
      name: `${mailDomain.dkimSelector}._domainkey`,
      value: `v=DKIM1; k=rsa; p=${mailDomain.dkimPublicKey}`,
      ttl: 3600,
      purpose: "2048-bit DKIM cryptographic signature so Gmail/Outlook trust your emails",
    },
    {
      type: "TXT",
      name: "_dmarc",
      value: `v=DMARC1; p=quarantine; rua=mailto:postmaster@${mailDomain.domain}`,
      ttl: 3600,
      purpose: "DMARC policy protecting your domain against spoofing",
    },
    {
      type: "PTR",
      name: vpsIpv4,
      value: mailDomain.mailHostname,
      ttl: 3600,
      purpose: "Set Reverse DNS (rDNS) in Contabo Customer Control Panel -> IP Management",
    },
  ];
}
