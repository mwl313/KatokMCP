/**
 * Android Kakao Account authentication via passcode approval flow.
 * 
 * Flow:
 * 1. Check allowlist → 2. Try login → if -100, 3. Generate passcode
 * 4. User enters passcode in KakaoTalk app → 5. Poll registration → 6. Login
 */

import { createHash } from "node:crypto";
import type { AuthResult } from "./types.js";
import { parseLoginResponse } from "./windows.js";

const AUTH_BASE_URL = "https://katalk.kakao.com/android/account/";
const DEFAULT_APP_VERSION = "25.9.2";
const DEFAULT_DEVICE_NAME = "SM-X930";
const MAX_POLL_ATTEMPTS = 120;

export interface AndroidAuthOptions {
  appVersion?: string;
  osVersion?: string;
  apiLevel?: string;
  language?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  sleepImpl?: (ms: number) => Promise<void>;
}

export class AndroidAuthApiError extends Error {
  constructor(readonly status: number) {
    super(`Kakao Android authentication failed with API status ${status}`);
    this.name = "AndroidAuthApiError";
  }
}

export interface AndroidPasscodeChallenge {
  passcode: string;
  remainingSeconds: number;
}

interface ResolvedOptions {
  appVersion: string;
  osVersion: string;
  apiLevel: string;
  language: string;
  timeoutMs: number;
  fetchImpl: typeof fetch;
  sleepImpl: (ms: number) => Promise<void>;
}

function resolveOptions(options: AndroidAuthOptions = {}): ResolvedOptions {
  return {
    appVersion: options.appVersion ?? DEFAULT_APP_VERSION,
    osVersion: options.osVersion ?? "13",
    apiLevel: options.apiLevel ?? "33",
    language: options.language ?? "ko",
    timeoutMs: options.timeoutMs ?? 15_000,
    fetchImpl: options.fetchImpl ?? fetch,
    sleepImpl: options.sleepImpl ?? ((ms) => new Promise((r) => setTimeout(r, ms))),
  };
}

export function computeAndroidXvc(email: string, userAgent: string): string {
  return createHash("sha512")
    .update(`BARD|${userAgent}|DANTE|${email}|SIAN`)
    .digest("hex")
    .slice(0, 16);
}

function buildUserAgent(opts: ResolvedOptions): string {
  return `KT/${opts.appVersion} An/${opts.osVersion} ${opts.language}`;
}

function authHeaders(email: string, opts: ResolvedOptions): Record<string, string> {
  const ua = buildUserAgent(opts);
  return {
    "User-Agent": ua,
    "A": `android/${opts.appVersion}/${opts.language}`,
    "Accept": "*/*",
    "Accept-Language": opts.language,
    "X-VC": computeAndroidXvc(email, ua),
    "Connection": "close",
  };
}

async function requestText(url: URL, init: RequestInit, opts: ResolvedOptions): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
  try {
    const response = await opts.fetchImpl(url, { ...init, redirect: "error", signal: controller.signal });
    if (!response.ok) throw new Error(`Kakao Android auth HTTP ${response.status}`);
    if (!response.body) return "";
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } finally { clearTimeout(timer); }
}

/** Check if an Android device model is allowlisted for subdevice login */
export async function isAndroidDeviceAllowed(deviceName = DEFAULT_DEVICE_NAME, opts: AndroidAuthOptions = {}): Promise<boolean> {
  const o = resolveOptions(opts);
  const url = new URL("allowlist.json", AUTH_BASE_URL);
  url.searchParams.set("model_name", deviceName);
  const text = await requestText(url, { method: "GET", headers: { ...authHeaders("allowlist", o), "Content-Type": "application/x-www-form-urlencoded" } }, o);
  const parsed: Record<string, unknown> = JSON.parse(text);
  return parsed.allowlisted === true;
}

/** Try Android login directly (may fail with -100 if device not registered) */
export async function loginAndroid(email: string, password: string, deviceUuid: string, deviceName = DEFAULT_DEVICE_NAME, opts: AndroidAuthOptions = {}): Promise<AuthResult> {
  const o = resolveOptions(opts);
  const form = new URLSearchParams({ password, device_name: deviceName, forced: "false", permanent: "true", email, device_uuid: deviceUuid });
  const text = await requestText(new URL("login.json", AUTH_BASE_URL), {
    method: "POST",
    headers: { ...authHeaders(email, o), "Content-Type": "application/x-www-form-urlencoded" },
    body: form,
  }, o);
  return parseLoginResponse(text);
}

