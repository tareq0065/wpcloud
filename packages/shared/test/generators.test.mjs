import test from "node:test";
import assert from "node:assert/strict";
import {
  DomainSchema,
  ImportSiteInputSchema,
  NginxSiteOptionsSchema,
  PhpPoolOptionsSchema,
  generateNginxMasterInclude,
  generateNginxSiteConfig,
  generatePhpFpmPoolConfig,
  generateWpPreviewMuPlugin,
  generateWpSmtpMuPlugin,
  buildSiteDnsInstructions,
  buildMailDomainDnsInstructions,
  generateMailAcmeNginxConfig,
  generateAppleMailMobileConfig,
} from "../dist/index.js";

test("DomainSchema accepts valid domains and rejects URLs/paths/shell metacharacters", () => {
  assert.equal(DomainSchema.parse("Example.COM"), "example.com");
  assert.equal(DomainSchema.parse("sub.acmedesign.studio"), "sub.acmedesign.studio");
  assert.throws(() => DomainSchema.parse("https://example.com"));
  assert.throws(() => DomainSchema.parse("example.com; rm -rf /"));
  assert.throws(() => DomainSchema.parse("../etc/passwd"));
});

test("generateNginxMasterInclude only includes /opt/wpcloud/nginx/sites/*.conf", () => {
  const content = generateNginxMasterInclude("/opt/wpcloud");
  assert.match(content, /include \/opt\/wpcloud\/nginx\/sites\/\*\.conf;/);
});

test("generateNginxSiteConfig builds automated vhost with www->apex redirect, SSL, and xmlrpc block", () => {
  const options = NginxSiteOptionsSchema.parse({
    includeWww: true,
    canonicalHost: "apex",
    httpsRedirect: true,
    clientMaxBodySizeMb: 256,
    blockXmlRpc: true,
    staticCacheDays: 30,
    enableGzip: true,
    enableHsts: true,
    extraDirectives: "",
  });

  const conf = generateNginxSiteConfig({
    domain: "client.org",
    wpcloudRoot: "/opt/wpcloud",
    phpVersion: "8.3",
    sslEnabled: true,
    options,
  });

  assert.match(conf, /root \/opt\/wpcloud\/sites\/client\.org\/public;/);
  assert.match(conf, /listen 443 ssl http2;/);
  assert.doesNotMatch(conf, /^\s*http2 on;/m);
  assert.match(conf, /fastcgi_pass unix:\/run\/php\/wpcloud-client\.org\.sock;/);
  assert.match(conf, /client_max_body_size 256M;/);
  assert.match(conf, /location = \/xmlrpc\.php/);
  assert.match(conf, /return 301 https:\/\/client\.org\$request_uri;/);
});

test("generatePhpFpmPoolConfig isolates site to its own user and /opt/wpcloud/sites/<domain>", () => {
  const phpOptions = PhpPoolOptionsSchema.parse({
    phpVersion: "8.2",
    memoryLimitMb: 512,
    maxExecutionTime: 300,
    uploadMaxFilesizeMb: 256,
    maxChildren: 12,
  });

  const pool = generatePhpFpmPoolConfig({
    domain: "client.org",
    linuxUser: "wp_clientorg",
    wpcloudRoot: "/opt/wpcloud",
    phpOptions,
  });

  assert.match(pool, /user = wp_clientorg/);
  assert.match(pool, /listen = \/run\/php\/wpcloud-client\.org\.sock/);
  assert.match(pool, /php_admin_value\[memory_limit\] = 512M/);
  assert.match(
    pool,
    /php_admin_value\[open_basedir\] = \/opt\/wpcloud\/sites\/client\.org\/public/
  );
});

