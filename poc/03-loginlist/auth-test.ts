import assert from "node:assert/strict";
import {
  AuthApiError,
  authenticate,
  buildUserAgent,
  computeXvc,
  parseLoginResponse,
  registerDevice,
  requestPasscode,
} from "./auth.js";

const deviceUuid = "WlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWg==";
const userAgent = buildUserAgent("26.5.0");
assert.equal(userAgent, "KT/26.5.0 Wd/10.0 ko");
assert.equal(computeXvc(deviceUuid, userAgent, "test@example.com"), "8b8f4f409e96c09a");

let capturedRequest: Request | undefined;
const successFetch: typeof fetch = async (input, init) => {
  capturedRequest = new Request(input, init);
  return new Response(
    '{"status":0,"userId":9007199254740993123,"access_token":"fake-access","refresh_token":"fake-refresh","token_type":"bearer"}',
    { status: 200, headers: { "content-type": "application/json" } },
  );
};

const result = await authenticate(
  {
    email: "test@example.com",
    password: "fake-password",
    deviceUuid,
    deviceName: "TEST_DEVICE",
  },
  { fetchImpl: successFetch },
);
assert.equal(result.userId, 9_007_199_254_740_993_123n);
assert.equal(result.accessToken, "fake-access");
assert.equal(result.refreshToken, "fake-refresh");

assert.ok(capturedRequest);
assert.equal(capturedRequest.method, "POST");
assert.equal(capturedRequest.url, "https://katalk.kakao.com/win32/account/login.json");
assert.equal(capturedRequest.headers.get("user-agent"), userAgent);
assert.equal(capturedRequest.headers.get("a"), "win32/26.5.0/ko");
assert.equal(capturedRequest.headers.get("x-vc"), "8b8f4f409e96c09a");
const requestForm = new URLSearchParams(await capturedRequest.text());
assert.equal(requestForm.get("device_name"), "TEST_DEVICE");
assert.equal(requestForm.get("device_uuid"), deviceUuid);
assert.equal(requestForm.get("email"), "test@example.com");
assert.equal(requestForm.get("password"), "fake-password");
assert.equal(requestForm.get("forced"), "false");

const deviceRequests: Request[] = [];
const deviceFetch: typeof fetch = async (input, init) => {
  deviceRequests.push(new Request(input, init));
  return new Response('{"status":0}', { status: 200 });
};
const credentials = { email: "test@example.com", password: "fake-password", deviceUuid };
await requestPasscode(credentials, { fetchImpl: deviceFetch });
await registerDevice(credentials, "1234", true, { fetchImpl: deviceFetch });
assert.equal(deviceRequests[0]?.url, "https://katalk.kakao.com/win32/account/request_passcode.json");
assert.equal(deviceRequests[1]?.url, "https://katalk.kakao.com/win32/account/register_device.json");
const registerForm = new URLSearchParams(await deviceRequests[1]?.text());
assert.equal(registerForm.get("passcode"), "1234");
assert.equal(registerForm.get("permanent"), "true");

assert.throws(
  () => parseLoginResponse('{"status":12}'),
  (error: unknown) => error instanceof AuthApiError && error.status === 12,
);
assert.throws(() => parseLoginResponse('{"status":0,"userId":1}'), /access token/);
assert.throws(() => computeXvc("invalid", userAgent, "test@example.com"), /deviceUuid/);

await assert.rejects(
  authenticate(
    { email: "test@example.com", password: "fake-password", deviceUuid },
    { fetchImpl: async () => new Response("x".repeat(1024 * 1024 + 1)) },
  ),
  /size limit/,
);

console.log("X-VC known vector: OK");
console.log("Authentication request shape: OK");
console.log("64-bit userId and token parsing: OK");
console.log("Sanitized API error handling: OK");
console.log("Bounded response streaming: OK");
console.log("Device registration request flow: OK");
