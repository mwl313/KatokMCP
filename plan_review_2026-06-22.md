# 카카오MCP 구현 계획 리뷰

> 리뷰 대상: `PLAN.md` (Implementation Plan v4)  
> 리뷰 일자: 2026-06-22

---

## 1. 총평

현재 문서는 단순한 아이디어 메모가 아니라, 다음 요소를 모두 포함한 **구현 계획서 수준의 설계 문서**다.

- LOCO 연결 구조
- 패킷·암호화·BSON 계층
- 인증 및 세션 생명주기
- MCP Tools·Resources·Notifications 설계
- Read-only 기본값과 쓰기 기능 안전장치
- 모노레포 패키지 구조
- 단계별 구현 및 배포 계획
- OpenClaw·Claude·ChatGPT 등 AI 서비스 연동 계획

프로젝트의 핵심 방향인 **“TypeScript로 현행 LOCO 프로토콜을 직접 구현하고, 이를 MCP 서버로 감싸 여러 AI 에이전트에서 카카오톡을 제어한다”**는 목표가 명확하다.

다만 현재 문서는 다음 두 종류의 정보가 일부 섞여 있다.

1. 실제 구현체와 패킷 캡처를 통해 검증된 사실
2. 외부 문서와 오픈소스 코드에 기반한 구현 가설

따라서 바로 전체 구현에 착수하기보다는, 먼저 **인증 → LOGINLIST → 채팅방 목록 조회**까지의 최소 PoC를 성공시키고 이후 범위를 확장하는 것이 가장 안전하다.

---

## 2. 잘 설계된 부분

### 2.1 LOCO Engine과 MCP Server의 분리

`loco-engine`과 `mcp-server`를 별도 패키지로 분리한 것은 적절한 선택이다.

이 구조의 장점은 다음과 같다.

- LOCO 프로토콜이 변경되어도 MCP 인터페이스를 최대한 유지 가능
- LOCO 엔진을 CLI, 데스크톱 앱, 테스트 도구 등에서 재사용 가능
- 프로토콜 디버깅과 MCP 도구 구현을 독립적으로 진행 가능
- 테스트 범위를 계층별로 분리 가능

따라서 현재의 모노레포 방향은 유지하는 것이 좋다.

### 2.2 Safety Layer를 초기 설계에 포함

다음 안전장치를 초기 설계부터 포함한 점은 좋다.

- Read-only 기본 활성화
- Write 기능 명시적 opt-in
- 전송 속도 제한
- 동일 채팅방 및 수신자별 제한
- 감사 로그
- 메시지 전송 표시

카카오톡의 비공식 프로토콜을 사용하는 프로젝트인 만큼, 기능 확장보다 계정 보호를 우선하는 설계가 필요하다.

### 2.3 Phase 0을 별도 리서치 단계로 둔 점

프로토콜 구현 전 다음 항목을 검증하도록 한 것은 적절하다.

- OpenKakao 문서 분석
- KiwiTalk 구현 분석
- BSON 스키마 확인
- 실제 패킷 캡처
- 인증 방식 결정
- RSA 공개키 추출 방식 확인

다만 Phase 0의 목표는 단순 문서 작성이 아니라, **최소 연결 가능성을 검증하는 실행 가능한 PoC**여야 한다.

---

## 3. 가장 큰 리스크: 인증

이 프로젝트의 최대 난관은 LOCO 패킷 인코딩보다 **카카오 계정 인증과 기기 인증**일 가능성이 높다.

현재 문서에서는 다음 흐름을 주요 인증 경로로 가정하고 있다.

```text
email + password
→ Kakao Account Auth API
→ Access Token / Refresh Token
→ LOGINLIST
→ LOCO Session
```

그러나 실제 환경에서는 다음 요소가 개입할 수 있다.

- 추가 기기 인증
- 2단계 인증
- CAPTCHA 또는 이상 로그인 탐지
- PC 카카오톡 전용 디바이스 식별 정보
- 내부 헤더 및 버전 검증
- 웹 로그인과 PC 클라이언트 인증 방식의 차이
- Refresh Token의 기기 또는 세션 종속성

따라서 인증 성공 여부를 확인하기 전에 전체 LOCO 엔진과 MCP 계층을 구현하면, 인증 단계에서 프로젝트가 막혔을 때 상당한 작업이 무용지물이 될 수 있다.

