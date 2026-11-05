# 아키텍처

앱의 구조와 보안 규칙을 적는다. 제품 범위와 화면은 다루지 않는다. "현재"로 표시한 내용은 코드에 구현되어 있고, "설계"로 표시한 내용은 해당 기능을 만들 때 따를 원칙이며 아직 코드가 없다.

## 1. 프로세스 구조 (현재)

```
렌더러 (비신뢰)          preload (다리)            메인 (신뢰)
React UI                 window.api 노출           OS, 파일, 비밀, 외부 네트워크
sandbox, Node 없음  -->  동작 하나 = 채널 하나 -->  발신자 확인, 입력 검증, 처리
CSP로 네트워크 차단      검증과 로직 없음
```

| 위치 | 역할 | 가져올 수 있는 것 |
|---|---|---|
| `src/main/` | 앱 수명주기, 창, IPC 처리기, 보안 정책 | 전부 |
| `src/preload/` | `contextBridge`로 `window.api` 노출 | `electron`, `shared`의 채널 이름과 타입 |
| `src/renderer/` | React UI | `shared`만. `electron`과 Node 내장 모듈 금지 |
| `src/shared/` | 앱 이름, IPC 계약 | 어느 프로세스에서도 실행 가능한 코드만 |

가져오기 제한은 `eslint.config.mjs`의 `no-restricted-imports`로 강제한다.

### 렌더러 잠금

- 창 설정은 `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`다(`src/main/window.ts`). `app.enableSandbox()`도 함께 호출한다.
- 배포 빌드는 `file://` 대신 `app://bundle/`로 로드한다(`src/main/security/app-protocol.ts`). 렌더러 번들 밖의 경로는 404로 응답한다.
- CSP의 원본은 `src/main/security/csp.ts` 하나이고, 메인 프로세스가 응답 헤더로 붙인다. 배포용 정책은 인라인 스크립트, `eval`, 외부 연결을 모두 막는다.
- 개발 정책은 Vite HMR에 필요한 만큼만 완화한다(`unsafe-inline`, 개발 서버 웹소켓).
- 새 창, `webview`, 외부 탐색, 모든 웹 권한 요청을 거부한다(`src/main/security/hardening.ts`).
- 패키징 시 Electron 퓨즈로 `RunAsNode`, `NODE_OPTIONS`, `--inspect`를 끄고 ASAR 무결성 검사를 켠다(`electron-builder.config.mjs`).

보안 설정을 완화하는 변경은 이유를 `docs/decisions.md`에 기록한다.

### pdf.js와 CSP (현재)

PDF 뷰어를 위해 CSP를 바꾸지 않았다. 설정의 원본은 `src/renderer/src/viewer/pdf-engine.ts`다.

| 필요한 것 | 처리 |
|---|---|
| 워커 | `worker-src`가 없으면 `script-src 'self'`를 따르므로 번들의 모듈 워커가 그대로 뜬다 |
| CMap, 표준 글꼴 데이터 | `connect-src 'none'`이라 fetch를 못 한다. 지연 로드 JS 청크에 base64로 넣고 `BinaryDataFactory`로 공급한다 |
| 글꼴 대체(`url()`) | `pdfjs/standard_fonts/`를 번들에 고정 이름으로 넣는다(`font-src 'self'`) |
| JPEG 2000, JBIG2 | WebAssembly에 필요한 `wasm-unsafe-eval`을 열지 않고 `useWasm: false`로 JS 디코더를 쓴다(`pdfjs/wasm/`). ICC 색 관리(qcms)는 꺼진다 |
| PDF 스크립트 | 스크립팅 관리자를 넘기지 않아 실행되지 않는다. 외부 링크는 주소만 표시한다 |

## 2. IPC 규칙 (현재)

채널을 추가하는 순서는 다음과 같다.

1. `src/shared/ipc/channels.ts`에 채널 이름을 추가한다.
2. `src/shared/ipc/contract.ts`에 요청과 응답 스키마를 추가한다. 빠뜨리면 타입 검사가 실패한다.
3. `src/shared/ipc/renderer-api.ts`에 렌더러용 메서드 타입을 추가한다.
4. `src/preload/index.ts`에 메서드를 잇는다.
5. `src/main/ipc/register.ts`에서 `createIpcHandler`로 처리기를 등록한다.
6. 거부 사례를 포함한 단위 테스트를 추가한다.

규칙은 다음과 같다.

