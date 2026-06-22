# 🔧 KakaoMCP — 개선 가이드 v2

> **대상:** Cline (DeepSeek Flash)
> **기준:** `experiment/cline-flash` (commit `cf81fcd`)
> **제외:** npm publish, 데모 영상, CI/CD — 별도 지시 있을 때까지 보류
> **우선순위:** 🔴 긴급 → 🟡 권장 → 🟢 여유

---

## 작업 순서 (권장)

```
1️⃣ public-key.pem 복사 (🔴)
2️⃣ STATUS.md 갱신 (🟡)
3️⃣ MCP 서버 Keep-Alive 연동 (🟡)
4️⃣ connection.ts unused import 정리 (🟡)
5️⃣ connection.ts push/response TCP 프레임 경계 처리 (🟡)
6️⃣ connection.ts LocoClient timeoutMs 전달 (🟢)
7️⃣ docs/ 경로 절대경로→상대경로 (🟢)
```

---

## 🔴 긴급 — Production 차단 이슈

### 1. public-key.pem 파일 미존재

**원인:** `session.ts` 경로는 `../assets/public-key.pem`으로 수정했지만, 실제로 `packages/loco-engine/assets/` 디렉토리와 `public-key.pem` 파일이 생성되지 않음.

**현재 상태:** 서버 실행 시 `ENOENT` 에러로 바로 크래시.

**해결:**
```bash
mkdir -p packages/loco-engine/assets
cp poc/02-checkin/public-key.pem packages/loco-engine/assets/
```

`poc/` 디렉토리를 배포에서 제외해도 `assets/`에 복사본이 있으므로 안전.

---

## 🟡 권장

### 2. STATUS.md 갱신

**파일:** `STATUS.md`

**누락된 커밋:**
- `cf81fcd` — IMPROVEMENTS 전 항목 완료
  - connection.ts 리팩토링 (push 버퍼, 이벤트 기반 응답 처리)
  - stream.ts readNextPush 구현 (polling 방식)
  - @deprecated 함수 제거
  - PING Keep-Alive 추가
  - 루트 npm workspace 생성
  - docs/ai-integration.md 생성
  - .gitignore 개선
  - public-key.pem 경로 변경

**작업:** STATUS.md 하단 git 히스토리 표에 위 커밋을 추가하고, Phase E/F 상태를 업데이트.

---

### 3. MCP 서버에 Keep-Alive 연동

**파일:** `packages/mcp-server/src/index.ts`

**현재 상태:** `LocoClient.startKeepAlive()`는 `session.ts`에 구현됐지만, MCP 서버의 `ensureClient()`에서 호출하지 않음. 따라서 Keep-Alive PING이 실제로 전송되지 않음.

**해결:** `ensureClient()`에서 세션 생성 직후 Keep-Alive 시작:
```typescript
async function ensureClient(): Promise<LocoClient> {
  if (client && client.getConnection().isConnected()) return client;
  // ... auth + connect ...
  client = await LocoClient.connect({ auth });
  client.startKeepAlive();  // ← 추가
  console.error("Session established");
  return client;
}
```

**참고:** `close()` 시 `stopKeepAlive()`가 자동 호출되므로 별도 정리 불필요.

---

### 4. connection.ts unused import 정리

**파일:** `packages/loco-engine/src/connection.ts:13`

**현재:**
```typescript
import { once } from "node:events";
```

**문제:** `once`가 더 이상 사용되지 않음. 원래 `await once(socket, "connect")`로 연결을 기다렸지만, 현재는 `connectSocket()` 내부에서 `await once(socket, "connect")`를 처리하므로 `connection.ts`에서는 불필요.

**해결:** `import { once } from "node:events";` 라인 제거. (연쇄 효과 없음 — 해당 import만 삭제)

---

### 5. push/response TCP 프레임 경계 처리

**파일:** `packages/loco-engine/src/connection.ts`

**문제:** 현재 `onData()`는 `responseResolver` 유무만으로 push와 response를 구분함. 하지만 TCP 스트림에서는 **하나의 chunk에 여러 프레임이 섞여 들어올 수 있음.**

예를 들어:
- **시나리오:** command() 응답을 기다리는 중, 서버가 응답 + MSG push를 같은 TCP segment로 전송
- **현재 동작:** `tryResolveResponse()`가 첫 번째 프레임만 소비하고, 같은 chunk의 나머지 데이터는 무시됨
- **결과:** push 데이터 유실

