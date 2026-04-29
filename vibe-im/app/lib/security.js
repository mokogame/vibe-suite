const crypto = require("node:crypto");

const TOKEN_BYTES = 32;

function randomToken(prefix = "tok") {
  return `${prefix}_${crypto.randomBytes(TOKEN_BYTES).toString("base64url")}`;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("base64url");
  const hash = crypto.scryptSync(password, salt, 64).toString("base64url");
  return `scrypt:${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  if (!stored || !stored.startsWith("scrypt:")) return false;
  const [, salt, hash] = stored.split(":");
  const candidate = crypto.scryptSync(password, salt, 64).toString("base64url");
  return crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(hash));
}

function makeTransportKey() {
  return crypto.randomBytes(32).toString("base64url");
}

function normalizeKey(key) {
  if (!key) throw new Error("Missing encryption key");
  const raw = Buffer.from(key, "base64url");
  return raw.length === 32 ? raw : crypto.createHash("sha256").update(key).digest();
}

function encryptText(plainText, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("chacha20-poly1305", normalizeKey(key), iv, { authTagLength: 16 });
  const ciphertext = Buffer.concat([cipher.update(String(plainText), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    alg: "CHACHA20-POLY1305",
    iv: iv.toString("base64url"),
    ciphertext: ciphertext.toString("base64url"),
    tag: tag.toString("base64url")
  };
}

function encryptTextAesGcm(plainText, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", normalizeKey(key), iv);
  const ciphertext = Buffer.concat([cipher.update(String(plainText), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    alg: "AES-256-GCM",
    iv: iv.toString("base64url"),
    ciphertext: ciphertext.toString("base64url"),
    tag: tag.toString("base64url")
  };
}

function decryptText(payload, key) {
  if (!payload || typeof payload !== "object") return "";
  if (payload.alg === "CHACHA20-POLY1305") {
    const decipher = crypto.createDecipheriv("chacha20-poly1305", normalizeKey(key), Buffer.from(payload.iv, "base64url"), { authTagLength: 16 });
    decipher.setAuthTag(Buffer.from(payload.tag, "base64url"));
    const plain = Buffer.concat([
      decipher.update(Buffer.from(payload.ciphertext, "base64url")),
      decipher.final()
    ]);
    return plain.toString("utf8");
  }
  const decipher = crypto.createDecipheriv("aes-256-gcm", normalizeKey(key), Buffer.from(payload.iv, "base64url"));
  decipher.setAuthTag(Buffer.from(payload.tag, "base64url"));
  const plain = Buffer.concat([
    decipher.update(Buffer.from(payload.ciphertext, "base64url")),
    decipher.final()
  ]);
  return plain.toString("utf8");
}

module.exports = {
  randomToken,
  sha256,
  hashPassword,
  verifyPassword,
  makeTransportKey,
  encryptText,
  encryptTextAesGcm,
  decryptText
};