---

## 4. 권장 구현 순서 변경

현재의 큰 Phase 구분은 유지하되, 실제 개발 우선순위는 다음처럼 변경하는 것이 좋다.

```text
1. 인증 PoC
2. Booking GETCONF 성공
3. Checkin 및 암호화 핸드셰이크 성공
4. LOGINLIST 성공
5. LCHATLIST 또는 초기 채팅방 목록 수신
6. 특정 채팅방 Read-only 메시지 동기화
7. 장기 세션 유지 및 재연결
8. MCP Read-only Tools 래핑
9. 별도 테스트 계정에서 WRITE 검증
10. Write Tools 및 Safety Layer 적용
```

### 최소 성공 기준

첫 번째 마일스톤은 다음 조건을 만족하는 것이 좋다.

- 별도 테스트 계정 사용
- 인증 성공
- LOCO 서버 접속 성공
- LOGINLIST 성공
- 채팅방 목록 조회 성공
- 메시지 전송 기능 없음
- 로그에서 토큰과 비밀번호 자동 마스킹

이 단계가 성공한 이후 MCP 서버와 쓰기 기능을 구현해야 한다.

---

## 5. 검증 상태를 구분해야 하는 항목

현재 문서에는 일부 항목이 확정된 명세처럼 표현되어 있다. 그러나 실제 구현과 패킷 캡처로 확인되기 전까지는 검증 수준을 구분하는 것이 좋다.

### 권장 검증 상태 표기

```text
✅ Confirmed by packet capture
🟡 Confirmed in a current open-source implementation
🔵 Confirmed only in external documentation
⚠️ Unverified working hypothesis
❌ Legacy protocol only
```

### 우선 재검증이 필요한 내용

- AES-128-GCM 암호화 프레임의 정확한 바이트 구조
- RSA 공개키 크기와 지수
- OAEP 해시 및 라벨 사용 여부
- `key_encrypt_type = 16`
- `encrypt_type = 3`
- 268바이트 핸드셰이크 구조
- 22바이트 LOCO 헤더 구조
- `body_type` 필드의 실제 의미
- 각 Method의 정확한 BSON 필드명과 타입
- `LOGINLIST`, `CHECKIN`, `SYNCMSG`, `WRITE` 요청 스키마
- PING 주기와 타임아웃 조건
- CHANGESVR 이후 재연결 시작 단계
- KICKOUT 이후 재인증 가능 여부
- 문서에 기록된 에러 코드와 실제 서버 응답
- `REWRITE`, `DELETEMSG`, Reaction 기능의 현행 지원 여부
- email+password 로그인과 Refresh Token 획득 가능 여부

### 권장 문서 구조

각 프로토콜 항목에 다음 메타데이터를 추가하면 좋다.

```markdown
- 검증 상태: 🟡 Open-source implementation
- 확인 기준일: 2026-06-22
- 확인 대상 버전: KakaoTalk PC x.x.x
- 출처: KiwiTalk commit / OpenKakao docs / packet capture
- 마지막 실계정 검증: 미실시
```

---

## 6. 권장 아키텍처 변경: Session Daemon 분리

현재 구조는 MCP 서버 프로세스가 카카오 세션까지 직접 관리하는 형태다.

장기적으로는 다음과 같이 카카오 세션 프로세스를 분리하는 편이 더 안정적이다.

```text
┌─────────────────────────────┐
│ Kakao Session Daemon        │
│                             │
│ - Authentication            │
│ - LOCO TCP Session          │
│ - PING / Reconnect          │
│ - Token Refresh             │
│ - Local Cache               │
│ - Event Queue               │
└──────────────┬──────────────┘
               │ Local IPC
               │ Unix Socket / Named Pipe / localhost
┌──────────────▼──────────────┐
│ MCP Server                  │
│                             │
│ - Tools                     │
│ - Resources                 │
│ - Notifications             │
│ - Permission Policy         │
└──────────────┬──────────────┘
               │ stdio / HTTP
┌──────────────▼──────────────┐
│ OpenClaw / Claude / Client  │
└─────────────────────────────┘
```

### 장점

