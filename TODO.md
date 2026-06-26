# 🎯 KatokMCP — Implementation TODO

> Last updated: 2026-06-25

---

## 🔴 Priority 0: 버그 수정

### 0.1 - AuthApiError 타입 불일치
- **파일:** `packages/loco-engine/src/auth/android.ts`
- **문제:** `authenticateAndroid()`가 `-100`(기기 미등록) 에러를 잡을 때 `AndroidAuthApiError`만 체크하지만, 실제 `loginAndroid()`는 `AuthApiError`를 throw함
- **영향:** passcode 자동 fallback이 작동하지 않음 → 수동 passcode 인증 필요
- **해결:** `catch`에서 `AndroidAuthApiError` → `AuthApiError` 또는 둘 다 체크

### 0.2 - SYNCMSG maxLogId 계산 버그
- **파일:** `packages/mcp-server/src/index.ts`
- **문제:** `kakao_read_chat`에서 `cur = maxLogId - count*10n` 방식이 일부 채팅방에서 0개 메시지 반환
- **해결:** SYNCMSG의 LOCO 프로토콜 파라미터(`cur`, `max`, `cnt`) 정확한 동작 분석 필요

### 0.3 - `kakao_list_members` displayName 미출력
- **파일:** `packages/mcp-server/src/index.ts`
- **문제:** 멤버 ID만 출력되고 displayName/닉네임이 안 나옴
- **해결:** `displayMembers` 필드 파싱 로직 개선

---

## 🟡 Priority 1: 핵심 기능

### 1.1 - CHAT_INFO 구현 (방 이름 조회)
- **설명:** LOCO 프로토콜에 채팅방 메타정보를 조회하는 명령어 추가
- **목표:** `kakao_list_chats`의 MultiChat에 방 이름 표시
- **방법:** LOCO 프로토콜 리버싱으로 `CHAT_INFO` 또는 유사 명령어 찾기
  - KiwiTalk 코드 분석
  - LOCO 패킷 캡처/분석
- **난이도:** 🟡 중간

### 1.2 - MSG Push 핸들러 (Phase E-1)
- **파일:** `packages/loco-engine/src/connection.ts` + `packages/mcp-server/src/index.ts`
- **현재:** `LocoConnection.onPushData()`는 이미 구현됨
- **필요:** Push 데이터를 MCP Notification으로 변환하는 로직
- **난이도:** 🟡 중간

### 1.3 - CHANGESVR 대응 (Phase E-2)
- **설명:** 카카오 서버가 연결 대상 변경 명령을 보낼 때 새 서버로 자동 재접속
- **파일:** `packages/loco-engine/src/error.ts`에 `detectChangesvr` 있음 → 실제 연결 로직 필요
- **난이도:** 🟡 중간

### 1.4 - MCP Notifications (Phase E-4)
- **설명:** 새 메시지 도착 시 클라이언트에 실시간 알림 전송
- **필요:** 1.2(MSG Push) + Streamable HTTP의 SSE Notification
- **난이도:** 🟡 중간

---

## 🟢 Priority 2: 개선

### 2.1 - HTTP Transport 실환경 테스트
- **파일:** `packages/mcp-server/src/http.ts`
- **할 일:**
  1. curl/Node 스크립트로 CORS + Initialize + tools/list 검증
  2. OpenClaw Gateway에서 stdio → HTTP 모드 전환 테스트
  3. ChatGPT/Claude Web 호환성 확인 (MCP 미지원 가능성 있음)
- **난이도:** 🔵 쉬움

### 2.2 - 채팅방 검색 Tool (Phase K)
- **할 일:** `kakao_search_chats` tool 추가
- **로직:** `loginResp.chatDatas`에서 멤버 이름/메시지 내용 키워드 검색
- **난이도:** 🔵 쉬움

### 2.3 - PING Keep-Alive 개선
- **파일:** `packages/mcp-server/src/index.ts`
- **현재:** `startKeepAlive()`는 구현됨
- **개선:** 연결 끊김 감지 → 자동 재접속 로직
- **난이도:** 🔵 쉬움

### 2.4 - kakao_list_chats 표시 개선
- **할 일:** 
  - MultiChat: `"멤버A, 멤버B, ..."` → `"[방 이름?] 멤버A, 멤버B, ..."`
  - 방 이름이 없으면 `"(멤버명)"` 형식으로 자동 생성 (카톡 앱처럼)
- **난이도:** 🔵 쉬움

---

## 🔴 Priority 3: 대규모

### 3.1 - Session Daemon (Phase J)
- **설명:** 백그라운드 독립 데몬으로 LOCO 연결 유지, 멀티 클라이언트 IPC 공유
- **할 일:**
  1. IPC 프로토콜 설계 (Unix Socket / HTTP)
  2. `LocoConnection.command()` 단일 요청 한계 해결 (큐잉)
  3. Launchd 등록 (자동 실행)
  4. MCP 클라이언트가 데몬에 명령 위임
- **난이도:** 🔴 어려움 (20~40시간)

### 3.2 - Docker 이미지 (Phase K)
- **할 일:** Dockerfile + docker-compose.yml 작성
- **난이도:** 🔵 쉬움

### 3.3 - 멀티 계정 (Phase K)
- **할 일:** Credential Store 계정 분리, 각 계정별 LOCO 세션 관리
- **난이도:** 🟡 중간

---

## 💡 Priority 4: 포트폴리오

- [ ] CI/CD (GitHub Actions)
- [ ] 테스트 커버리지 향상
- [ ] 데모 영상 제작
- [ ] awesome-mcp-servers 업데이트
- [ ] README에 방 이름 미지원 명시

---

## 📋 현재 버전 매핑

| 버전 | 포함 기능 | TODO 항목 |
|:----:|:---------|:---------:|
| **v0.3.0** | HTTP Transport, Read/Write, Safety, Setup | 현재 |
| **v0.4.0** | 1.1 방 이름, 1.2 Push, 2.1~2.4 개선 | Priority 1+2 |
| **v0.5.0** | 3.1 Session Daemon | Priority 3 |
| **v1.0.0** | 3.2 Docker, 3.3 멀티 계정, CI/CD | Priority 3+4 |
