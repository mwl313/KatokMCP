# STATUS.md — 프로젝트 진행 현황

> 마지막 업데이트: 2026-06-23 02:25
> ✅ Phase A (인증) | ✅ Phase B (LOCO Engine) | ✅ Phase C (메시지 전송) | ✅ Phase D (MCP Server)

---

## Phase A: Feasibility Gate ✅

> "인증부터 채팅방 목록까지 될까?" → **된다! Go/No-Go PASSED 🚀**

| # | 작업 | 상태 | 산출물 |
|---|------|:----:|--------|
| A-1 | BSON + 패킷 인코딩 | ✅ | `poc/01-booking/header.ts`, `bson-test.ts` |
| A-2 | RSA 공개키 확보 | ✅ | `poc/02-checkin/public-key.pem`, `rsa-test.ts` |
| A-3 | Booking (GETCONF) | ✅ | `poc/01-booking/booking.ts`, `fixtures/getconf-response.json` |
| A-4 | Checkin (RSA+AES) | ✅ | `poc/02-checkin/checkin.ts`, `fixtures/checkin-response.json` |
| A-5 | AES-128-CFB 암복호화 | ✅ | `poc/02-checkin/aes.ts` |
| A-6 | 인증 (Android passcode) | ✅ | `poc/03-loginlist/auth.ts`, `android-auth.ts` |
| **A-7** | **LOGINLIST → 세션 수립** | **✅ 🚀** | Go/No-Go PASSED! |
| A-8 | LCHATLIST → 채팅방 목록 | ✅ | `poc/03-loginlist/lchatlist.ts` |
| A-9 | SYNCMSG → 메시지 읽기 | ✅ | `poc/03-loginlist/syncmsg.ts` |

### A-7 핵심 이슈
- `-300` 에러: BSON 필드명 `token`→`oauthToken`, `duuid`/`prtVer`/`rp`/`lbk` 누락
- 해결: KiwiTalk 코드 분석 후 정확한 BSON 구조 적용
- `-201` 에러: 별도 TCP 연결 문제 → `LocoConnection`/`LocoClient` 리팩토링으로 해결

---

## Phase B: LOCO Engine 코어 ✅

**패키지:** `packages/loco-engine/` — TypeScript, 타입체크 통과

```
packages/loco-engine/src/
├── index.ts              ← 전체 export (모든 모듈 통합)
├── protocol/header.ts    ← B-3: 22-byte LOCO 헤더 encode/decode
├── crypto/aes.ts         ← B-2: AES-128-CFB 암호화/복호화
├── crypto/handshake.ts   ← B-2: RSA-2048 OAEP SHA-1 핸드셰이크
├── transport/socket.ts   ← B-1: TCP 연결 + 프레임 송수신
├── connection.ts         ← B-6: Persistent TCP 연결 (LocoConnection)
├── auth/types.ts         ← B-4: 공통 타입 정의
├── auth/windows.ts       ← B-4: Windows Kakao 로그인
├── auth/android.ts       ← B-4: Android passcode 인증
├── session.ts            ← B-4+6: LocoClient (CHECKIN+LOGINLIST+persistent)
├── commands.ts           ← B-5+C-1~C-3: 모든 LOCO 명령어
└── error.ts              ← B-7: LocoError, SessionManager, retry, CHANGESVR
```

---

## Phase C: 메시지 전송 + 부가 기능 ✅

**MCP 도구:** 모두 `packages/mcp-server`에 통합

| # | 작업 | 상태 | 비고 |
|---|------|:----:|------|
| C-1 | **WRITE** (메시지 전송) | ✅ | `sendWrite()` + `kakao_send_chat` tool |
| C-2 | **DELETEMSG** (메시지 삭제) | ✅ | `sendDeleteMsg()` |
| C-3 | **GETMEM / MEMBER** (멤버 조회) | ✅ | `sendGetMem()` + `kakao_list_members` tool |
| C-4 | **친구 목록 / 프로필** | ✅ | GETMEM/MEMBER로 커버 (KiwiTalk 분석 결과 FRIENDLIST 명령어 없음) |
| C-5 | **Safety Layer** | ✅ | Rate Limiter + Audit Log + AI Prefix |

### kakao_send_chat 보안:
- **Opt-in 필수:** `KAKAO_ALLOW_WRITE=YES` 설정해야 활성화
- **AI 접두사:** 자동 `🤖 ` prefix (비활성화: `KAKAO_AI_PREFIX=false`)
- **최대 길이:** 10,000자 제한
- **Rate Limiter:** 초당 3회 / 버스트 30회

---

## Phase D: MCP Server ✅

**패키지:** `packages/mcp-server/` — MCP Protocol via stdio

```
packages/mcp-server/src/
├── index.ts              ← MCP 서버 메인 (tools + resources + handlers)
├── credential-store.ts   ← D-4: AES-256-GCM 암호화 자격 증명 저장
└── safety.ts             ← D-5: Rate Limiter + Audit Log
```

### MCP Tools (4개):

| Tool | 설명 | Opt-in |
|------|------|:------:|
| `kakao_list_chats` | 전체 채팅방 목록 (읽지 않은 수, 멤버, 마지막 메시지) | ❌ |
| `kakao_read_chat` | 특정 채팅방 메시지 읽기 | ❌ |
| `kakao_send_chat` | **메시지 전송 🤖** | ✅ `KAKAO_ALLOW_WRITE=YES` |
| `kakao_list_members` | 채팅방 멤버 목록 | ❌ |

### Resources:
- `kakao://chats` — 채팅방 목록
- `kakao://chat/{chatId}` — 특정 채팅방 메시지

---

## 프로토콜 명세 오류 정정

| 항목 | 초기 가설 (오류) | 실제 검증값 |
|------|-----------------|------------|
| 암호화 알고리즘 | ~~AES-128-GCM~~ | **AES-128-CFB** |
| key_encrypt_type | ~~16 (0x10)~~ | **15 (0x0F)** |
| encrypt_type | ~~3 (GCM)~~ | **2 (CFB)** |
| LOGINLIST token 필드 | ~~token~~ | **oauthToken** |
| 인증 방식 | ~~Windows login~~ | **Android passcode 승인** |
| LOCO 서버 포트 | ~~단일~~ | **port=995 + csport=9002** |

---

## Git 커밋 히스토리

| 해시 | 날짜 | 내용 |
|:----:|:----:|------|
| `2d4c87e` | 06-23 | C-3: GETMEM/MEMBER + kakao_list_members |
| `227010f` | 06-23 | C-1+C-2: WRITE/DELETEMSG 메시지 전송 |
| `69efe77` | 06-23 | D-5: Safety Layer (Rate Limiter + Audit Log) |
| `fb84f6d` | 06-23 | D-4: Credential Store (AES-256-GCM) |
| `5147841` | 06-23 | D-1~D-3: MCP 서버 초기 구현 |
| `827265b` | 06-23 | refactor: Persistent Connection |
| `40c17d9` | 06-23 | A-8+A-9: LCHATLIST/SYNCMSG 검증 |
| `10ef030` | 06-23 | B-7: Error Handling + Retry |
| `3598b67` | 06-23 | B-5+B-6: Command Module |
| `d132bb3` | 06-23 | fix: session.ts 핸드셰이크 버그 |
| `656bc25` | 06-22 | A-7: LOGINLIST 성공 ✅ |

## 다음 단계
- Phase E: 실시간 MSG Push + Session Daemon (v0.3)
- Phase F: npm 배포 + 연동 가이드 (v0.4)