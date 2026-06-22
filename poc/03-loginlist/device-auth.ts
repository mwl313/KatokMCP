import { pathToFileURL } from "node:url";
import {
  AuthApiError,
  readCredentialsFromEnvironment,
  registerDevice,
  requestPasscode,
} from "./auth.js";

async function main(): Promise<void> {
  const action = process.argv[2];
  const credentials = readCredentialsFromEnvironment();
  const options = { appVersion: process.env.KAKAO_APP_VERSION };

  if (action === "request") {
    await requestPasscode(credentials, options);
    console.log("Device passcode request: OK");
    return;
  }
  if (action === "register") {
    const passcode = process.env.KAKAO_PASSCODE;
    if (!passcode) {
      throw new Error("missing required environment variable: KAKAO_PASSCODE");
    }
    await registerDevice(credentials, passcode, true, options);
    console.log("Device registration: OK");
    return;
  }
  throw new Error("usage: device-auth.ts <request|register>");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    if (error instanceof AuthApiError) {
      console.error(`Device authentication failed: API status ${error.status}`);
    } else {
      console.error(error instanceof Error ? error.message : "Device authentication failed");
    }
    process.exitCode = 1;
  });
}
