import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import {
  parseLoginResponse,
  readBoundedResponse,
  type AuthResult,
} from "./auth.js";

const AUTH_BASE_URL = "https://katalk.kakao.com/android/account/";
const DEFAULT_APP_VERSION = "25.9.2";
const DEFAULT_OS_VERSION = "13";
const DEFAULT_API_LEVEL = "33";
const DEFAULT_LANGUAGE = "ko";
const DEFAULT_DEVICE_NAME = "SM-X930";
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_POLL_ATTEMPTS = 120;

export interface AndroidAuthCredentials {
  email: string;
  password: string;
  deviceUuid: string;
  deviceName?: string;
}

export interface AndroidAuthOptions {
  appVersion?: string;
  osVersion?: string;
  apiLevel?: string;
  language?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  sleepImpl?: (milliseconds: number) => Promise<void>;
}

export interface AndroidPasscodeChallenge {
  passcode: string;
  remainingSeconds: number;
}

export class AndroidAuthApiError extends Error {
  constructor(readonly status: number) {
    super(`Kakao Android authentication failed with API status ${status}`);
    this.name = "AndroidAuthApiError";
  }
}

interface ResolvedAndroidOptions {
  appVersion: string;
  osVersion: string;
  apiLevel: string;
  language: string;
  timeoutMs: number;
  fetchImpl: typeof fetch;
  sleepImpl: (milliseconds: number) => Promise<void>;
}

