<!-- default lang: ko -->
<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://img.shields.io/badge/KatokMCP-FFCD00?style=for-the-badge&logo=kakao&logoColor=000000">
    <img src="https://img.shields.io/badge/KatokMCP-FFCD00?style=for-the-badge&logo=kakao&logoColor=000000" alt="KatokMCP" height="40">
  </picture>
</p>

<h1 align="center">KatokMCP — AI로 카카오톡 제어하기 🤖✉️</h1>

<p align="center">
  <strong>AI (Claude, ChatGPT, Gemini 등등)가 카카오톡을 읽고, 답장하고, 관리할 수 있게 해주는 오픈소스 MCP 서버</strong> <br>
  by 판교동돌주먹 (Pangyo Stonefist)
</p>

<p align="center">
  <a href="#-한국어"><img src="https://img.shields.io/badge/🇰🇷-한국어-FFCD00?style=flat-square&logo=kakao&logoColor=000000" alt="한국어" height="28"></a>
  <a href="#-english"><img src="https://img.shields.io/badge/🇺🇸-English-3178C6?style=flat-square&logo=typescript&logoColor=white" height="28"></a>
  <p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-green?style=flat-square" alt="MIT License" height="28"></a>
  <a href="https://github.com/mwl313/KatokMCP"><img src="https://img.shields.io/github/last-commit/mwl313/KatokMCP?style=flat-square" alt="Last Commit" height="28"></a>
  <a href="https://github.com/mwl313/KatokMCP/actions"><img src="https://github.com/mwl313/KatokMCP/actions/workflows/ci.yml/badge.svg" alt="CI" height="28"></a>
</p>

> ⚠️ **비공식 프로젝트입니다.** 카카오와 제휴 또는 보증 관계가 아닙니다.
> Unofficial project. Not affiliated with or endorsed by Kakao Corp.

<br>

# 🇰🇷 한국어

> **이 프로젝트는 카카오톡의 비공개 프로토콜(LOCO)을 분석하여 구현한 결과물입니다.** <br> **연구 및 교육 목적으로만 사용해 주세요.** <br>
> **강한 힘에는 강한 책임감이 동반됩니다.**  <br>**강력한 기능들을 책임감 있게 사용해 주세요.**


---

## 🤷 그래서 이게 뭐예요?

**KatokMCP**를 사용하면 여러분의 AI 비서가 **카카오톡을 직접 다룰 수 있게 됩니다.**

- 📋 **"읽지 않은 메시지가 있는 채팅방 알려줘"** → AI가 채팅방 목록을 확인
- 📖 **"가족 단톡방에서 오늘 무슨 얘기했어?"** → AI가 메시지를 읽어줌
- ✉️ **"엄마한테 저녁 7시에 도착한다고 보내줘"** → AI가 메시지를 대신 전송
- 👥 **"이 방에 누가 있어?"** → AI가 채팅방 멤버를 알려줌

MCP(Model Context Protocol)는 AI 모델이 외부 도구와 소통하기 위한 국제 표준입니다. Claude, ChatGPT, Gemini, OpenClaw 등 **모든 주요 AI 서비스**와 호환됩니다.

