<!-- default lang: ko -->
<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://img.shields.io/badge/KakaoMCP-FFCD00?style=for-the-badge&logo=kakao&logoColor=000000">
    <img src="https://img.shields.io/badge/KakaoMCP-FFCD00?style=for-the-badge&logo=kakao&logoColor=000000" alt="KakaoMCP" height="40">
  </picture>
</p>

<h1 align="center">KakaoMCP — AI로 카카오톡 제어하기 🤖✉️</h1>

<p align="center">
  <strong>AI 비서(Claude, ChatGPT 등)가 카카오톡을 읽고, 답장하고, 관리할 수 있게 해주는 오픈소스 MCP 서버</strong>
</p>

<p align="center">
  <a href="#-한국어"><img src="https://img.shields.io/badge/🇰🇷-한국어-FFCD00?style=flat-square&logo=kakao&logoColor=000000" alt="한국어" height="28"></a>
  <a href="#-english"><img src="https://img.shields.io/badge/🇺🇸-English-3178C6?style=flat-square&logo=typescript&logoColor=white" height="28"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-green?style=flat-square" alt="MIT License" height="28"></a>
  <a href="https://github.com/mwl313/KakaoMCP"><img src="https://img.shields.io/github/last-commit/mwl313/KakaoMCP?style=flat-square" alt="Last Commit" height="28"></a>
</p>

---

<br>

# 🇰🇷 한국어

> **이 프로젝트는 카카오톡의 비공개 프로토콜(LOCO)을 분석하여 구현한 결과물입니다. 연구 및 교육 목적으로만 사용해 주세요.**

---

## 🤷 이게 뭐예요?

**KakaoMCP**를 사용하면 여러분의 AI 비서가 **카카오톡을 직접 다룰 수 있게 됩니다.**

- 📋 **"읽지 않은 메시지가 있는 채팅방 알려줘"** → AI가 채팅방 목록을 확인
- 📖 **"가족 단톡방에서 오늘 무슨 얘기했어?"** → AI가 메시지를 읽어줌
- ✉️ **"엄마한테 저녁 7시에 도착한다고 보내줘"** → AI가 메시지를 대신 전송
- 👥 **"이 방에 누가 있어?"** → AI가 채팅방 멤버를 알려줌

MCP(Model Context Protocol)는 AI 모델이 외부 도구와 소통하기 위한 국제 표준입니다. Claude, ChatGPT, Gemini, OpenClaw 등 **모든 주요 AI 서비스**와 호환됩니다.

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
- **안드로이드 폰** (최초 1회 인증용, 이후에는 불필요)

### 2. 설치

```bash
# 저장소 다운로드
git clone https://github.com/mwl313/KakaoMCP.git
cd KakaoMCP

# 패키지 설치
cd packages/loco-engine && npm install && npm run build
cd ../mcp-server && npm install
cd ../..
```

### 3. 인증 (최초 1회)

> 카카오톡 보안 정책상, 새로운 기기에서 로그인하려면 휴대폰 인증이 필요합니다.

**① 환경변수 설정**
```bash
set KAKAO_EMAIL=your@email.com
set KAKAO_PASSWORD=your_password
set KAKAO_ANDROID_DEVICE_UUID=0000...0001  # 아무 64자리 hex
set KAKAO_CONFIRM_ANDROID_REGISTRATION=YES
```

**② 인증 실행**
```bash
cd poc/03-loginlist
npm run auth-android-register
```

**③ passcode 입력 (1회, 60초 내)**
```
Enter this one-time code in the KakaoTalk app: 9418 (58s)
```
→ 휴대폰 카카오톡 앱을 열고 표시된 번호를 입력하세요.

**④ 완료!** 이후에는 자동 로그인됩니다.

### 4. MCP 서버 실행

```bash
cd packages/mcp-server
set KAKAO_EMAIL=your@email.com
set KAKAO_PASSWORD=your_password  
set KAKAO_ANDROID_DEVICE_UUID=0000...0001
npm run dev
```

### 5. AI 비서와 연결

**Claude Desktop** (`claude_desktop_config.json`):
```json
{
  "mcpServers": {
    "kakao": {
      "command": "node",
      "args": ["C:\\path\\to\\KakaoMCP\\packages\\mcp-server\\dist\\index.js"],
      "env": {
        "KAKAO_EMAIL": "your@email.com",
        "KAKAO_PASSWORD": "your_password",
        "KAKAO_ANDROID_DEVICE_UUID": "0000...0001"
      }
    }
  }
}
```

**OpenClaw / Claude Code:**
```bash
claude mcp add kakao -- node C:\path\to\KakaoMCP\packages\mcp-server\dist\index.js
```

