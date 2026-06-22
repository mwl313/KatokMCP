# 🔧 KakaoMCP — 개선 및 리팩토링 가이드

> **대상:** Cline (DeepSeek Flash)
> **목표:** main 브랜치 기준 생산성/안정성/포트폴리오 완성도 향상
> **우선순위:** 🔴 긴급 → 🟡 권장 → 🟢 여유 → 💡 포트폴리오

---

## 작업 순서 (권장)

```
1️⃣ npm publish 준비 (🔴)
2️⃣ stream.ts readNextPush 구현 (🔴)  
3️⃣ @deprecated 함수 제거 (🟡)
4️⃣ STATUS.md 갱신 (🟡)
5️⃣ docs/ 폴더 + 연동 가이드 (🟡)
6️⃣ 루트 package.json workspace (🟡)
7️⃣ PING Keep-Alive (🟢)
8️⃣ 데모 영상 + CI (💡)
```

---

## 🔴 긴급 — Production 차단 이슈

### 1. MCP 서버 loco-engine import 경로

**파일:** `packages/mcp-server/src/index.ts:16`
**현재:**
```typescript
import { LocoClient } from "@kakao-mcp/loco-engine";
```
**문제:** `@kakao-mcp/loco-engine`이 아직 npm에 publish되지 않아서 import가 안 풀림.

**해결 (택1):**
- **A:** `npm link` 사용 → `packages/loco-engine`에서 `npm link`, `packages/mcp-server`에서 `npm link @kakao-mcp/loco-engine`
- **B:** 루트 `package.json`에 npm workspace 설정 (권장)
- **C:** 상대경로 import로 임시 변경: `import { LocoClient } from "../loco-engine/dist/index.js"`

---

### 2. public-key.pem 경로가 poc/에 의존

**파일:** `packages/loco-engine/src/session.ts:73`
**현재:**
```typescript
config.publicKeyPath ?? new URL("../../poc/02-checkin/public-key.pem", import.meta.url)
```
**문제:** 배포 시 `poc/` 폴더가 없으면 session.ts가 깨짐. `poc/`은 Phase A 실험 코드 폴더라 프로덕션 배포에 포함되면 안 됨.

**해결:**
```typescript
// ① public-key.pem을 packages/loco-engine/assets/ 로 복사
mkdir -p packages/loco-engine/assets
cp poc/02-checkin/public-key.pem packages/loco-engine/assets/

// ② session.ts 경로 수정
config.publicKeyPath ?? new URL("../assets/public-key.pem", import.meta.url)
```

---

### 3. stream.ts readNextPush 미구현

**파일:** `packages/loco-engine/src/stream.ts:110`
**현재:**
```typescript
private async readNextPush(): Promise<Buffer | null> {
  return null; // Placeholder
}
```
**문제:** Push 수신 로직이 없어서 Phase E가 반쪽. 새 메시지 알림, KICKOUT 감지, CHANGESVR 대응 불가.

**해결 방향:**
```
LocoConnection의 raw socket에서 데이터를 계속 읽으면서
request/response 응답인지 push 이벤트인지 구분해야 함.

핵심 아이디어:
- LocoConnection.command()가 응답 대기 중일 때는 push를 버퍼링
- command()가 대기 중이 아닐 때 도착한 데이터 = push 이벤트
- async generator나 이벤트 emitter 패턴으로 구현
```

**참고:** KiwiTalk의 `talk-loco-client`에서 Push 수신 방식을 참고하세요.

---

### 4. package.json build/dev 스크립트 누락

**파일:** `packages/loco-engine/package.json`, `packages/mcp-server/package.json`
**문제:** `npm run build` (TypeScript 컴파일)와 `npm run dev` 스크립트가 정의되어 있는지 확인 필요. README에서는 `npm run build`를 사용하라고 안내 중.

**체크리스트:**
- [ ] loco-engine: `"build": "tsc"` / `"dev": "tsc --watch"` 
- [ ] mcp-server: `"build": "tsc"` / `"dev": "tsc --watch"`
- [ ] mcp-server: `"start"` 스크립트 (node dist/index.js)
- [ ] mcp-server: `tsconfig.json`에 `outDir: "dist"` 확인

---

## 🟡 권장 — 있으면 좋고 없으면 아쉬움

### 5. @deprecated 함수 정리

**파일:** `packages/loco-engine/src/commands.ts:98~157`
**대상:**
- `sendLchatList()` — LocoClient 방식으로 대체됨
- `sendSyncMsg()` — LocoClient 방식으로 대체됨

**작업:** 두 함수와 주석 블록 삭제. 남아있으면 Cline이 헷갈려서 잘못된 함수를 호출할 수 있음.

---

### 6. STATUS.md 최신 커밋 반영

**파일:** `STATUS.md`
**누락된 커밋:**
- `f2118cd` — Phase E-1: Stream Reader
- `cdb983d` — Phase F-1: MIT License 추가
- `d14755a` — docs: README 완전 재작성

