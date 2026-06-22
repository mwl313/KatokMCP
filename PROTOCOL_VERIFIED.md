# 🔬 PROTOCOL_VERIFIED.md — LOCO Protocol 검증 명세

> Codex 작업용 기술 참고 문서. 검증 상태 표기 (🟢🔵🟡⚠️) 필수 확인.
> Last updated: 2026-06-23 (A-7 LOGINLIST 통과 — 다수 🟡→🟢 승격)

---

## 범례

| 표기 | 의미 |
|:----:|------|
| 🟢 | 실제 동작 확인됨 (패킷 캡처 or 동작 코드) |
| 🔵 | 구현체 코드에서 확인 (OpenKakao/KiwiTalk) |
| 🟡 | 문서 기반 가설 (OpenKakao 문서) — 실험 필요 |
| ⚠️ | 불확실 / 위험 — 실패 가능성 높음 |

---

## 1. 서버 엔드포인트

| 용도 | 호스트 | 포트 | 프로토콜 | 상태 |
|------|--------|------|----------|:----:|
| Booking | `booking-loco.kakao.com` | 443 | TLS over TCP | 🟢 |
| Checkin | `ticket-loco.kakao.com` | 995 | TCP | 🟢 |
| LOCO Server | CHECKIN 응답의 host:port | 995 (주) / 9002 (CS) | TCP (AES-128-CFB) | 🟢 |
| Kakao Auth | `katalk.kakao.com` | 443 | HTTPS | 🟢 |

✅ **LOCO Server 상태 🟡→🟢 로 승격 (2026-06-23 LOGINLIST 성공)**

---

## 2. 3-Stage Connection Flow

```
Stage 1: BOOKING
  Client → booking-loco.kakao.com:443 (TLS)
  GETCONF request → 서버 리스트 응답
  ✅ 실서버 검증 완료

Stage 2: CHECKIN
  Client → ticket-loco.kakao.com:995 (TCP)
  클라이언트가 생성한 세션 키를 포함한 268-byte 핸드셰이크
  CHECKIN → LOCO 서버 IP/포트
  ✅ 실서버 검증 완료

Stage 3: LOGIN
  Client → LOCO Server (동적 IP:Port) (TCP + AES-128-CFB)
  LOGINLIST → 인증 + 채팅방 목록
  ✅ 실서버 검증 완료 (2026-06-23)
```

**✅ 3-Stage 모두 실서버 검증 완료!**

---

## 3. 패킷 포맷 (22-byte Header + BSON Body)

### 3.1 Header (22 bytes, Little Endian)

```
Offset  Size  Type    Field         Description
------  ----  ------  -----         -----------
0x00    4     u32 LE  packet_id     순차 카운터. 1부터 시작. 요청/응답 동일 ID
0x04    2     i16 LE  status_code   요청=0. 응답 시 서버 상태 코드
0x06    11    ASCII   method        메서드명. 11바이트 고정. null(\0) 패딩
                                     예: "GETCONF\0\0\0\0\0" (4 + 7 null)
0x11    1     u8      body_type     보통 0
0x12    4     u32 LE  body_size     BSON 바디 길이 (바디 없으면 0)
------
22 bytes total
```

**상태:** 🟢 (실서버 GETCONF/CHECKIN/LOGINLIST 요청/응답으로 확인)

### 3.2 Body: BSON (Binary JSON)

- MongoDB BSON 명세와 동일하며 npm `bson` 패키지로 직렬화/역직렬화 확인 🟢
- **⛔ Protobuf 아님**

**상태:** 🟢

---

## 4. 암호화

### 4.1 Checkin 핸드셰이크 (268 bytes 고정)

```
Offset  Size  Type    Field             Value
------  ----  ------  -----             -----
0x00    4     u32 LE  key_size          256 (0x00000100)
0x04    4     u32 LE  key_encrypt_type  15 (0x0000000F) = RSA OAEP SHA-1
0x08    4     u32 LE  encrypt_type      2  (0x00000002) = AES-128-CFB
0x0C    256   bytes   encrypted_key     RSA-2048로 암호화된 AES 세션 키
------
268 bytes total
```

**상태:** 🟢 (실서버 CHECKIN 성공)

⚠️ **`key_encrypt_type = 15` (0x0F). 절대 16(0x10) 아님!**

### 4.2 암호화 스펙

| 항목 | 값 | 상태 | 참고 |
|------|-----|:----:|------|
| 키 교환 | RSA-2048 OAEP SHA-1 | 🟢 | |
| 데이터 암호화 | **AES-128-CFB** (NoPadding) | 🟢 | ❌ ~~AES-128-GCM~~ 아님! |
| RSA 공개키 지수(e) | **3** | 🟢 | |
| OAEP 해시 / MGF1 | **SHA-1 / SHA-1** | 🟢 | |
| AES 키 길이 | 128 bits (16 bytes) | 🟢 | |
| CFB IV | 16 bytes random (매 프레임 새로) | 🟢 | |
| 무결성 인증 | **없음** (인증 태그 없음) | 🟢 | CFB는 변조 탐지 불가 |

