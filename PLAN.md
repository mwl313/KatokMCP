# 🗺️ 카카오MCP — Implementation Plan (v5)

> 플랫폼 독립적인 KakaoTalk MCP 서버 개발 계획
> Last updated: 2026-06-22 | Revision: v5 (리뷰 반영 — 실무 Phase 재구성 + 검증 상태 표기 + Codex 작업 체계)

---

## 📖 비개발자도 이해하는 카카오MCP (Overview for Everyone)

### 이 프로젝트가 뭔가요?

**카카오톡을 AI 비서가 직접 조작할 수 있게 해주는 다리**를 만드는 프로젝트예요.

지금은 카카오톡을 쓰려면 반드시 카카오톡 앱을 직접 열어서 타이핑해야 하잖아요? 이 프로젝트가 완성되면, **AI 비서(OpenClaw, Claude 등)가 카카오톡 메시지를 읽고, 답장하고, 채팅방을 관리하는 걸 자동으로 할 수 있게 돼요.**

### 구체적으로 뭘 할 수 있나요?

- 📋 **내 채팅방 목록을 AI가 확인** → "읽지 않은 메시지가 있는 채팅방 알려줘"
- 📖 **특정 채팅방의 대화 내용을 AI가 읽음** → "가족 단톡방에서 오늘 무슨 얘기했어?"
- ✉️ **AI가 카카오톡 메시지 전송** → "엄마한테 저녁 7시에 도착한다고 보내줘" *(v0.2 이후)*
- 👥 **친구 목록 / 프로필 확인** *(v0.2 이후)*
- 🔔 **새 메시지가 오면 AI가 실시간으로 감지** *(v0.3 이후)*

### 왜 어려운가요?

카카오톡은 **공식 API를 일반인에게 제공하지 않아요.** 카카오톡 앱과 서버 사이의 통신은 **LOCO**라는 카카오만의 비공개 프로토콜로 이루어져 있어서, 이걸 분석해서 똑같이 흉내 내는 프로그램을 만들어야 해요. 마치 외국어를 하나 새로 배우는 것과 비슷해요.

### 가장 큰 관문: 인증

이 프로젝트의 첫 번째이자 가장 중요한 관문은 **"카카오 서버가 우리를 들여보내주는가"** 예요. 아무리 프로토콜을 완벽하게 구현해도, 인증이 실패하면 아무것도 할 수 없어요. 그래서 **Phase A의 모든 작업은 오직 "인증 + 채팅방 목록 획득"이라는 한 가지 목표에 집중**해요.

### 핵심 보안 원칙

- ✅ **v0.1은 '읽기 전용'만** — 메시지 전송은 v0.2까지 구현하지 않음
- ✅ **전송 기능은 명시적으로 켜야만 함** (opt-in)
- ✅ **AI가 보낸 메시지에는 자동으로 표식** (🤖 prefix)
- ✅ **전송 속도에 제한** (Rate Limiter)
- ✅ **Audit Log는 dev/prod 모드 구분** — 개발 중에는 전문 저장, 프로덕션은 해시만

---

## 0. 실무 운영 모델

### 역할 분담

| 역할 | 담당자 | 도구 | 머신 |
|------|--------|------|------|
| **기획 / 설계 / 리뷰** | 주인님 + 아리아 | WebChat | Mac mini |
| **코딩 / 구현** | Codex (GPT Codex 모델) | VS Code | Windows (로컬 SSD) |
| **프로토콜 검증** | Codex (실험 코딩) → 아리아 (결과 판정) | → GitHub → | 동기화 |
| **버전 관리 / 동기화** | GitHub Private Repo | git push/pull | 양쪽 |

### Git 기반 협업 구조

```
Windows 머신 (로컬 SSD)                Mac mini (Haven)
┌─────────────────────┐              ┌─────────────────────┐
│ VS Code + Codex     │              │ 아리아 (OpenClaw)    │
│                     │              │                     │
│ kakao-mcp/          │              │ kakao-mcp/          │
│ ├── PLAN.md    ←────│──── pull ────│── 나도 편집          │
│ ├── TASKS.md   ←────│──── pull ────│── 내가 업데이트      │
│ ├── poc/*.ts   ─────│──── push ───▶│── 내가 읽고 검증     │
│ └── STATUS.md  ─────│──── push ───▶│── 내가 판정          │
│                     │              │                     │
│ Codex가 읽기/쓰기    │    GitHub    │ 내가 읽기/검증/업뎃  │
└─────────────────────┘              └─────────────────────┘
```