- **좁은 동작만 노출한다.** `exportNotes(id)`는 되고 `writeFile(path, data)`는 안 된다. 범용 파일, 셸, 네트워크, `invoke` 통로를 만들지 않는다.
- **모든 처리기는 `createIpcHandler`를 거친다.** 순서는 발신자 확인, 입력 검증, 처리, 응답 검증이다. `ipcMain.handle`에 직접 로직을 쓰지 않는다.
- **메인 프로세스에서 검증한다.** 타입은 렌더러를 믿게 해 주지 않는다. 스키마는 `z.strictObject`로 알 수 없는 필드도 거부한다. 문자열과 배열에는 길이 제한을 둔다.
- **preload에는 로직을 두지 않는다.** zod도 가져오지 않는다.
- **오류는 코드만 돌려준다.** 응답은 `IpcResult`이고 코드는 `FORBIDDEN`, `INVALID_INPUT`, `INTERNAL`이다. 메시지와 스택은 렌더러로 보내지 않고, 로그에는 오류 이름만 남긴다.

실제 예시는 `app:get-version`이다. 렌더러는 `window.api.getVersion({ component: 'app' })`를 호출하고, 메인 프로세스는 `component`가 허용 목록에 없으면 `INVALID_INPUT`으로 거부한다.

### 튜터 채널 (현재, 가짜 응답)

`tutor:resolve-scope`, `tutor:ask`, `tutor:stop`과 메인 -> 렌더러 알림 `tutor:event`가 있다. 최근 문서는 `pdf:list-recent`, `pdf:open-recent`로 ID만 주고받고 경로는 렌더러로 보내지 않는다. 구현은 `src/main/tutor/`에 있다.

- 렌더러는 재료(문서 ID, 현재 쪽, 쪽 수, 선택 종류와 쪽)만 보내고, 전송 범위는 메인의 `resolveSendScope`가 확정한다. 화면의 범위 문구는 돌려받은 값으로만 만든다. 다시 받기는 메인이 보관한 그 요청의 범위를 쓴다.
- 제공사는 `TutorProvider` 경계 뒤에 있다. `src/main/ai/openai-provider.ts`와 `postech-provider.ts`가 있고, 설정 창에서 고른 제공사가 새 질문의 범위에 고정되며 `routeProvider`가 그 어댑터로 보낸다. `fake-provider.ts`는 패키징되지 않은 실행에서 `AI_PDF_VIEWER_FAKE_PROVIDER=1`일 때만 쓰며 E2E가 사용한다. 패키징된 앱은 환경 변수로 바꿀 수 없다.
- 보낸 범위 밖의 근거 쪽은 메인의 `sanitizeSource`가 글자로 바꾼다.
- 렌더러가 범위의 쪽 글, 선택한 글, 영역 이미지를 보내고, 메인의 `fitContextToScope`가 확정 범위에 맞는 것만 남겨 제공사로 보낸다.
- 복사 금지 차단: 메인은 `copyAllowed`가 거짓이면 전송을 거부한다. 다만 권한은 렌더러의 pdf.js가 읽어 알리는 값이고 메인이 PDF를 직접 해석하지는 않으므로, 렌더러가 침해된 경우까지 막지는 못한다.

## 3. API 키 처리 원칙 (현재, `src/main/ai/key-store.ts`)

실제 `safeStorage`와 키체인 동작은 아직 앱에서 확인하지 않았다.

- **메인 프로세스 전용.** 키는 렌더러에 돌려주지 않는다. 입력 화면에서 메인으로 한 번 넘어간 뒤에는 렌더러가 다시 읽을 방법이 없다. 렌더러가 받는 정보는 "등록됨 여부"와 "검증 결과"뿐이다. 마스킹한 일부도 렌더러에 주지 않는 것을 기본으로 한다.
- **저장은 Electron `safeStorage`.** macOS에서는 키체인에 보관된 암호화 키로 값을 암호화한다. 암호문은 `userData` 안의 파일에 권한 `0600`으로 저장한다. 네이티브 모듈이 필요 없어 빌드와 패키징이 단순하다.
- **평문 대체 저장 금지.** `safeStorage.isEncryptionAvailable()`이 거짓이거나 복호화에 실패하면 키가 없는 상태로 처리하고 다시 입력을 요청한다.
- **남기지 않는다.** 로그, 오류 메시지, 크래시 보고, 렌더러 상태, 저장소, `.env`에 넣지 않는다. 외부 라이브러리의 오류 객체에는 요청 헤더가 들어 있을 수 있으므로 통째로 기록하지 않는다.
- **메모리에는 필요한 동안만 둔다.** 요청을 만들 때 복호화하고, 전역 상태에 평문을 캐시하지 않는 것을 기본으로 한다.
- **삭제 경로를 제공한다.** 사용자가 키를 지우면 암호문 파일을 삭제한다.

