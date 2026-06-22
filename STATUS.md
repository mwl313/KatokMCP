# STATUS.md — 프로젝트 진행 현황

> 마지막 업데이트: 2026-06-23 01:55
> ✅ Phase A 완료 | ✅ Phase B (LOCO Engine) 100% 완료

---

## Phase A: Feasibility Gate ✅

> "인증부터 채팅방 목록까지 될까?" — 성공! 🚀

| # | 작업 | 상태 | 산출물 |
|---|------|:----:|--------|
| A-1 | BSON + 패킷 인코딩 | ✅ | `poc/01-booking/header.ts`, `bson-test.ts` |
| A-2 | RSA 공개키 확보 | ✅ | `poc/02-checkin/public-key.pem`, `rsa-test.ts` |
| A-3 | Booking (GETCONF) | ✅ | `poc/01-booking/booking.ts`, `fixtures/getconf-response.json` |
| A-4 | Checkin (RSA+AES) | ✅ | `poc/02-checkin/checkin.ts`, `fixtures/checkin-response.json` |
| A-5 | AES-128-CFB 암복호화 | ✅ | `poc/02-checkin/aes.ts` |
| A-6 | 인증 (Android passcode) | ✅ | `poc/03-loginlist/auth.ts`, `android-auth.ts` |
| **A-7** | **LOGINLIST → 세션 수립** | **✅ 🚀** | `poc/03-loginlist/loginlist.ts`, `fixtures/loginlist-response.json` |

### A-7 핵심 이슈 및 해결
- **문제:** LOCO LOGINLIST 전송 시 `{"status":-300}` 응답
- **원인:** BSON 필드명/구조 불일치 (KiwiTalk `talk-loco-client` 코드 분석)
  - `token` → **`oauthToken`** (필드명 변경)
  - `duuid`(device UUID), `prtVer`(protocol version), `rp`(6 bytes), `lbk`(last block token) 필수 필드 누락
  - `os: "win32"` + Android 토큰 = 플랫폼 불일치 → `os: "android"`로 수정
- **해결:** KiwiTalk 코드 기반 정확한 BSON 구조 적용 → `status: 0` 성공

---

## Phase B: LOCO Engine 코어 ✅

> 재사용 가능한 LOCO 클라이언트 라이브러리

**패키지:** `packages/loco-engine/` — TypeScript, 타입체크 통과

| # | 작업 | 상태 | 파일 | 설명 |
|---|------|:----:|------|------|
| B-1 | Transport Layer | ✅ | `transport/socket.ts` | TCP 연결 + AES 프레임 송수신 |
| B-2 | Crypto Layer | ✅ | `crypto/aes.ts`, `crypto/handshake.ts` | RSA 핸드셰이크 + AES-128-CFB |
| B-3 | Protocol Layer | ✅ | `protocol/header.ts` | 22-byte LOCO 헤더 encode/decode |
| B-4 | Auth Module | ✅ | `auth/windows.ts`, `auth/android.ts`, `auth/types.ts`, `session.ts` | Windows/Android 인증 + CHECKIN + LOGINLIST |
| B-5 | Command Module | ✅ | `commands.ts` | LCHATLIST, SYNCMSG 명령어 |
| B-6 | Keep-Alive | ✅ | `commands.ts` (sendPing) | PING 30s |
| B-7 | Error Handling | ✅ | `error.ts` | LocoError, SessionManager, exponential backoff, CHANGESVR |

### 검증된 프로토콜 명세
| 항목 | 실제 값 | 초기 가설 (오류) |
|------|---------|------------------|
| 데이터 암호화 | **AES-128-CFB** | ~~AES-128-GCM~~ |
| key_encrypt_type | **15 (0x0F)** | ~~16 (0x10)~~ |
| encrypt_type | **2 (CFB)** | ~~3 (GCM)~~ |
| LOGINLIST token 필드 | **oauthToken** | ~~token~~ |
| 인증 방식 | **Android passcode 승인** | ~~Windows login~~ |
| LOCO 서버 포트 | **port=995 + csport=9002** | ~~directional~~ |

---

## Git 커밋 히스토리

| 해시 | 날짜 | 내용 |
|:----:|:----:|------|
| `10ef030` | 06-23 | B-7: Error Handling + Retry 완료 |
| `3598b67` | 06-23 | B-5+B-6: Command Module (LCHATLIST, SYNCMSG, PING) |
| `d132bb3` | 06-23 | fix: session.ts 핸드셰이크 버그 (publicKey 누락) |
| `4a61a6a` | 06-23 | B-4: Auth Module + Session 통합 |
| `f7dc06d` | 06-23 | B-1~B-3: LOCO Engine 패키지 초기 구조 |
| `bbb5558` | 06-22 | A-7 문서 정리 (PLAN.md v6, PROTOCOL_VERIFIED.md) |
| `656bc25` | 06-22 | A-7: LOGINLIST 세션 수립 성공 ✅ |

## 다음 단계
- Phase D: MCP 서버 래핑 (v0.1 MVP)
- Phase C: 메시지 전송 (v0.2)