test("generateWpSmtpMuPlugin creates valid WordPress phpmailer_init hook", () => {
  const php = generateWpSmtpMuPlugin("client.org", {
    enabled: true,
    provider: "titan",
    host: "smtp.titan.email",
    port: 587,
    encryption: "tls",
    username: "hello@client.org",
    password: "secret",
    fromEmail: "hello@client.org",
    fromName: "Client Org",
  });

  assert.match(php, /add_action\('phpmailer_init'/);
  assert.match(php, /\$phpmailer->Host\s*=\s*'smtp\.titan\.email'/);
});

test("buildSiteDnsInstructions includes A, CNAME, and protected Titan MX/SPF records", () => {
  const records = buildSiteDnsInstructions({
    domain: "client.org",
    vpsIpv4: "194.163.148.72",
    includeWww: true,
    canonicalHost: "apex",
    existingMx: ["10 mx1.titan.email", "20 mx2.titan.email"],
    existingSpf: "v=spf1 include:spf.titan.email ~all",
  });

  assert.equal(records[0].type, "A");
  assert.equal(records[0].value, "194.163.148.72");
  assert.ok(records.some((r) => r.type === "MX" && r.status === "protected"));
  assert.ok(records.some((r) => r.type === "TXT" && r.status === "protected"));
});

test("buildMailDomainDnsInstructions outputs MX, SPF, 2048-bit DKIM, DMARC, and Contabo PTR", () => {
  const records = buildMailDomainDnsInstructions(
    {
      id: "md_1",
      domain: "client.org",
      mailHostname: "mail.client.org",
      dkimSelector: "wpcloud2026",
      dkimPublicKey: "MIIBIjANBgkqhki",
      status: "active",
      createdAt: new Date().toISOString(),
    },
    "194.163.148.72"
  );

  assert.ok(records.some((r) => r.type === "MX" && r.value === "10 mail.client.org"));
  assert.ok(records.some((r) => r.type === "PTR" && r.value === "mail.client.org"));
});

test("generateNginxSiteConfig includes dedicated instant IP preview port block", () => {
  const options = NginxSiteOptionsSchema.parse({});
  const conf = generateNginxSiteConfig({
    domain: "previewtest.com",
    wpcloudRoot: "/opt/wpcloud",
    phpVersion: "8.3",
    sslEnabled: false,
    previewPort: 38081,
    options,
  });

  assert.match(conf, /listen 38081;/);
  assert.match(conf, /fastcgi_param HTTP_X_WPCLOUD_PREVIEW "1";/);
  assert.match(conf, /access_log \/opt\/wpcloud\/sites\/previewtest\.com\/logs\/preview_access\.log;/);
});

test("generateWpPreviewMuPlugin filters home and siteurl and disables canonical redirect", () => {
  const mu = generateWpPreviewMuPlugin("previewtest.com", 38081);
  assert.match(mu, /Plugin Name: WPCloud Instant IP Preview Helper/);
  assert.match(mu, /add_filter\('option_home'/);
  assert.match(mu, /add_filter\('option_siteurl'/);
  assert.match(mu, /remove_action\('template_redirect', 'redirect_canonical'\)/);
  assert.match(mu, /add_filter\('redirect_canonical', '__return_false'/);
  assert.match(mu, /previewtest\.com/);
});

test("generateNginxSiteConfig places writable-dir script deny rules before PHP FastCGI handler", () => {
  const options = NginxSiteOptionsSchema.parse({});
  const conf = generateNginxSiteConfig({
    domain: "hardened.example",
    wpcloudRoot: "/opt/wpcloud",
    phpVersion: "8.3",
    sslEnabled: false,
    previewPort: 38082,
    options,
  });

  const denyUploadsIndex = conf.indexOf(
    "location ~* /(?:uploads|files|blogs\\.dir|upgrade|cache|backups?)/.*\\.(?:php\\d*|phtml|phar|pl|py|rb|cgi|sh|bash)$"
  );
  const denyScriptsIndex = conf.indexOf(
    "location ~* \\.(?:phtml|phar|php[3-8]|pl|py|rb|cgi|sh|bash)$"
  );
  const phpHandlerIndex = conf.indexOf("location ~ \\.php$");
  assert.ok(denyUploadsIndex !== -1);
  assert.ok(denyScriptsIndex !== -1);
  assert.ok(phpHandlerIndex !== -1);
  assert.ok(denyUploadsIndex < phpHandlerIndex);
  assert.ok(denyScriptsIndex < phpHandlerIndex);
  assert.match(conf, /try_files \$uri =404;/);
  assert.match(conf, /autoindex off;/);
  assert.match(conf, /location ~\* \^\/\(\?:wp-config\(\?:-sample\)\?\\\.php\|wp-cli\\\.ya\?ml\|readme\\\.html\|license\\\.txt\)\$/);
});

test("generatePhpFpmPoolConfig disables dangerous exec functions and omits shared /tmp from open_basedir", () => {
  const phpOptions = PhpPoolOptionsSchema.parse({});
  const pool = generatePhpFpmPoolConfig({
    domain: "hardened.example",
    linuxUser: "wp_hardened",
    wpcloudRoot: "/opt/wpcloud",
    phpOptions,
  });

  assert.match(pool, /php_admin_value\[disable_functions\] = .*exec.*shell_exec.*proc_open.*popen/);
  assert.match(pool, /php_admin_flag\[allow_url_include\] = off/);
  assert.match(pool, /php_admin_flag\[expose_php\] = off/);
  const openBasedirLine = pool
    .split("\n")
    .find((line) => line.startsWith("php_admin_value[open_basedir]"));
  assert.ok(openBasedirLine);
  assert.doesNotMatch(openBasedirLine, /:\/tmp(?::|$)/);
});

test("NginxSiteOptionsSchema and ImportSiteInputSchema reject dangerous directives and filenames", () => {
  assert.throws(() =>
    NginxSiteOptionsSchema.parse({ extraDirectives: "root /etc;" })
  );
  assert.throws(() =>
    NginxSiteOptionsSchema.parse({ extraDirectives: "fastcgi_pass unix:/run/php/other.sock;" })
  );
  assert.throws(() =>
    NginxSiteOptionsSchema.parse({ extraDirectives: "include /etc/passwd;" })
  );
  assert.ok(
    NginxSiteOptionsSchema.parse({ extraDirectives: "add_header X-Frame-Options SAMEORIGIN;" })
  );

  assert.throws(() =>
    ImportSiteInputSchema.parse({
      domain: "import.example",
      filesArchiveName: "../evil.zip",
    })
  );
  assert.throws(() =>
    ImportSiteInputSchema.parse({
      domain: "import.example",
      filesArchiveName: "shell.php",
    })
  );
  assert.throws(() =>
    ImportSiteInputSchema.parse({
      domain: "import.example",
      sqlDumpName: "dump.php",
    })
  );
  assert.ok(
    ImportSiteInputSchema.parse({
      domain: "import.example",
      filesArchiveName: "site-backup.tar.gz",
      sqlDumpName: "db-backup.sql.gz",
    })
  );
});

test("generateMailAcmeNginxConfig and generateAppleMailMobileConfig build valid configs", () => {
  const acme = generateMailAcmeNginxConfig("mail.client.org", "/opt/wpcloud/mail/acme-webroot");
  assert.match(acme, /server_name mail\.client\.org;/);
  assert.match(acme, /location \^~ \/\.well-known\/acme-challenge\//);

  const plist = generateAppleMailMobileConfig({
    email: "info@client.org",
    displayName: "Info & Support",
    mailHostname: "mail.client.org",
    domain: "client.org",
  });
  assert.match(plist, /<string>Info &amp; Support<\/string>/);
  assert.match(plist, /<string>mail\.client\.org<\/string>/);
  assert.match(plist, /<integer>993<\/integer>/);
  assert.match(plist, /<integer>587<\/integer>/);
});
