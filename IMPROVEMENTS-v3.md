# 🔧 KakaoMCP — 개선 가이드 v3

> **대상:** Cline (DeepSeek Flash)
> **기준:** `main` (commit `0c792e1`)
> **제외:** npm publish, 데모 영상, CI/CD
> **우선순위:** 🔴 긴급 → 🟡 권장 → 🟢 여유

---

## 작업 순서 (권장)

```
1️⃣ StreamReader 이벤트 기반 개선 (🔴)
2️⃣ STATUS.md 갱신 (🟡)
3️⃣ keepAlive 실패 시 재연결 로직 (🟢)
4️⃣ credential-store.ts resolve() 중복 경로 정리 (🟢)
```

---

## 🔴 긴급 — StreamReader 리팩토링

### StreamReader: Polling → Event 기반

**파일:** `packages/loco-engine/src/connection.ts`, `packages/loco-engine/src/stream.ts`

**현재 문제:**
- `StreamReader`가 1초마다 `readPushBuffer()`를 폴링 → push 도착 후 최대 1초 지연
- 새 메시지 실시간 감지 불가능 (MSG, KICKOUT, CHANGESVR)
- Polling 루프가 `setInterval`을 `setTimeout`으로 매번 재생성 (비효율적)

**해결: `connection.ts`에 push 콜백 등록 메서드 추가 + `stream.ts`를 이벤트 기반으로 전환**

### 1. connection.ts — `onPushData()` 추가

```typescript
// connection.ts — LocoConnection 클래스 내부
export class LocoConnection {
  // ...기존 필드...

  private pushCallbacks: Array<(frames: Buffer[]) => void> = [];

  /** Register a callback that fires immediately when push frames arrive */
  onPushData(callback: (frames: Buffer[]) => void): void {
    this.pushCallbacks.push(callback);
  }

  /** Handle incoming data — route to response resolver or push buffer */
  private onData(chunk: Buffer): void {
    if (this.responseResolver) {
      this.responseBuffer = Buffer.concat([this.responseBuffer, chunk]);
      this.tryResolveResponse();
    } else {
      this.pushBuffer.push(chunk);
      // 🔥 즉시 완전한 프레임 추출 → 콜백 호출
      const frames = this.readPushBuffer();
      if (frames.length > 0) {
        for (const cb of this.pushCallbacks) {
          try { cb(frames); } catch { /* ignore */ }
        }
      }
    }
  }
}
```

⚠️ **주의:** 위 코드에서 `onData()`가 `this.readPushBuffer()`를 호출하면 기존의 `pushBuffer`를 비우게 되는데, 이때 `StreamReader`가 polling으로 같은 데이터를 중복 읽지 않도록 해야 함. 아래 `stream.ts`와 함께 적용해야 정상 동작함.

### 2. stream.ts — Event 기반으로 전면 개선

```typescript
// stream.ts — 전체 교체
export class StreamReader {
  private conn: LocoConnection;
  private running = false;
  private callbacks: StreamCallback[] = [];

  constructor(conn: LocoConnection) {
    this.conn = conn;
  }

  onEvent(callback: StreamCallback): void {
    this.callbacks.push(callback);
  }

  offEvent(callback: StreamCallback): void {
    this.callbacks = this.callbacks.filter((cb) => cb !== callback);
  }

  /** Start listening — registers event-driven callback on connection */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.conn.onPushData((frames: Buffer[]) => {
      if (!this.running) return;
      for (const frame of frames) {
        const plaintext = this.decryptFrame(frame);
        if (!plaintext) continue;
        const event = this.parsePacket(plaintext);
        if (event) {
          for (const cb of this.callbacks) {
            try { cb(event); } catch { /* ignore */ }
          }
        }
      }
    });
  }

  stop(): void {
    this.running = false;
  }

  /** Decrypt a push frame (push data is already just the encrypted frame payload) */
  private decryptFrame(frame: Buffer): Buffer | null {
    try {
      // readPushBuffer()에서 반환된 frame은 이미 raw encrypted frame
      // → 연결의 sessionKey로 복호화
      return decryptLocoFrame(frame, this.conn.getSessionKey());
    } catch {
      return null;
    }
  }

  // parsePacket(), parseCommand(), toBigInt() — 기존 코드 그대로 유지
}
```

