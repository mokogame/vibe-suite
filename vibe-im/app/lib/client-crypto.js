import { chacha20poly1305 } from "@noble/ciphers/chacha";

function toBase64Url(bytes) {
  let binary = "";
  bytes.forEach(byte => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value) {
  const base64 = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - base64.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

function getSubtleCrypto() {
  return globalThis.crypto?.subtle || null;
}

function getBrowserCrypto() {
  return globalThis.crypto || globalThis.msCrypto || null;
}

function normalizeRawKey(key) {
  const bytes = fromBase64Url(key);
  if (bytes.length !== 32) {
    throw new Error("Invalid transport key");
  }
  return bytes;
}

async function importKey(key) {
  const subtle = getSubtleCrypto();
  if (!subtle) throw new Error("WebCrypto is unavailable");
  const bytes = fromBase64Url(key);
  const normalized = bytes.length === 32 ? bytes : new Uint8Array(await subtle.digest("SHA-256", bytes));
  return subtle.importKey("raw", normalized, "AES-GCM", false, ["encrypt", "decrypt"]);
}

function randomBytes(length) {
  const browserCrypto = getBrowserCrypto();
  if (!browserCrypto?.getRandomValues) throw new Error("Browser crypto is unavailable");
  return browserCrypto.getRandomValues(new Uint8Array(length));
}

function encryptChaCha20Poly1305(plainText, key) {
  const iv = randomBytes(12);
  const cipher = chacha20poly1305(normalizeRawKey(key), iv);
  const encrypted = cipher.encrypt(new TextEncoder().encode(String(plainText)));
  return {
    alg: "CHACHA20-POLY1305",
    iv: toBase64Url(iv),
    ciphertext: toBase64Url(encrypted.slice(0, -16)),
    tag: toBase64Url(encrypted.slice(-16))
  };
}

function decryptChaCha20Poly1305(payload, key) {
  const ciphertext = fromBase64Url(payload.ciphertext);
  const tag = fromBase64Url(payload.tag);
  const merged = new Uint8Array(ciphertext.length + tag.length);
  merged.set(ciphertext);
  merged.set(tag, ciphertext.length);
  const cipher = chacha20poly1305(normalizeRawKey(key), fromBase64Url(payload.iv));
  return new TextDecoder().decode(cipher.decrypt(merged));
}

export async function encryptText(plainText, key) {
  return encryptChaCha20Poly1305(plainText, key);
}

async function decryptAesGcm(payload, key) {
  const subtle = getSubtleCrypto();
  if (!subtle) throw new Error("当前访问地址不支持旧 AES-GCM 消息解密，请改用 localhost 或 HTTPS 打开一次旧消息。");
  const cryptoKey = await importKey(key);
  const ciphertext = fromBase64Url(payload.ciphertext);
  const tag = fromBase64Url(payload.tag);
  const merged = new Uint8Array(ciphertext.length + tag.length);
  merged.set(ciphertext);
  merged.set(tag, ciphertext.length);
  const plain = await subtle.decrypt({ name: "AES-GCM", iv: fromBase64Url(payload.iv) }, cryptoKey, merged);
  return new TextDecoder().decode(plain);
}

export async function decryptText(payload, key) {
  if (!payload) return "";
  if (payload.alg === "CHACHA20-POLY1305") return decryptChaCha20Poly1305(payload, key);
  return decryptAesGcm(payload, key);
}
