# KatokMCP 개발자 가이드

> **프로젝트:** KatokMCP (구 KakaoMCP)
> **설명:** 카카오톡 LOCO 프로토콜을 TypeScript로 구현한 MCP 서버
> **대상:** 프로젝트에 기여하거나 내부 동작을 이해하려는 개발자

---

## 📦 프로젝트 구조

```
KatokMCP/
├── README.md                      # 사용자 문서 (한국어/영어)
├── package.json                   # 루트 npm workspace
├── LICENSE                        # MIT License
├── .gitignore
├── kakaoauth.env                  # (로컬 전용) 인증 정보 — git ignored
│
├── docs/
│   ├── ai-integration.md          # AI 서비스 연동 설정 가이드
│   └── developer-guide.md         # ◀ 이 문서 — 개발자용 기술 문서
│
├── packages/
│   ├── loco-engine/               # ← LOCO Protocol 엔진 (핵심)
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── assets/
│   │   │   └── public-key.pem     # RSA-2048 공개키 (e=3)
│   │   └── src/
│   │       ├── index.ts           # 전체 export
│   │       ├── protocol/
│   │       │   └── header.ts      # 22-byte LOCO 헤더
│   │       ├── crypto/
│   │       │   ├── aes.ts         # AES-128-CFB 암호화
│   │       │   └── handshake.ts   # RSA-2048 OAEP SHA-1
│   │       ├── transport/
│   │       │   └── socket.ts      # TCP 연결 유틸
│   │       ├── auth/
│   │       │   ├── types.ts       # 공통 타입
│   │       │   ├── windows.ts     # Windows 로그인
│   │       │   └── android.ts     # Android passcode 인증
│   │       ├── connection.ts      # 영구 TCP 연결
│   │       ├── session.ts         # LocoClient (CHECKIN+LOGINLIST)
│   │       ├── commands.ts        # LOCO 명령어
│   │       ├── error.ts           # 에러 처리 + 재시도
│   │       └── stream.ts          # Push 이벤트 스트림
│   │
│   └── mcp-server/                # ← MCP 서버
│       ├── package.json
│       ├── tsconfig.json
│       └── src/
│           ├── index.ts           # MCP 서버 메인
│           ├── credential-store.ts # 암호화 저장소
│           └── safety.ts          # Rate Limiter + Audit Log
│
└── poc/                           # Phase A 실험 코드
    ├── 01-booking/                # GETCONF
    ├── 02-checkin/                # RSA+AES 핸드셰이크
    ├── 03-loginlist/              # 인증 + 채팅방 목록
    └── fixtures/                  # Golden Packet
```

---

## 🧠 아키텍처 개요

### 3-Stage 연결 흐름

```
STAGE 1: BOOKING (TLS)
  클라이언트 → booking-loco.kakao.com:443
  GETCONF 요청 → 서버 리스트 응답 (ticket 서버 주소 획득)

STAGE 2: CHECKIN (TCP + RSA/AES)
  클라이언트 → ticket-loco.kakao.com:995
  268-byte RSA 핸드셰이크 → AES-128-CFB 세션 키 교환
  CHECKIN 요청 → LOCO 서버 IP/포트 할당

STAGE 3: LOGIN (TCP + AES)
  클라이언트 → LOCO 서버 (동적 IP:Port)
  RSA 핸드셰이크 → AES 로그인 → LOGINLIST → 세션 수립 ✅
```

### 인증 흐름 (Android Passcode)

```
환경변수 → authenticateAndroid()
  ├─ loginAndroid() 성공 → AuthResult 반환 (이미 등록된 기기)
  └─ loginAndroid() 실패 (-100) →
       generateAndroidPasscode() → passcode 출력
       ← 사용자가 카톡 앱에 passcode 입력
       waitForAndroidRegistration() polling (status=0까지)
       loginAndroid() → AuthResult 반환
```

### Token Caching 흐름 (v4)

```
MCP 서버 실행 → ensureClient()
  ├─ saveAuth()가 저장한 토큰 있음?
  │   YES → BigInt(userId) → LocoClient.connect() → 세션 직행
  │   NO  → authenticateAndroid() → saveAuth() → LocoClient.connect()
```