> 📖 **자세한 설정법은 [AI 서비스 연동 가이드](docs/ai-integration.md)를 참고하세요.** (준비 중)

---

## 🛡️ 보안 안내

| 항목 | 내용 |
|------|------|
| **메시지 전송** | 처음에는 비활성화되어 있음. `KAKAO_ALLOW_WRITE=YES` 설정해야 전송 가능 |
| **AI 표식** | AI가 보낸 메시지에는 자동으로 🤖 이모지가 붙음 (비활성화 가능) |
| **토큰 저장** | 비밀번호를 안전하게 저장하려면 `kakao-mcp store-credentials` 명령어 사용 (AES-256-GCM 암호화) |
| **읽기 전용 기본값** | 메시지를 보내지 않고 읽기만 함 |
| **속도 제한** | 초당 3회로 요청 제한 (남용 방지) |
| **감사 로그** | 모든 명령어 실행 내역 기록 (dev 모드: 전체, prod 모드: 해시만) |

---

## 🏗️ 기술 구조 (간략)

```
카카오MCP
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

기술적으로 궁금한 점은 [PLAN.md](PLAN.md)와 [PROTOCOL_VERIFIED.md](PROTOCOL_VERIFIED.md)를 참고하세요.

---

## 📋 현재 상태

```
✅ 인증 — 카카오톡 로그인
✅ 채팅방 목록 — 모든 방 확인
✅ 메시지 읽기 — 대화 내용 확인
✅ 메시지 전송 — AI가 답장 (opt-in)
✅ 멤버 조회 — 방에 있는 사람 확인
✅ 안전장치 — 속도 제한, 감사 로그, AI 표식
```

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

**KakaoMCP** is an open-source server that lets your AI assistant (Claude, ChatGPT, etc.) control KakaoTalk — Korea's #1 messaging app.

- 📋 **"Show me chats with unread messages"** → AI lists your chat rooms
- 📖 **"What did my family chat about today?"** → AI reads the messages
- ✉️ **"Tell mom I'll be there at 7"** → AI sends the message for you
- 👥 **"Who's in this chat room?"** → AI shows the members

It uses the **MCP (Model Context Protocol)**, an open standard supported by all major AI services: Claude, ChatGPT, Gemini, OpenClaw, and more.

---

## ✨ Features

| Feature | Description |
|---------|-------------|
| **List Chats** | All chat rooms with unread counts, members, last message |
| **Read Messages** | Recent messages from any chat room |
| **Send Messages** 🤖 | AI replies on your behalf (opt-in, auto 🤖 prefix) |
| **List Members** | Who's in the chat room |

---

## 🚀 Quick Start

### Prerequisites
- **Node.js 18+**
- **KakaoTalk account** (email + password)
- **Android phone** (for one-time authentication)

### Setup

```bash
git clone https://github.com/mwl313/KakaoMCP.git
cd KakaoMCP

# Install dependencies
cd packages/loco-engine && npm install && npm run build
cd ../mcp-server && npm install
cd ../..
```

### One-time Authentication

```bash
set KAKAO_EMAIL=your@email.com
set KAKAO_PASSWORD=your_password
set KAKAO_ANDROID_DEVICE_UUID=0000...0001
set KAKAO_CONFIRM_ANDROID_REGISTRATION=YES
cd poc/03-loginlist
npm run auth-android-register
# → Enter the passcode in the KakaoTalk app on your phone
```

### Run the MCP Server

```bash
cd packages/mcp-server
set KAKAO_EMAIL=your@email.com
set KAKAO_PASSWORD=your_password
set KAKAO_ANDROID_DEVICE_UUID=0000...0001
npm run dev
```

### Connect to Claude Desktop

Add to your `claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "kakao": {
      "command": "node",
      "args": ["C:\\path\\to\\KakaoMCP\\packages\\mcp-server\\dist\\index.js"],
      "env": {
        "KAKAO_EMAIL": "your@email.com",
        "KAKAO_PASSWORD": "your_password",
        "KAKAO_ANDROID_DEVICE_UUID": "0000...0001"
      }
    }
  }
}
```

---

## 🛡️ Security

| Feature | Detail |
|---------|--------|
| **Message Sending** | Disabled by default. Set `KAKAO_ALLOW_WRITE=YES` to enable |
| **AI Prefix** | Bot messages automatically get 🤖 prefix (configurable) |
| **Token Safety** | AES-256-GCM encrypted credential storage available |
| **Read-Only by Default** | Won't send anything unless you explicitly allow it |
| **Rate Limiting** | Max 3 requests/second |
| **Audit Log** | Full detail in dev mode, hashes only in production |

---

## 📄 License

MIT License — free to use, modify, and distribute.