- MCP 클라이언트 재시작 시에도 카카오 세션 유지
- 여러 MCP 클라이언트가 하나의 세션을 공유 가능
- 계정 비밀번호와 토큰을 MCP 프로세스에 직접 노출하지 않음
- PING, CHANGESVR, KICKOUT 처리를 독립적으로 수행
- 장기 연결 안정성 테스트가 쉬워짐
- 향후 CLI 또는 GUI 클라이언트 연결 가능

### 크로스 플랫폼 IPC 후보

| 방식 | 장점 | 단점 |
|---|---|---|
| localhost HTTP | 구현과 디버깅이 쉬움 | 포트 노출 및 인증 필요 |
| WebSocket | 이벤트 Push에 적합 | 연결 관리 필요 |
| Unix Socket / Named Pipe | 로컬 격리 우수 | OS별 구현 차이 |
| Node IPC | 단순함 | 프로세스 구조가 Node에 종속 |

초기에는 localhost + 랜덤 인증 토큰으로 시작하고, 안정화 이후 Unix Socket 또는 Named Pipe를 검토하는 것이 현실적이다.

---

## 7. Write 기능의 안전 정책 개선

### 7.1 AI Prefix 강제 정책

모든 메시지에 `🤖` Prefix를 강제로 붙이는 방식은 안전성은 높지만, 실제 개인 비서 사용성은 낮출 수 있다.

다음처럼 위험도 기반으로 구분하는 것이 더 현실적이다.

| 전송 유형 | 권장 정책 |
|---|---|
| 사용자가 수신자와 문구를 직접 지정 | Prefix 선택 가능 |
| AI가 대화 내용을 판단해 자동 응답 | Prefix 강제 |
| 예약·반복·대량 전송 | Prefix 강제 |
| 여러 수신자에게 같은 문구 전송 | 추가 확인 + Prefix 강제 |
| 삭제·수정 등 파괴적 작업 | 사용자 확인 필수 |

### 7.2 사용자 확인이 필요한 작업

다음 작업은 환경변수 opt-in만으로는 부족할 수 있다.

- 새로운 수신자에게 첫 메시지 전송
- 여러 채팅방에 동시 전송
- 메시지 삭제
- 메시지 수정
- 초대 또는 채팅방 관리
- 미디어 및 파일 전송
- 자동 응답 규칙 등록

MCP Tool의 결과를 바로 실행하는 대신, 다음처럼 2단계 도구로 분리할 수 있다.

```text
kakao_prepare_message
→ 전송 대상과 최종 문구를 반환

kakao_confirm_send
→ 사용자의 명시적 승인 이후 실제 전송
```

단, 사용자가 수신자와 전송 문구를 정확히 직접 지정한 단일 메시지는 한 단계 실행을 허용할 수 있다.

---

## 8. Credential Store 보강

환경변수에 이메일과 비밀번호를 직접 넣는 예시는 개발 초기에는 편하지만, 배포 문서의 기본 예시로 사용하기에는 위험하다.

### 권장 우선순위

1. OS Keychain 사용
   - macOS Keychain
   - Windows Credential Manager
   - Linux Secret Service
2. 암호화된 로컬 Credential Store
3. 일회성 인터랙티브 입력
4. 환경변수는 CI 및 개발 환경의 보조 수단

### 추가 원칙

- 비밀번호를 설정 파일에 저장하지 않음
- 로그에 Token, Password, Session Key를 출력하지 않음
- 예외 객체와 디버그 덤프에서도 자동 마스킹
- 감사 로그에는 메시지 전문 대신 해시 또는 일부 마스킹 옵션 제공
- MCP 클라이언트에 인증정보를 반환하지 않음

---

## 9. Audit Log 정책 재검토

현재 문서에서는 모든 쓰기 작업의 채팅방, 수신자, 내용을 로컬 로그에 저장하도록 되어 있다.

이는 추적성에는 도움이 되지만, 대화 내용 전체를 장기간 보관하면 별도의 개인정보 유출 위험이 생긴다.

### 권장 기본 로그 포맷

```json
{
  "timestamp": "2026-06-22T13:00:00+09:00",
  "operation": "send_message",
  "chat_id_hash": "sha256:...",
  "recipient_count": 1,
  "message_length": 24,
  "message_hash": "sha256:...",
  "result": "success",
  "request_source": "openclaw"
}
```

메시지 전문 저장은 별도의 명시적 디버그 옵션에서만 허용하는 편이 안전하다.

또한 로그는 다음 조건을 만족해야 한다.

