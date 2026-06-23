# 🔧 KakaoMCP — 개선 가이드 v4

> **대상:** Cline (DeepSeek Flash)
> **기준:** `main` (commit `911376a`)
> **목표:** 인증 Rate Limit(status 30) 해결 — Access Token Caching
> **우선순위:** 🔴 긴급 — 필드테스트 차단 이슈

---

## 문제 상황

MCP 서버가 실행될 때마다 `authenticateAndroid()`가 **카카오 인증 API(`login.json`)를 매번 호출**함.
짧은 시간에 여러 번 실행하면 **status 30 (Rate Limit)** 발생 → 서버 사용 불가.

```
MCP 실행 ──▶ 인증 API 호출 ──▶ status 30 ❌
```

## 해결 전략

**Token Caching:** 첫 번째 인증 성공 시 `AuthResult`(accessToken + refreshToken)를 암호화 저장.
다음 실행 시 인증 API 생략 → 저장된 토큰으로 바로 LOCO 세션 열기.

```
MCP 실행 ──▶ 저장된 토큰 있음? ──▶ LOCO 세션 직행 ✅
                  │ 없음
                  ▼
             인증 API 호출 ──▶ 토큰 저장 ──▶ LOCO 세션
```

---

## 작업 순서

```
1️⃣ credential-store.ts: AuthResult 저장/로드 메서드 추가 (🔴)
2️⃣ android.ts: refresh_token으로 access_token 갱신 함수 추가 (🔴)
3️⃣ error.ts: rate limit 에러 코드 및 retry 개선 (🟡)
4️⃣ mcp-server/index.ts: ensureClient() 토큰 캐싱 적용 (🔴)
5️⃣ STATUS.md 갱신 (🟡)
```

---

## 🔴 긴급

### 1. credential-store.ts — AuthResult 저장/로드

**파일:** `packages/mcp-server/src/credential-store.ts`

기존 `StoredCredentials`는 email/password 저장용. 여기에 `AuthResult` 저장 기능 추가.

**현재 구조:**
```typescript
export interface StoredCredentials {
  email: string;
  password: string;
  deviceUuid: string;
  deviceName?: string;
}
```

**추가할 타입:**
```typescript
export interface StoredAuthResult {
  userId: string;          // bigint → string (JSON-safe)
  accessToken: string;
  refreshToken: string;
  tokenType: string;
  savedAt: string;         // ISO timestamp
  expiresAt?: string;      // 추정 만료 시간 (선택)
}
```

**추가할 메서드:**
```typescript
export class CredentialStore {
  // ...기존 메서드...

  /** Save AuthResult to encrypted storage */
  async saveAuth(auth: StoredAuthResult): Promise<void>

  /** Load saved AuthResult */
  async loadAuth(): Promise<StoredAuthResult | null>

  /** Check if saved AuthResult exists */
  async hasAuth(): Promise<boolean>

  /** Clear saved AuthResult (e.g. on token refresh failure) */
  async clearAuth(): Promise<void>
}
```

**저장 형식:** 기존 `save()`와 동일한 AES-256-GCM. 다른 파일(`auth.enc`)에 저장하여 credentials와 분리.

```typescript
// CredentialStore 클래스 내부
private authPath: string;

constructor(config: CredentialStoreConfig = {}) {
  // ...기존 초기화...
  this.authPath = path.join(this.basePath, "auth.enc");
}
```

---

### 2. android.ts — Access Token 갱신 함수

**파일:** `packages/loco-engine/src/auth/android.ts`

`refreshAccessToken()` 함수 추가 — refresh_token으로 새 access_token 발급.

```typescript
const REFRESH_BASE_URL = "https://katalk.kakao.com/android/account/";

export interface RefreshResult {
  accessToken: string;
  refreshToken: string;
  tokenType: string;
}

/**
 * Refresh access token using refresh_token.
 * Kakao Android auth API: /android/account/login.json?refresh=true
 */
export async function refreshAccessToken(
  email: string,
  refreshToken: string,
  deviceUuid: string,
  opts: AndroidAuthOptions = {},
): Promise<RefreshResult> {
  // POST to login.json with refresh=true param
  // Body: email, refresh_token, device_uuid
  // Response: { status: 0, access_token, refresh_token, token_type }
  // On failure: throw AndroidAuthApiError(status)
}
```

**참고:** refresh API의 정확한 엔드포인트와 파라미터는 카카오 서버 동작에 따라 다를 수 있음. 실패 시 기존 `authenticateAndroid()`로 fallback.

---

### 3. error.ts — Rate Limit 에러 타입 추가

**파일:** `packages/loco-engine/src/error.ts`

```typescript
// LocoErrorCode에 추가:
export type LocoErrorCode =
  | "TIMEOUT"
  | "CONNECTION_REFUSED"
  // ...
  | "RATE_LIMITED"     // ← 추가: status 30 등 Rate Limit
  | "AUTH_EXPIRED";    // ← 추가: token 만료

// classifyError()에 추가:
if (lower.includes("status 30")) {
  return new LocoError("RATE_LIMITED", msg, ...);
}
if (lower.includes("status 10") || lower.includes("token expired")) {
  return new LocoError("AUTH_EXPIRED", msg, ...);
}
```

