# STATUS.md — Phase A 진행 현황

> 마지막 업데이트: 2026-06-22 01:09
> 각 Task 완료/실패 시 아래 표를 채우고 `git commit && git push`

---

## Task A-1: BSON + 패킷 인코딩 ✅
- **상태:** ✅ 완료
- **완료 시간:** 2026-06-22 15:40
- **산출물:** `poc/01-booking/header.ts`, `poc/01-booking/bson-test.ts`, `poc/01-booking/package.json`, `poc/fixtures/a1-getconf-packet.json`, `poc/fixtures/a1-getconf-packet.hex`
- **결과 요약:** 22-byte LOCO 헤더와 BSON 각각의 roundtrip 및 GETCONF 통합 패킷 조립/파싱 성공

## Task A-2: RSA 공개키 확보 ✅
- **상태:** ✅ 완료
- **산출물:** `poc/02-checkin/public-key.pem`, `poc/02-checkin/rsa-test.ts`, `poc/02-checkin/package.json`
- **결과 요약:** KiwiTalk에서 RSA-2048 공개키를 추출, e=3, OAEP SHA-1 암호화 확인

## Task A-3: Booking (GETCONF) ✅
- **상태:** ✅ 완료
- **산출물:** `poc/01-booking/booking.ts`, `poc/fixtures/getconf-response.json`, `poc/fixtures/getconf-packets.hex`
- **결과 요약:** TLS 연결, GETCONF 응답 BSON 디코딩 성공

## Task A-4: Checkin (RSA+AES 핸드셰이크) ✅
- **상태:** ✅ 완료
- **산출물:** `poc/02-checkin/handshake.ts`, `poc/02-checkin/handshake-test.ts`, `poc/02-checkin/checkin.ts`, `poc/fixtures/checkin-response.json`, `poc/fixtures/checkin-packets.hex`
- **결과 요약:** ticket-loco.kakao.com:995 RSA-OAEP SHA-1 핸드셰이크, CHECKIN 성공

## Task A-5: AES-128-CFB 암복호화 ✅
- **상태:** ✅ 완료
- **산출물:** `poc/02-checkin/aes.ts`, `poc/02-checkin/aes-test.ts`
- **결과 요약:** LOCO AES-128-CFB 프레임 roundtrip 검증 성공

## Task A-6: 인증 (email+password) ✅
- **상태:** ✅ 완료
- **산출물:** `poc/03-loginlist/auth.ts`, `poc/03-loginlist/android-auth.ts`, `poc/03-loginlist/auth-test.ts`, `poc/03-loginlist/android-auth-test.ts`, `poc/03-loginlist/package.json`
- **결과 요약:** Android 보조기기 passcode 승인 흐름 구현 및 라이브 인증 성공 (userId=100000001)

## Task A-7: LOGINLIST → 세션 수립 ✅
- **상태:** ✅ 완료 🚨 Go/No-Go 통과!
- **완료 시간:** 2026-06-22 01:08
- **산출물:** `poc/03-loginlist/loginlist.ts`, `poc/fixtures/loginlist-response.json`, `poc/fixtures/loginlist-packets.hex`
- **결과 요약:** LOCO 서버 체크인 → RSA 핸드셰이크 → AES LOGINLIST 전송 성공. `status=0`, `userId=100000001`, `chatDatas`에 채팅방 정보 포함 (MultiChat 1개, PlusChat 1개)
- **참고사항:** `-300` 에러 원인은 BSON 필드명 불일치. `token` → `oauthToken`, `duuid`/`prtVer`/`rp`/`lbk` 등 필드 누락 수정 후 성공. KiwiTalk `talk-loco-client` 코드 참고하여 해결.

## Task A-8: LCHATLIST → 채팅방 목록 ⬜
- **상태:** ⬜ 미완료
- **참고사항:** LOGINLIST 응답에 이미 chatDatas 포함되어 있어 LCHATLIST 필요성 낮음

## Task A-9: SYNCMSG → 메시지 읽기 ⬜
- **상태:** ⬜ 미완료
- **참고사항:** LOGINLIST 응답에 마지막 메시지 포함됨