# 📋 TASKS.md — Codex 작업 지시서

> Phase A: Feasibility Gate — "인증부터 채팅방 목록까지 될까?"
> 작업 디렉토리: `~/Haven_v0.5/home/projects/kakao-mcp/poc/`
> 상태: ⬜ 미완료 | 🔄 진행 중 | ✅ 완료 | ❌ 실패

---

## ⚠️ Codex 필독 규칙

1. **모든 토큰, 비밀번호, 세션 키는 콘솔 출력 시 `***`로 마스킹할 것**
2. **실패 시 반드시 에러 메시지 + 패킷 hex dump를 파일로 저장할 것**
   - 저장 위치: `poc/xx-xxx/debug-YYYYMMDD-HHMMSS.log`
3. **성공한 패킷은 `poc/fixtures/` 에 JSON + hex dump 형태로 저장할 것** (Golden Packet)
4. **`PROTOCOL_VERIFIED.md` 의 🟡/⚠️ 항목은 "가설"이다. 실패해도 당황하지 말 것**
5. **한 스텝이 성공해야 다음 스텝으로 넘어간다.** 실패 시 중단하고 보고
6. **TypeScript + Node.js 18 이상 사용.** `node:crypto`, `net`, `tls` 내장 모듈 활용
7. **npm 패키지 추가 필요 시 `package.json` 에 명시하고 `npm install` 실행**

---

## Task A-1: BSON + 패킷 기본 인코딩 검증 ⬜

**작업 디렉토리:** `poc/01-booking/`
**목표:** LOCO 22-byte 헤더와 BSON 바디를 올바르게 인코딩/디코딩할 수 있는지 확인

### 세부 작업:

1. `npm init -y` → `npm install bson typescript tsx @types/node`
2. 22-byte LOCO 헤더 encode/decode 함수 작성 (`header.ts`)
   - `encodeHeader(packetId, method, bodyType, body)` → `Buffer`
   - `decodeHeader(buffer)` → `{ packetId, statusCode, method, bodyType, bodySize, body }`
3. BSON 직렬화 테스트 (`bson-test.ts`)
   - `npm bson` 패키지의 `BSON.serialize()` / `BSON.deserialize()` 동작 확인
   - 간단한 JSON 객체 → BSON → JSON roundtrip 테스트
4. 통합 테스트: Header + BSON body를 하나의 Buffer로 조립 → 파싱

### 예상 산출물:
- `poc/01-booking/header.ts` — 헤더 인코딩/디코딩
- `poc/01-booking/bson-test.ts` — BSON roundtrip 검증
- `poc/01-booking/package.json`

### 검증 기준:
- 헤더 encode → decode roundtrip 성공
- BSON serialize → deserialize roundtrip 성공
- 예시 GETCONF 패킷을 수동 조립하여 hex dump 출력

---

## Task A-2: RSA 공개키 확보 ⬜

**작업 디렉토리:** `poc/02-checkin/`
**목표:** 카카오톡 LOCO 서버와 통신하기 위한 RSA-2048 공개키 획득

### 세부 작업:

1. **방법 A (우선): KiwiTalk 저장소에서 추출**
   - `https://github.com/KiwiTalk/KiwiTalk` 클론 또는 파일 직접 다운로드
   - `talk-loco-client` 크레이트에서 공개키 검색
   - PEM/DER 형식으로 저장

2. **방법 B (차선): 카카오톡 앱에서 추출**
   - macOS: `/Applications/KakaoTalk.app/Contents/` 내부 바이너리 검색
   - `strings` 명령어로 공개키 패턴 검색

3. **방법 C (마지막): OpenKakao 저장소 참고**
   - `github.com/JungHoonGhae/openkakao-cli` 에서 키 위치 확인

4. 획득한 공개키를 `poc/02-checkin/public-key.pem` 파일로 저장
5. Node.js `crypto` 모듈에서 **e=3** 지원 여부 확인
   ```typescript
   // 테스트: e=3 RSA 공개키로 암호화 가능한지
   import { publicEncrypt, constants } from 'node:crypto';
   ```

### 예상 산출물:
- `poc/02-checkin/public-key.pem`
- `poc/02-checkin/rsa-test.ts` — e=3 지원 여부 확인 결과
- `poc/02-checkin/package.json`

### 검증 기준:
- PEM 파일 존재
- `publicEncrypt` 성공 (e=3 지원 확인) 또는 수동 OAEP 필요 판정

---

## Task A-3: Booking (GETCONF) 검증 ⬜

