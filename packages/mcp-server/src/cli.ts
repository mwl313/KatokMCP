#!/usr/bin/env node
/**
 * @katok-mcp/mcp-server CLI — Setup Wizard & Management Commands
 *
 * Commands:
 *   katok-mcp setup      → 5-step interactive wizard
 *   katok-mcp teardown   → Delete all stored data
 *   katok-mcp auth       → Passcode authentication only
 *   katok-mcp config     → Show current configuration status
 */

import { randomBytes } from "node:crypto";
import { readFile, writeFile, mkdir, copyFile, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { input, password, select, confirm } from "@inquirer/prompts";
import { CredentialStore } from "./credential-store.js";
import {
  authenticateAndroid,
  generateAndroidPasscode,
  waitForAndroidRegistration,
} from "@katok-mcp/loco-engine";

// ─── Constants ──────────────────────────────────────────────────────────────

const APP_NAME = "KatokMCP";
const APP_TAGLINE = "AI가 카카오톡을 읽고 답장합니다";
const CONFIG_DIR_NAME = ".kakao-mcp";
const PASSCODE_DISPLAY_SECONDS = 120;

// ─── Helpers ────────────────────────────────────────────────────────────────

function generateDeviceUuid(): string {
  return randomBytes(32).toString("hex");
}

function getConfigDir(): string {
  return path.join(os.homedir(), CONFIG_DIR_NAME);
}

function getConfigFilePath(): string {
  return path.join(getConfigDir(), "config.json");
}

function getBackupFilePath(originalPath: string): string {
  return originalPath + ".katok-backup";
}

interface SavedConfig {
  email: string;
  deviceUuid: string;
  allowWrite: boolean;
  aiService: string;
  savedAt: string;
}

async function loadConfig(): Promise<SavedConfig | null> {
  const configPath = getConfigFilePath();
  if (!existsSync(configPath)) return null;
  try {
    const raw = await readFile(configPath, "utf-8");
    return JSON.parse(raw) as SavedConfig;
  } catch {
    return null;
  }
}

async function saveConfig(config: SavedConfig): Promise<void> {
  const configDir = getConfigDir();
  if (!existsSync(configDir)) {
    await mkdir(configDir, { recursive: true });
  }
  await writeFile(getConfigFilePath(), JSON.stringify(config, null, 2), "utf-8");
}

function getClaudeConfigDir(): string {
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA || "", "Claude");
  }
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "Claude");
  }
  return path.join(os.homedir(), ".config", "Claude");
}

function getChatGptConfigDir(): string {
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA || "", "ChatGPT Desktop");
  }
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "com.openai.chat", "config");
  }
  return path.join(os.homedir(), ".config", "ChatGPT Desktop");
}

function getCursorConfigDir(): string {
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA || "", "Cursor", "User");
  }
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "Cursor", "User");
  }
  return path.join(os.homedir(), ".config", "Cursor", "User");
}

function getVscodeConfigDir(): string {
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA || "", "Code", "User");
  }
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "Code", "User");
  }
  return path.join(os.homedir(), ".config", "Code", "User");
}

function buildCommonEnv(email: string, password: string, deviceUuid: string, allowWrite: boolean): Record<string, string> {
  return {
    KAKAO_EMAIL: email,
    KAKAO_PASSWORD: password,
    KAKAO_ANDROID_DEVICE_UUID: deviceUuid,
    KAKAO_ALLOW_WRITE: allowWrite ? "YES" : "NO",
  };
}

