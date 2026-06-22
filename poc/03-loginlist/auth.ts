import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

const AUTH_URL = "https://katalk.kakao.com/win32/account/login.json";
const XVC_FIRST_SEED = "JAYDEN";
const XVC_SECOND_SEED = "JAYMOND";
const MAX_RESPONSE_SIZE = 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 15_000;

export interface AuthCredentials {
  email: string;
  password: string;
  deviceUuid: string;
  deviceName?: string;
}

export interface AuthOptions {
  appVersion?: string;
  language?: string;
  windowsVersion?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export interface AuthResult {
  userId: bigint;
  accessToken: string;
  refreshToken: string;
  tokenType: string;
}

export class AuthApiError extends Error {
  constructor(readonly status: number) {
    super(`Kakao authentication failed with API status ${status}`);
    this.name = "AuthApiError";
  }
}

function requireNonEmpty(value: string, name: string): void {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${name} must be a non-empty string`);
  }
}

function validateDeviceUuid(deviceUuid: string): void {
  requireNonEmpty(deviceUuid, "deviceUuid");
  if (!/^[A-Za-z0-9+/]{86}==$/.test(deviceUuid)) {
    throw new TypeError("deviceUuid must be canonical base64 for 64 bytes");
  }
  const decoded = Buffer.from(deviceUuid, "base64");
  if (decoded.length !== 64 || decoded.toString("base64") !== deviceUuid) {
    throw new TypeError("deviceUuid must decode to exactly 64 bytes");
  }
}

export function buildUserAgent(appVersion: string, windowsVersion = "10.0", language = "ko"): string {
  if (!/^\d+\.\d+\.\d+$/.test(appVersion)) {
    throw new TypeError("appVersion must use the major.minor.patch format");
  }
  requireNonEmpty(windowsVersion, "windowsVersion");
  requireNonEmpty(language, "language");
  return `KT/${appVersion} Wd/${windowsVersion} ${language}`;
}

export function computeXvc(deviceUuid: string, userAgent: string, email: string): string {
  validateDeviceUuid(deviceUuid);
  requireNonEmpty(userAgent, "userAgent");
  requireNonEmpty(email, "email");
  return createHash("sha512")
    .update(`${XVC_FIRST_SEED}|${userAgent}|${XVC_SECOND_SEED}|${email}|${deviceUuid}`)
    .digest("hex")
    .slice(0, 16);
}

function parseUserId(responseText: string): bigint {
  const match = /"userId"\s*:\s*(?:"(\d+)"|(\d+))/.exec(responseText);
  const value = match?.[1] ?? match?.[2];
  if (!value) {
    throw new Error("Kakao authentication response has no valid userId");
  }
  return BigInt(value);
}

export function parseLoginResponse(responseText: string): AuthResult {
  if (responseText.length > MAX_RESPONSE_SIZE) {
    throw new Error("Kakao authentication response exceeds the size limit");
  }

  const parsed: unknown = JSON.parse(responseText);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Kakao authentication response is not an object");
  }
  const response = parsed as Record<string, unknown>;
  if (!Number.isInteger(response.status)) {
    throw new Error("Kakao authentication response has no integer status");
  }
  if (response.status !== 0) {
    throw new AuthApiError(response.status as number);
  }

  const accessToken = response.access_token;
  const refreshToken = response.refresh_token;
  const tokenType = response.token_type;
  if (typeof accessToken !== "string" || accessToken.length === 0) {
    throw new Error("Kakao authentication response has no access token");
  }
  if (typeof refreshToken !== "string" || refreshToken.length === 0) {
    throw new Error("Kakao authentication response has no refresh token");
  }
  if (typeof tokenType !== "string" || tokenType.length === 0) {
    throw new Error("Kakao authentication response has no token type");
  }

  return {
    userId: parseUserId(responseText),
    accessToken,
    refreshToken,
    tokenType,
  };
}

async function readBoundedResponse(response: Response): Promise<string> {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_SIZE) {
    throw new Error("Kakao authentication response exceeds the size limit");
  }
  if (!response.body) {
    return "";
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    size += value.byteLength;
    if (size > MAX_RESPONSE_SIZE) {
      await reader.cancel();
      throw new Error("Kakao authentication response exceeds the size limit");
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

export async function authenticate(
  credentials: AuthCredentials,
  options: AuthOptions = {},
): Promise<AuthResult> {
  requireNonEmpty(credentials.email, "email");
  requireNonEmpty(credentials.password, "password");
  validateDeviceUuid(credentials.deviceUuid);
  const deviceName = credentials.deviceName ?? "KakaoMCP";
  requireNonEmpty(deviceName, "deviceName");

  const appVersion = options.appVersion ?? "26.5.0";
  const language = options.language ?? "ko";
  const userAgent = buildUserAgent(appVersion, options.windowsVersion, language);
  const xvc = computeXvc(credentials.deviceUuid, userAgent, credentials.email);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError("timeoutMs must be a positive safe integer");
  }

  const form = new URLSearchParams({
    device_name: deviceName,
    device_uuid: credentials.deviceUuid,
    email: credentials.email,
    password: credentials.password,
    forced: "false",
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await (options.fetchImpl ?? fetch)(AUTH_URL, {
      method: "POST",
      headers: {
        "User-Agent": userAgent,
        "A": `win32/${appVersion}/${language}`,
        "Accept": "*/*",
        "Accept-Language": language,
        "Content-Type": "application/x-www-form-urlencoded",
        "X-VC": xvc,
      },
      body: form,
      redirect: "error",
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Kakao authentication HTTP status ${response.status}`);
    }

    return parseLoginResponse(await readBoundedResponse(response));
  } finally {
    clearTimeout(timer);
  }
}

function readCredentialsFromEnvironment(): AuthCredentials {
  const email = process.env.KAKAO_EMAIL;
  const password = process.env.KAKAO_PASSWORD;
  const deviceUuid = process.env.KAKAO_DEVICE_UUID;
  const missing = [
    !email && "KAKAO_EMAIL",
    !password && "KAKAO_PASSWORD",
    !deviceUuid && "KAKAO_DEVICE_UUID",
  ].filter(Boolean);
  if (missing.length > 0) {
    throw new Error(`missing required environment variables: ${missing.join(", ")}`);
  }
  return {
    email: email as string,
    password: password as string,
    deviceUuid: deviceUuid as string,
    deviceName: process.env.KAKAO_DEVICE_NAME,
  };
}

async function main(): Promise<void> {
  const result = await authenticate(readCredentialsFromEnvironment(), {
    appVersion: process.env.KAKAO_APP_VERSION,
  });
  console.log(`Authentication: OK (userId=${result.userId}, accessToken=***, refreshToken=***)`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    if (error instanceof AuthApiError) {
      console.error(`Authentication failed: API status ${error.status}`);
    } else {
      console.error(error instanceof Error ? error.message : "Authentication failed");
    }
    process.exitCode = 1;
  });
}
