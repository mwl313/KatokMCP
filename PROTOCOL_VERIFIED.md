# 🔬 PROTOCOL_VERIFIED.md — LOCO Protocol 검증 명세

> Codex 작업용 기술 참고 문서. 검증 상태 표기 (🟢🔵🟡⚠️) 필수 확인.
> Last updated: 2026-06-22

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
| LOCO Server | 동적 (Booking 응답) | 동적 | TCP (AES 암호화) | 🟡 |
| Kakao Auth | `accounts.kakao.com` | 443 | HTTPS | ⚠️ |

---

## 2. 3-Stage Connection Flow

```
Stage 1: BOOKING
  Client → booking-loco.kakao.com:443 (TLS)
  GETCONF request → 서버 리스트 응답
  
Stage 2: CHECKIN
  Client → ticket-loco.kakao.com:995 (TCP)
  클라이언트가 생성한 세션 키를 포함한 268-byte 핸드셰이크
  CHECKIN → LOCO 서버 IP/포트

Stage 3: LOGIN
  Client → LOCO Server (동적 IP:Port) (TCP + AES)
  LOGINLIST → 인증 + 채팅방 목록
```

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

**상태:** 🟢 (2026-06-22 실서버 GETCONF 요청/응답으로 확인)

### 3.2 Body: BSON (Binary JSON)

- MongoDB BSON 명세와 동일하며 npm `bson` 패키지로 직렬화/역직렬화 확인 🟢
- **⛔ Protobuf 아님**

**상태:** 🟢 (2026-06-22 실서버 GETCONF BSON 디코딩 성공)

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

**상태:** 🟢 (2026-06-22 포트 995 실서버 CHECKIN 성공)

### 4.2 암호화 스펙

| 항목 | 값 | 상태 |
|------|-----|:----:|
| 키 교환 | RSA-2048 OAEP SHA-1 | 🟢 |
| 데이터 암호화 | AES-128-CFB (NoPadding) | 🟢 |
| RSA 공개키 지수(e) | **3** | 🟢 |
| OAEP 해시 / MGF1 | **SHA-1 / SHA-1** | 🟢 |
| AES 키 길이 | 128 bits (16 bytes) | 🟢 |
| CFB IV | 16 bytes random (매 프레임 새로) | 🟢 |

### 4.3 암호화 프레임

```
Offset  Size  Field
------  ----  -----
0x00    4     encrypted_size   u32 LE (16-byte IV + ciphertext)
0x04    16    iv               crypto.randomBytes(16) — 매 프레임 새 IV
0x14    N     ciphertext       AES-128-CFB 암호문
```

**상태:** 🟢 (2026-06-22 CHECKIN 요청/응답 roundtrip 확인)

### 4.4 RSA 공개키

- KiwiTalk commit `7e8bcc34d6c2d994ff32b482bc649e8b51382255`에서 modulus와 e=3 추출
- SPKI PEM으로 변환하여 `poc/02-checkin/public-key.pem`에 저장
- Node.js `publicEncrypt` 및 실서버 핸드셰이크 성공

**상태:** 🟢

---

## 5. Method 목록 (Phase A 대상)

### 5.1 GETCONF — 서버 설정 조회

```
Direction: Request → Response
Host: booking-loco.kakao.com:443 (TLS)

Request BSON (실서버 확인 🟢):
{
  MCCMNC: "999",
  os: "win32",
  model: ""
}

Response BSON (주요 필드, 실서버 확인 🟢):
{
  revision: 197,
  wifi: { ports: [995, 8080, ...], encType: 2, ... },
  "3g": { ports: [995, 8080, ...], ... },
  ticket: {
    lsl: ["ticket-loco.kakao.com", "211.183.211.10", ...],
    lsl6: ["ticket-loco.kakao.com", "2404:4600:...", ...]
  },
  ...
}
```

**상태:** 🟢 (2026-06-22 확인, 전체 응답은 `poc/fixtures/getconf-response.json`)

### 5.2 CHECKIN — LOCO 서버 할당

```
Direction: Request → Response (핸드셰이크 이후)
Host: ticket-loco.kakao.com:995 (TCP + RSA/AES)

Request BSON (실서버 확인 🟢):
{
  userId: long(1),
  os: "win32",
  ntype: 0,
  appVer: "26.5.0",
  MCCMNC: "999",
  lang: "ko",
  countryISO: "KR",
  useSub: true
}

Response: `status`, `host`, `host6`, `port`, `cshost`, `csport`, `vsshost`, `vssport`, `cacheExpire`, `MCCMNC`
```

**상태:** 🟢 (2026-06-22 확인, 전체 응답은 `poc/fixtures/checkin-response.json`)

### 5.3 LOGINLIST — 인증 + 초기 채팅방 목록

```
Direction: Request → Response
Host: LOCO Server (AES 암호화)

Request BSON (추정 🟡):
{
  userId: long,
  token: string,         // Access Token
  appVer: "3.0.0",
  ...
}

Response: 세션 토큰 + 채팅방 리스트
```

**상태:** 🟡

### 5.4 LCHATLIST — 채팅방 목록

```
Direction: Request → Response

Request BSON (추정 🟡):
{
  chatIds: [long, ...],  // 조회할 채팅방 ID 목록
  lastToken: string?     // 페이지네이션 토큰
}
```

**상태:** 🟡

### 5.5 SYNCMSG — 메시지 내역

```
Direction: Request → Response

Request BSON (추정 🟡):
{
  chatId: long,
  cur: long,             // 현재 watermark
  cnt: int,              // 가져올 메시지 개수
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

## 6. 에러 코드 (추정)

| Code | 의미 | 상태 |
|:----:|------|:----:|
| 0 | 성공 | 🟡 |
| -500 | 서버 내부 오류 | 🟡 |
| -501 | 인증 실패 | 🟡 |
| -502 | 권한 없음 | 🟡 |
| -950 | 중복 로그인 (KICKOUT) | 🟡 |
| -979 | 서버 점검 중 | 🟡 |

---

## 7. 인증: email+password 방식

```
1. POST https://accounts.kakao.com/... 으로 로그인
2. X-VC 헤더 필요 (기기 식별자 기반 해시) ⚠️
3. Access Token + Refresh Token 획득
4. Access Token을 LOGINLIST BSON에 포함하여 LOCO 인증
```

**⚠️ X-VC 헤더 계산 방식이 불확실. 카카오톡 앱 리버싱 or QR 로그인으로 우회 가능성 검토.**

---

## 8. Codex 작업 시 주의사항

1. **🟡 항목은 "가설"로 취급.** 실패 시 당황하지 말고 로그를 남길 것
2. **모든 패킷은 hex dump를 파일로 저장** (poc/fixtures/ 에 Golden Packet 보관)
3. **토큰/비밀번호는 콘솔 출력 시 마스킹** (`***`)
4. **RSA e=3**: Node.js `crypto` 모듈에서 지원 여부 먼저 확인. 안 되면 수동 OAEP 구현
5. **Checkin 암호화**: 실서버 검증값은 `key_encrypt_type=15`, `encrypt_type=2` (AES-128-CFB)
6. **TLS**: booking-loco.kakao.com:443은 일반 HTTPS 아님. TLS over raw TCP로 시도

---

> 이 문서는 OpenKakao 문서와 KiwiTalk 코드를 기반으로 작성되었으며, 실제 검증은 Phase A에서 진행됩니다.
