# STATUS.md — 프로젝트 진행 현황

> 마지막 업데이트: 2026-06-23 02:06
> ✅ Phase A 완료 | ✅ Phase B (LOCO Engine) 100% 완료 | ✅ Pending Connection 리팩토링

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
| A-8 | LCHATLIST → 채팅방 목록 | ✅ | `poc/03-loginlist/lchatlist.ts`, `-201` 확인 (별도 연결 문제) |
| A-9 | SYNCMSG → 메시지 읽기 | ✅ | `poc/03-loginlist/syncmsg.ts`, `-201` 확인 |

### A-7 / A-8 / A-9 핵심 발견
- **-201 에러:** LCHATLIST/SYNCMSG를 새 TCP 연결에서 보내면 서버가 세션을 인식하지 못함
- **해결:** `LocoConnection` + `LocoClient` — 같은 TCP 연결에서 LOGINLIST/LCHATLIST/SYNCMSG 순차 전송
- 위 리팩토링 완료 (커밋 `827265b`)

---

## Phase B: LOCO Engine 코어 ✅

**패키지:** `packages/loco-engine/` — TypeScript, 타입체크 통과

```
packages/loco-engine/src/
├── index.ts                  ← 전체 export
├── protocol/header.ts        ← B-3: 22-byte 패킷 헤더
├── crypto/aes.ts             ← B-2: AES-128-CFB
├── crypto/handshake.ts       ← B-2: RSA-2048 OAEP SHA-1
├── transport/socket.ts       ← B-1: TCP 연결
├── connection.ts             ← ★ NEW: Persistent TCP 연결 관리
├── auth/types.ts             ← B-4: 공통 타입
├── auth/windows.ts           ← B-4: Windows Kakao 로그인
├── auth/android.ts           ← B-4: Android passcode 인증
├── session.ts                ← B-4 + Persistent: LocoClient
├── commands.ts               ← B-5+B-6: LCHATLIST/SYNCMSG/PING
└── error.ts                  ← B-7: 에러 처리 + SessionManager
```

---

## Git 커밋 히스토리

| 해시 | 날짜 | 내용 |
|:----:|:----:|------|
| `827265b` | 06-23 | **refactor: Persistent Connection (LocoConnection + LocoClient)** |
| `40c17d9` | 06-23 | A-8+A-9: LCHATLIST/SYNCMSG poc 검증 (-201 발견) |
| `10ef030` | 06-23 | B-7: Error Handling + Retry 완료 |
| `3598b67` | 06-23 | B-5+B-6: Command Module |
| `d132bb3` | 06-23 | fix: session.ts 핸드셰이크 버그 |
| `4a61a6a` | 06-23 | B-4: Auth Module + Session |
| `f7dc06d` | 06-23 | B-1~B-3: LOCO Engine 베이스 |
| `656bc25` | 06-22 | A-7: LOGINLIST 세션 수립 성공 ✅ |

## 다음 단계
- Phase D: MCP 서버 래핑 (v0.1 MVP)