**`withRetry()`에 rate limit 백오프 추가:**
```typescript
// isRetryable 기본값에 RATE_LIMITED 추가 (선택)
// 또는 별도의 withRateLimitRetry() 함수 제공 — 더 긴 지연(30~60s)
export async function withRateLimitRetry<T>(
  operation: (attempt: number) => Promise<T>,
): Promise<T> {
  // baseDelayMs = 30_000, maxAttempts = 3
}
```

---

### 4. mcp-server/index.ts — Token Caching 적용

**파일:** `packages/mcp-server/src/index.ts`

**`ensureClient()` 수정:**

```typescript
import { CredentialStore } from "./credential-store.js";

const store = new CredentialStore();

async function ensureClient(): Promise<LocoClient> {
  if (client && client.getConnection().isConnected()) return client;

  // 1. 저장된 인증 토큰 확인
  const savedAuth = await store.loadAuth();
  if (savedAuth) {
    console.error("Using cached access token...");
    try {
      // 저장된 토큰으로 직접 LOCO 세션 열기
      client = await LocoClient.connect({
        auth: {
          userId: BigInt(savedAuth.userId),
          accessToken: savedAuth.accessToken,
          refreshToken: savedAuth.refreshToken,
          tokenType: savedAuth.tokenType,
        },
      });
      client.startKeepAlive();
      console.error("Session established (cached token)");
      return client;
    } catch (error) {
      console.error("Cached token invalid, re-authenticating...");
      await store.clearAuth();
      // fall through to fresh auth
    }
  }

  // 2. 신규 인증
  console.error("Authenticating...");
  const creds = readAndroidCredentialsFromEnvironment();
  const auth = await authenticateAndroid(creds.email, creds.password, creds.deviceUuid, creds.deviceName);
  console.error(`Auth OK: userId=${auth.userId}`);

  // 3. 토큰 저장 (다음 실행 시 재사용)
  await store.saveAuth({
    userId: String(auth.userId),
    accessToken: auth.accessToken,
    refreshToken: auth.refreshToken,
    tokenType: auth.tokenType,
    savedAt: new Date().toISOString(),
  });
  console.error("Access token cached for next session");

  client = await LocoClient.connect({ auth });
  client.startKeepAlive();
  console.error("Session established");
  return client;
}
```

⚠️ **주의:** `LocoClient.connect()`의 `SessionConfig.auth`는 `AuthResult` 타입. `AuthResult`에는 `userId: bigint`, `accessToken: string`, `refreshToken: string`, `tokenType: string`이 필요. 저장된 토큰으로 세션 열 때 `BigInt(savedAuth.userId)`로 변환.

---

### 5. refresh_token 갱신 타이밍

access_token이 만료되면 LOCO 서버가 -300이나 -100 같은 에러를 반환할 수 있음.
이때 refresh_token으로 새 access_token을 발급받고 재시도.

**구현 방향:** `ensureClient()`에서 LOCO 명령어 실패 감지 시 refresh 시도:
```typescript
// LocoClient.sendRaw() 실패 시 token expired 체크
// → refreshAccessToken() 호출 → 저장된 토큰 갱신 → 재시도
```

**v4 범위:** 위 로직은 **v4.1(추후)** 로 미루고, v4.0에서는 **저장된 토큰으로 바로 세션 열기**까지만 구현.
refresh는 저장된 토큰이 만료되어 `LocoClient.connect()` 실패 시 → 폴백으로 `authenticateAndroid()` 다시 호출.

---

## 🟡 권장

### 6. STATUS.md 갱신

**파일:** `STATUS.md`
- commit `c769109` (PLAN.md Phase 재구성) 반영
- Phase E/F/G 구분 업데이트
- Token Caching 계획 상태 표시

---

## 📋 작업 요약

| 파일 | 작업 | 난이도 |
|------|------|:------:|
| `credential-store.ts` | `saveAuth()`, `loadAuth()`, `clearAuth()`, `hasAuth()` 추가 | 중 |
| `android.ts` | `refreshAccessToken()` 추가 | 중 |
| `error.ts` | `RATE_LIMITED`, `AUTH_EXPIRED` 에러 코드 추가 | 하 |
| `index.ts` (mcp-server) | `ensureClient()` 토큰 캐싱 적용 | 중 |
| `STATUS.md` | 현황 갱신 | 하 |

---

## ⚠️ 주의사항

1. **refresh_token API는 미검증 상태** — 실제 Kakao 서버 동작 확인 필요. 실패 시 기존 `authenticateAndroid()`로 폴백
2. **access_token 만료 시간을 모름** — 정해진 만료 시간이 없으면 저장된 토큰이 항상 유효할 수도 있고, 몇 시간 후 만료될 수도 있음. 실사용 테스트 필요
3. **보안** — AuthResult도 AES-256-GCM으로 암호화 저장. `credential-store.ts`의 기존 암호화 방식 재사용
4. **gitignore** — `.kakao-mcp/auth.enc`가 `.gitignore`에 포함되어 있는지 확인 (이미 `.kakao-mcp/` 패턴으로 커버됨)
5. **status 30은 짧은 시간 내 여러 번 인증 API 호출 시 발생** — 토큰 캐싱 적용 후에는 재인증이 거의 발생하지 않으므로 근본적으로 해결됨

---

> 마지막 업데이트: 2026-06-23 09:45
> 작성: 아리아 (Haven v0.5)
> 관련 이슈: 필드테스트 중 status 30 Rate Limit — 재인증 API 호출이 원인