- Append-only
- 자동 보존 기간 설정
- 최대 파일 크기 제한
- Token 및 비밀번호 마스킹
- AI Tool을 통한 로그 수정·삭제 차단

---

## 10. MCP 인터페이스 개선 제안

### 10.1 ID 타입

`chatId`, `logId`, `userId`는 JavaScript의 안전한 정수 범위를 초과할 수 있으므로 MCP 경계에서는 문자열로 유지하는 것이 좋다.

```typescript
chatId: string
logId: string
userId: string
```

LOCO BSON 직렬화 단계에서만 `Long` 타입으로 변환해야 한다.

### 10.2 Tool 결과 표준화

각 Tool이 제각기 다른 결과를 반환하지 않도록 공통 Envelope를 정의하는 것이 좋다.

```typescript
interface KakaoToolResult<T> {
  ok: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    retryable: boolean;
  };
  meta: {
    source: "network" | "cache";
    fetchedAt: string;
  };
}
```

### 10.3 Cursor 설계

`before?: number`보다는 플랫폼 독립적인 opaque cursor를 사용하는 것이 안전하다.

```typescript
{
  chatId: string,
  limit?: number,
  cursor?: string
}
```

내부적으로는 logId, timestamp, 서버 token 등을 조합해 처리할 수 있다.

### 10.4 캐시 데이터의 최신성 표시

장기 연결이 끊어졌을 때 로컬 캐시를 반환한다면, 결과에 데이터 최신성을 표시해야 한다.

```json
{
  "source": "cache",
  "stale": true,
  "last_synced_at": "2026-06-22T12:55:00+09:00"
}
```

---

## 11. 테스트 전략 보강

현재의 Unit / Integration / Mock / Real Account 테스트 구분은 적절하다.

여기에 다음 테스트를 추가하는 것이 좋다.

### 11.1 Golden Packet Test

실제 또는 검증된 패킷 샘플을 Fixture로 저장하고, Encode/Decode 결과가 바이트 단위로 동일한지 검사한다.

```text
fixtures/
├── getconf-request.bin
├── getconf-response.bin
├── checkin-request.bin
├── loginlist-response.bin
└── msg-push.bin
```

### 11.2 Fragmentation Test

TCP는 패킷 경계를 보장하지 않는다.

따라서 다음 상황을 반드시 테스트해야 한다.

- 헤더 22바이트가 여러 chunk로 나뉘어 수신
- 헤더와 바디가 분리되어 수신
- 여러 LOCO 프레임이 한 chunk에 합쳐져 수신
- 암호화 프레임 길이 필드만 먼저 수신
- 연결 종료 직전 일부 프레임만 수신

### 11.3 Property-based Test

패킷 길이, Method 패딩, BSON 길이 등을 무작위 입력으로 검증하면 파서 안정성이 높아진다.

### 11.4 Fault Injection

- 잘못된 GCM Tag
- 재사용된 Nonce 탐지
- 비정상 body_size
- 알 수 없는 Method
- 중복 packet_id
- 서버 응답 지연
- PING timeout
- CHANGESVR 반복
- KICKOUT 직후 재연결

### 11.5 계정 보호 테스트

- Rate limit이 우회되지 않는지
- 재시도 로직이 중복 메시지를 만들지 않는지
- 동일 요청의 idempotency 처리
- MCP 클라이언트 재전송 시 중복 전송 방지
- Audit Log가 모든 Write 작업을 기록하는지

---

## 12. 법적·운영 리스크 표현 수정

현재 문서의 “법적 지위: 회색 지대”, “비상업적 오픈소스이면 대책”과 같은 표현은 지나치게 단순할 수 있다.

비상업적이거나 연구 목적이라는 사실만으로 약관, 저작권, 접근 통제 우회, 개인정보보호 관련 리스크가 자동으로 사라지는 것은 아니다.

문서에는 다음 수준의 표현이 적절하다.

```text
본 프로젝트는 비공식 프로토콜 연구 및 개인 자동화 목적의 실험적 프로젝트다.
카카오의 공식 지원을 받지 않으며, 서비스 약관 또는 기술적 변경에 따라
언제든 동작이 중단되거나 계정에 불이익이 발생할 수 있다.
배포 전 관련 약관과 법률 검토가 필요하다.
```

