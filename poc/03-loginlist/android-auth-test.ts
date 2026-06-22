import assert from "node:assert/strict";
import {
  computeAndroidXvc,
  generateAndroidPasscode,
  isAndroidDeviceAllowed,
  loginAndroid,
  waitForAndroidRegistration,
} from "./android-auth.js";

const credentials = {
  email: "test@example.com",
  password: "fake-password",
  deviceUuid: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  deviceName: "SM-X930",
};
assert.equal(computeAndroidXvc(credentials.email, "KT/25.9.2 An/13 ko"), "5496390f221823b4");

const requests: Request[] = [];
let registrationPoll = 0;
const mockFetch: typeof fetch = async (input, init) => {
  const request = new Request(input, init);
  requests.push(request);
  const path = new URL(request.url).pathname;
  if (path.endsWith("allowlist.json")) {
    return new Response('{"allowlisted":true}');
  }
  if (path.endsWith("passcodeLogin/generate")) {
    return new Response('{"status":0,"passcode":"654321","remainingSeconds":60}');
  }
  if (path.endsWith("passcodeLogin/registerDevice")) {
    registrationPoll += 1;
    return new Response(
      registrationPoll === 1
        ? '{"status":-100,"remainingSeconds":60,"nextRequestIntervalInSeconds":1}'
        : '{"status":0}',
    );
  }
  if (path.endsWith("login.json")) {
    return new Response('{"status":0,"userId":9007199254740993123,"access_token":"fake-access","refresh_token":"fake-refresh","token_type":"bearer"}');
  }
  return new Response('{"status":-400}');
};
const options = { fetchImpl: mockFetch, sleepImpl: async () => undefined };

assert.equal(await isAndroidDeviceAllowed(credentials.deviceName, options), true);
const challenge = await generateAndroidPasscode(credentials, options);
assert.deepEqual(challenge, { passcode: "654321", remainingSeconds: 60 });
await waitForAndroidRegistration(credentials, challenge, options);
const login = await loginAndroid(credentials, options);
assert.equal(login.userId, 9_007_199_254_740_993_123n);

const generateRequest = requests.find((request) => request.url.endsWith("passcodeLogin/generate"));
assert.ok(generateRequest);
const generateBody = JSON.parse(await generateRequest.text()) as Record<string, unknown>;
assert.equal(generateBody.email, credentials.email);
assert.equal((generateBody.device as Record<string, unknown>).uuid, credentials.deviceUuid);
assert.equal(generateRequest.headers.get("x-vc"), "5496390f221823b4");

console.log("Android X-VC known vector: OK");
console.log("Android passcode registration flow: OK");
console.log("Android token response parsing: OK");