**작업:** STATUS.md 하단 git 히스토리 표에 위 3개 커밋 추가. Phase E/F 상태 표시 업데이트.

---

### 7. docs/ 폴더 생성 + 연동 가이드

**파일:** 새로 생성: `docs/ai-integration.md`
**README에서 링크만 있고 실제 문서 없음.** Cline에게 바로 사용자를 위한 연동 가이드를 쓰라고 지시.

**포함할 내용:**
- Claude Desktop (`claude_desktop_config.json`)
- Claude Code (`claude mcp add`)
- OpenClaw (MCP 설정)
- Cursor / VS Code (`.cursor/mcp.json`)
- 각 설정의 예시 JSON 복붙 가능하게

---

### 8. 루트 package.json workspace

**파일:** `package.json` (루트에 신규 생성)
**현재:** 두 패키지 각각 `npm install` 해야 함.
**해결:** npm workspace로 통합

```json
{
  "name": "kakao-mcp",
  "private": true,
  "workspaces": ["packages/*"],
  "scripts": {
    "build": "npm run build --workspaces",
    "dev": "npm run dev --workspaces"
  }
}
```

**효과:** `npm install` 한 번으로 두 패키지 모두 설치됨.

---

## 🟢 여유 — 시간 날 때

### 9. PING Keep-Alive 주기 호출

**파일:** `packages/mcp-server/src/index.ts`
**구현:** `commands.ts`에 `sendPing()` 함수는 있는데, 30초마다 자동으로 호출하는 로직이 없음.

**작업:** LocoClient나 MCP 서버에 30초 인터벌로 PING을 보내는 Keep-Alive 타이머 추가.

```typescript
// LocoClient에 추가:
private pingInterval?: NodeJS.Timeout;

startKeepAlive(intervalMs = 30_000): void {
  this.pingInterval = setInterval(() => {
    sendPing(this).catch(() => {});
  }, intervalMs);
}

stopKeepAlive(): void {
  if (this.pingInterval) clearInterval(this.pingInterval);
}
```

---

### 10. .gitignore 재점검

**파일:** `.gitignore`
**확인할 패턴:**
- [ ] `*.pem` — public-key.pem이 git tracking 중인지 확인
- [ ] `dist/` — 빌드 결과물
- [ ] `*.env` — 환경변수 파일 전부
- [ ] `.kakao-mcp/` — Credential Store 기본 경로

---

## 💡 포트폴리오 — 있어야 빛나는 것

### 11. npm publish

**대상:** `@kakao-mcp/loco-engine`, `@kakao-mcp/mcp-server`

**준비물:**
- npm 계정
- `npm login`
- 각 패키지의 `package.json`에 `"publishConfig": { "access": "public" }` 추가

**작업:**
```bash
cd packages/loco-engine
npm publish
cd ../mcp-server
npm publish
```

**완료 후:** `npx @kakao-mcp/mcp-server`로 전 세계 누구나 설치 가능.

---

### 12. 데모 영상 1개

**도구:** OBS 또는 macOS QuickTime (화면 녹화)
**내용 (30초~1분):**
```
1. 터미널 열고 MCP 서버 실행
2. Claude Desktop 열기
3. "채팅방 목록 보여줘" → kakao_list_chats 호출
4. "가장 최근 메시지 읽어줘" → kakao_read_chat
5. "안녕! 이 메시지는 AI가 보냈어" → kakao_send_chat 전송
```

**출력:** README에 GIF로 첨부. `/img/demo.gif`

---

### 13. GitHub Actions CI

**파일:** `.github/workflows/ci.yml`
**내용:**
```yaml
on: [push, pull_request]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: "18" }
      - run: npm ci
      - run: npm run build --workspaces
      - run: npm test --workspaces --if-present
```

**효과:** 빌드가 깨지면 GitHub에 빨간 X 표시 → 프로젝트의 신뢰도 상승.

---

## ⚠️ 참고: 실서버 검증된 I/O 값 요약

Cline이 작업할 때 헷갈리지 않도록 아래 값들이 확정되었다는 걸 꼭 알려주세요.

| 항목 | 확정값 |
|------|--------|
| AES 암호화 | **AES-128-CFB** (GCM 아님) |
| key_encrypt_type | **15 (0x0F)** (16 아님) |
| encrypt_type | **2 (CFB)** (3/GCM 아님) |
| LOGINLIST 필드 | **oauthToken** (token 아님) |
| 필요 필드 | duuid, prtVer, rp, lbk 필수 |
| Android 기기 | SM-X930 (allowlist 등록됨) |
| 영구 연결 | LocoConnection 사용 (-201 방지) |

---

> 마지막 업데이트: 2026-06-23 02:46
> 작성: 아리아 (Haven v0.5)