**⚠️ 주의사항:**
- 위 코드에서 `readPushBuffer()`는 `connection.ts`의 기존 메서드로, **이미 복호화까지 완료된 `Buffer[]`를 반환**함. 따라서 `stream.ts`의 새 `start()`에서는 `decryptFrame()`이 불필요할 수 있음. 실제 구현 시 `readPushBuffer()`의 반환값이 이미 복호화된 plaintext인지, raw encrypted frame인지 확인해야 함.

### 변경 요약

| 변경 전 | 변경 후 |
|---------|---------|
| `start(pollMs)` — polling 시작 | `start()` — 이벤트 리스너 등록 |
| 1초마다 `readPushBuffer()` 호출 | push 도착 시 **즉시** 콜백 실행 |
| `pollLoop()` 무한 루프 | 없음 (이벤트 구동) |
| 최대 1,000ms 지연 | **0ms 지연** |

---

## 🟡 권장

### 3. STATUS.md 갱신

**파일:** `STATUS.md`

**누락된 커밋:**
- `e6e3ac7` — IMPROVEMENTS-v2 전 항목 적용
- `0c792e1` — fix: assets/public-key.pem 추가

**작업:** STATUS.md 하단 git 히스토리 표와 IMPROVEMENTS-v2 항목 현황 업데이트.

---

## 🟢 여유

### 4. PING Keep-Alive 실패 시 처리

**파일:** `packages/loco-engine/src/session.ts`

**현재:**
```typescript
this.pingInterval = setInterval(() => {
  sendPing(this).catch(() => { /* ignore ping failures */ });
}, intervalMs);
```

**문제:** PING이 연속으로 실패하면 연결이 끊긴 건데도 계속 무시됨.

**개선 방향:**
```typescript
private pingFailCount = 0;

this.pingInterval = setInterval(async () => {
  try {
    await sendPing(this);
    this.pingFailCount = 0;
  } catch {
    this.pingFailCount++;
    if (this.pingFailCount >= 3) {
      // 3회 연속 실패 → 연결 재수립 필요 신호
      this.emit("connection_lost");
    }
  }
}, intervalMs);
```

**참고:** 위 코드는 EventEmitter 패턴을 가정. 실제 구현은 MCP 서버에 재연결 트리거를 보내는 방식으로.

---

### 5. credential-store.ts resolve() 중복 경로

**파일:** `packages/mcp-server/src/credential-store.ts`

**문제:** `resolve()` 메서드가 환경변수 → 암호화 저장소 순서로 읽는 건 좋음. 하지만 `storeCredentialsInteractive()`도 같은 우선순위 로직을 중복 구현하고 있음.

**개선 방향:** `storeCredentialsInteractive()` 내부에서 `store.resolve()`를 재사용.

---

## ⚠️ 참고: 이번 작업에서 주의할 점

1. **`stream.ts`의 `parsePacket()`은 그대로 재사용** — 이벤트 타입, 파싱 로직은 변경 불필요
2. **`connection.ts`의 `readPushBuffer()`와 `onData()`가 충돌하지 않도록** — 이벤트 콜백이 push 데이터를 소비하면 polling 시 중복되지 않아야 함. 즉, **이벤트 기반으로 전환하면 polling 루프는 제거**
3. **TCP 프레임 경계 처리** — `onData()`는 chunk 단위로 도착하므로, push 데이터도 `readPushBuffer()`의 프레임 추출 로직을 통해 완전한 프레임만 콜백에 전달해야 함

---

> 마지막 업데이트: 2026-06-23 08:53
> 작성: 아리아 (Haven v0.5)
> 기반: v1→v2 리뷰 + stream.ts 이벤트 기반 개선 제안