**해결 방향:** `tryResolveResponse()`에서 응답 프레임을 추출한 후, **같은 chunk에 남은 데이터가 있으면 push 버퍼로 이동**:
```typescript
private tryResolveResponse(): void {
  if (this.responseBuffer.length < SECURE_FRAME_HEADER_SIZE) return;
  const payloadSize = this.responseBuffer.readUInt32LE(0);
  if (payloadSize < 16 || payloadSize > MAX_FRAME_SIZE) {
    this.failResponse(new Error(`invalid frame size: ${payloadSize}`));
    return;
  }
  const frameSize = 4 + payloadSize;
  if (this.responseBuffer.length >= frameSize) {
    const frame = this.responseBuffer.subarray(0, frameSize);
    // ✅ 남은 데이터가 있으면 push 버퍼로 이동
    const remainder = this.responseBuffer.subarray(frameSize);
    this.responseBuffer = Buffer.alloc(0);
    if (remainder.length > 0) {
      this.pushBuffer.push(remainder);
    }
    try {
      const plaintext = decryptLocoFrame(frame, this.sessionKey);
      this.resolveResponse(plaintext);
    } catch (error) {
      this.failResponse(error instanceof Error ? error : new Error("decryption failed"));
    }
  }
}
```

---

### 6. docs/ai-integration.md 경로 개선

**파일:** `docs/ai-integration.md`

**문제:** 모든 예시가 절대경로 (`C:\KakaoMCP\...`, `/path/to/KakaoMCP/...`). 사용자가 복붙해서 바로 쓸 수 없음.

**해결 방향:**
- npm publish 전이므로, `npx` 대신 **프로젝트 루트 기준 상대경로**로 통일
- 또는 `npm link`와 `npx @kakao-mcp/mcp-server` 병기

```markdown
## 설치 후 실행 (프로젝트 루트 기준)

```bash
# 1. 의존성 설치
npm install

# 2. 빌드
npm run build

# 3. MCP 서버 실행
node packages/mcp-server/dist/index.js
```

### Claude Desktop 설정

`claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "kakao": {
      "command": "node",
      "args": ["{{프로젝트경로}}/packages/mcp-server/dist/index.js"],
      ...
    }
  }
}
```
```

---

## 🟢 여유 — 시간 날 때

### 7. LocoClient connect()에 timeoutMs 전달

**파일:** `packages/loco-engine/src/session.ts`

**현재:**
```typescript
const conn = new LocoConnection(locoServer.host, locoServer.port, publicKey);
```

**문제:** `timeoutMs` 인자가 전달되지 않아 항상 `DEFAULT_TIMEOUT_MS`(15초)가 사용됨. 향후 설정 가능한 타임아웃을 원한다면 `SessionConfig`에 `timeoutMs` 필드를 추가하고 전달해야 함.

**해결 (선택사항):**
```typescript
// SessionConfig에 추가:
export interface SessionConfig {
  auth: AuthResult;
  appVersion?: string;
  publicKeyPath?: string;
  publicKey?: string;
  timeoutMs?: number;  // ← 추가
}

// connect()에서:
const conn = new LocoConnection(
  locoServer.host, locoServer.port, publicKey,
  config.timeoutMs,  // ← 전달
);
```

---

### 8. `sendAndReceive` / `readSecureFrame` 사용 여부 재검토

**파일:** `packages/loco-engine/src/transport/socket.ts`

**현재:** `sendAndReceive()`와 `readSecureFrame()`은 `session.ts`의 `checkin()`에서만 사용됨. `LocoConnection`이 모든 LOCO 명령어를 처리하면서 이 함수들은 사실상 `checkin()` 전용 유틸리티가 됨.

**검토:** 이 함수들을 `connection.ts`로 이동하거나, `checkin()` 내부에서 직접 구현하는 게 더 깔끔한지 판단. (Phase F 범위 — 지금 당장은 필요 없음)

---

## ⚠️ 참고: 확정된 I/O 값 (변경 없음)

| 항목 | 확정값 |
|------|--------|
| AES 암호화 | **AES-128-CFB** (GCM 아님) |
| key_encrypt_type | **15 (0x0F)** |
| encrypt_type | **2 (CFB)** |
| LOGINLIST 필드 | **oauthToken** (token 아님) |
| 필요 필드 | duuid, prtVer, rp, lbk 필수 |
| Android 기기 | SM-X930 (allowlist 등록됨) |
| 영구 연결 | LocoConnection 사용 (-201 방지) |

---

> 마지막 업데이트: 2026-06-23 08:30
> 작성: 아리아 (Haven v0.5)
> 기반: IMPROVEMENTS.md v1 + Cline commit cf81fcd 리뷰
