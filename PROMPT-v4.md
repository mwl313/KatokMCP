# KakaoMCP — Cline 작업 프롬프트 v4

> 이 프롬프트를 Cline에게 주세요.

---

## 작업 지시

`IMPROVEMENTS-v4.md` 파일을 읽고 아래 작업을 모두 구현하세요.

**목표:** MCP 서버가 실행될 때마다 인증 API를 호출하지 않고, 첫 인증 시 받은 access token을 저장해 재사용하도록 만드는 것.

**핵심 수정 파일:**
1. `packages/mcp-server/src/credential-store.ts` — `saveAuth()`, `loadAuth()`, `clearAuth()` 메서드 추가
2. `packages/loco-engine/src/error.ts` — `RATE_LIMITED` 에러 코드 추가
3. `packages/mcp-server/src/index.ts` — `ensureClient()`가 저장된 토큰을 먼저 확인하도록 수정
4. `packages/loco-engine/src/auth/android.ts` — `refreshAccessToken()` 함수 추가

**우선순위:**
- 1, 3번이 가장 중요 (Token Caching으로 인증 API 호출 회피)
- 2, 4번은 보조 (Error 타입 정리, 토큰 갱신)

**참고:**
- `credential-store.ts`의 AES-256-GCM 암호화 방식을 그대로 재사용하세요
- `auth.enc` 파일로 저장 (credentials.enc와 분리)
- token 만료 시 폴백: 저장된 토큰 실패 → 기존 `authenticateAndroid()`로 전체 재인증
- `StoredAuthResult.userId`는 bigint → string 변환 필요

**완료 후:** `npm run build`로 빌드가 되는지 확인하고, `STATUS.md`를 갱신하세요.
