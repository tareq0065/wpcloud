import test from "node:test";
import assert from "node:assert/strict";
import {
  DomainSchema,
  NginxSiteOptionsSchema,
  PhpPoolOptionsSchema,
  generateNginxMasterInclude,
  generateNginxSiteConfig,
  generatePhpFpmPoolConfig,
  generateWpPreviewMuPlugin,
  generateWpSmtpMuPlugin,
  buildSiteDnsInstructions,
  buildMailDomainDnsInstructions,
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