미서명 빌드에서 키체인이 어떻게 동작하는지는 6절을 본다.

## 4. 렌더러에서 AI까지의 요청 경로 (현재, `src/main/ai/`, 실제 호출 미확인)

제공사는 OpenAI(기본)와 POSTECH AI다(`docs/decisions.md`). 주소는 각 어댑터에 고정한다. 키는 제공사별 파일에 따로 저장하고 해당 어댑터만 읽는다. POSTECH AI는 키를 `X-Api-Key` 헤더로 보내며 다른 주소로 넘겨받기를 거부한다. 아래 구조는 제공사와 무관하며, 제공사별 코드는 어댑터 하나에 가둔다.

```
렌더러
  │  좁은 IPC 동작 호출 (AI 요청 내용, 문서 참조. 키, URL, 모델 엔드포인트는 넘기지 않는다)
  ▼
IPC 경계 (createIpcHandler: 발신자 확인, 스키마 검증, 크기 제한)
  ▼
AI 서비스 (메인, 제공사 무관)
  │  선택된 제공사 확인 -> 전송 범위 확정 -> 키 조회 -> 요청 조립
  ▼
제공사 어댑터 (메인, 제공사별 1개)
  │  공통 요청을 제공사 형식으로 변환하고, 응답과 오류를 공통 형식으로 되돌린다
  ▼
제공사 API (HTTPS, 어댑터에 고정된 주소로만)
```

어댑터의 경계는 다음과 같은 모양을 기준으로 한다. 실제 타입은 구현할 때 PRD에 맞춰 정한다.

```ts
interface AiProviderAdapter {
  readonly id: string;
  validateKey(apiKey: string, signal: AbortSignal): Promise<KeyCheckResult>;
  stream(request: AiRequest, apiKey: string, signal: AbortSignal): AsyncIterable<AiEvent>;
}
```

- **렌더러는 네트워크에 나갈 수 없다.** CSP의 `connect-src 'none'`이 이를 강제한다. E2E 테스트가 이 차단을 확인한다.
- **SDK 타입은 어댑터 밖으로 나가지 않는다.** 서비스와 렌더러는 공통 타입만 안다. 제공사 추가는 어댑터 추가로 끝나야 한다.
- **키는 어댑터 호출 시 인자로 전달한다.** 어댑터가 키를 저장하지 않으므로 키 저장소와 분리되고, 가짜 어댑터로 테스트하기 쉽다.
- **목적지는 렌더러가 정하지 않는다.** 렌더러는 제공사 ID만 고를 수 있고, 메인이 등록된 어댑터인지 확인한다. 임의 URL을 받으면 키 탈취 경로가 된다.
- **전송 범위는 메인이 확정한다.** 실제로 보낼 범위를 메인이 정해 렌더러에 알려 주고, 화면이 이를 표시한다. PDF 내용은 사용자가 선택한 제공사로만 보낸다.
- **스트리밍과 취소를 기본으로 설계한다.** 스트림은 요청 ID로 구분해 렌더러로 전달하고, 취소 동작은 `AbortSignal`로 잇는다. 창이 닫히면 진행 중인 요청도 취소한다.
- **오류는 공통 코드로 변환한다.** 키 오류, 잔액 부족, 요청 한도 초과, 네트워크 실패, 제공사 오류처럼 나눈다. 제공사의 원문 오류는 렌더러로 보내지 않는다.
- **제공사 응답은 비신뢰 입력이다.** 렌더러에서 HTML로 그대로 삽입하지 않는다. PDF 내용에 섞인 프롬프트 주입도 같은 경계에서 고려한다. AI 응답이 IPC 동작이나 파일 접근을 직접 실행하게 하지 않는다.

## 5. 파일 접근 (현재)

구현은 `src/main/documents/document-access.ts`와 `src/main/ipc/register.ts`에 있다. 채널은 `pdf:show-open-dialog`, `pdf:open-dropped`, `pdf:read-document` 셋이고, 읽기 권한은 마지막으로 고른 파일 하나에만 있다. 문서 전체를 메모리로 넘기므로 크기 상한은 1GiB다.