---

## 📂 패키지별 상세

### `packages/loco-engine` — LOCO Protocol Engine

#### `protocol/header.ts` — 22-byte 패킷 헤더

```
Offset  Size  Type    Field          설명
0x00    4     u32 LE  packet_id      순차 카운터 (1부터)
0x04    2     i16 LE  status_code    요청=0, 응답 시 상태
0x06    11    ASCII   method         null-padded 메서드명
0x11    1     u8      body_type      보통 0
0x12    4     u32 LE  body_size      BSON 바디 길이
------
22 bytes total + BSON body
```

**내보내는 함수:**
| 함수 | 설명 |
|------|------|
| `encodeHeader(packetId, method, bodyType, body)` | 헤더 + 바디를 Buffer로 조립 |
| `decodeHeader(buffer)` | Buffer → `DecodedPacket` 파싱 |

#### `crypto/aes.ts` — AES-128-CFB 프레임

**암호화 프레임 형식:**
```
Offset  Size  Field
0x00    4     encrypted_size (u32 LE) = 16 + ciphertext 길이
0x04    16    iv (randomBytes(16))
0x14    N     ciphertext (AES-128-CFB)
```

**내보내는 함수:**
| 함수 | 설명 |
|------|------|
| `encryptLocoFrame(plaintext, sessionKey, iv?)` | 평문 → 암호화 프레임 |
| `decryptLocoFrame(frame, sessionKey)` | 프레임 → 복호화된 평문 |

#### `crypto/handshake.ts` — RSA 핸드셰이크

**핸드셰이크 패킷 (268 bytes 고정):**
```
Offset  Size  Value    설명
0x00    4     256      key_size (0x00000100)
0x04    4     15       key_encrypt_type (0x0F) — ⚠️ 16 아님!
0x08    4     2        encrypt_type (CFB)
0x0C    256   —        RSA-2048 OAEP SHA-1 암호화된 세션 키
```

**내보내는 함수:** `createHandshake(publicKey, sessionKey)` → 268-byte Buffer

#### `transport/socket.ts` — TCP 연결 유틸

| 함수 | 설명 |
|------|------|
| `connectSocket({host, port, timeoutMs})` | TCP 연결 + `setNoDelay` |
| `readSecureFrame(socket, sessionKey)` | 소켓에서 AES 프레임 1개 읽기 |
| `sendAndReceive(socket, sessionKey, plaintext)` | AES 암호화 → 전송 → 응답 복호화 |

#### `connection.ts` — 영구 TCP 연결 (LocoConnection)

`LocoConnection` 클래스 — **가장 중요한 클래스 중 하나.**

- `command()`가 응답을 기다리는 동안 도착한 데이터 → `responseBuffer`
- `command()`가 대기 중이 아닐 때 도착한 데이터 → `pushBuffer` → 즉시 `onPushData` 콜백 호출
- TCP 스트림 경계 처리: 하나의 chunk에 여러 프레임이 있으면 `remainder` → pushBuffer 이동

| 메서드 | 설명 |
|--------|------|
| `connect(timeoutMs?)` | TCP 연결 + RSA 핸드셰이크 |
| `command(packet)` | AES 암호화 → 전송 → 응답 대기 |
| `readPushBuffer()` | 버퍼링된 push 데이터를 복호화해서 반환 |
| `onPushData(callback)` | push 도착 시 즉시 실행될 콜백 등록 |
| `close()` | 연결 종료 + 세션 키 제로라이즈 |
| `isConnected()` | 연결 상태 확인 |

#### `session.ts` — LocoClient

`LocoClient extends EventEmitter` 클래스 — **가장 중요한 클래스 중 하나.**

| 정적 메서드 | 설명 |
|-----------|------|
| `LocoClient.connect(config)` | CHECKIN + LOGINLIST → 영구 연결 LocoClient 반환 |

| 인스턴스 메서드 | 설명 |
|---------------|------|
| `sendRaw(method, body)` | LOCO 명령어 전송 (영구 연결 재사용) |
| `getLoginListResponse()` | LOGINLIST 응답 데이터 (채팅방 목록) |
| `getConnection()` | 내부 LocoConnection 참조 |
| `startKeepAlive(intervalMs=30000)` | PING 30초 간격 자동 전송 |
| `stopKeepAlive()` | PING 중단 |
| `close()` | 연결 종료 + 정리 |