### 4.3 암호화 프레임

```
Offset  Size  Field
------  ----  -----
0x00    4     encrypted_size   u32 LE (16-byte IV + ciphertext)
0x04    16    iv               crypto.randomBytes(16) — 매 프레임 새 IV
0x14    N     ciphertext       AES-128-CFB 암호문
```

**상태:** 🟢 (CHECKIN/LOGINLIST 요청/응답 roundtrip 확인)

### 4.4 RSA 공개키

- KiwiTalk commit `7e8bcc34d6c2d994ff32b482bc649e8b51382255`에서 modulus와 e=3 추출
- SPKI PEM으로 변환하여 `poc/02-checkin/public-key.pem`에 저장
- Node.js `publicEncrypt` 및 실서버 핸드셰이크 성공

**상태:** 🟢

---

## 5. Method 목록 (Phase A 대상)

### 5.1 GETCONF — 서버 설정 조회 ✅

```
Direction: Request → Response
Host: booking-loco.kakao.com:443 (TLS)

Request BSON:
{
  MCCMNC: "999",
  os: "win32",
  model: ""
}

Response BSON (주요 필드):
{
  status: 0,
  revision: 197,
  wifi: { ports: [995, 8080, ...], encType: 2, ... },
  "3g": { ports: [995, 8080, ...], ... },
  ticket: { lsl: [...], lsl6: [...] },
  trailer: { ... },
  ...
}
```

**상태:** 🟢 (전체 응답은 `poc/fixtures/getconf-response.json`)

### 5.2 CHECKIN — LOCO 서버 할당 ✅

```
Direction: Request → Response (핸드셰이크 이후)
Host: ticket-loco.kakao.com:995 (TCP + RSA/AES)

Request BSON:
{
  userId: long(실제 userId),
  os: "android" or "win32",
  ntype: 0,
  appVer: "26.5.0" or "25.9.2",
  MCCMNC: "999",
  lang: "ko",
  countryISO: "KR",
  useSub: true
}

Response BSON:
{
  status: 0,
  host: "211.183.211.104",
  port: 995,
  cshost: "121.53.93.66",
  csport: 9002,
  vsshost: "211.249.241.56",
  vssport: 9002,
  cacheExpire: 3600,
  MCCMNC: "999"
}
```

**상태:** 🟢 (전체 응답은 `poc/fixtures/checkin-response.json`)

### 5.3 LOGINLIST — 인증 + 초기 채팅방 목록 ✅

```
Direction: Request → Response
Host: LOCO Server (AES-128-CFB 암호화) — CHECKIN 응답의 host:port

Request BSON (KiwiTalk 코드 기반 🟢):
{
  os: "android",                     // 현재 OS
  ntype: 0,                          // network type
  appVer: "25.9.2",                  // official app version
  MCCMNC: "999",                     // network MCCMNC
  prtVer: "1",                       // protocol version
  duuid: "64자리 hex",               // device UUID
  oauthToken: "access_token_string", // ❗ token 아님! oauthToken!
  lang: "ko",
  dtype: 0,                          // 2=pc, 0=mobile
  revision: 0,
  rp: Buffer([0x00,0x00,0xff,0xff,0x00,0x00]),  // 6 bytes binary
  pcst: null,                        // PC only
  chatIds: [],                       // 빈 배열 (첫 요청)
  maxIds: [],
  lastTokenId: 0,
  lastChatId: Long.ZERO,
  lbk: 0,
  bg: false
}

Response BSON (주요 필드):
{
  status: 0,
  userId: 436650423,
  revision: 29,
  chatDatas: [                       // 채팅방 목록
    {
      c: 387031120097368,            // chatroom id
      t: "MultiChat",                // type: DirectChat/MultiChat/MemoChat/OD/OM
      a: 8,                          // active member count
      n: 0,                          // unread count
      ll: { high, low },             // last log id
      s: { high, low },              // last seen log id
      l: {                           // last chatlog
        logId: { high, low },
        chatId: 387031120097368,
        type: 1,
        authorId: 178657582,
        message: "헬레스 개맛있음",
        sendAt: 1782139902,
        ...
      },
      i: [66906127, ...],            // icon user ids
      k: ["최정규", ...],            // icon user nicknames
      ...
    }
  ],
  lastTokenId: { high, low },        // pagination token
  lastChatId: 0,
  eof: true,                         // end of list
  ...
}
```

**상태:** 🟢 (2026-06-23 실서버 검증 완료. `poc/fixtures/loginlist-response.json`)

### 5.4 LCHATLIST — 채팅방 목록

