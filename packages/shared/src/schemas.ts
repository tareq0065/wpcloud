import { z } from "zod";

export const DOMAIN_REGEX =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export const DomainSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(
    DOMAIN_REGEX,
    "Enter a valid domain name (e.g. example.com) without http:// or paths"
  );

export const PhpVersionSchema = z.enum(["8.1", "8.2", "8.3"]);
export type PhpVersion = z.infer<typeof PhpVersionSchema>;

export const CanonicalHostSchema = z.enum(["apex", "www", "none"]);
export type CanonicalHost = z.infer<typeof CanonicalHostSchema>;

export const NginxSiteOptionsSchema = z.object({
  includeWww: z.boolean().default(true),
  canonicalHost: CanonicalHostSchema.default("apex"),
  httpsRedirect: z.boolean().default(true),
  clientMaxBodySizeMb: z.number().int().min(8).max(2048).default(128),
  blockXmlRpc: z.boolean().default(true),
  staticCacheDays: z.number().int().min(0).max(365).default(30),
  enableGzip: z.boolean().default(true),
  enableHsts: z.boolean().default(false),
  extraDirectives: z
    .string()
    .max(4000)
    .default("")
    .refine(
      (val) => !/(?:^|\s)(?:http|events|stream|mail)\s*\{/i.test(val),
      "Top-level http/events/stream blocks are not allowed inside a site server block"
    ),
});
export type NginxSiteOptions = z.infer<typeof NginxSiteOptionsSchema>;

export const PhpPoolOptionsSchema = z.object({
  phpVersion: PhpVersionSchema.default("8.3"),
  memoryLimitMb: z.number().int().min(64).max(4096).default(256),
  maxExecutionTime: z.number().int().min(30).max(3600).default(300),
  uploadMaxFilesizeMb: z.number().int().min(8).max(2048).default(128),
  maxChildren: z.number().int().min(2).max(100).default(10),
});
export type PhpPoolOptions = z.infer<typeof PhpPoolOptionsSchema>;

export const WpSmtpProviderSchema = z.enum([
  "panel_mailbox",
  "titan",
  "brevo",
  "ses",
  "custom",
]);
export type WpSmtpProvider = z.infer<typeof WpSmtpProviderSchema>;

export const WpSmtpConfigSchema = z.object({
  enabled: z.boolean().default(false),
  provider: WpSmtpProviderSchema.default("panel_mailbox"),
  host: z.string().default("127.0.0.1"),
  port: z.number().int().min(1).max(65535).default(587),
  encryption: z.enum(["tls", "ssl", "none"]).default("tls"),
  username: z.string().default(""),
  password: z.string().default(""),
  fromEmail: z.string().default(""),
  fromName: z.string().default(""),
});
export type WpSmtpConfig = z.infer<typeof WpSmtpConfigSchema>;

export const CreateSiteInputSchema = z.object({
  domain: DomainSchema,
  siteTitle: z.string().trim().min(1).max(120).default("My WordPress Site"),
  wpAdminUser: z
    .string()
    .trim()
    .regex(/^[a-zA-Z0-9._-]{3,32}$/, "Admin username must be 3-32 alphanumeric chars")
    .default("wpadmin"),
  wpAdminEmail: z.string().trim().email("Enter a valid admin email"),
  wpAdminPassword: z.string().min(8).max(128).optional(),
  dbName: z.string().trim().regex(/^[a-zA-Z0-9_]{1,64}$/).optional(),
  dbUser: z.string().trim().regex(/^[a-zA-Z0-9_]{1,32}$/).optional(),
  dbPassword: z.string().trim().min(1).max(128).optional(),
  nginxOptions: NginxSiteOptionsSchema.default({}),
  phpOptions: PhpPoolOptionsSchema.default({}),
});
export type CreateSiteInput = z.infer<typeof CreateSiteInputSchema>;

export const ImportSiteInputSchema = z.object({
  domain: DomainSchema,
  oldDomain: z.string().trim().optional().default(""),
  replaceDomain: z.boolean().default(false),
  forceHttpsReplace: z.boolean().default(false),
  tablePrefix: z
    .string()
    .trim()
    .regex(/^[a-zA-Z0-9_]{1,24}$/)
    .default("wp_"),
  filesArchiveName: z.string().min(1),
  sqlDumpName: z.string().min(1),
  dbName: z.string().trim().regex(/^[a-zA-Z0-9_]{1,64}$/).optional(),
  dbUser: z.string().trim().regex(/^[a-zA-Z0-9_]{1,32}$/).optional(),
  dbPassword: z.string().trim().min(1).max(128).optional(),
  nginxOptions: NginxSiteOptionsSchema.default({}),
  phpOptions: PhpPoolOptionsSchema.default({}),
});
export type ImportSiteInput = z.infer<typeof ImportSiteInputSchema>;

export interface SiteRecord {
  id: string;
  domain: string;
  aliases: string[];
  mode: "fresh" | "imported";
  status: "running" | "disabled" | "provisioning" | "error";
  linuxUser: string;
  rootPath: string;
  logsPath: string;
  nginxConfigPath: string;
  phpPoolConfigPath: string;
  phpVersion: PhpVersion;
  phpOptions: PhpPoolOptions;
  nginxOptions: NginxSiteOptions;
  dbName: string;
  dbUser: string;
  dbPassword: string;
  tablePrefix: string;
  wpVersion: string;
  wpAdminUser: string;
  wpAdminEmail: string;
  wpAdminPassword?: string;
  sslEnabled: boolean;
  sslIssuer?: string;
  sslExpiresAt?: string;
  dnsVerified: boolean;
  dnsLastCheckedAt?: string;
  detectedEmailProvider?: string;
  smtpConfig: WpSmtpConfig;
  diskUsageMb: number;
  createdAt: string;
  updatedAt: string;
}

export interface DnsRecordInstruction {
  type: "A" | "AAAA" | "CNAME" | "MX" | "TXT" | "PTR";
  name: string;
  value: string;
  ttl: number;
  purpose: string;
  status?: "matched" | "mismatch" | "missing" | "protected";
  currentValues?: string[];
}

export interface EmailProtectionInspection {
  hasExistingMail: boolean;
  providerName: string; // e.g., "Titan Mail (Hostinger / Direct)", "Google Workspace", "Microsoft 365", "Custom MX"
  mxRecords: string[];
  spfRecord?: string;
  dmarcRecord?: string;
  warningMessage: string;
}

export interface DnsCheckReport {
  domain: string;
  checkedAt: string;
  resolvers: string[];
  vpsIpv4: string;
  vpsIpv6?: string;
  apexResolvedIps: string[];
  wwwResolvedIps: string[];
  apexMatchesVps: boolean;
  wwwMatchesVps: boolean;
  readyForSsl: boolean;
  instructions: DnsRecordInstruction[];
  emailProtection: EmailProtectionInspection;
}

export interface JobStep {
  id: string;
  label: string;
  status: "pending" | "running" | "completed" | "failed";
  detail?: string;
  commandPreview?: string;
  startedAt?: string;
  completedAt?: string;
}

export interface AgentJob {
  id: string;
  type:
    | "site.create"
    | "site.import"
    | "site.ssl"
    | "site.php_switch"
    | "site.nginx_update"
    | "site.wp_cli"
    | "mail.imapsync"
    | "mail.install";
  targetDomain: string;
  title: string;
  status: "running" | "completed" | "failed";
  steps: JobStep[];
  createdAt: string;
  completedAt?: string;
  error?: string;
}

export interface MailDomainRecord {
  id: string;
  domain: string;
  mailHostname: string; // e.g., mail.example.com
  dkimSelector: string;
  dkimPublicKey: string;
  status: "active" | "pending_dns";
  createdAt: string;
}

export interface MailboxRecord {
  id: string;
  domainId: string;
  domain: string;
  localPart: string;
  email: string; // e.g., me@example.com
  displayName: string;
  quotaMb: number;
  usedMb: number;
  status: "active" | "suspended";
  lastSyncedFrom?: string;
  createdAt: string;
}

export interface MailServerState {
  installed: boolean;
  serviceStatus: "running" | "stopped" | "not_installed";
  webmailUrl: string;
  contaboPort25Open: boolean;
  ptrRecordHost: string;
  ptrMatchesHostname: boolean;
  deliveryMode: "direct" | "relay";
  relayConfig: {
    provider: "brevo" | "ses" | "mailgun" | "custom";
    host: string;
    port: number;
    username: string;
    password: string;
  };
  domains: MailDomainRecord[];
  mailboxes: MailboxRecord[];
  syncJobs: {
    id: string;
    sourceHost: string;
    sourceEmail: string;
    targetEmail: string;
    messagesCopied: number;
    status: "running" | "completed" | "failed";
    startedAt: string;
    completedAt?: string;
  }[];
}