**작업 디렉토리:** `poc/01-booking/`
**전제:** Task A-1 완료
**목표:** 실제 `booking-loco.kakao.com:443` 에 GETCONF 요청 → 서버 리스트 획득

### 세부 작업:

1. TLS over raw TCP 연결 (`tls` 모듈 사용)
   ```typescript
   import tls from 'node:tls';
   const socket = tls.connect({ host: 'booking-loco.kakao.com', port: 443 });
   ```
2. GETCONF 요청 패킷 조립 (Task A-1의 헤더 + BSON 사용)
   - packet_id: 1
   - method: "GETCONF" + null padding
   - BSON body: `{ os: "win32", version: "3.0.0", ... }`
3. 패킷 전송 → 응답 수신
4. 응답 디코딩 → JSON 출력 (서버 리스트 확인)
5. 서버 리스트를 `poc/fixtures/getconf-response.json` 으로 저장
6. 성공한 요청/응답 패킷 hex dump를 `poc/fixtures/getconf-packets.hex` 로 저장

### 예상 산출물:
- `poc/01-booking/booking.ts`
- `poc/fixtures/getconf-response.json`
- `poc/fixtures/getconf-packets.hex`

### 검증 기준:
- TLS 연결 성공
- GETCONF 응답에서 `srv` 배열 획득
- ticket-loco.kakao.com:995 정보 포함 확인

---

## Task A-4: Checkin (RSA+AES 핸드셰이크) 검증 ⬜

**작업 디렉토리:** `poc/02-checkin/`
**전제:** Task A-2 (공개키), Task A-3 (GETCONF) 완료
**목표:** `ticket-loco.kakao.com:995` 에 CHECKIN → LOCO 서버 할당

### 세부 작업:

1. TCP 연결: `ticket-loco.kakao.com:995`
2. 268-byte 핸드셰이크 패킷 구성:
   ```
   [key_size: 4 LE = 256]
   [key_encrypt_type: 4 LE = 16]   ← ⚠️ 16 (0x10)!!!
   [encrypt_type: 4 LE = 3]        ← 3 (GCM)
   [encrypted_key: 256 bytes]      ← RSA-2048 OAEP SHA-1
   ```
3. AES 세션 키 생성: `crypto.randomBytes(16)`
4. RSA-2048 OAEP SHA-1로 AES 키 암호화 (공개키 사용)
5. 핸드셰이크 패킷 전송
6. 응답 수신 → CHECKIN BSON 디코딩
7. LOCO 서버 IP, 포트, 세션 정보 저장
   → `poc/fixtures/checkin-response.json`

### ⚠️ 주의사항:
- `key_encrypt_type = 16` (0x10). 절대 15(0x0F) 보내지 말 것
- `encrypt_type = 3` (GCM). 2(CFB) 아님
- RSA OAEP는 **SHA-1** (SHA-256 아님!)
- 실패 시: 서버가 에러 메시지 없이 조용히 연결 끊을 수 있음 → 패킷 구조 재검토

### 예상 산출물:
- `poc/02-checkin/checkin.ts`
- `poc/02-checkin/handshake.ts`
- `poc/fixtures/checkin-response.json`
- 실패 시: `poc/02-checkin/debug-*.log`

### 검증 기준:
- TCP 연결 성공
- 핸드셰이크 패킷 전송 후 연결 유지 (서버가 바로 끊지 않음)
- CHECKIN 응답에서 LOCO 서버 정보 획득

---

## Task A-5: AES-128-GCM 암복호화 검증 ⬜

**작업 디렉토리:** `poc/02-checkin/`
**전제:** Task A-4 완료 (AES 세션 키 확보)
**목표:** AES-128-GCM 암호화/복호화가 올바르게 동작하는지 검증

### 세부 작업:

1. 암호화 함수:
   ```typescript
   function encryptLocoFrame(plaintext: Buffer, key: Buffer): Buffer
   // → [size: 4 LE][nonce: 12][ciphertext][gcm_tag: 16]
   ```
   - nonce = `crypto.randomBytes(12)` (매 프레임마다 새로)
   
2. 복호화 함수:
   ```typescript
   function decryptLocoFrame(frame: Buffer, key: Buffer): Buffer
   // 입력: 전체 프레임. 출력: 복호화된 평문
   ```

3. Roundtrip 테스트:
   - 랜덤 데이터 → encrypt → decrypt → 원본과 일치 확인

4. GCM 인증 태그 검증 실패 테스트:
   - 변조된 프레임 → 복호화 시 에러 발생 확인

### 예상 산출물:
- `poc/02-checkin/aes.ts`

