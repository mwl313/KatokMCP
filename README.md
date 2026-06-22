# KakaoMCP 🤖✉️

> **카카오톡을 AI 비서가 직접 제어할 수 있게 해주는 MCP 서버**

[![Status](https://img.shields.io/badge/Phase-B%20(LOCO%20Engine)-brightgreen)](PLAN.md)
[![License](https://img.shields.io/badge/License-MIT-blue)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6)](https://www.typescriptlang.org/)
[![Node](https://img.shields.io/badge/Node.js-18%2B-339933)](https://nodejs.org/)

---

## 🌟 What is KakaoMCP?

**KakaoMCP** implements the **LOCO protocol** — KakaoTalk's proprietary messaging protocol — to create an **MCP (Model Context Protocol) server** that allows AI agents (Claude, ChatGPT, OpenClaw, etc.) to:

- 📋 **Read your chat room list** — "Show me unread messages"
- 📖 **Read messages from specific chats** — "What did my family chat about today?"
- ✉️ **Send messages** (v0.2, opt-in for safety)

All without requiring a phone or the KakaoTalk desktop app running.

---

## ✨ Features

### Current (v0.1 — Feasibility Verified ✅)
| Feature | Status |
|---------|:------:|
| GETCONF — Server config fetch | ✅ |
| CHECKIN — RSA+AES handshake + LOCO server assignment | ✅ |
| LOGINLIST — Authentication + session establishment | ✅ |
| AES-128-CFB secure frame encryption | ✅ |
| LCHATLIST — Paginated chat room list | ✅ |
| SYNCMSG — Message history fetch | ✅ |
| PING — Keep-alive connection | ✅ |
| Session management with retry | ✅ |

### Planned (v0.2+)
- Message send (WRITE) — opt-in
- Friend list / profile
- Message delete (DELETEMSG)
- Real-time push notifications (v0.3)
- npm package distribution (v0.4)

---

## 🏗️ Architecture

```
┌──────────────────────────────────┐
│         kakao-mcp-server          │
│  ┌────────────────────────────┐   │
│  │   MCP Interface (Stdio)    │   │  ← Phase D
│  │   ├── kakao_list_chats     │   │
│  │   └── kakao_read_chat      │   │
│  └────────────────────────────┘   │
│  ┌────────────────────────────┐   │
│  │    LOCO Engine              │   │  ← Phase B ✅
│  │   ├── Protocol Layer        │   │
│  │   ├── Crypto Layer          │   │
│  │   ├── Transport Layer       │   │
│  │   ├── Auth Module           │   │
│  │   └── Command Module        │   │
│  └────────────────────────────┘   │
└──────────────────────────────────┘
```

### 3-Stage Connection Flow
```
Stage 1: BOOKING
  → booking-loco.kakao.com:443 (TLS)
  → GETCONF → server list

Stage 2: CHECKIN  
  → ticket-loco.kakao.com:995 (TCP)
  → 268-byte RSA handshake → AES-128-CFB session key
  → CHECKIN → LOCO server IP/port

Stage 3: LOGIN
  → LOCO Server (AES encrypted)
  → LOGINLIST → session + chat room list
```

---

## 📦 Project Structure

```
kakao-mcp/
├── README.md
├── PLAN.md                 ← Implementation plan
├── PROTOCOL_VERIFIED.md    ← Verified protocol spec
├── STATUS.md               ← Progress tracking
├── TASKS.md                ← Work instructions
├── poc/                    ← Phase A experiments
│   ├── 01-booking/         ← GETCONF
│   ├── 02-checkin/         ← RSA+AES handshake
│   ├── 03-loginlist/       ← Auth + chat rooms
│   └── fixtures/           ← Golden packets
├── packages/
│   └── loco-engine/        ← LOCO Protocol Engine ✅
│       └── src/
│           ├── protocol/header.ts
│           ├── crypto/aes.ts
│           ├── crypto/handshake.ts
│           ├── transport/socket.ts
│           ├── auth/ (windows, android, types)
│           ├── session.ts
│           ├── commands.ts
│           └── error.ts
└── docs/                   ← Documentation (WIP)
```

---

## 🔬 Protocol Summary

| Detail | Value | Status |
|--------|-------|:------:|
| Packet Format | 22-byte header + BSON body | 🟢 |
| Key Exchange | RSA-2048 OAEP SHA-1 | 🟢 |
| Data Encryption | AES-128-CFB (No Padding) | 🟢 |
| RSA Public Exponent | **e=3** | 🟢 |
| Auth Method | Android passcode approval | 🟢 |
| LOCO Server Ports | 995 (main) / 9002 (CS) | 🟢 |
| LOGINLIST Token Field | **oauthToken** (not `token`) | 🟢 |

> **Full spec:** [PROTOCOL_VERIFIED.md](PROTOCOL_VERIFIED.md)

---

## 🚀 Getting Started (for Developers)

### Prerequisites
- Node.js >= 18 LTS
- npm

### Setup
```bash
# Install engine dependencies
cd packages/loco-engine
npm install
npm run typecheck  # Verify type correctness
```

### Authentication
The project uses **Android passcode approval** for Kakao Account authentication:
1. Set environment variables:
   ```bash
   export KAKAO_EMAIL="your@email.com"
   export KAKAO_PASSWORD="your_password"
   export KAKAO_ANDROID_DEVICE_UUID="64char_hex_string"
   ```
2. Run the auth flow (the first time only, to register your device):
   ```bash
   cd poc/03-loginlist
   npm run auth-android-register
   ```
3. Enter the displayed passcode in the KakaoTalk app on your phone.

---

## 🛡️ Security & Privacy

- **No token persistence** — All tokens stay in memory only
- **Console masking** — Tokens/passwords are shown as `***`
- **Read-only by default** (v0.1) — Message sending requires explicit opt-in
- **Rate limiting** — Planned for v0.2
- **Audit log** — Full text in dev mode, hashes only in production
- **.env files excluded** — Added to `.gitignore`

---

## 📄 License

MIT License — see [LICENSE](LICENSE) (license file will be added before v0.1 release).

---

## 🙏 Credits

- **KiwiTalk** — Rust LOCO implementation that guided BSON structure verification
- **OpenKakao** — Protocol documentation reference
- **NodeKakao** — Pioneering TypeScript implementation (archived)

---

> ⚠️ **Disclaimer:** This project is for **educational and research purposes**. It is not affiliated with or endorsed by Kakao Corp. Use at your own risk.