| 이벤트 | 설명 |
|--------|------|
| `"connection_lost"` | PING 3회 연속 실패 시 발생 |

#### `commands.ts` — LOCO 명령어

| 함수 | 설명 |
|------|------|
| `sendLchatListOn(client, req)` | 채팅방 목록 페이지네이션 |
| `sendSyncMsgOn(client, req)` | 메시지 내역 조회 |
| `sendWrite(client, req)` | 메시지 전송 |
| `sendDeleteMsg(client, req)` | 메시지 삭제 |
| `sendGetMem(client, chatId)` | 채팅방 멤버 조회 |
| `sendMember(client, chatId, ids)` | 특정 멤버 정보 조회 |
| `sendPing(client)` | Keep-Alive |
| `getChatId(data)` | BSON Document에서 채팅방 ID 추출 |
| `getMessageText(log)` | BSON Document에서 메시지 텍스트 추출 |

#### `auth/types.ts` — 공통 타입

```typescript
AuthCredentials   // email, password, deviceUuid
AuthResult        // userId(bigint), accessToken, refreshToken, tokenType
LocoServerInfo    // host, port, csport
LocoSession      // userId, auth, sessionKey, locoServer
```

#### `auth/windows.ts` — Windows Kakao 로그인

| 함수 | 설명 |
|------|------|
| `authenticateWindows(credentials)` | Windows login API 호출 |
| `buildUserAgent(ver, os, lang)` | User-Agent 문자열 생성 |
| `computeXvc(uuid, ua, email)` | SHA-512 기반 X-VC 헤더 |
| `parseLoginResponse(text)` | HTTP 응답 → AuthResult 파싱 |

#### `auth/android.ts` — Android passcode 인증

| 함수 | 설명 |
|------|------|
| `loginAndroid(email, password, uuid, device?)` | Android login API 직접 호출 |
| `authenticateAndroid(email, password, uuid, device?)` | login → -100 → passcode → polling → login (전체 흐름) |
| `refreshAccessToken(email, refreshToken, uuid)` | refresh_token으로 access_token 갱신 |
| `isAndroidDeviceAllowed(deviceName)` | 기기 allowlist 확인 |
| `generateAndroidPasscode(...)` | passcode 생성 |
| `waitForAndroidRegistration(...)` | 등록 polling (최대 120회) |

#### `error.ts` — 에러 처리

```typescript
LocoErrorCode:
  "TIMEOUT" | "CONNECTION_REFUSED" | "CONNECTION_RESET"
  | "HANDSHAKE_FAILED" | "AUTH_FAILED" | "SESSION_EXPIRED"
  | "RATE_LIMITED" | "AUTH_EXPIRED" | "SERVER_ERROR"
  | "CHANGESVR" | "UNKNOWN"
```

| 함수/클래스 | 설명 |
|-----------|------|
| `classifyError(error)` | Error 객체 → LocoError (문자열 패턴 매칭) |
| `withRetry(operation, config?, isRetryable?)` | 지수 백오프 재시도 |
| `SessionManager` | 세션 생명주기 관리 + CHANGESVR 대응 |
| `detectChangesvr(response)` | status -701/-702 감지 |
| `isKickout(response)` | status -950 감지 |

#### `stream.ts` — Push 이벤트

`StreamReader` 클래스 — 이벤트 기반 (v3, polling 없음)

| 메서드 | 설명 |
|--------|------|
| `constructor(conn)` | LocoConnection 연결 |
| `onEvent(callback)` | StreamEvent 콜백 등록 |
| `start()` | onPushData 콜백 등록 (이벤트 구동 시작) |
| `stop()` | 이벤트 수신 중단 |

**StreamEvent 타입:**
```typescript
NewMessageEvent   // "MSG" — 새 메시지 도착
KickoutEvent      // "KICKOUT" — 중복 로그인
ServerChangeEvent // "CHANGESVR" — 서버 변경
MemberUpdateEvent // "NEWMEM" | "DELMEM" | "LEFT"
UnknownEvent      // "UNKNOWN"
```