- **렌더러는 경로를 넘기지 않는다.** 파일 선택은 메인의 `dialog.showOpenDialog`로 한다. 메인은 렌더러에 불투명한 문서 ID와 표시용 이름만 준다. 이후 요청은 문서 ID로 한다.
- **드래그 앤 드롭은 예외로 관리한다.** `webUtils.getPathForFile`은 preload에서만 쓴다. 메인은 받은 경로를 신뢰하지 않고 실제 경로 확인, 일반 파일 여부, PDF 시그니처, 크기 제한을 검사한다.
- **읽기 전용이 기본이다.** 저장이 필요해지면 사용자가 저장 대화상자로 고른 경로에만 쓴다.
- **앱 데이터는 `app.getPath('userData')` 아래에 둔다.** 개발 실행은 `<앱 이름> Dev` 폴더를 따로 쓴다(현재 구현됨).
- **사용자 문서를 몰래 복사하지 않는다.** 캐시가 필요하면 범위와 삭제 방법을 함께 정한다.
- **로그에 문서 내용과 전체 경로를 남기지 않는다.** 경로에는 사용자 이름과 강의명 같은 개인정보가 들어 있다.
- **저작권이 있는 PDF를 저장소에 넣지 않는다.** `.gitignore`가 `evals/public/` 밖의 PDF를 제외한다.

## 6. 미서명 배포 시 주의점

베타는 인증서와 공증 없이 직접 전달한다(`docs/decisions.md`). 빌드는 애드혹 서명(`identity: '-'`)을 쓴다. Apple Silicon이 서명 없는 코드를 실행하지 않기 때문이고, 신원을 증명하는 서명은 아니다.

### 현재 빌드에서 확인한 것

- `codesign --verify --deep --strict` 통과, `Signature=adhoc`, Team ID 없음.
- `spctl -a -vv` 결과는 `rejected`. Gatekeeper가 이 앱을 신뢰하지 않는다는 뜻이고, 이 배포 방식에서 예상되는 결과다.
- 격리 속성이 없는 상태에서 DMG 안의 앱은 정상 실행된다.

### 아직 확인하지 못한 것 (첫 배포 전에 다른 Mac에서 확인)

- 브라우저로 내려받아 격리 속성이 붙은 DMG를 실제로 여는 과정과 표시되는 경고 문구. "손상되었기 때문에 열 수 없습니다"가 나오면 아래 안내가 달라진다.
- 전달 경로별 차이(메일, 드라이브, 메신저, AirDrop).
- 업데이트된 빌드에서 이전 키체인 항목을 읽을 때의 동작(아래).

### 테스터 안내

- macOS 15 이후로는 Control-클릭으로 여는 우회가 없어졌다고 알려져 있다. 기본 절차는 앱을 한 번 실행해 차단된 뒤 **시스템 설정 > 개인정보 보호 및 보안 > 그래도 열기**를 누르는 것이다. 실제 화면을 확인한 뒤 캡처를 넣어 안내문을 완성한다.
- DMG 안에서 바로 실행하지 말고 응용 프로그램 폴더로 옮겨 실행하도록 안내한다.
- `xattr` 터미널 명령을 기본 안내로 쓰지 않는다. 경고를 무시하는 습관을 만들기 때문이다. 필요하면 개별 지원에서만 쓴다.
- 파일은 팀이 공지한 경로로만 받도록 하고, 빌드마다 SHA-256 값을 함께 공지한다. 서명이 없으므로 사용자가 위조를 구별할 다른 방법이 없다.

### 키체인과의 관계

키체인 항목의 접근 권한은 앱의 코드 서명 신원과 연결된다. 애드혹 서명에는 고정된 신원이 없으므로, 새 빌드를 설치하면 키체인 접근 확인 창이 다시 뜨거나 복호화가 실패할 수 있다. 실제 동작은 API 키 저장을 구현할 때 두 빌드로 시험해 확인한다. 어떤 결과든 앱은 복호화 실패를 정상 경로로 처리해 키 재입력을 요청해야 한다.

### 자동 업데이트가 없는 영향

- 새 버전은 수동으로 다시 내려받아 설치한다. 테스터가 옛 버전에 머물 수 있으므로 앱 버전을 사용자가 볼 수 있게 유지한다.
- 옛 빌드에는 옛 Chromium이 남는다. Electron 보안 패치가 나오면 새 빌드를 공지한다. 베타 기간을 넘겨 이 상태로 운영하지 않는다.
- `userData`의 데이터 형식은 옛 버전에서 새 버전으로 넘어가도 읽을 수 있게 관리한다.