### 작업 사이클

```
① 아리아: TASKS.md 작성/업데이트 → git push
② 주인님: Windows에서 git pull → TASKS.md 확인
③ Codex: TASKS.md 읽고 코딩 → 결과를 STATUS.md에 기록 → git push
④ 아리아: git pull → STATUS.md + 코드 확인 → PLAN.md/PROTOCOL_VERIFIED 업데이트
⑤ 반복
```

### 파일 구조

```
kakao-mcp/                     ← GitHub repo root (양쪽 머신 동일)
├── .gitignore
├── PLAN.md                     ← 기획 문서 (이 파일)
├── PROTOCOL_VERIFIED.md        ← 검증 상태 표기된 프로토콜 명세
├── TASKS.md                    ← Codex 작업 지시서
├── STATUS.md                   ← Codex 진행상황 보고 (Codex가 작성)
├── poc/                        ← Phase A 실험 코드
│   ├── 01-booking/             ← GETCONF
│   ├── 02-checkin/             ← RSA+AES 핸드셰이크
│   ├── 03-loginlist/           ← 인증 + 채팅방 목록
│   └── fixtures/               ← Golden Packet (성공한 패킷 저장)
├── packages/
│   ├── loco-engine/            ← Phase B 산출물
│   └── mcp-server/             ← Phase D+E 산출물
└── docs/
```

### Git 규칙
- `PLAN.md`, `TASKS.md`, `PROTOCOL_VERIFIED.md` — 아리아가 주로 편집
- `poc/**`, `STATUS.md` — Codex가 주로 편집
- `.env`, 토큰 파일 — 절대 커밋 금지 (`.gitignore` 에 등록됨)
- 커밋은 자주, 작게 (한 Task 완료마다)

---

## 1. 검증 상태 표기 시스템

PLAN.md와 PROTOCOL_VERIFIED.md에 사용할 검증 상태 마크:

| 표기 | 의미 | 설명 |
|:----:|------|------|
| 🟢 | **검증 완료** | 실제 패킷 캡처 또는 동작하는 구현체에서 확인됨 |
| 🔵 | **구현체 참고** | OpenKakao/KiwiTalk 코드에서 확인. 실제 동작 검증은 아직 |
| 🟡 | **문서 기반 가설** | OpenKakao 문서에만 기술됨. 실험적 검증 필요 |
| ⚠️ | **불확실 / 위험** | 출처 불분명하거나 구현 시 실패 가능성 높음 |

**규칙:**
- Codex에게 작업 지시 시 🟡/⚠️ 항목은 "가설"로 명시
- 🟡 항목이 검증되면 🟢로 승격
- ⚠️ 항목이 실패하면 대안 경로 제시

---

## 2. 개요

### 목표
카카오톡을 **플랫폼에 관계없이** (macOS/Windows/Linux) AI 에이전트가 제어할 수 있도록 하는 **MCP 서버**를 개발한다.

### 핵심 접근법
**TypeScript 기반 LOCO 프로토콜 직접 구현 + MCP 서버 래핑**

### MCP란?
**Model Context Protocol** — AI 모델이 외부 도구와 소통하기 위한 오픈 표준. Anthropic 제안 (2024). 현재 Claude, ChatGPT, Gemini, OpenClaw, Cursor, VS Code 등 모든 주요 AI 서비스가 지원 중.

---

## 3. 참고 프로젝트 분석

### 🥇 OpenKakao (문서 1순위)
| 항목 | 내용 |
|------|------|
| 저장소 | `github.com/JungHoonGhae/openkakao-cli` |
| 문서 | `openkakao.vercel.app/docs/protocol/overview` |
| 언어 | Rust |
| 상태 | ⭐⭐⭐⭐⭐ — LOCO 패킷 구조, 암호화, 메서드 목록까지 완벽 문서화 |
| **상태** | 🟡 문서 기반 가설 — 문서 내용이지만 우리가 직접 검증하지 않음 |