async function safeReadJson(filePath: string): Promise<Record<string, unknown> | null> {
  try {
    if (!existsSync(filePath)) return null;
    const raw = await readFile(filePath, "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function saveConfigFile(
  filePath: string,
  configKey: string,
  serverConfig: Record<string, unknown>,
  serviceName: string,
): Promise<void> {
  // Backup existing file
  if (existsSync(filePath)) {
    const backupPath = getBackupFilePath(filePath);
    await copyFile(filePath, backupPath).catch(() => {});
    console.log(`  → Backup saved: ${backupPath}`);
  }

  let existing: Record<string, unknown> = {};
  const raw = await safeReadJson(filePath);
  if (raw) {
    existing = raw;
  }

  // Check if katok already exists
  const existingServers = existing[configKey] as Record<string, unknown> | undefined;
  if (existingServers && existingServers["katok"]) {
    const overwrite = await confirm({
      message: `katok MCP 서버가 이미 ${serviceName} 설정에 있습니다. 덮어쓰시겠습니까?`,
      default: false,
    });
    if (!overwrite) {
      console.log(`  → Skipped ${serviceName} configuration`);
      return;
    }
  }

  existing[configKey] = {
    ...(existing[configKey] as Record<string, unknown> || {}),
    katok: serverConfig,
  };

  await writeFile(filePath, JSON.stringify(existing, null, 2), "utf-8");
  console.log(`  → ${filePath} 설정 완료`);
}

// ─── Print Banner ───────────────────────────────────────────────────────────

function printBanner(): void {
  console.log("");
  console.log(`  ╔══════════════════════════════════════════╗`);
  console.log(`  ║     ${APP_NAME} — 1분이면 끝!              ║`);
  console.log(`  ║     ${APP_TAGLINE}     ║`);
  console.log(`  ╚══════════════════════════════════════════╝`);
  console.log("");
}

// ─── Setup Command ──────────────────────────────────────────────────────────

async function cmdSetup(): Promise<void> {
  printBanner();

  // Node.js version check
  const nodeVersion = process.versions.node;
  console.log(`  ✅ Node.js ${nodeVersion} 확인됨`);
  console.log("");

  const store = new CredentialStore();

  // ── Step 1: KakaoTalk Account ──
  console.log("  Step 1 — 카카오톡 계정");
  console.log("  ────────────────────────");

  const email = await input({
    message: "Email:",
    validate: (v: string) => (v.includes("@") ? true : "올바른 이메일 주소를 입력하세요"),
  });

  const pwValue = await password({
    message: "Password:",
    mask: true,
    validate: (v: string) => (v.length >= 4 ? true : "비밀번호는 최소 4자 이상입니다"),
  });

  // ── Step 2: Device Registration ──
  console.log("");
  console.log("  Step 2 — 기기 등록");
  console.log("  ────────────────────────");

  const deviceUuid = generateDeviceUuid();
  console.log(`  Device UUID: ${deviceUuid} (자동 생성)`);
  console.log("  ⚠️  재설치 시 필요하니 메모해두세요");
  console.log("");

  // Save credentials before auth
  await store.save({ email, password: pwValue, deviceUuid, deviceName: "SM-X930" });
  console.log("  ✅ AES-256-GCM으로 암호화 저장됨");
  console.log("");

  // ── Step 3: Phone Authentication ──
  console.log("  Step 3 — 휴대폰 인증 (최초 1회)");
  console.log("  ────────────────────────");

  try {
    const challenge = await generateAndroidPasscode(email, pwValue, deviceUuid, "SM-X930");
    console.log("");
    console.log("  ┌────────────────────────────────────────┐");
    console.log(`  │   📱 카카오톡 앱에서 이 번호를 입력    │`);
    console.log(`  │           [  ${challenge.passcode}  ] (${challenge.remainingSeconds}초)            │`);
    console.log("  └────────────────────────────────────────┘");
    console.log("  ⏳ 인증 대기 중...");

    await waitForAndroidRegistration(email, pwValue, deviceUuid, challenge);

    // Now authenticate to get tokens
    const authResult = await authenticateAndroid(email, pwValue, deviceUuid, "SM-X930");

    // Save auth tokens
    await store.saveAuth({
      userId: String(authResult.userId),
      accessToken: authResult.accessToken,
      refreshToken: authResult.refreshToken,
      tokenType: authResult.tokenType,
      savedAt: new Date().toISOString(),
    });

    console.log("  ✅ 인증 완료!");
    console.log("");
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`  ❌ 인증 실패: ${msg}`);
    console.log("  다시 시도하려면: katok-mcp auth");
    process.exit(1);
  }

  // ── Step 4: AI Service Selection ──
  console.log("  Step 4 — AI 비서 선택");
  console.log("  ────────────────────────");

  const aiChoice = await select({
    message: "AI 비서를 선택하세요:",
    choices: [
      { name: "Claude Desktop", value: "claude" },
      { name: "ChatGPT Desktop", value: "chatgpt" },
      { name: "Cursor / VS Code", value: "cursor-vscode" },
      { name: "OpenClaw (config 출력)", value: "openclaw" },
      { name: "직접 설정할게요 (가이드 출력)", value: "manual" },
    ],
  });

  // ── Step 5: Allow Write ──
  console.log("");
  console.log("  Step 5 — 메시지 전송 허용");
  console.log("  ────────────────────────");

  const allowWrite = await confirm({
    message: "AI가 메시지를 보낼 수 있게 할까요? (전송 시 🤖 표식이 자동 추가됩니다)",
    default: true,
  });

  // Build the common env
  const env = buildCommonEnv(email, pwValue, deviceUuid, allowWrite);

  // Configure based on selection
  const serverConfig = {
    command: "npx",
    args: ["-y", "@katok-mcp/mcp-server"],
    env,
  };

  switch (aiChoice) {
    case "claude": {
      const configDir = getClaudeConfigDir();
      const configPath = path.join(configDir, "claude_desktop_config.json");
      if (!existsSync(configDir)) {
        await mkdir(configDir, { recursive: true });
      }
      await saveConfigFile(configPath, "mcpServers", serverConfig, "Claude Desktop");
      break;
    }

    case "chatgpt": {
      const configDir = getChatGptConfigDir();
      const configPath = path.join(configDir, "config.json");
      if (!existsSync(configDir)) {
        await mkdir(configDir, { recursive: true });
      }
      const chatgptServerConfig = {
        type: "stdio",
        command: "npx",
        args: ["-y", "@katok-mcp/mcp-server"],
        env,
      };
      await saveConfigFile(configPath, "mcp_servers", chatgptServerConfig, "ChatGPT Desktop");
      break;
    }

    case "cursor-vscode": {
      const cursorDir = getCursorConfigDir();
      const vscodeDir = getVscodeConfigDir();
      let configured = false;

      // Try Cursor first
      if (existsSync(cursorDir) || aiChoice === "cursor-vscode") {
        const cursorConfigPath = path.join(cursorDir, "globalStorage", "roovet.cline", "mcp_settings.json");
        if (!existsSync(path.dirname(cursorConfigPath))) {
          await mkdir(path.dirname(cursorConfigPath), { recursive: true });
        }
        await saveConfigFile(cursorConfigPath, "mcpServers", serverConfig, "Cursor");
        configured = true;
      }

      // VS Code
      if (existsSync(vscodeDir)) {
        const vscodeConfigPath = path.join(vscodeDir, "globalStorage", "roovet.cline", "mcp_settings.json");
        if (!existsSync(path.dirname(vscodeConfigPath))) {
          await mkdir(path.dirname(vscodeConfigPath), { recursive: true });
        }
        await saveConfigFile(vscodeConfigPath, "mcpServers", serverConfig, "VS Code");
        configured = true;
      }

      if (!configured) {
        console.log("  ⚠️  Cursor/VS Code 설정 디렉토리를 찾을 수 없습니다.");
        console.log("  다음 설정을 직접 추가하세요:");
        printManualGuide(serverConfig);
      }
      break;
    }

    case "openclaw": {
      console.log("");
      console.log("  OpenClaw 설정:");
      console.log(`    openclaw mcp set katok -- npx -y @katok-mcp/mcp-server`);
      console.log("");
      console.log("  환경 변수:");
      for (const [key, value] of Object.entries(env)) {
        console.log(`    ${key}=${value}`);
      }
      break;
    }

    case "manual": {
      printManualGuide(serverConfig);
      break;
    }
  }

  // Save config metadata
  await saveConfig({
    email,
    deviceUuid,
    allowWrite,
    aiService: aiChoice,
    savedAt: new Date().toISOString(),
  });

  // ── Done ──
  console.log("");
  console.log("  🎉 모든 준비 완료!");
  console.log("  Claude Desktop을 재시작한 후 말해보세요:");
  console.log('  "카톡 채팅방 목록 보여줘"');
  console.log("");
}

function printManualGuide(serverConfig: Record<string, unknown>): void {
  console.log("");
  console.log("  직접 설정 가이드:");
  console.log("");
  console.log("  다음 JSON을 AI 클라이언트 설정에 추가하세요:");
  console.log("  " + JSON.stringify({ mcpServers: { katok: serverConfig } }, null, 2));
  console.log("");
  console.log("  또는 환경 변수를 직접 설정 후 실행:");
  console.log(`    npx -y @katok-mcp/mcp-server`);
  console.log("");
  console.log("  필요한 환경 변수:");
  console.log("    KAKAO_EMAIL=<이메일>");
  console.log("    KAKAO_PASSWORD=<비밀번호>");
  console.log("    KAKAO_ANDROID_DEVICE_UUID=<디바이스 UUID>");
  console.log("    KAKAO_ALLOW_WRITE=YES  (메시지 전송 허용 시)");
  console.log("");
}

// ─── Teardown Command ───────────────────────────────────────────────────────

async function cmdTeardown(): Promise<void> {
  console.log("");
  console.log("  KatokMCP — 설정 삭제");
  console.log("  ──────────────────────");
  console.log("");

  const confirmed = await confirm({
    message: "모든 저장된 데이터를 삭제하시겠습니까? (이메일, 비밀번호, 인증 토큰)",
    default: false,
  });

  if (!confirmed) {
    console.log("  삭제가 취소되었습니다.");
    return;
  }

  const configDir = getConfigDir();
  let deletedCount = 0;

  // Delete credentials.enc
  const credPath = path.join(configDir, "credentials.enc");
  if (existsSync(credPath)) {
    await unlink(credPath);
    deletedCount++;
  }

  // Delete auth.enc
  const authPath = path.join(configDir, "auth.enc");
  if (existsSync(authPath)) {
    await unlink(authPath);
    deletedCount++;
  }

  // Delete config.json
  const configPath = getConfigFilePath();
  if (existsSync(configPath)) {
    await unlink(configPath);
    deletedCount++;
  }

  // Remove backups if any
  const claudeConfigPath = path.join(getClaudeConfigDir(), "claude_desktop_config.json");
  const backupPath = getBackupFilePath(claudeConfigPath);
  if (existsSync(backupPath)) {
    await unlink(backupPath);
    deletedCount++;
  }

  console.log(`  ✅ ${deletedCount}개 파일 삭제 완료`);
  console.log("  설정이 완전히 제거되었습니다.");
  console.log("");
}

// ─── Auth Command ───────────────────────────────────────────────────────────

async function cmdAuth(): Promise<void> {
  console.log("");
  console.log("  KatokMCP — 인증");
  console.log("  ────────────────");
  console.log("");

  const store = new CredentialStore();
  const creds = await store.load().catch(() => null);

  if (!creds) {
    console.error("  ❌ 저장된 계정 정보가 없습니다.");
    console.error("  먼저 'katok-mcp setup'을 실행하세요.");
    process.exit(1);
  }

  console.log(`  계정: ${creds.email}`);
  console.log("");

  try {
    const challenge = await generateAndroidPasscode(
      creds.email,
      creds.password,
      creds.deviceUuid,
      creds.deviceName || "SM-X930",
    );

    console.log("  ┌────────────────────────────────────────┐");
    console.log(`  │   📱 카카오톡 앱에서 이 번호를 입력    │`);
    console.log(`  │           [  ${challenge.passcode}  ] (${challenge.remainingSeconds}초)            │`);
    console.log("  └────────────────────────────────────────┘");
    console.log("  ⏳ 인증 대기 중...");

    await waitForAndroidRegistration(
      creds.email,
      creds.password,
      creds.deviceUuid,
      challenge,
    );

    const authResult = await authenticateAndroid(
      creds.email,
      creds.password,
      creds.deviceUuid,
      creds.deviceName || "SM-X930",
    );

    await store.saveAuth({
      userId: String(authResult.userId),
      accessToken: authResult.accessToken,
      refreshToken: authResult.refreshToken,
      tokenType: authResult.tokenType,
      savedAt: new Date().toISOString(),
    });

    console.log("  ✅ 인증 완료!");
    console.log("");
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`  ❌ 인증 실패: ${msg}`);
    process.exit(1);
  }
}

