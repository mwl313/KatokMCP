# KatokMCP — HTTP Transport 구현 계획 (Phase I)

> **목표:** ChatGPT Web, Claude Web, OpenClaw Web 등 웹챗에서 KatokMCP 사용
> **핵심:** stdio(로컬 프로세스) → HTTP(네트워크 접속) 전환

---

## 1. 현재 vs 목표 아키텍처

### 현재 (stdio)

```
AI 클라이언트 (같은 PC)
  Claude Desktop
  OpenClaw
  └── ▶ katok-mcp (stdio 프로세스)
        └── LOCO 세션 → 카카오톡
```

### 목표 (HTTP)

```
AI 클라이언트 (어디서든)
  ChatGPT Web  ──┐
  Claude Web   ──┤  HTTP/HTTPS
  OpenClaw     ──┤
  다른 PC      ──┘
                    ▶ KatokMCP HTTP Server (TCP:포트)
                         ├── Auth Middleware (API Key)
                         ├── Rate Limiter
                         ├── Session Manager
                         └── LOCO 세션 → 카카오톡
```

---

## 2. 구현 방식: MCP Streamable HTTP

MCP 공식 스펙에서 정의한 **Streamable HTTP Transport** 사용.
기존 stdio 서버를 HTTP로 감싸는 구조.

```
POST /mcp → { method: "tools/list" }      → tools 목록 반환
POST /mcp → { method: "tools/call", ... }  → 명령어 실행
```

---

## 3. 필요한 기술 스택

| 구성 요소 | 기술 | 비고 |
|----------|------|------|
| **HTTP 서버** | **Express.js** | 가장 보편적, MCP 예제 풍부 |
| **MCP HTTP** | `@modelcontextprotocol/sdk` | 공식 SDK에 HTTP Transport 있음 |
| **인증** | **API Key (Bearer Token)** | 단순하고 보편적 |
| **보안** | **HTTPS** | Let's Encrypt + nginx 또는 Caddy |
| **배포** | **Docker** | 설치 간소화 |
| **포트** | **3000번** | 기본값, 변경 가능 |

---

## 4. 구현 단계

### Step 1: HTTP 서버 래퍼 (🔴 필수)

**파일:** `packages/mcp-server/src/http.ts` (신규)

```typescript
import express from "express";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

const app = express();
const mcpServer = new Server({ name: "katok-mcp", version: "0.3.0" }, {
  capabilities: { tools: {}, resources: {} },
});

// MCP Streamable HTTP 엔드포인트
const transport = new StreamableHTTPServerTransport();
app.use("/mcp", (req, res) => transport.handleRequest(req, res));

// Health check
app.get("/health", (req, res) => res.json({ status: "ok" }));

app.listen(3000, () => {
  console.error("KatokMCP HTTP server running on port 3000");
});
```

### Step 2: API Key 인증

```typescript
// 미들웨어
app.use((req, res, next) => {
  const key = req.headers["authorization"]?.replace("Bearer ", "");
  if (key !== process.env.KATOK_API_KEY) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
});
```

`katok-mcp setup` 마법사가 API Key를 자동 생성하고 AES-256-GCM 저장.

### Step 3: Session Manager

```typescript
class SessionManager {
  private client: LocoClient | null = null;

  async getClient(): Promise<LocoClient> {
    if (this.client && this.client.getConnection().isConnected()) {
      return this.client;
    }
    // credential-store fallback으로 인증
    this.client = await ensureClient();
    return this.client;
  }
}
```

### Step 4: Docker 배포

```dockerfile
FROM node:20-alpine
RUN npm install -g @katok-mcp/mcp-server
EXPOSE 3000
CMD ["katok-mcp", "server", "--http", "--port", "3000"]
```

---

## 5. CLI 변경사항

```bash
# HTTP 모드 실행
katok-mcp server --http --port 3000
katok-mcp server --http --port 3000 --api-key mykey

# 설치 마법사에 HTTP 설정 추가
katok-mcp setup → Step 4에 "HTTP 원격 접속" 옵션 추가
```

---

## 6. 보안 설계

| 위협 | 대응 |
|------|------|
| **무단 접속** | API Key (Bearer Token) — `katok-mcp setup` 시 자동 생성 |
| **도청** | HTTPS (Let's Encrypt) 권장, HTTP는 경고 표시 |
| **LOCO 세션 충돌** | Session Manager가 단일 세션 직렬화 |
| **무차별 대입** | Rate Limiter (이미 구현됨) |

---

## 7. Cline 작업 범위

| 파일 | 작업 | 난이도 |
|------|------|:------:|
| `packages/mcp-server/src/http.ts` | **신규** — Express + MCP HTTP | 중 |
| `packages/mcp-server/src/cli.ts` | `katok-mcp server --http` 옵션 추가 | 하 |
| `packages/mcp-server/package.json` | express 의존성 추가 | 하 |
| `packages/mcp-server/Dockerfile` | **신규** — Docker 이미지 | 하 |
| `README.md` | HTTP 접속 가이드 추가 | 하 |

---

## 8. 이후 확장 (Phase J)

HTTP Transport 이후 Session Daemon(Phase J)으로 발전:
```
Phase I: HTTP Transport (단일 세션, 웹챗 지원)
    ↓
Phase J: Session Daemon (멀티 클라이언트, 재연결, 실시간 Push)
    ↓
Phase K: Docker + 원격 배포
```

---

> 작성: 2026-06-23 22:27
> 브랜치: (향후 생성)
> 관련 Phase: I (로드맵)