```
Direction: Request → Response
Host: LOCO Server (AES-128-CFB 암호화)

Request BSON (KiwiTalk 코드 기반 🔵):
{
  chatIds: [long, ...],    // 조회할 채팅방 ID 목록
  maxIds: [long, ...],     // 각 채팅방의 max log id
  lastTokenId: long,       // 이전 응답의 lastTokenId
  lastChatId: long         // 이전 응답의 lastChatId
}
```

**상태:** 🟡 (LOGINLIST 응답에 이미 chatDatas 포함)

### 5.5 SYNCMSG — 메시지 내역

```
Direction: Request → Response

Request BSON (KiwiTalk 코드 기반 🔵):
{
  chatId: long,
  cur: long,               // 현재 watermark (last log id)
  cnt: int,                // 가져올 메시지 개수
  ...
}
```

**상태:** 🟡

### 5.6 PING — Keep-Alive

```
Direction: Request → (응답 없이 연결 유지 확인)
Interval: 30초
```

**상태:** 🟡

---

## 6. 에러 코드

| Code | 의미 | 상태 | 비고 |
|:----:|------|:----:|------|
| 0 | 성공 | 🟢 | |
| -100 | 기기 등록 필요 (Windows) | 🟢 | Android passcode 우회 필요 |
| -201 | 요청 오류 (필드 타입/값 불일치) | 🟡 | LCHATLIST/SYNCMSG에서 확인. lastTokenId 등 Long 타입 변환 문제 추정 |
| -300 | 요청 오류 (Token/필드 불일치) | 🟢 | `token`→`oauthToken` 수정, `duuid`/`prtVer`/`rp` 등 필드 누락 |
| -500 | 서버 내부 오류 | 🟡 | |
| -501 | 인증 실패 | 🟡 | |
| -502 | 권한 없음 | 🟡 | |
| -950 | 중복 로그인 (KICKOUT) | 🟡 | |
| -979 | 서버 점검 중 | 🟡 | |

---

## 7. 인증

### Windows login (win32/account/login.json)

```
POST https://katalk.kakao.com/win32/account/login.json
Content-Type: application/x-www-form-urlencoded
User-Agent: KT/{app_version} Wd/{windows_version} {language}
A: win32/{app_version}/{language}
X-VC: SHA-512("JAYDEN|{user_agent}|JAYMOND|{email}|{device_uuid}")[0..8] hex

Form:
  device_name, device_uuid, email, password, forced=false

Response:
  status, userId, access_token, refresh_token, token_type, ...
```

**상태:** 🔵 — 라이브 테스트 결과 `status=-100` (기기 등록 필요). `sys_uuid`는 기기 UUID가 아님.

### Android subdevice passcode 승인 (실제 동작 ✅)

```
Agent: android, model: SM-X930 (allowlist 확인)
X-VC: SHA-512("BARD|{user_agent}|DANTE|{email}|SIAN")[0..8] hex

1. POST /android/account/allowlist.json?model_name=SM-X930 (GET)
2. POST /android/account/passcodeLogin/generate     → passcode 반환
3. 사용자가 카카오톡 앱에 passcode 입력 (60초 내)
4. POST /android/account/passcodeLogin/registerDevice polling (status=0까지)
5. POST /android/account/login.json                  → token 발급
```

**상태:** 🟢 **라이브 인증 성공!** (userId=436650423, SM-X930 allowlist 통과)

---

## 8. Codex 작업 시 주의사항

1. ✅ **🟡 항목은 "가설"로 취급** → Phase A에서 다수 🟢 승격 완료
2. ✅ **모든 패킷은 hex dump를 파일로 저장** → poc/fixtures/ 에 Golden Packet 보관
3. ✅ **토큰/비밀번호는 콘솔 출력 시 마스킹** (`***`)
4. ✅ **RSA e=3**: Node.js `crypto` 모듈 지원 확인 → `publicEncrypt` 성공
5. ✅ **Checkin 암호화**: 실서버 검증값 `key_encrypt_type=15`, `encrypt_type=2` (AES-128-CFB)
6. ✅ **TLS**: booking-loco.kakao.com:443 → TLS over raw TCP 성공
7. ⚠️ **LOGINLIST BSON 필드명 주의:** `token` → `oauthToken`. `duuid`, `prtVer`, `rp`, `lbk` 필수
8. ✅ **Android auth → LOCO protocol os도 "android"** 일치 필요
9. ⚠️ **key_encrypt_type = 15 (0x0F)**, encrypt_type = 2 (CFB). 절대 GCM 아님

---

> 이 문서는 OpenKakao 문서와 KiwiTalk 코드를 기반으로 작성되었으며, Phase A에서 실제 검증 완료.
> **2026-06-23 업데이트:** 3-Stage 모두 실서버 검증 🟢. AES GCM→CFB 정정. LOGINLIST 필드명 token→oauthToken 정정.