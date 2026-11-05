# AI PDF 뷰어

사용자 본인이 AI 튜터와 함께 PDF를 읽으려고 만드는 개인용 macOS 데스크톱 앱. 홍보와 베타 테스트는 하지 않는다. 스택은 Electron + React이고, AI는 사용자 API 키(BYOK)로 호출하며 별도 서버는 없다.

## 문서
- `docs/decisions.md`: 확정된 결정과 PRD 대기 항목. 임의로 뒤집지 않는다.
- `docs/architecture.md`: 프로세스 구조, IPC 계약, 보안 규칙.
- `PRD.md`: 제품 범위와 수용 기준. 범위를 추측해 기능을 구현하지 않는다.
- `docs/tasks.md`: 작업 목록과 상태.

## 불변 규칙
- API 키는 메인 프로세스에서만 다룬다. 렌더러, 로그, 저장소에 남기지 않는다.
- 렌더러는 비신뢰 영역으로 본다. `contextIsolation` 켜기, `nodeIntegration` 끄기, `sandbox` 켜기를 유지한다.
- IPC는 좁은 동작 단위로 만들고 메인 프로세스에서 입력을 검증한다. 범용 파일·셸 접근을 노출하지 않는다.
- PDF 내용은 사용자가 선택한 AI 제공사로만 보내고, 전송 범위를 화면에 표시한다.
- 저작권이 있는 PDF는 저장소에 올리지 않는다. 재배포 가능함을 확인한 문서만 `evals/public/`에 둔다.
- 커밋과 푸시는 사용자가 요청할 때만 한다.

## 명령
- `npm ci`: 의존성 설치
- `npm run dev`: 개발 실행(HMR)
- `npm run build`: `out/`에 빌드
- `npm run typecheck`: 타입 검사
- `npm run lint`: 린트
- `npm test`: 단위 테스트
- `npm run test:e2e`: 빌드 후 Electron E2E 테스트
- `npm run package:mac`: 미서명(애드혹 서명) macOS 빌드. DMG는 `release/`, `.app`은 `~/Library/Caches/ai-pdf-viewer-build/`에 생성
- `npm run test:packaged`: 패키징된 앱을 실행해 확인. `package:mac` 다음에 실행