// ─── Config Command ─────────────────────────────────────────────────────────

async function cmdConfig(): Promise<void> {
  console.log("");
  console.log("  KatokMCP — 설정 상태");
  console.log("  ─────────────────────");
  console.log("");

  const store = new CredentialStore();
  const hasCredentials = await store.exists();
  const hasAuth = await store.hasAuth();
  const config = await loadConfig();

  console.log(`  저장된 계정:     ${hasCredentials ? "✅ 있음" : "❌ 없음"}`);
  console.log(`  인증 토큰:      ${hasAuth ? "✅ 있음" : "❌ 없음"}`);
  console.log(`  AI 서비스:       ${config?.aiService ?? "설정 안 됨"}`);
  console.log(`  메시지 전송:    ${config?.allowWrite ? "✅ 허용" : "❌ 차단"}`);
  console.log(`  Device UUID:     ${config?.deviceUuid ? config.deviceUuid.slice(0, 16) + "..." : "없음"}`);
  console.log(`  Email:           ${config?.email ?? "없음"}`);
  console.log(`  설정 저장일:     ${config?.savedAt ?? "없음"}`);
  console.log("");

  // Check config files
  const claudeConfigPath = path.join(getClaudeConfigDir(), "claude_desktop_config.json");
  const claudeConfig = await safeReadJson(claudeConfigPath);
  const hasClaudeConfig = !!(
    claudeConfig &&
    (claudeConfig as Record<string, unknown>)["mcpServers"] &&
    ((claudeConfig as Record<string, unknown>)["mcpServers"] as Record<string, unknown>)?.["katok"]
  );
  console.log(`  Claude Desktop:  ${hasClaudeConfig ? "✅ 설정됨" : "❌ 설정 안 됨"}`);

  console.log("");
  console.log("  명령어:");
  console.log("    katok-mcp setup     → 설정 마법사 실행");
  console.log("    katok-mcp auth      → 인증만 다시 실행");
  console.log("    katok-mcp teardown  → 모든 데이터 삭제");
  console.log("");
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const command = process.argv[2] ?? "help";

  switch (command) {
    case "setup":
      await cmdSetup();
      break;
    case "teardown":
      await cmdTeardown();
      break;
    case "auth":
      await cmdAuth();
      break;
    case "config":
      await cmdConfig();
      break;
    case "help":
    default:
      console.log("");
      console.log(`  KatokMCP — AI가 카카오톡을 읽고 답장합니다`);
      console.log("");
      console.log("  사용법:");
      console.log("    katok-mcp setup         대화형 설치 마법사");
      console.log("    katok-mcp teardown      저장된 데이터 완전 삭제");
      console.log("    katok-mcp auth          passcode 인증만 다시 실행");
      console.log("    katok-mcp config        현재 설정 상태 확인");
      console.log("");
      break;
  }
}

main().catch((error) => {
  console.error("Error:", error instanceof Error ? error.message : String(error));
  process.exit(1);
});