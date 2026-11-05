[English](README.md) | **한국어**

# AI PDF Viewer

쪽 옆에 AI 튜터가 있는 macOS용 PDF 뷰어입니다. 보고 있는 쪽, 선택한 글, 드래그한 영역에 대해 물으면 눌러서 이동할 수 있는 쪽 근거와 함께 답합니다.

개인용 프로젝트입니다. 내 API 키로 동작하고 별도 서버는 없습니다. 앱 화면은 한국어입니다.

## 기능

- **PDF 읽기:** 스크롤, 쪽 이동, 확대, 텍스트 선택, 최근 문서 목록을 제공합니다.
- **맥락 질문:** 현재 쪽, 선택한 글, 드래그한 영역에 대해 물을 수 있습니다.
- **글자가 없는 쪽:** 쓸 수 있는 글자가 없는 쪽에서 선택 없이 물으면 쪽을 이미지로 보냅니다. 스캔본과 그림만 있는 쪽도 질문할 수 있습니다.
- **답변 서식:** 스트리밍으로 받으며 제목, 목록, 코드, 수식을 표시합니다. 수식은 [Temml](https://temml.org/)로 그립니다.
- **쪽 근거:** 근거를 누르면 해당 쪽으로 이동합니다.
- **되짚기와 수정:** 튜터가 읽은 내용을 보고, 잘못 읽은 부분을 고칠 수 있습니다.
- **전송 범위 표시:** 무엇을 보낼지 질문하기 전에 패널에 표시합니다.

## 개인정보와 보안

- **보내는 내용:** 패널에 표시된 범위만 사용자가 고른 제공사로 보냅니다. 앞뒤 쪽 글, 선택한 글, 영역이나 쪽 이미지, 최근 대화, 사용자의 수정 내용이 해당합니다. 문서 전체는 보내지 않습니다.
- **복사 금지 PDF:** 읽을 수는 있지만 내용을 복사하거나 전송하지 않습니다. 암호가 걸린 PDF는 해제하지 않습니다.
- **API 키:** 메인 프로세스에서만 다루고 Electron `safeStorage`로 암호화합니다. 렌더러에는 노출하지 않습니다.
- **대화:** 메모리에만 있어서 앱을 끄면 사라집니다. OpenAI 요청에는 `store: false`를 씁니다.
- **로컬 데이터:** 최근 문서 경로는 앱 데이터 폴더의 `recent-documents.json`에 암호화 없이 저장합니다(권한 `0600`).
- **프로세스 격리:** 렌더러를 비신뢰 영역으로 보고 `contextIsolation`과 `sandbox`를 켜고 `nodeIntegration`을 끕니다. IPC는 좁은 동작 단위로 나누고 zod로 검증합니다.

## 시작하기

macOS, Node.js, OpenAI API 키가 필요합니다. Apple Silicon과 Node.js 26에서 개발하고 시험했습니다.

```sh
git clone https://github.com/kimking73/ai-pdf-viewer.git
cd ai-pdf-viewer
npm ci
npm run dev
```

그다음 순서입니다.

1. `⌘,`로 설정 창을 엽니다.
2. OpenAI를 고르고 API 키를 저장합니다.
3. `⌘O`로 PDF를 열고 패널에서 질문합니다.

### 설치용 앱 만들기

```sh
npm run package:mac
```

DMG는 `release/`에 생깁니다. DMG를 열어 앱을 `Applications`로 끌어 넣으세요. 애드혹 서명만 했고 Developer ID 서명과 공증은 하지 않았으므로, 다른 Mac으로 옮기면 Gatekeeper가 막을 수 있습니다.

## 단축키

| 단축키 | 동작 |
|---|---|
| `⌘O` | PDF 열기 |
| `⌘,` | 설정 열기 |
| `⌥⌘G` | 쪽 번호로 이동 |
| `⌘+` / `⌘-` | 확대 / 축소 |
| `⌘0` | 폭 맞춤 |
| `⇧⌘R` | 영역 선택 |
| `⌘L` | 질문 입력으로 이동 |
| `⌘.` | 답변 중지 |

## 개발

| 명령 | 용도 |
|---|---|
| `npm run dev` | 개발 실행(HMR). 메인 프로세스나 프리로드 코드를 바꾸면 다시 실행해야 합니다 |
| `npm run build` | `out/`에 빌드 |
| `npm run typecheck` | 타입 검사 |
| `npm run lint` | 린트 |
| `npm test` | 단위 테스트 |
| `npm run test:e2e` | 빌드 후 가짜 제공사로 Electron E2E 테스트. 화면에 창이 뜹니다 |
| `npm run package:mac` | DMG 빌드 |
| `npm run test:packaged` | 패키징된 앱을 실행해 확인. `package:mac` 다음에 실행합니다 |

Electron, React, TypeScript, electron-vite, pdf.js, Temml, zod, Vitest, Playwright로 만들었습니다.

소스 구조는 다음과 같습니다.

```
src/main/      메인 프로세스: AI 제공사, 키 저장, 문서, IPC 처리
src/preload/   렌더러에 노출하는 좁은 API
src/renderer/  React 화면: 뷰어와 튜터 패널
src/shared/    IPC 계약과 프로세스 공용 코드
e2e/           Electron E2E 테스트
```

프로젝트 문서: [아키텍처](docs/architecture.md), [결정 기록](docs/decisions.md), [작업 목록](docs/tasks.md), [PRD](PRD.md)

## 알려진 제한

- **POSTECH AI:** 설정 창에 있지만 아직 동작하지 않습니다. OpenAI를 쓰세요.
- **OpenAI 모델:** `src/shared/ai-model.ts`에 고정되어 있고 현재 값은 임시입니다.
- **수식:** `\pmb`와 `\sideset`은 콘텐츠 보안 정책 때문에 배포판에서 스타일이 적용되지 않습니다.
- **스캔본:** OCR은 없습니다. 글자가 없는 쪽은 쪽 이미지로 질문합니다.

## 라이선스

아직 라이선스를 정하지 않았으므로 코드 재사용 권한을 부여하지 않습니다.