### 🥇 KiwiTalk (코드 1순위)
| 항목 | 내용 |
|------|------|
| 저장소 | `github.com/KiwiTalk/KiwiTalk` |
| 언어 | Rust + TypeScript/SolidJS |
| 최근 업데이트 | **2026-06-21** |
| **상태** | 🔵 구현체 참고 — 실제 동작하는 코드이므로 신뢰도 높음 |

### ❌ NodeKakao
| 항목 | 내용 |
|------|------|
| 상태 | **2021-11-21 중단**. 포크 가치 없음 |
| 참고 | TypeScript 코드 구조만 참고 |

---

## 4. LOCO Protocol (검증 상태 표기)

### 4.1 연결 구조 (3-Stage)

```
Stage 1: Booking   🟡  booking-loco.kakao.com:443 (TLS) → GETCONF → 서버 리스트
Stage 2: Checkin   🟡  ticket-loco.kakao.com:995 (TCP) → RSA+AES 핸드셰이크 → LOCO 서버 할당
Stage 3: Login     🟡  LOCO Server (동적 IP) → LOGINLIST → 세션 수립 → 채팅 가능
```

### 4.2 암호화

| 항목 | 값 | 상태 |
|------|-----|:----:|
| 키 교환 | RSA-2048 OAEP SHA-1 | 🟡 |
| 암호화 | AES-128-GCM | 🟡 |
| 공개키 지수(e) | 3 (특이함) | ⚠️ |
| OAEP 해시 | SHA-1 | 🟡 |
| 핸드셰이크 패킷 | 268바이트 고정 | 🟡 |

**⚠️ `key_encrypt_type = 16` (0x10)이 가장 실수하기 쉬운 부분. 15(0x0F)를 보내면 서버가 조용히 연결 거부.**

### 4.3 패킷 포맷

| 필드 | 크기 | 설명 | 상태 |
|------|------|------|:----:|
| packet_id | 4 u32 LE | 순차 카운터 (1부터) | 🟡 |
| status_code | 2 i16 LE | 응답 코드 | 🟡 |
| method | 11 ASCII | null-padded 메서드명 | 🟡 |
| body_type | 1 u8 | 보통 0 | 🟡 |
| body_size | 4 u32 LE | BSON 바디 길이 | 🟡 |
| body | variable | **BSON (Binary JSON)** | 🟡 |

### 4.4 핵심 Method (v0.1 대상)

| Method | 용도 | 상태 |
|--------|------|:----:|
| `GETCONF` | 서버 설정 조회 | 🟡 |
| `CHECKIN` | LOCO 서버 할당 | 🟡 |
| `LOGINLIST` | 인증 + 채팅방 목록 | 🟡 |
| `LCHATLIST` | 채팅방 목록 | 🟡 |
| `SYNCMSG` | 메시지 내역 | 🟡 |
| `PING` | Keep-Alive (30s) | 🟡 |

### 4.5 인증

| 방법 | 플랫폼 독립 | 상태 |
|------|:----------:|:----:|
| email + password | ✅ | ⚠️ 2FA/기기인증 가능성 |
| QR 코드 로그인 | ✅ | 🟡 대안 |
| macOS 앱 캐시 추출 | ❌ | 🔵 openkakao 방식 |

---

## 5. 버전별 범위 (What We Actually Build)

### v0.1 — "증명" (Feasibility Verified)
> 목표: 인증 뚫고 채팅방 목록 보기. 실패하면 접근법 재검토.

| 기능 | 상태 |
|------|:----:|
| GETCONF → 서버 리스트 획득 | 목표 |
| CHECKIN → RSA+AES 핸드셰이크 | 목표 |
| LOGINLIST → 인증 + 세션 수립 | 목표 |
| 채팅방 목록 조회 (LCHATLIST) | 목표 |
| 특정 채팅방 최근 메시지 읽기 (SYNCMSG) | 목표 |
| PING Keep-Alive | 목표 |
| **MCP 서버로 래핑** | 목표 |
| 메시지 전송 | ❌ v0.2 |
| 친구 목록 / 프로필 | ❌ v0.2 |
| 실시간 MSG Push | ❌ v0.3 |

