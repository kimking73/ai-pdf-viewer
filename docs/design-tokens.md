# 확정 디자인 토큰

시안 A와 `DESIGN.md`를 합친 앱 기준이다. 시안: https://claude.ai/artifact/N2DhVtDbs8NdYoAfpuh3Te 의 '확정안'. `docs/design-contract.md` 10.4절의 열린 결정을 이 값으로 정한다. 구조와 동작은 디자인 계약을 따르고, 시각 값은 이 문서를 따른다. 코드에는 hex를 직접 쓰지 말고 CSS 변수로 쓴다.

## 라이트 모드 색

| 토큰 | 값 | 쓰임 |
|---|---|---|
| `--color-bg-app`, `--color-bg-viewer` | `#f5f5f7` | 앱 바탕, 뷰어 |
| `--color-bg-panel`, `--color-bg-input` | `#ffffff` | 튜터 패널, 입력창 |
| `--color-bg-elevated` | `#fafafc` | 도구 막대, 입력 블록 |
| `--color-text-primary` | `#1d1d1f` | 본문 |
| `--color-text-secondary` | `#333333` | 보조 문구. `DESIGN.md`의 `#7a7a7a`는 작은 글자 대비가 4.5:1에 못 미쳐 쓰지 않음 |
| `--color-border` | `#e0e0e0` | 경계선 |
| `--color-accent` | `#0066cc` | 모든 조작 요소. 두 번째 강조색 없음 |
| `--color-focus-ring` | `#0071e3` | 포커스 2px |
| `--color-text-on-accent` | `#ffffff` | 강조색 위 글자 |
| `--color-page-selection-border` | `#0066cc` | PDF 위 선택 테두리 |
| `--color-page-selection-fill` | `rgba(0, 102, 204, 0.08)` | PDF 위 선택 채움 |

경고, 오류, 성공, 부분 맞음 색과 다크 모드는 `DESIGN.md`에 없다. 해당 화면을 만들 때 정하고 이 문서에 추가한다.

## 글자

글꼴은 `system-ui, -apple-system, BlinkMacSystemFont, 'Apple SD Gothic Neo', sans-serif`, 굵기는 400과 600을 쓴다. 500은 쓰지 않는다. 한글에는 `word-break: keep-all`.

| 역할 | 크기 / 행간 / 자간 | 쓰임 |
|---|---|---|
| `--type-title` | 17px / 1.24 / -0.374px, 600 | 패널 제목 |
| `--type-body` | 15px / 1.6 | 답변, 입력창 |
| `--type-label` | 14px / 1.43 / -0.224px | 버튼, 도구 막대 |
| `--type-caption` | 12px / 1.5 / -0.12px | 범위 표시, 보조 문구 |

`DESIGN.md`의 본문 17px은 360~560px 패널에 크다고 보고 15px로 줄였다. 사용자가 써 보고 조정한다.

## 모양과 동작

| 항목 | 값 |
|---|---|
| 주요·이해도·근거 버튼, 켜진 영역 선택 | 알약 `9999px` |
| 도구 막대 버튼, 선택 칩 | `8px` |
| 입력창, 읽은 내용 블록, 내 질문 | `18px` |
| 간격 | 4, 8, 12, 17, 24, 32px |
| 눌림 | `transform: scale(0.95)` |
| 그림자 | PDF 쪽에만 `rgba(0, 0, 0, 0.22) 3px 5px 30px 0`. 다른 곳에는 쓰지 않음 |
| 그라데이션 | 쓰지 않음 |

PDF 쪽 색은 다크 모드에서도 원본을 유지한다. 일반 지식 라벨은 점선 테두리로 근거 라벨과 구분한다.

앱은 Apple 제품의 로고나 명칭을 쓰지 않는다. 56px 제목, 전면 타일, 사진 중심 구성처럼 `DESIGN.md`의 마케팅 페이지 요소도 쓰지 않는다.
