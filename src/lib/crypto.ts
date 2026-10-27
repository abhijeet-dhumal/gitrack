import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

const ALGO = "aes-256-gcm";
const KEY_LEN = 32;
const IV_LEN = 16;
const TAG_LEN = 16;

export function getEncryptionSecret(): string {
    const configured = process.env.SETTINGS_ENCRYPTION_KEY?.trim();
    if (configured) return configured;
    if (process.env.NODE_ENV === "production") throw new Error("SETTINGS_ENCRYPTION_KEY must be configured in production");
    return "gitrack-default-key-change-me";
}

function deriveKey(secret: string): Buffer {
    return scryptSync(secret, "gitrack-settings-salt", KEY_LEN);
}

export function encrypt(plaintext: string, secret: string): string {
    const key = deriveKey(secret);
    const iv = randomBytes(IV_LEN);
    const cipher = createCipheriv(ALGO, key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, "utf-8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, encrypted]).toString("base64");
}

export function decrypt(encoded: string, secret: string): string {
    const key = deriveKey(secret);
    const buf = Buffer.from(encoded, "base64");
    const iv = buf.subarray(0, IV_LEN);
    const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
    const encrypted = buf.subarray(IV_LEN + TAG_LEN);
    const decipher = createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(tag);
    return decipher.update(encrypted) + decipher.final("utf-8");
}