### 검증 기준:
- Encrypt → Decrypt roundtrip 성공
- 변조된 프레임 복호화 시 에러 발생 (GCM 인증)

---

## Task A-6: 인증 (email+password) 검증 ⬜

**작업 디렉토리:** `poc/03-loginlist/`
**전제:** Task A-4 완료
**목표:** Kakao Account 인증 → Access Token 획득

### 세부 작업:

1. Kakao Account 로그인 API 호출
   ```
   POST https://accounts.kakao.com/... (정확한 URL 확인 필요)
   Headers: X-VC, User-Agent 등
   Body: { email, password }
   ```
2. X-VC 헤더 계산 방식 리서치 (카카오톡 앱 분석 or OpenKakao 문서 참고)
3. Access Token + Refresh Token 획득
4. 토큰을 환경변수에서 읽도록 설정 (하드코딩 금지)
   ```typescript
   const email = process.env.KAKAO_EMAIL;
   const password = process.env.KAKAO_PASSWORD;
   ```

### ⚠️ 주의:
- **X-VC 헤더가 가장 큰 장애물.** 계산 방법이 불확실하면 QR 로그인으로 우회 검토
- **토큰은 절대 로그/콘솔/파일에 저장하지 말 것** (메모리에서만 사용)

### 예상 산출물:
- `poc/03-loginlist/auth.ts`
- `poc/03-loginlist/package.json`

### 검증 기준:
- 200 응답 → Access Token 획득
- 실패 시 명확한 에러 코드 기록

---

## Task A-7: LOGINLIST → 세션 수립 ⬜

**작업 디렉토리:** `poc/03-loginlist/`
**전제:** Task A-4 (LOCO 서버 접속), Task A-5 (AES 암복호화), Task A-6 (토큰) 완료
**목표:** LOCO 서버에 LOGINLIST 전송 → 인증 완료 → 세션 수립

### 세부 작업:

1. Task A-4에서 획득한 LOCO 서버 IP/포트로 TCP 연결
2. 이후 모든 통신은 Task A-5의 AES-128-GCM 암호화 적용
3. LOGINLIST BSON 구성하여 전송
4. 응답 수신 → 세션 토큰 + 초기 채팅방 목록 확인

### 예상 산출물:
- `poc/03-loginlist/loginlist.ts`
- `poc/fixtures/loginlist-response.json`
- `poc/fixtures/session-token.txt` (⚠️ 마스킹)

### 검증 기준: **이 Task 성공 여부가 프로젝트 Go/No-Go 결정**
- LOGINLIST 응답 200
- 세션 토큰 획득
- 채팅방 목록 데이터 포함

---

## Task A-8: LCHATLIST → 채팅방 목록 ⬜

**작업 디렉토리:** `poc/03-loginlist/`
**전제:** Task A-7 완료
**목표:** LCHATLIST 명령으로 채팅방 목록 조회

### 예상 산출물:
- `poc/03-loginlist/lchatlist.ts`
- `poc/fixtures/chat-list.json`

### 검증 기준:
- 채팅방 ID, 이름, 마지막 메시지 등 정보 획득
- 최소 1개 이상의 채팅방 확인

---

## Task A-9: SYNCMSG → 메시지 읽기 ⬜

**작업 디렉토리:** `poc/03-loginlist/`
**전제:** Task A-8 완료
**목표:** 특정 채팅방의 메시지 내역 읽기

### 예상 산출물:
- `poc/03-loginlist/syncmsg.ts`
- `poc/fixtures/messages-sample.json` (내용 마스킹)

### 검증 기준:
- 최근 메시지 N개 획득
- 메시지 텍스트 정상 표시

---

## 작업 순서 요약

```
A-1 (BSON/패킷) ──┐
                   ├──▶ A-3 (GETCONF)
                   │
A-2 (RSA 공개키) ──┼──▶ A-4 (CHECKIN) ──▶ A-5 (AES 검증)
                   │                          │
                   │                          ▼
                   └──────────────────── A-6 (인증)
                                              │
                                              ▼
                                         A-7 (LOGINLIST) ← 🚨 Go/No-Go Gate
                                              │
                                              ▼
                                         A-8 (LCHATLIST)
                                              │
                                              ▼
                                         A-9 (SYNCMSG)
```

**A-7 성공 = 프로젝트 진행. 실패 = 인증 방식 전면 재검토.**

---

> 이 파일은 Phase A 진행 상황에 따라 아리아가 업데이트합니다.
> Codex는 각 Task를 순차적으로 실행하고, 완료/실패 여부를 보고해주세요.
