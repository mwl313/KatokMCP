/**
 * D-4: Credential Store — 안전한 자격 증명 관리
 * 
 * 환경변수 대신 로컬 암호화 저장소를 사용하여 Kakao 계정 정보를 관리합니다.
 * 
 * 보안 설계:
 * - AES-256-GCM으로 파일 암호화 (파생 키는 SHA-256 해시 사용)
 * - 민감 정보(토큰)는 메모리에서만 존재, 디스크에는 암호화된 형태만
 * - 파일 권한: 소유자만 읽기 가능 (Unix: 600)
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from "node:crypto";
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

export interface CredentialStoreConfig {
  /** Base path for credential files (default: ~/.kakao-mcp/) */
  basePath?: string;
  /** Custom encryption passphrase (default: machine ID + username) */
  passphrase?: string;
}

const ALGORITHM = "aes-256-gcm";
const KEY_LENGTH = 32;
const IV_LENGTH = 16;
const TAG_LENGTH = 16;
const SALT_LENGTH = 32;

function getDefaultBasePath(): string {
  return path.join(os.homedir(), ".kakao-mcp");
}

function getDefaultPassphrase(): string {
  // Machine-specific: hostname + username + "kakao-mcp-v1"
  const hostname = os.hostname();
  const username = os.userInfo()?.username ?? "unknown";
  return `kakao-mcp-${hostname}-${username}-v1`;
}

function deriveKey(passphrase: string, salt: Buffer): Buffer {
  return scryptSync(passphrase, salt, KEY_LENGTH);
}

export class CredentialStore {
  private basePath: string;
  private passphrase: string;
  private credentials: StoredCredentials | null = null;
  private credentialsPath: string;

  constructor(config: CredentialStoreConfig = {}) {
    this.basePath = config.basePath ?? getDefaultBasePath();
    this.passphrase = config.passphrase ?? getDefaultPassphrase();
    this.credentialsPath = path.join(this.basePath, "credentials.enc");
  }

  /** Check if stored credentials exist */
  async exists(): Promise<boolean> {
    return existsSync(this.credentialsPath);
  }

  /** Save credentials to encrypted file */
  async save(credentials: StoredCredentials): Promise<void> {
    const salt = randomBytes(SALT_LENGTH);
    const key = deriveKey(this.passphrase, salt);
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, key, iv);

    const plaintext = Buffer.from(JSON.stringify(credentials), "utf-8");
    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();

    // Format: salt(32) + iv(16) + tag(16) + encrypted(N)
    const payload = Buffer.concat([salt, iv, tag, encrypted]);

    // Ensure directory exists
    await writeFile(this.credentialsPath, payload);
    try { await chmod(this.credentialsPath, 0o600); } catch { /* Windows may not support chmod */ }
  }

  /** Load and decrypt stored credentials */
  async load(): Promise<StoredCredentials> {
    if (this.credentials) return this.credentials;

    if (!existsSync(this.credentialsPath)) {
      throw new Error("No credentials stored. Use save() or set KAKAO_EMAIL env var.");
    }

    const payload = await readFile(this.credentialsPath);
    if (payload.length < SALT_LENGTH + IV_LENGTH + TAG_LENGTH) {
      throw new Error("Corrupted credential file");
    }

    const salt = payload.subarray(0, SALT_LENGTH);
    const iv = payload.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
    const tag = payload.subarray(SALT_LENGTH + IV_LENGTH, SALT_LENGTH + IV_LENGTH + TAG_LENGTH);
    const encrypted = payload.subarray(SALT_LENGTH + IV_LENGTH + TAG_LENGTH);

    const key = deriveKey(this.passphrase, salt);
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);

    const plaintext = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    this.credentials = JSON.parse(plaintext.toString("utf-8")) as StoredCredentials;
    return this.credentials;
  }

  /** Clear stored credentials */
  async clear(): Promise<void> {
    this.credentials = null;
    try { await writeFile(this.credentialsPath, Buffer.alloc(0)); } catch { /* ignore */ }
  }

  /**
   * Read credentials from environment or encrypted store.
   * Priority: Environment variables > Encrypted store
   */
  async resolve(): Promise<StoredCredentials> {
    // Environment variables take priority
    const envEmail = process.env.KAKAO_EMAIL;
    const envPassword = process.env.KAKAO_PASSWORD;
    const envDeviceUuid = process.env.KAKAO_ANDROID_DEVICE_UUID;

    if (envEmail && envPassword && envDeviceUuid) {
      return {
        email: envEmail,
        password: envPassword,
        deviceUuid: envDeviceUuid,
        deviceName: process.env.KAKAO_ANDROID_DEVICE_NAME,
      };
    }

    // Fall back to encrypted store
    return await this.load();
  }

  /** Check if environment variables are set */
  static hasEnvCredentials(): boolean {
    return !!(process.env.KAKAO_EMAIL && process.env.KAKAO_PASSWORD && process.env.KAKAO_ANDROID_DEVICE_UUID);
  }
}

/** CLI helper to store credentials interactively */
export async function storeCredentialsInteractive(store: CredentialStore): Promise<void> {
  const email = process.env.KAKAO_EMAIL ?? "";
  const password = process.env.KAKAO_PASSWORD ?? "";
  const deviceUuid = process.env.KAKAO_ANDROID_DEVICE_UUID ?? "";
  const deviceName = process.env.KAKAO_ANDROID_DEVICE_NAME ?? "SM-X930";

  if (!email || !password || !deviceUuid) {
    console.error("Error: Set KAKAO_EMAIL, KAKAO_PASSWORD, KAKAO_ANDROID_DEVICE_UUID first.");
    process.exit(1);
  }

  await store.save({ email, password, deviceUuid, deviceName });
  console.log(`Credentials saved to ${store["credentialsPath"]}`);
}