---

### `packages/mcp-server` — MCP 서버

#### `src/index.ts` — MCP 서버 메인

**MCP Tools (4개):**
| Tool | 설명 | Opt-in |
|------|------|:------:|
| `kakao_list_chats` | 채팅방 목록 조회 | ❌ |
| `kakao_read_chat` | 메시지 읽기 | ❌ |
| `kakao_send_chat` | 메시지 전송 🤖 | ✅ `KAKAO_ALLOW_WRITE=YES` |
| `kakao_list_members` | 멤버 조회 | ❌ |

**내부 동작:**
1. `ensureClient()`: 저장된 토큰 우선 → 실패 시 재인증 → 토큰 저장
2. 각 tool 핸들러: `ensureClient()` → 명령어 실행 → Audit Log 기록

#### `src/credential-store.ts` — 암호화 저장소

**파일:** AES-256-GCM 암호화
| 파일 | 내용 |
|------|------|
| `~/.kakao-mcp/credentials.enc` | email, password, deviceUuid |
| `~/.kakao-mcp/auth.enc` | cached AuthResult (accessToken, refreshToken) |

| 메서드 | 설명 |
|--------|------|
| `save(creds)` | 계정 정보 저장 |
| `load()` | 계정 정보 불러오기 |
| `saveAuth(auth)` | AuthResult 저장 (token caching) |
| `loadAuth()` | 저장된 AuthResult 불러오기 |
| `clearAuth()` | AuthResult 삭제 (토큰 만료 시) |
| `resolve()` | 환경변수 우선 → 암호화 저장소 폴백 |

#### `src/safety.ts` — 안전장치

| 클래스 | 설명 |
|--------|------|
| `RateLimiter` | Token bucket (30 tokens / 10초) |
| `AuditLogger` | dev 모드(전문), prod 모드(해시만) |

---

## 🔧 확정된 프로토콜 값

| 항목 | 확정값 | 비고 |
|------|--------|------|
| 암호화 | **AES-128-CFB** | ~~GCM~~ 아님 |
| key_encrypt_type | **15 (0x0F)** | ~~16~~ 아님 |
| encrypt_type | **2 (CFB)** | ~~3 (GCM)~~ 아님 |
| RSA 지수(e) | **3** | KiwiTalk 추출 |
| LOGINLIST token | **oauthToken** 필드 | ~~token~~ 아님 |
| 필요 필드 | duuid, prtVer, rp, lbk | 누락 시 -300 |
| 기기명 | SM-X930 | allowlist 등록됨 |
| 영구 연결 | LocoConnection | 새 연결 시 -201 |

---

## 🚀 개발 워크플로

```bash
# 1. 빌드
npm run build              # 루트 workspace로 두 패키지 동시 빌드
cd packages/loco-engine && npm run build   # 엔진만 빌드
cd packages/mcp-server && npm run typecheck # 서버 타입체크

# 2. 로컬 테스트 (MCP 서버 실행)
cd packages/mcp-server
set KAKAO_EMAIL=... && set KAKAO_PASSWORD=... && set KAKAO_ANDROID_DEVICE_UUID=...
npm run dev

# 3. MCP 프로토콜 테스트
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | npx tsx src/index.ts

# 4. 커밋
git add -A && git commit -m "설명" && git push
```

---

## ⚠️ 주의사항

1. **절대 `kakaoauth.env`를 커밋하지 말 것** — `.gitignore`에 등록됨
2. **토큰은 메모리에서만 사용** — 파일 저장 시 AES-256-GCM 필수
3. **`*.pem`은 git에 추적되지 않음** — `assets/public-key.pem`은 `!` 예외 규칙으로 추적
4. **status 30 (Rate Limit):** 토큰 캐싱(v4)으로 인증 API 호출 최소화
5. **-201 에러:** 영구 연결(`LocoConnection`) 사용으로 해결
6. **-300 에러:** BSON 필드명 `oauthToken` 확인, `duuid`/`prtVer`/`rp`/`lbk` 필수