function requireNonEmpty(value: string, name: string): void {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${name} must be a non-empty string`);
  }
}

function validateCredentials(credentials: AndroidAuthCredentials): void {
  requireNonEmpty(credentials.email, "email");
  requireNonEmpty(credentials.password, "password");
  if (!/^[0-9a-f]{64}$/i.test(credentials.deviceUuid)) {
    throw new TypeError("Android deviceUuid must be a 64-character hexadecimal string");
  }
  requireNonEmpty(credentials.deviceName ?? DEFAULT_DEVICE_NAME, "deviceName");
}

function resolveOptions(options: AndroidAuthOptions): ResolvedAndroidOptions {
  const resolved = {
    appVersion: options.appVersion ?? DEFAULT_APP_VERSION,
    osVersion: options.osVersion ?? DEFAULT_OS_VERSION,
    apiLevel: options.apiLevel ?? DEFAULT_API_LEVEL,
    language: options.language ?? DEFAULT_LANGUAGE,
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    fetchImpl: options.fetchImpl ?? fetch,
    sleepImpl: options.sleepImpl ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))),
  };
  if (!/^\d+\.\d+\.\d+$/.test(resolved.appVersion)) {
    throw new TypeError("appVersion must use the major.minor.patch format");
  }
  if (!Number.isSafeInteger(resolved.timeoutMs) || resolved.timeoutMs <= 0) {
    throw new RangeError("timeoutMs must be a positive safe integer");
  }
  return resolved;
}

function buildUserAgent(options: ResolvedAndroidOptions): string {
  return `KT/${options.appVersion} An/${options.osVersion} ${options.language}`;
}

export function computeAndroidXvc(email: string, userAgent: string): string {
  requireNonEmpty(email, "email");
  requireNonEmpty(userAgent, "userAgent");
  return createHash("sha512")
    .update(`BARD|${userAgent}|DANTE|${email}|SIAN`)
    .digest("hex")
    .slice(0, 16);
}

function authHeaders(email: string, options: ResolvedAndroidOptions): Record<string, string> {
  const userAgent = buildUserAgent(options);
  return {
    "User-Agent": userAgent,
    "A": `android/${options.appVersion}/${options.language}`,
    "Accept": "*/*",
    "Accept-Language": options.language,
    "X-VC": computeAndroidXvc(email, userAgent),
  };
}

async function requestText(
  url: URL,
  init: RequestInit,
  options: ResolvedAndroidOptions,
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const response = await options.fetchImpl(url, { ...init, redirect: "error", signal: controller.signal });
    if (!response.ok) {
      throw new Error(`Kakao Android authentication HTTP status ${response.status}`);
    }
    return await readBoundedResponse(response);
  } finally {
    clearTimeout(timer);
  }
}

function parseObject(responseText: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(responseText);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Kakao Android authentication response is not an object");
  }
  return parsed as Record<string, unknown>;
}

function parseStatus(response: Record<string, unknown>): number {
  if (!Number.isInteger(response.status)) {
    throw new Error("Kakao Android authentication response has no integer status");
  }
  return response.status as number;
}

async function postJson(
  endpoint: string,
  email: string,
  body: unknown,
  options: ResolvedAndroidOptions,
): Promise<Record<string, unknown>> {
  return parseObject(
    await requestText(
      new URL(endpoint, AUTH_BASE_URL),
      {
        method: "POST",
        headers: { ...authHeaders(email, options), "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify(body),
      },
      options,
    ),
  );
}

export async function isAndroidDeviceAllowed(
  deviceName = DEFAULT_DEVICE_NAME,
  authOptions: AndroidAuthOptions = {},
): Promise<boolean> {
  const options = resolveOptions(authOptions);
  requireNonEmpty(deviceName, "deviceName");
  const url = new URL("allowlist.json", AUTH_BASE_URL);
  url.searchParams.set("model_name", deviceName);
  const response = parseObject(
    await requestText(
      url,
      { method: "GET", headers: { ...authHeaders("allowlist", options), "Content-Type": "application/x-www-form-urlencoded" } },
      options,
    ),
  );
  return response.allowlisted === true;
}

export async function loginAndroid(
  credentials: AndroidAuthCredentials,
  authOptions: AndroidAuthOptions = {},
): Promise<AuthResult> {
  validateCredentials(credentials);
  const options = resolveOptions(authOptions);
  const deviceName = credentials.deviceName ?? DEFAULT_DEVICE_NAME;
  const form = new URLSearchParams({
    password: credentials.password,
    device_name: deviceName,
    forced: "false",
    permanent: "true",
    email: credentials.email,
    device_uuid: credentials.deviceUuid,
  });
  const responseText = await requestText(
    new URL("login.json", AUTH_BASE_URL),
    {
      method: "POST",
      headers: { ...authHeaders(credentials.email, options), "Content-Type": "application/x-www-form-urlencoded" },
      body: form,
    },
    options,
  );
  const response = parseObject(responseText);
  const status = parseStatus(response);
  if (status !== 0) {
    throw new AndroidAuthApiError(status);
  }
  return parseLoginResponse(responseText);
}

export async function generateAndroidPasscode(
  credentials: AndroidAuthCredentials,
  authOptions: AndroidAuthOptions = {},
): Promise<AndroidPasscodeChallenge> {
  validateCredentials(credentials);
  const options = resolveOptions(authOptions);
  const deviceName = credentials.deviceName ?? DEFAULT_DEVICE_NAME;
  const response = await postJson(
    "passcodeLogin/generate",
    credentials.email,
    {
      email: credentials.email,
      password: credentials.password,
      permanent: true,
      device: {
        name: deviceName,
        uuid: credentials.deviceUuid,
        model: deviceName,
        osVersion: options.apiLevel,
      },
    },
    options,
  );
  const status = parseStatus(response);
  if (status !== 0) {
    throw new AndroidAuthApiError(status);
  }
  if (typeof response.passcode !== "string" || !Number.isSafeInteger(response.remainingSeconds)) {
    throw new Error("Kakao Android passcode response is incomplete");
  }
  return { passcode: response.passcode, remainingSeconds: response.remainingSeconds as number };
}

async function cancelAndroidRegistration(
  credentials: AndroidAuthCredentials,
  options: ResolvedAndroidOptions,
): Promise<void> {
  await postJson(
    "passcodeLogin/cancel",
    credentials.email,
    { email: credentials.email, password: credentials.password, device: { uuid: credentials.deviceUuid } },
    options,
  );
}

export async function waitForAndroidRegistration(
  credentials: AndroidAuthCredentials,
  challenge: AndroidPasscodeChallenge,
  authOptions: AndroidAuthOptions = {},
): Promise<void> {
  validateCredentials(credentials);
  const options = resolveOptions(authOptions);
  let registered = false;
  try {
    for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt += 1) {
      const response = await postJson(
        "passcodeLogin/registerDevice",
        credentials.email,
        { email: credentials.email, password: credentials.password, device: { uuid: credentials.deviceUuid } },
        options,
      );
      const status = parseStatus(response);
      if (status === 0) {
        registered = true;
        return;
      }
      if (status !== -100) {
        throw new AndroidAuthApiError(status);
      }
      const remainingSeconds = response.remainingSeconds;
      const intervalSeconds = response.nextRequestIntervalInSeconds;
      if (!Number.isSafeInteger(remainingSeconds) || !Number.isSafeInteger(intervalSeconds)) {
        throw new Error("Kakao Android registration polling response is incomplete");
      }
      if ((remainingSeconds as number) <= 0 || (remainingSeconds as number) > challenge.remainingSeconds + 5) {
        throw new Error("Kakao Android registration challenge expired");
      }
      const delaySeconds = Math.max(1, Math.min(intervalSeconds as number, remainingSeconds as number));
      await options.sleepImpl(delaySeconds * 1000);
    }
    throw new Error("Kakao Android registration exceeded the polling limit");
  } finally {
    if (!registered) {
      await cancelAndroidRegistration(credentials, options).catch(() => undefined);
    }
  }
}

export function readAndroidCredentialsFromEnvironment(): AndroidAuthCredentials {
  const email = process.env.KAKAO_EMAIL;
  const password = process.env.KAKAO_PASSWORD;
  const deviceUuid = process.env.KAKAO_ANDROID_DEVICE_UUID;
  const missing = [
    !email && "KAKAO_EMAIL",
    !password && "KAKAO_PASSWORD",
    !deviceUuid && "KAKAO_ANDROID_DEVICE_UUID",
  ].filter(Boolean);
  if (missing.length > 0) {
    throw new Error(`missing required environment variables: ${missing.join(", ")}`);
  }
  return { email: email as string, password: password as string, deviceUuid: deviceUuid as string, deviceName: process.env.KAKAO_ANDROID_DEVICE_NAME };
}

async function main(): Promise<void> {
  if (process.env.KAKAO_CONFIRM_ANDROID_REGISTRATION !== "YES") {
    throw new Error("set KAKAO_CONFIRM_ANDROID_REGISTRATION=YES to approve Android subdevice registration");
  }
  const credentials = readAndroidCredentialsFromEnvironment();
  const options = { appVersion: process.env.KAKAO_ANDROID_APP_VERSION };
  const deviceName = credentials.deviceName ?? DEFAULT_DEVICE_NAME;
  if (!(await isAndroidDeviceAllowed(deviceName, options))) {
    throw new Error(`Android device model ${deviceName} is not allowlisted for subdevice login`);
  }
  try {
    const existing = await loginAndroid(credentials, options);
    console.log(`Authentication: OK (userId=${existing.userId}, accessToken=***, refreshToken=***)`);
    return;
  } catch (error) {
    if (!(error instanceof AndroidAuthApiError) || error.status !== -100) {
      throw error;
    }
  }

  const challenge = await generateAndroidPasscode(credentials, options);
  console.log(`Enter this one-time code in the KakaoTalk app within ${challenge.remainingSeconds}s: ${challenge.passcode}`);
  await waitForAndroidRegistration(credentials, challenge, options);
  const result = await loginAndroid(credentials, options);
  console.log(`Authentication: OK (userId=${result.userId}, accessToken=***, refreshToken=***)`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    if (error instanceof AndroidAuthApiError) {
      console.error(`Android authentication failed: API status ${error.status}`);
    } else {
      console.error(error instanceof Error ? error.message : "Android authentication failed");
    }
    process.exitCode = 1;
  });
}
