import crypto from "node:crypto";

const SESSION_SECRET =
  process.env.WPCLOUD_SESSION_SECRET ||
  "wpcloud-dev-session-secret-change-in-prod-9f8e7d6c5b4a";

export const SESSION_COOKIE_NAME = "wpcloud_session";

export function hashPassword(password: string, salt?: string): string {
  const actualSalt = salt || crypto.randomBytes(16).toString("hex");
  const derived = crypto.scryptSync(password, actualSalt, 64).toString("hex");
  return `${actualSalt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const [salt, key] = storedHash.split(":");
  if (!salt || !key) return false;
  const derivedBuffer = crypto.scryptSync(password, salt, 64);
  const keyBuffer = Buffer.from(key, "hex");
  if (derivedBuffer.length !== keyBuffer.length) return false;
  return crypto.timingSafeEqual(derivedBuffer, keyBuffer);
}

export function createSessionToken(username: string): string {
  const exp = Date.now() + 1000 * 60 * 60 * 24 * 7; // 7 days
  const payload = Buffer.from(JSON.stringify({ sub: username, exp })).toString(
    "base64url"
  );
  const sig = crypto
    .createHmac("sha256", SESSION_SECRET)
    .update(payload)
    .digest("base64url");
  return `${payload}.${sig}`;
}

export function verifySessionToken(
  token?: string | null
): { sub: string; exp: number } | null {
  if (!token || !token.includes(".")) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expectedSig = crypto
    .createHmac("sha256", SESSION_SECRET)
    .update(payload)
    .digest("base64url");
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expectedSig);
  if (
    sigBuf.length !== expBuf.length ||
    !crypto.timingSafeEqual(sigBuf, expBuf)
  ) {
    return null;
  }
  try {
    const parsed = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8")
    ) as { sub: string; exp: number };
    if (Date.now() > parsed.exp) return null;
    return parsed;
  } catch {
    return null;
  }
}

// Base32 helpers for RFC 6238 TOTP 2FA
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function generateTotpSecret(): string {
  const bytes = crypto.randomBytes(20);
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += BASE32_ALPHABET[bytes[i] % 32];
  }
  return out;
}

function base32ToBuffer(base32: string): Buffer {
  const clean = base32.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = "";
  for (const ch of clean) {
    const val = BASE32_ALPHABET.indexOf(ch);
    if (val >= 0) bits += val.toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

export function generateTotpCode(secret: string, windowOffset = 0): string {
  const key = base32ToBuffer(secret);
  const counter = Math.floor(Date.now() / 1000 / 30) + windowOffset;
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));

  const hmac = crypto.createHmac("sha1", key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    (((hmac[offset] & 0x7f) << 24) |
      ((hmac[offset + 1] & 0xff) << 16) |
      ((hmac[offset + 2] & 0xff) << 8) |
      (hmac[offset + 3] & 0xff)) %
    1_000_000;
  return code.toString().padStart(6, "0");
}

export function verifyTotpCode(secret: string, token: string): boolean {
  const clean = token.trim().replace(/\s+/g, "");
  if (!/^\d{6}$/.test(clean)) return false;
  for (const offset of [-1, 0, 1]) {
    if (generateTotpCode(secret, offset) === clean) {
      return true;
    }
  }
  return false;
}