### v0.2 — "대화" (Read + Write)
> 목표: 메시지 전송, 삭제, 친구 목록

- 메시지 전송 (WRITE) + opt-in
- 메시지 삭제 (DELETEMSG) + opt-in
- 친구 목록 / 프로필
- 채팅방 멤버 조회 (GETMEM)
- Safety Layer (Rate Limiter, Prefixer, Audit Log)

### v0.3 — "실시간" (Push + Daemon)
> 목표: 실시간 메시지 수신 + 안정적 연결 유지

- MSG Push 수신 → MCP Notification
- CHANGESVR 자동 대응
- **Session Daemon 분리** (IPC)
- 재연결 + 오프라인 큐

### v0.4 — "배포" (npm + Docs)
- npm publish `@kakao-mcp/server`
- 문서화 + 연동 가이드
- Streamable HTTP Transport (원격)
- ChatGPT 연동

---

## 6. 구현 Phase (실무 재구성)

### Phase A: Feasibility Gate 🚧 ← 지금 여기

**기간:** 결과 나올 때까지 (예상 1~2주)
**목표:** "인증부터 채팅방 목록까지 실제로 되는가?" 를 검증
**실패 시:** 접근법 변경 (QR 로그인, macOS 캐시 추출 등 대안 검토)
**담당:** Codex (코딩) + 아리아 (TASKS.md 작성, 결과 판정)

| # | 작업 | 상태 |
|---|------|:----:|
| A-1 | BSON/패킷 기본 인코딩 검증 | ⬜ |
| A-2 | Booking: GETCONF → 서버 리스트 | ⬜ |
| A-3 | RSA 공개키 확보 | ⬜ |
| A-4 | Checkin: 268-byte 핸드셰이크 | ⬜ |
| A-5 | AES-128-GCM 암복호화 검증 | ⬜ |
| A-6 | 인증: email+password → Access Token | ⬜ |
| A-7 | LOGINLIST → 세션 수립 | ⬜ |
| A-8 | LCHATLIST → 채팅방 목록 | ⬜ |
| A-9 | SYNCMSG → 메시지 읽기 | ⬜ |

**게이트 기준:** A-8 통과 = Phase B 진입. A-7 실패 = 접근법 재검토.

### Phase B: LOCO Engine 코어

**기간:** 3~4주
**전제:** Phase A 통과
**목표:** 재사용 가능한 LOCO 클라이언트 라이브러리

| # | 작업 |
|---|------|
| B-1 | Transport Layer (Booking → Checkin → Connection) |
| B-2 | Crypto Layer (RSA, AES, Handshake) |
| B-3 | Protocol Layer (Header, BSON, Method Router) |
| B-4 | Auth Module (Login, Token, Session) |
| B-5 | Command Module (LCHATLIST, SYNCMSG) |
| B-6 | Keep-Alive (PING 30s) |
| B-7 | 에러 처리 + 재연결 (exponential backoff) |

### Phase C: 메시지 전송 (v0.2 범위)

**기간:** 1~2주

| # | 작업 |
|---|------|
| C-1 | WRITE (메시지 전송) |
| C-2 | DELETEMSG (메시지 삭제) |
| C-3 | GETMEM (멤버 조회) |
| C-4 | 친구 목록 / 프로필 |
| C-5 | Safety Layer (Rate Limiter, Prefixer, Audit Log) |

### Phase D: MCP 서버 래핑 (v0.1 대상 기능만)

**기간:** 1주