또한 공개 npm 배포와 GitHub 오픈소스 공개는 개인 로컬 실험보다 리스크가 크게 증가하므로, 다음처럼 배포 단계를 구분하는 것이 좋다.

1. Private local PoC
2. Private repository
3. 제한된 테스트 사용자
4. 공개 문서화
5. npm 공개 배포

---

## 13. Phase 재구성 제안

### Phase A: Feasibility Gate

목표: 프로젝트가 실제로 가능한지 판정

- 인증 PoC
- Booking 성공
- Checkin 성공
- LOGINLIST 성공
- 채팅방 목록 수신
- Read-only 메시지 동기화

**Exit Criteria:** 실제 테스트 계정으로 채팅방 목록과 최근 메시지를 안정적으로 조회

### Phase B: Stable LOCO Client

- 패킷 파서
- 암호화 프레임
- 요청/응답 Multiplexing
- Push Event Router
- Keep-Alive
- Reconnect
- CHANGESVR
- Local Cache

### Phase C: Local MCP Read-only

- list_chats
- read_chat
- list_members
- unread
- search
- profile
- Notifications

### Phase D: Controlled Write

- 별도 테스트 계정
- send_message만 우선 구현
- Rate Limiter
- Idempotency
- Approval Policy
- Audit Log

삭제, 수정, Reaction, 파일 전송은 이후 단계로 미루는 것이 좋다.

### Phase E: Distribution

- Keychain
- Installer / npm package
- OpenClaw integration
- Claude integration
- Documentation

### Phase F: Remote Access

- Session Daemon
- Streamable HTTP
- 인증 및 TLS
- 원격 클라이언트 권한 관리

---

## 14. 우선순위를 낮추는 것이 좋은 항목

다음 기능은 초기 v1 범위에서 제외하거나 후순위로 미루는 것이 좋다.

- 메시지 수정
- 메시지 삭제
- Reaction
- 첨부파일 전송
- 오픈채팅
- 원격 HTTP
- ChatGPT 연동
- npm 공개 배포
- Docker 이미지
- 다중 계정 지원

### 권장 v0.1 범위

```text
- 별도 테스트 계정 인증
- 채팅방 목록
- 최근 메시지 읽기
- 실시간 새 메시지 이벤트
- 재연결
- OpenClaw용 로컬 stdio MCP
- 쓰기 기능 없음
```

### 권장 v0.2 범위

```text
- 단일 메시지 전송
- 사용자가 수신자와 문구를 직접 지정한 경우만 허용
- Rate Limiter
- 중복 전송 방지
- Audit Log
```

---

## 15. 최종 권고

현재 문서의 전체 방향과 계층 구조는 좋다. 특히 다음 결정은 유지할 가치가 있다.

- TypeScript 사용
- LOCO 엔진과 MCP 서버 분리
- Read-only 우선
- 별도 테스트 계정 사용
- Protocol Research 단계 운영
- OpenClaw을 첫 번째 MCP 클라이언트로 선택

그러나 실제 개발 착수 시에는 다음 원칙을 적용해야 한다.

1. **인증 가능성부터 검증한다.**
2. **LOGINLIST와 LCHATLIST 성공 전에는 전체 엔진을 확장하지 않는다.**
3. **외부 문서의 내용을 확정 명세로 취급하지 않는다.**
4. **검증 상태와 카카오톡 버전을 모든 프로토콜 항목에 기록한다.**
5. **초기 버전은 Read-only로 제한한다.**
6. **MCP 프로세스와 장기 카카오 세션을 분리하는 구조를 고려한다.**
7. **Credential과 대화 로그가 새로운 보안 취약점이 되지 않게 한다.**
8. **공개 배포는 로컬 PoC가 충분히 안정화된 이후 판단한다.**

가장 적절한 다음 작업은 전체 프로젝트 Scaffold를 만드는 것이 아니라, 별도 실험 디렉터리에서 다음 성공 조건을 검증하는 것이다.

```text
Auth
→ GETCONF
→ CHECKIN
→ LOGINLIST
→ Chat List Read
```

이 경로가 성공하면 현재 설계는 실행 가능한 프로젝트로 전환될 수 있다. 반대로 인증 또는 LOGINLIST가 막힐 경우, UI Automation이나 기존 앱 세션 활용 방식으로 접근법을 조정해야 한다.
