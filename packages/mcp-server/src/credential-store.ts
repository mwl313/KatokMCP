/**
 * D-4: Credential Store — 안전한 자격 증명 및 인증 토큰 관리
 *
 * 보안 설계:
 * - AES-256-GCM으로 파일 암호화
 * - 민감 정보(토큰)는 메모리에서만 존재, 디스크에는 암호화된 형태만
 * - 두 개의 파일: credentials.enc(email/password) + auth.enc(access token)
 */

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { readFile, writeFile, chmod } from "node:fs/promises";
import { existsSync } from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

export interface StoredCredentials {
  email: string;
  password: string;
  deviceUuid: string;
  deviceName?: string;
}

export interface StoredAuthResult {
  userId: string;
  accessToken: string;
  refreshToken: string;
  tokenType: string;
  savedAt: string;
  expiresAt?: string;
}

export interface CredentialStoreConfig {
  basePath?: string;
  passphrase?: string;
}

const ALGORITHM = "aes-256-gcm";
const KEY_LENGTH = 32;
const IV_LENGTH = 16;
const TAG_LENGTH = 16;
const SALT_LENGTH = 32;

function getDefaultBasePath(): string { return path.join(os.homedir(), ".kakao-mcp"); }
function getDefaultPassphrase(): string {
  return `kakao-mcp-${os.hostname()}-${(os.userInfo()?.username) ?? "unknown"}-v1`;
}
function deriveKey(passphrase: string, salt: Buffer): Buffer { return scryptSync(passphrase, salt, KEY_LENGTH); }

function encryptData(plaintext: Buffer, passphrase: string, salt: Buffer, iv: Buffer): Buffer {
  const key = deriveKey(passphrase, salt);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([salt, iv, cipher.getAuthTag(), encrypted]);
}

function decryptData(payload: Buffer, passphrase: string): Buffer {
  if (payload.length < SALT_LENGTH + IV_LENGTH + TAG_LENGTH) throw new Error("Corrupted file");
  const salt = payload.subarray(0, SALT_LENGTH);
  const iv = payload.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
  const tag = payload.subarray(SALT_LENGTH + IV_LENGTH, SALT_LENGTH + IV_LENGTH + TAG_LENGTH);
  const encrypted = payload.subarray(SALT_LENGTH + IV_LENGTH + TAG_LENGTH);
  const key = deriveKey(passphrase, salt);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]);
}

export class CredentialStore {
  private basePath: string;
  private passphrase: string;
  private credentials: StoredCredentials | null = null;
  private credentialsPath: string;
  private authPath: string;

  constructor(config: CredentialStoreConfig = {}) {
    this.basePath = config.basePath ?? getDefaultBasePath();
    this.passphrase = config.passphrase ?? getDefaultPassphrase();
    this.credentialsPath = path.join(this.basePath, "credentials.enc");
    this.authPath = path.join(this.basePath, "auth.enc");
  }

  async exists(): Promise<boolean> { return existsSync(this.credentialsPath); }
  async hasAuth(): Promise<boolean> { return existsSync(this.authPath); }

  async save(credentials: StoredCredentials): Promise<void> {
    const plaintext = Buffer.from(JSON.stringify(credentials), "utf-8");
    const payload = encryptData(plaintext, this.passphrase, randomBytes(SALT_LENGTH), randomBytes(IV_LENGTH));
    await writeFile(this.credentialsPath, payload);
    try { await chmod(this.credentialsPath, 0o600); } catch { /* ignore */ }
  }

  async load(): Promise<StoredCredentials> {
    if (this.credentials) return this.credentials;
    if (!existsSync(this.credentialsPath)) throw new Error("No credentials stored");
    this.credentials = JSON.parse(decryptData(await readFile(this.credentialsPath), this.passphrase).toString("utf-8")) as StoredCredentials;
    return this.credentials;
  }

  async clear(): Promise<void> {
    this.credentials = null;
    try { await writeFile(this.credentialsPath, Buffer.alloc(0)); } catch { /* ignore */ }
  }

  async saveAuth(auth: StoredAuthResult): Promise<void> {
    const plaintext = Buffer.from(JSON.stringify(auth), "utf-8");
    const payload = encryptData(plaintext, this.passphrase, randomBytes(SALT_LENGTH), randomBytes(IV_LENGTH));
    await writeFile(this.authPath, payload);
    try { await chmod(this.authPath, 0o600); } catch { /* ignore */ }
  }

  async loadAuth(): Promise<StoredAuthResult | null> {
    if (!existsSync(this.authPath)) return null;
    try {
      return JSON.parse(decryptData(await readFile(this.authPath), this.passphrase).toString("utf-8")) as StoredAuthResult;
    } catch {
      await this.clearAuth().catch(() => {});
      return null;
    }
  }

  async clearAuth(): Promise<void> {
    try { await writeFile(this.authPath, Buffer.alloc(0)); } catch { /* ignore */ }
  }

  async resolve(): Promise<StoredCredentials> {
    const envEmail = process.env.KAKAO_EMAIL, envPassword = process.env.KAKAO_PASSWORD, envDeviceUuid = process.env.KAKAO_ANDROID_DEVICE_UUID;
    if (envEmail && envPassword && envDeviceUuid) return { email: envEmail, password: envPassword, deviceUuid: envDeviceUuid, deviceName: process.env.KAKAO_ANDROID_DEVICE_NAME };
    return await this.load();
  }

  static hasEnvCredentials(): boolean { return !!(process.env.KAKAO_EMAIL && process.env.KAKAO_PASSWORD && process.env.KAKAO_ANDROID_DEVICE_UUID); }
}

export async function storeCredentialsInteractive(store: CredentialStore): Promise<void> {
  const email = process.env.KAKAO_EMAIL ?? "", password = process.env.KAKAO_PASSWORD ?? "", deviceUuid = process.env.KAKAO_ANDROID_DEVICE_UUID ?? "";
  if (!email || !password || !deviceUuid) { console.error("Error: Set KAKAO_EMAIL, KAKAO_PASSWORD, KAKAO_ANDROID_DEVICE_UUID first."); process.exit(1); }
  await store.save({ email, password, deviceUuid, deviceName: process.env.KAKAO_ANDROID_DEVICE_NAME ?? "SM-X930" });
  console.log(`Credentials saved to ${store["credentialsPath"]}`);
}