![KatokMCP 데모](https://github.com/mwl313/KatokMCP/raw/main/katok_demo.gif)

<sub><i>데모 영상: Claude Desktop에서 KakaoTalk 채팅방 조회 및 메시지 전송</i></sub>

---

## ✨ 주요 기능

| 기능 | 설명 | 
|------|------|
| **채팅방 목록 보기** | 모든 채팅방, 읽지 않은 메시지 수, 멤버, 마지막 메시지 |
| **메시지 읽기** | 특정 채팅방의 최근 메시지 내역 |
| **메시지 전송** 🤖 | AI가 대신 답장 (opt-in 필수, 자동 🤖 표식) |
| **멤버 조회** | 채팅방에 누가 있는지 확인 |

---

## 🚀 어떻게 쓰나요?

### 1. 준비물
- **Node.js 18 이상**이 설치된 컴퓨터
- **카카오톡 계정** (이메일 + 비밀번호)
- **카카오톡 계정이 설치된 폰 (안드 IOS 상관X)** (최초 1회 인증용, 이후에는 불필요)

### 2. 설치

#### 🚀 1분 설치 (권장)

```bash
# 글로벌 설치
npm install -g @katok-mcp/mcp-server

# 설치 마법사 실행 (5단계)
katok-mcp setup
```

`katok-mcp setup` 명령어가 다음을 자동으로 처리합니다:
1. ✅ 카카오톡 계정 입력 (AES-256-GCM 암호화 저장)
2. ✅ Device UUID 자동 생성
3. ✅ 휴대폰 인증 (최초 1회 passcode)
4. ✅ AI 비서 설정 (Claude / ChatGPT / Cursor / VS Code)
5. ✅ 메시지 전송 허용 여부

**AI 비서를 재시작한 후 말해보세요:**
> "카톡 채팅방 목록 보여줘"

#### 상세 설치 (개발자용)

```bash
# 방법 1: npx로 바로 실행 (권장)
npx @katok-mcp/mcp-server

# 방법 2: 저장소 다운로드
# git clone https://github.com/mwl313/KatokMCP.git
# cd KatokMCP
# cd packages/loco-engine && npm install && npm run build
# cd ../mcp-server && npm install && cd ../..
```

### 3. 인증 (최초 1회)

> 카카오톡 보안 정책상, 새로운 기기에서 로그인하려면 휴대폰 인증이 필요합니다.

> **설치 마법사 사용 시:** `katok-mcp setup`의 Step 3에서 자동으로 처리됩니다.

> **직접 설정 시:** 환경변수 (`KAKAO_EMAIL`, `KAKAO_PASSWORD`, `KAKAO_ANDROID_DEVICE_UUID`)를 설정 후 MCP 서버 실행 시 자동 인증됩니다.

### 4. AI 비서와 연결

설치 마법사(`katok-mcp setup`)가 AI 비서 설정을 자동으로 완료합니다.

**Claude Desktop** (config 자동 생성됨):
```json
{
  "mcpServers": {
    "katok": {
      "command": "katok-mcp",
      "args": []
    }
  }
}
```

**OpenClaw / Claude Code:**
```bash
openclaw mcp set katok -- npx -y @katok-mcp/mcp-server
claude mcp add katok -- npx -y @katok-mcp/mcp-server
```

> 📖 **자세한 설정법은 [AI 서비스 연동 가이드](docs/ai-integration.md)를 참고하세요.**

---

## 🛡️ 보안 안내

| 항목 | 내용 |
|------|------|
| **메시지 전송** | 처음에는 비활성화되어 있음. `KAKAO_ALLOW_WRITE=YES` 설정해야 전송 가능 |
| **AI 표식** | AI가 보낸 메시지에는 자동으로 🤖 이모지가 붙음 (비활성화 가능) |
| **토큰 저장** | 비밀번호를 안전하게 저장하려면 `katok-mcp store-credentials` 명령어 사용 (AES-256-GCM 암호화) |
| **읽기 전용 기본값** | 메시지를 보내지 않고 읽기만 함 |
| **속도 제한** | 초당 3회로 요청 제한 (남용 방지) |
| **감사 로그** | 모든 명령어 실행 내역 기록 (dev 모드: 전체, prod 모드: 해시만) |

---

## 🏗️ 기술 구조 (간략)

```
KatokMCP
├── 🧠 MCP 서버          ← AI 비서와의 인터페이스
│   ├── kakao_list_chats   ← 채팅방 목록
│   ├── kakao_read_chat    ← 메시지 읽기
│   ├── kakao_send_chat    ← 메시지 전송 (opt-in)
│   └── kakao_list_members ← 멤버 조회
│
└── 🔧 LOCO 엔진          ← 카카오톡 비공개 프로토콜 구현
    ├── 인증 (Android passcode)
    ├── 암호화 (RSA + AES)
    └── 명령어 (LOGINLIST, SYNCMSG, WRITE, ...)
```

---

## ✅ 호환성 확인

| AI 서비스 | 상태 | 비고 |
|-----------|:----:|------|
| **Claude Desktop** (Windows/macOS) | ✅ 동작 확인 | katok-mcp setup 자동 설정 |
| **OpenClaw** | ✅ 동작 확인 | openclaw mcp set katok |
| **Claude Code (CLI)** | ✅ 동작 확인 | claude mcp add katok |
| **ChatGPT Desktop** | ❓ 미확인 | MCP 기능 실험적 (별도 설정 필요) |
| **Cursor / VS Code** | ❓ 미확인 | 설정 가능하나 실제 테스트 필요 |
| **ChatGPT Web** | ❌ 불가능 | MCP 미지원 (HTTP Transport 필요) |

---

## 📋 현재 상태

```
✅ 인증 — 카카오톡 로그인
✅ 채팅방 목록 — 모든 방 확인
✅ 메시지 읽기 — 대화 내용 확인
✅ 메시지 전송 — AI가 답장 (opt-in)
✅ 멤버 조회 — 방에 있는 사람 확인
✅ 안전장치 — 속도 제한, 감사 로그, AI 표식
✅ 설치 마법사 — 1분 설정 (katok-mcp setup)
✅ Token Caching — 재인증 불필요
✅ Credential Store — 환경변수 불필요 (AES-256-GCM 암호화)
```

---

## 🔮 향후 계획

| 단계 | 작업 | 우선순위 |
|:----:|------|:--------:|
| **G** | npm publish 완료 ✅ | — |
| **H** | GitHub 공개 + awesome-mcp-servers 등록 | 🟡 |
| **I** | HTTP Transport (ChatGPT Web 호환) | 🟢 |
| **J** | Session Daemon (멀티 클라이언트, 실시간 Push) | 🟢 |
| **K** | 멀티 계정, Docker 이미지, 채팅방 검색 | 💡 |

---

## 📄 라이선스

MIT License — 자유롭게 사용, 수정, 배포하세요.

---

## 🙏 크레딧

- **[KiwiTalk](https://github.com/KiwiTalk/KiwiTalk)** — Rust 기반 LOCO 구현체. BSON 구조 분석에 큰 도움
- **[OpenKakao](https://github.com/JungHoonGhae/openkakao-cli)** — LOCO 프로토콜 문서
- **NodeKakao** — 선구적인 TypeScript 구현체 (현재 보관됨)

---

<br>
<br>

# 🇺🇸 English

> **This project implements KakaoTalk's proprietary LOCO protocol through protocol analysis. For educational and research purposes only.**

---

## 🤷 What is this?

**KatokMCP** lets your AI assistant **control KakaoTalk** — Korea's #1 messaging app.

- 📋 **"Show me chats with unread messages"** → AI lists your chat rooms
- 📖 **"What did my family chat about today?"** → AI reads the messages
- ✉️ **"Tell mom I'll be there at 7"** → AI sends the message for you
- 👥 **"Who's in this chat?"** → AI shows the members

MCP (Model Context Protocol) is an open standard for AI models to interact with external tools. Supported by Claude, ChatGPT, Gemini, OpenClaw, and more.

![KatokMCP Demo](https://github.com/mwl313/KatokMCP/raw/main/katok_demo.gif)

<sub><i>Demo: AI assistant reading KakaoTalk chats and sending messages</i></sub>

---

## ✨ Features

| Feature | Description |
|---------|-------------|
| **List Chats** | All chat rooms with unread counts, members, last message |
| **Read Messages** | Recent messages from any chat room |
| **Send Messages** 🤖 | AI sends replies on your behalf (opt-in required, auto 🤖 prefix) |
| **List Members** | See who's in a chat room |

---

## 🚀 Quick Start

### 1. Prerequisites
- **Node.js 18+** on your computer
- **KakaoTalk account** (email + password)
- **Smartphone with KakaoTalk** (Android or iOS — needed once for authentication)

### 2. Installation

#### 🚀 1-Minute Setup (Recommended)

```bash
# Global install
npm install -g @katok-mcp/mcp-server

# Run the setup wizard
katok-mcp setup
```

The `katok-mcp setup` wizard handles everything:
1. ✅ KakaoTalk account (AES-256-GCM encrypted storage)
2. ✅ Device UUID auto-generation
3. ✅ Phone authentication (one-time passcode)
4. ✅ AI service configuration (Claude / ChatGPT / Cursor)
5. ✅ Message sending permission

**Restart your AI assistant and say:**
> "Show me my KakaoTalk chat list"

#### Manual Installation

```bash
npx @katok-mcp/mcp-server
```

### 3. Authentication

> **Using the setup wizard:** Handled automatically in Step 3.

> **Manual setup:** Set environment variables (`KAKAO_EMAIL`, `KAKAO_PASSWORD`, `KAKAO_ANDROID_DEVICE_UUID`) and run the server.

### 4. Connect Your AI Assistant

**Claude Desktop** (auto-configured by setup wizard):
```json
{
  "mcpServers": {
    "katok": {
      "command": "katok-mcp",
      "args": []
    }
  }
}
```

**OpenClaw / Claude Code:**
```bash
openclaw mcp set katok -- npx -y @katok-mcp/mcp-server
claude mcp add katok -- npx -y @katok-mcp/mcp-server
```

> 📖 **See the [AI Integration Guide](docs/ai-integration.md) for more details.**

---

## 🛡️ Security

| Item | Detail |
|------|--------|
| **Message Sending** | Disabled by default. Set `KAKAO_ALLOW_WRITE=YES` to enable |
| **AI Prefix** | Bot messages automatically get 🤖 prefix (configurable) |
| **Token Storage** | AES-256-GCM encrypted credential storage available via `katok-mcp store-credentials` |
| **Read-Only by Default** | Won't send anything unless you explicitly allow it |
| **Rate Limiting** | Max 3 requests per second (abuse prevention) |
| **Audit Log** | Full detail in dev mode, hashes only in production |

---

## 🏗️ Architecture (Overview)

```
KatokMCP
├── 🧠 MCP Server          ← AI assistant interface
│   ├── kakao_list_chats   ← List chat rooms
│   ├── kakao_read_chat    ← Read messages
│   ├── kakao_send_chat    ← Send messages (opt-in)
│   └── kakao_list_members ← List members
│
└── 🔧 LOCO Engine         ← KakaoTalk protocol implementation
    ├── Auth (Android passcode)
    ├── Encryption (RSA + AES)
    └── Commands (LOGINLIST, SYNCMSG, WRITE, ...)
```

---

## ✅ Compatibility

| AI Service | Status | Notes |
|------------|:------:|-------|
| **Claude Desktop** (Windows/macOS) | ✅ Verified | Auto-configured via setup wizard |
| **OpenClaw** | ✅ Verified | openclaw mcp set katok |
| **Claude Code (CLI)** | ✅ Verified | claude mcp add katok |
| **ChatGPT Desktop** | ❓ Unverified | MCP feature experimental |
| **Cursor / VS Code** | ❓ Unverified | Configurable, untested |
| **ChatGPT Web** | ❌ Not supported | Requires HTTP Transport (planned) |

---

## 📋 Current Status

```
✅ Auth — KakaoTalk login
✅ Chat List — All rooms visible
✅ Read Messages — View conversation history
✅ Send Messages — AI replies (opt-in)
✅ List Members — Who's in a room
✅ Safety — Rate limiting, audit log, AI prefix
✅ Setup Wizard — 1-minute automated setup
✅ Token Caching — No re-authentication needed
✅ Credential Store — AES-256-GCM encrypted, no env vars required
```

---

## 🔮 Roadmap

| Phase | Task | Priority |
|:-----:|------|:--------:|
| **G** | npm publish ✅ | Done |
| **H** | GitHub public + awesome-mcp-servers | 🟡 |
| **I** | HTTP Transport (ChatGPT Web support) | 🟢 |
| **J** | Session Daemon (multi-client, realtime push) | 🟢 |
| **K** | Multi-account, Docker image, chat search | 💡 |

---

## 📄 License

MIT License — free to use, modify, and distribute.

---

## 🙏 Credits

- **[KiwiTalk](https://github.com/KiwiTalk/KiwiTalk)** — Rust-based LOCO implementation. Invaluable for BSON structure analysis
- **[OpenKakao](https://github.com/JungHoonGhae/openkakao-cli)** — LOCO protocol documentation
- **NodeKakao** — Pioneering TypeScript implementation (archived)