| # | 작업 |
|---|------|
| D-1 | StdioServerTransport 기본 구조 |
| D-2 | Read-Only Tools (list_chats, read_chat) |
| D-3 | Resources (kakao:// URI) |
| D-4 | Credential Store (환경변수 + 로컬 암호화 저장) |

### Phase E: 실시간 + Daemon (v0.3)

**기간:** 2~3주

| # | 작업 |
|---|------|
| E-1 | MSG Push Handler |
| E-2 | CHANGESVR 대응 |
| E-3 | Session Daemon 프로세스 분리 (IPC) |
| E-4 | MCP Notifications |

### Phase F: 배포 + 원격 + 연동

**기간:** 2~3주

| # | 작업 |
|---|------|
| F-1 | npm publish |
| F-2 | Streamable HTTP Transport |
| F-3 | ChatGPT / Claude Web 연동 |
| F-4 | 문서화 + 연동 가이드 |
| F-5 | GitHub + CI/CD |

### Phase 관계도

```
Phase A ──(통과)──▶ Phase B ──▶ Phase D (v0.1 MVP)
  │                      │
  │ (실패)               ├──▶ Phase C (v0.2 전송 기능)
  │                      │
  ▼                      └──▶ Phase E (v0.3 실시간)
접근법 재검토                      │
                                   └──▶ Phase F (배포)
```

---

## 7. MCP 서버 아키텍처 (v0.1 기준, 단순화)

```
┌──────────────────────────────┐
│       kakao-mcp-server        │
│                              │
│  MCP Interface (Stdio)       │
│  ├── kakao_list_chats        │
│  └── kakao_read_chat         │
│                              │
│  LOCO Engine                  │
│  ├── Booking → Checkin       │
│  ├── Login → Session         │
│  └── Commands (LCHATLIST,    │
│       SYNCMSG, PING)         │
│                              │
│  Auth: email+password        │
│  Safety: Audit Log (dev 모드)│
└──────────────────────────────┘
```

> ⚠️ Session Daemon 분리는 **v0.3 이후**. v0.1~v0.2는 단일 프로세스로 충분.

---

## 7.1 Audit Log 정책

| 모드 | 메시지 전문 저장 | 용도 |
|:----:|:----------------:|------|
| **dev** | ✅ 전체 저장 | 디버깅, 프로토콜 검증 |
| **prod** | ❌ 해시만 저장 | 운영 보안 |

환경변수 `KAKAO_ENV=development` → dev 모드. 기본값은 prod.

## 7.2 배포 / 포트폴리오 (v0.2 이후 구체화)

워킹 버전(v0.1)이 나오면 본격적으로 설계할 항목.

| 항목 | 목표 |
|------|------|
| 설치는 `npx @kakao-mcp/server` 한 줄 | ✅ 이미 계획 완료 |
| AI 연동은 설정 파일 복붙만으로 | ✅ 이미 계획 완료 |
| **인증 UX 개선** (QR 로그인, CLI → 브라우저) | 🎯 워킹 버전 후 최우선 과제 |
| 영문/한글 README + 스크린샷 + 데모 GIF | 🎯 배포 전 필수 |
| GitHub Pages 랜딩 페이지 | 🎯 있으면 좋음 |
| npm publish + CI/CD | 🎯 Phase F 표준 |

**핵심 사용자 가치:**
- 한국인이 가장 필요한 카톡 AI 자동화를 **크로스플랫폼**으로 제공
- LOCO 프로토콜 리버싱 + 암호학 + TCP 네트워킹의 **기술적 깊이**
- MCP 표준을 따르므로 **Claude/ChatGPT/Gemini/OpenClaw 어디서든 동작**

---

## 8. 기술 스택

| 계층 | 기술 | 비고 |
|------|------|------|
| 런타임 | Node.js >= 18 LTS | 크로스 플랫폼 |
| 언어 | TypeScript 5.x | |
| MCP SDK | `@modelcontextprotocol/server` 1.x | |
| 암호화 | `node:crypto` (내장) | RSA-2048 OAEP, AES-128-GCM |
| TCP/TLS | `net`, `tls` (내장) | |
| BSON | `bson` (npm) | |
| 테스트 | `vitest` | |
| 로깅 | `pino` | |

---

## 9. 리스크 및 대책

| 리스크 | 확률 | 대책 |
|--------|:----:|------|
| 인증 실패 (email+password 막힘) | 중 | QR 로그인, macOS 캐시 추출 대안 즉시 전환 |
| RSA 공개키 획득 실패 | 중 | KiwiTalk 저장소에서 추출, 카톡 바이너리 리버싱 |
| LOCO 프로토콜 변경 | 중 | Phase A에서 검증하므로 전체 재작성 방지 |
| 계정 제재 | 중 | v0.1은 읽기 전용. v0.2 전송 시 Rate Limiter + Prefix |
| 카카오 법적 대응 | 낮음 | 비상업적 오픈소스, "연구 목적" 명시 |
| Codex가 LOCO 암호화 실수 | 중 | Golden Packet 테스트, Phase A 반복 검증 |

---

## 10. AI 서비스 연동 (요약)

| 서비스 | 연동 방식 | 가능 시점 |
|--------|-----------|:--------:|
| **OpenClaw** | Stdio MCP 설정 | Phase D |
| **Claude Desktop** | `claude_desktop_config.json` | Phase D |
| **Claude Code** | `claude mcp add` | Phase D |
| **Cursor / VS Code** | `.cursor/mcp.json` | Phase D |
| **ChatGPT** | Developer Mode (HTTPS 필요) | Phase F |
| **Claude Web** | Custom Connector (HTTPS 필요) | Phase F |
| **Gemini CLI** | MCP 설정 | Phase D |

---

## 11. PlayMCP와의 관계

카카오 공식 MCP 플랫폼 (2025.08~). **서로 충돌하지 않고 상호 보완적.**

| | PlayMCP | 우리 카카오MCP |
|---|---------|---------------|
| 카톡 메시지 | 나와의 채팅방만 | **모든 채팅방** |
| 메시지 읽기/쓰기 | ❌ / ⚠️ (자기 자신만) | ✅ / ✅ (누구나) |
| 기타 서비스 | 캘린더·지도·멜론·선물 | 카톡 메시징 집중 |

**시너지:** PlayMCP + 우리 카카오MCP 동시 사용 시 카카오 생태계 전체 제어 가능.
**등록 비권장:** 역공학 기반이므로 PlayMCP에 올리지 않는다. 독립 npm 패키지로 배포.

---

## 12. 의사결정 기록

| 결정 | 선택 | 이유 |
|------|------|------|
| 코딩 담당 | **Codex (VS Code)** | 주인님 지정. 일관된 코드 스타일 |
| 기획 담당 | **주인님 + 아리아** | TASKS.md 작성, 결과 판정 |
| Phase 구조 | **A→F (Feasibility Gate 우선)** | 인증 실패 시 전체 재작성 방지 |
| v0.1 범위 | **읽기 전용** (채팅방 목록 + 메시지 읽기) | 최소 기능으로 안전하게 검증 |
| Session Daemon | **v0.3 이후** | v0.1~v0.2는 단일 프로세스로 충분 |
| Audit Log | **dev=전문 / prod=해시** | 디버깅과 보안 분리 |
| 언어 | TypeScript | MCP SDK 네이티브, 크로스 플랫폼 |
| LOCO 구현 | 처음부터 구현 | NodeKakao 5년 전 중단 |
| 인증 | email+password 우선, QR 대안 | 플랫폼 독립성 |
| MCP SDK | v1.x stable | v2는 Q3 2026 출시 후 마이그레이션 |
| Write 기본값 | 비활성화 (opt-in) | 계정 보호 |
| 배포 | npm + GitHub (PlayMCP 등록 안 함) | |
| 라이선스 | MIT | |

---

## 13. 잘못 알려진 사실들 (Myths)

| 오해 | 진실 |
|------|------|
| "LOCO 바디는 Protobuf" | **BSON** |
| "NodeKakao 포크하면 빠르게 개발" | **5년 전 프로토콜** |
| "암호화는 AES-128-CFB" | **AES-128-GCM** (현행) |
| "RSA 키 크기는 1024, e=65537" | **RSA-2048, e=3** (현행) |
| "key_encrypt_type은 0x0F" | **0x10(16)**. 한 비트 차이로 수많은 구현체 실패 |
| "공식 카카오 API 쓰면 된다" | **일반 사용자 사용 불가** |
| "ChatGPT/Claude/Gemini는 MCP 미지원" | **2026년 현재 모두 공식 지원 중** |
| "PlayMCP로 모든 카톡 제어 가능" | **나와의 채팅방만 가능** |

---

> **v5 변경사항:** 실무 운영 모델(Codex+아리아) 도입, Phase A→F 완전 재구성, 검증 상태 표기 시스템(🟢🔵🟡⚠️), v0.1/v0.2/v0.3 범위 명확화, Session Daemon v0.3 연기, Audit Log dev/prod 모드 구분, Phase 관계도 추가.
