# STATUS.md — Phase A 진행 현황

> 마지막 업데이트: 2026-06-22 16:21
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

## Task A-3: Booking (GETCONF) ✅
- **상태:** ✅ 완료
- **완료 시간:** 2026-06-22 15:56
- **산출물:** `poc/01-booking/booking.ts`, `poc/fixtures/getconf-response.json`, `poc/fixtures/getconf-packets.hex`
- **결과 요약:** TLS 연결과 GETCONF 응답 BSON 디코딩 성공. `ticket.lsl/lsl6`에서 ticket 서버를, `wifi.ports`에서 포트 995를 확인
- **참고사항:** 실제 응답은 추정 `srv` 배열이 아닌 `ticket` + `wifi/3g` 구조이며 현재 `wifi.encType`은 2. `npm run typecheck`, `npm test`, `npm run booking` 통과

## Task A-4: Checkin (RSA+AES 핸드셰이크) ✅
- **상태:** ✅ 완료
- **완료 시간:** 2026-06-22 16:03
- **산출물:** `poc/02-checkin/handshake.ts`, `poc/02-checkin/handshake-test.ts`, `poc/02-checkin/checkin.ts`, `poc/fixtures/checkin-response.json`, `poc/fixtures/checkin-packets.hex`
- **결과 요약:** `ticket-loco.kakao.com:995`에서 RSA-OAEP SHA-1 핸드셰이크, AES-128-CFB CHECKIN 요청/응답 복호화 및 LOCO 서버 할당 성공
- **참고사항:** 라이브 GETCONF와 원본 구현 및 실서버 검증 결과는 `key_encrypt_type=15`, `encrypt_type=2`. `appVer=3.4.7`은 -999(업그레이드 필요), 현재 `26.5.0`은 성공

## Task A-5: AES-128-CFB 암복호화 ✅
- **상태:** ✅ 완료
- **완료 시간:** 2026-06-22 16:10
- **산출물:** `poc/02-checkin/aes.ts`, `poc/02-checkin/aes-test.ts`
- **결과 요약:** 실제 LOCO AES-128-CFB 프레임의 7개 경계 크기 roundtrip, 길이·키·IV 검증 및 CHECKIN 회귀 테스트 성공
- **참고사항:** 기존 GCM 가설과 달리 CFB에는 인증 태그가 없어 암호문 변조를 탐지하지 못함. 테스트에서 변조된 평문 반환 특성을 확인

## Task A-6: 인증 (email+password) 🔄
- **상태:** 🔄 실인증 검증 대기
- **완료 시간:** -
- **산출물:** `poc/03-loginlist/auth.ts`, `poc/03-loginlist/auth-test.ts`, `poc/03-loginlist/package.json`
- **결과 요약:** X-VC 계산, POST 폼, bigint userId, 토큰 메모리 전용 처리, 응답 크기 제한 및 mock 인증 테스트 완료
- **참고사항:** 엔드포인트 POST 지원 확인. `KAKAO_EMAIL`, `KAKAO_PASSWORD`, `KAKAO_DEVICE_UUID`가 현재 환경에 없어 Access Token 실발급은 미수행

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
