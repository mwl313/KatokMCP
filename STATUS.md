# STATUS.md — Phase A 진행 현황

> 마지막 업데이트: 2026-06-22 15:43
> 각 Task 완료/실패 시 아래 표를 채우고 `git commit && git push`

---

## Task A-1: BSON + 패킷 인코딩 ✅
- **상태:** ✅ 완료
- **완료 시간:** 2026-06-22 15:40
- **산출물:** `poc/01-booking/header.ts`, `poc/01-booking/bson-test.ts`, `poc/01-booking/package.json`, `poc/fixtures/a1-getconf-packet.json`, `poc/fixtures/a1-getconf-packet.hex`
- **결과 요약:** 22-byte LOCO 헤더와 BSON 각각의 roundtrip 및 GETCONF 통합 패킷 조립/파싱 성공
- **참고사항:** `npm run typecheck`, `npm test` 통과. 현재 패킷 명세는 `PROTOCOL_VERIFIED.md`의 가설을 기준으로 검증함

## Task A-2: RSA 공개키 확보 ✅
- **상태:** ✅ 완료
- **완료 시간:** 2026-06-22 15:43
- **산출물:** `poc/02-checkin/public-key.pem`, `poc/02-checkin/rsa-test.ts`, `poc/02-checkin/package.json`
- **결과 요약:** KiwiTalk에서 RSA-2048 공개키를 추출했으며 Node.js에서 공개 지수 e=3, OAEP SHA-1 암호화 및 256-byte 암호문 생성을 확인
- **참고사항:** 키 출처는 KiwiTalk commit `7e8bcc34d6c2d994ff32b482bc649e8b51382255`. `npm run typecheck`, `npm test` 통과

## Task A-3: Booking (GETCONF) ⬜
- **상태:** ⬜ 미완료
- **완료 시간:** -
- **산출물:** -
- **결과 요약:** -
- **참고사항:** -

## Task A-4: Checkin (RSA+AES 핸드셰이크) ⬜
- **상태:** ⬜ 미완료
- **완료 시간:** -
- **산출물:** -
- **결과 요약:** -
- **참고사항:** -

## Task A-5: AES-128-GCM 암복호화 ⬜
- **상태:** ⬜ 미완료
- **완료 시간:** -
- **산출물:** -
- **결과 요약:** -
- **참고사항:** -

## Task A-6: 인증 (email+password) ⬜
- **상태:** ⬜ 미완료
- **완료 시간:** -
- **산출물:** -
- **결과 요약:** -
- **참고사항:** -

## Task A-7: LOGINLIST → 세션 수립 ⬜ 🚨 Go/No-Go
- **상태:** ⬜ 미완료
- **완료 시간:** -
- **산출물:** -
- **결과 요약:** -
- **참고사항:** -

## Task A-8: LCHATLIST → 채팅방 목록 ⬜
- **상태:** ⬜ 미완료
- **완료 시간:** -
- **산출물:** -
- **결과 요약:** -
- **참고사항:** -

## Task A-9: SYNCMSG → 메시지 읽기 ⬜
- **상태:** ⬜ 미완료
- **완료 시간:** -
- **산출물:** -
- **결과 요약:** -
- **참고사항:** -
