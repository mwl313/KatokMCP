# AI 서비스 연동 가이드

> KakaoMCP MCP 서버를 다양한 AI 비서에 연결하는 방법

---

## Claude Desktop

`claude_desktop_config.json` 파일을 열고 `mcpServers`에 추가:

```json
{
  "mcpServers": {
    "kakao": {
      "command": "node",
      "args": ["C:\\KakaoMCP\\packages\\mcp-server\\dist\\index.js"],
      "env": {
        "KAKAO_EMAIL": "your@email.com",
        "KAKAO_PASSWORD": "your_password",
        "KAKAO_ANDROID_DEVICE_UUID": "0000000000000000000000000000000000000000000000000000000000000001",
        "KAKAO_ALLOW_WRITE": "YES"
      }
    }
  }
}
```

> **파일 위치:** Windows: `%APPDATA%\Claude\claude_desktop_config.json`

---

## Claude Code (CLI)

```bash
claude mcp add kakao -- node /path/to/KakaoMCP/packages/mcp-server/dist/index.js
```

환경변수는 `claude.json` 또는 `.env`에서 설정.

---

## OpenClaw

OpenClaw 설정에서 MCP 서버 추가:

```yaml
mcpServers:
  kakao:
    command: node
    args:
      - /path/to/KakaoMCP/packages/mcp-server/dist/index.js
    env:
      KAKAO_EMAIL: your@email.com
      KAKAO_PASSWORD: your_password
      KAKAO_ANDROID_DEVICE_UUID: "0000...0001"
```

---

## Cursor / VS Code

`.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "kakao": {
      "command": "node",
      "args": ["/path/to/KakaoMCP/packages/mcp-server/dist/index.js"],
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

## 환경변수 설명

| 변수 | 필수 | 설명 |
|------|:----:|------|
| `KAKAO_EMAIL` | ✅ | 카카오 계정 이메일 |
| `KAKAO_PASSWORD` | ✅ | 카카오 계정 비밀번호 |
| `KAKAO_ANDROID_DEVICE_UUID` | ✅ | 64자리 hex (최초 인증 시 사용한 값) |
| `KAKAO_ALLOW_WRITE` | ❌ | `YES` 설정 시 메시지 전송 활성화 |
| `KAKAO_AI_PREFIX` | ❌ | `false` 설정 시 🤖 prefix 제거 |
| `KAKAO_APP_VERSION` | ❌ | 앱 버전 (기본값: 25.9.2) |