/** Generate a passcode that user must enter in KakaoTalk app */
export async function generateAndroidPasscode(email: string, password: string, deviceUuid: string, deviceName = DEFAULT_DEVICE_NAME, opts: AndroidAuthOptions = {}): Promise<AndroidPasscodeChallenge> {
  const o = resolveOptions(opts);
  const body = { email, password, permanent: true, device: { name: deviceName, uuid: deviceUuid, model: deviceName, osVersion: o.apiLevel } };
  const text = await requestText(new URL("passcodeLogin/generate", AUTH_BASE_URL), {
    method: "POST",
    headers: { ...authHeaders(email, o), "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(body),
  }, o);
  const response: Record<string, unknown> = JSON.parse(text);
  if (!Number.isInteger(response.status)) throw new Error("Response has no status");
  if (response.status !== 0) throw new AndroidAuthApiError(response.status as number);
  if (typeof response.passcode !== "string" || !Number.isSafeInteger(response.remainingSeconds)) throw new Error("Incomplete passcode response");
  return { passcode: response.passcode, remainingSeconds: response.remainingSeconds as number };
}

/** Poll until device registration is approved (user entered passcode in app) */
export async function waitForAndroidRegistration(email: string, password: string, deviceUuid: string, challenge: AndroidPasscodeChallenge, opts: AndroidAuthOptions = {}): Promise<void> {
  const o = resolveOptions(opts);
  let registered = false;
  try {
    for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
      const text = await requestText(new URL("passcodeLogin/registerDevice", AUTH_BASE_URL), {
        method: "POST",
        headers: { ...authHeaders(email, o), "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({ email, password, device: { uuid: deviceUuid } }),
      }, o);
      const response: Record<string, unknown> = JSON.parse(text);
      const status = response.status as number;
      if (status === 0) { registered = true; return; }
      if (status !== -100) throw new AndroidAuthApiError(status);
      const remaining = response.remainingSeconds as number;
      const interval = response.nextRequestIntervalInSeconds as number;
      if (!Number.isSafeInteger(remaining) || !Number.isSafeInteger(interval)) throw new Error("Incomplete polling response");
      if (remaining <= 0 || remaining > challenge.remainingSeconds + 5) throw new Error("Challenge expired");
      await o.sleepImpl(Math.max(1, Math.min(interval, remaining)) * 1000);
    }
    throw new Error("Registration polling exceeded limit");
  } finally {
    if (!registered) {
      await requestText(new URL("passcodeLogin/cancel", AUTH_BASE_URL), {
        method: "POST",
        headers: { ...authHeaders(email, o), "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({ email, password, device: { uuid: deviceUuid } }),
      }, o).catch(() => undefined);
    }
  }
}

export interface RefreshResult {
  accessToken: string;
  refreshToken: string;
  tokenType: string;
}

/**
 * Refresh access token using refresh_token.
 * POST to login.json with refresh=true
 */
export async function refreshAccessToken(
  email: string,
  refreshToken: string,
  deviceUuid: string,
  deviceName = DEFAULT_DEVICE_NAME,
  opts: AndroidAuthOptions = {},
): Promise<RefreshResult> {
  const o = resolveOptions(opts);
  const form = new URLSearchParams({ email, refresh_token: refreshToken, device_uuid: deviceUuid, device_name: deviceName });
  const text = await requestText(new URL("login.json", AUTH_BASE_URL), {
    method: "POST",
    headers: { ...authHeaders(email, o), "Content-Type": "application/x-www-form-urlencoded" },
    body: form,
  }, o);
  const response: Record<string, unknown> = JSON.parse(text);
  if (!Number.isInteger(response.status)) throw new Error("Response has no status");
  if (response.status !== 0) throw new AndroidAuthApiError(response.status as number);
  const accessToken = response.access_token;
  const newRefreshToken = response.refresh_token;
  const tokenType = response.token_type;
  if (typeof accessToken !== "string") throw new Error("No access token in refresh response");
  if (typeof newRefreshToken !== "string") throw new Error("No refresh token in refresh response");
  return { accessToken, refreshToken: newRefreshToken, tokenType: typeof tokenType === "string" ? tokenType : "bearer" };
}

/** Full Android auth flow: try login, if -100 then passcode approval */
export async function authenticateAndroid(email: string, password: string, deviceUuid: string, deviceName = DEFAULT_DEVICE_NAME, opts: AndroidAuthOptions = {}): Promise<AuthResult> {
  try {
    return await loginAndroid(email, password, deviceUuid, deviceName, opts);
  } catch (error) {
    if (!(error instanceof AndroidAuthApiError) || error.status !== -100) throw error;
  }
  const challenge = await generateAndroidPasscode(email, password, deviceUuid, deviceName, opts);
  console.log(`Enter passcode in KakaoTalk app: ${challenge.passcode} (${challenge.remainingSeconds}s)`);
  await waitForAndroidRegistration(email, password, deviceUuid, challenge, opts);
  return await loginAndroid(email, password, deviceUuid, deviceName, opts);
}

export function readAndroidCredentialsFromEnvironment(): { email: string; password: string; deviceUuid: string; deviceName?: string } {
  const email = process.env.KAKAO_EMAIL;
  const password = process.env.KAKAO_PASSWORD;
  const deviceUuid = process.env.KAKAO_ANDROID_DEVICE_UUID;
  const missing = [!email && "KAKAO_EMAIL", !password && "KAKAO_PASSWORD", !deviceUuid && "KAKAO_ANDROID_DEVICE_UUID"].filter(Boolean);
  if (missing.length > 0) throw new Error(`missing required environment variables: ${missing.join(", ")}`);
  return { email: email as string, password: password as string, deviceUuid: deviceUuid as string, deviceName: process.env.KAKAO_ANDROID_DEVICE_NAME };
}