서명 전환은 Gatekeeper 경고로 인한 이탈을 측정한 뒤 재검토한다(`docs/decisions.md`).

## 7. 앱 이름 변경

앱 이름과 번들 ID의 원본은 저장소 루트의 `app.config.json` 하나다. 창 제목, 화면, 메뉴, `.app` 이름이 모두 이 값을 따른다. 현재 값은 임시다.

**베타 배포 전에 바꾼다.** 이름이 바뀌면 `userData` 경로와 키체인 항목 이름이 달라져, 배포 후에 바꾸면 기존 사용자의 데이터와 저장된 키를 이전하는 코드가 필요하다.

## 8. 도구 선택과 제약

| 도구 | 이유와 제약 |
|---|---|
| electron-vite | 메인, preload, 렌더러를 한 설정으로 빌드하고 HMR을 제공한다. |
| electron-builder | 애드혹 서명, 퓨즈, DMG를 한 설정에서 처리한다. |
| zod | IPC 계약의 스키마와 타입을 한 곳에서 정의한다. |
| Vitest | Vite와 같은 변환 도구를 쓴다. Electron 없이 실행되는 로직을 테스트한다. |
| temml | 답변의 수식을 MathML DOM으로 만든다. HTML 문자열을 넣지 않아 배포 CSP를 완화하지 않아도 된다. `trust: false`로 외부 연결 명령을 막는다. |
| Playwright | Electron을 실제로 띄워 확인한다. 빌드 결과(`out/`)를 대상으로 한다. |
| TypeScript 6.0 | 최신은 7.0이지만 `typescript-eslint` 8.72가 `<6.1.0`만 지원한다. 지원이 나오면 올린다. |
| `@types/node` 24 | Electron 45에 내장된 Node는 24.22다. Node 26 타입을 쓰면 실행 시 없는 API를 통과시킬 수 있다. 빌드 도구는 시스템 Node 26에서 실행된다. |

- **의존성은 모두 `devDependencies`에 둔다.** 전부 번들에 포함되므로 패키지 안에 `node_modules`가 들어가지 않는다. 샌드박스 preload에 외부 `require`가 생기는 것도 막는다. 네이티브 모듈이 필요해지면 그 패키지만 `dependencies`로 옮긴다.
- **버전은 정확히 고정한다**(`.npmrc`의 `save-exact`).
- **`node_modules`는 `deps.nosync/node_modules`를 가리키는 심볼릭 링크다.** 저장소가 iCloud 동기화 폴더에 있어, 재설치 때 동기화가 `bin 2`처럼 폴더를 복제하고 원본을 비워 도구가 깨진다. `.nosync`로 끝나는 폴더는 iCloud가 동기화하지 않는다. `npm ci`와 `npm install <패키지>`는 링크를 실제 폴더로 바꾸므로, 재설치 뒤에는 `rm -rf deps.nosync/node_modules && mv node_modules deps.nosync/node_modules && ln -s deps.nosync/node_modules node_modules`를 실행한다. npm이 설치 스크립트를 막아 Electron 실행 파일이 없으면 `node node_modules/electron/install.js`를 실행한다.
- **패키징 작업 폴더는 저장소 밖이다**(`~/Library/Caches/ai-pdf-viewer-build`). 저장소가 iCloud 동기화 폴더에 있으면 동기화가 `.app`에 확장 속성을 붙여 `codesign`이 실패한다. 완성된 DMG만 저장소의 `release/`로 복사한다.

## 9. 테스트

| 명령 | 대상 |
|---|---|
| `npm test` | IPC 계약, 처리기 경계, 경로 검사, CSP, 신뢰 출처 |
| `npm run test:e2e` | 빌드 결과를 Electron으로 실행. 화면, 보안 설정, IPC 왕복과 거부, CSP 차단 |
| `npm run test:packaged` | 패키징된 `.app`을 실행. 창, IPC 거부, `app://` 로드, PDF 렌더링, 한글, 암호·손상 PDF, JPEG 2000, 300쪽 첫 쪽 시간 |

패키징된 앱은 퓨즈로 `--inspect`를 막았으므로, `test:packaged`는 Chromium 원격 디버깅 포트로 접속한다. 앱 코드에 테스트 전용 분기는 없다.
