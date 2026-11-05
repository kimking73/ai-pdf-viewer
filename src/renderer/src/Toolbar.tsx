import { useState } from 'react';
import type { ViewerState } from './viewer/viewer-controller';
import { MAX_SCALE, MIN_SCALE, parsePageInput } from './viewer/view-math';

export interface ToolbarActions {
  goToPage: (page: number) => void;
  previousPage: () => void;
  nextPage: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  fitWidth: () => void;
  focusViewer: () => void;
  toggleAreaMode: () => void;
  togglePanel: () => void;
}

interface ToolbarProps {
  fileName: string | null;
  state: ViewerState | null;
  actions: ToolbarActions;
  pageInputRef: React.RefObject<HTMLInputElement | null>;
  panelButtonRef: React.RefObject<HTMLButtonElement | null>;
  panelOpen: boolean;
  /** 패널이 접혀 있는 동안의 답변 상태. 점과 접근성 이름으로 알린다(계약 2.3절). */
  panelStatus: '답변 받는 중' | '새 답변 있음' | null;
  areaMode: boolean;
}

// 도구 막대는 창 제목 막대를 겸한다.
export function Toolbar({ fileName, state, actions, pageInputRef, panelButtonRef, panelOpen, panelStatus, areaMode }: ToolbarProps) {
  return (
    <header className="toolbar">
      <span className="toolbar-file" data-testid="file-name" title={fileName ?? undefined}>
        {fileName}
      </span>
      {state !== null && (
        <>
          {!state.copyAllowed && (
            <span className="toolbar-badge" data-testid="copy-restricted" title="이 문서는 작성자가 복사를 제한했습니다.">
              복사 제한
            </span>
          )}
          <div className="toolbar-group" role="group" aria-label="쪽 이동">
            <button type="button" aria-label="이전 쪽" disabled={state.currentPage <= 1} onClick={actions.previousPage}>
              ‹
            </button>
            <PageInput state={state} actions={actions} inputRef={pageInputRef} key={state.currentPage} />
            <span className="toolbar-count" data-testid="page-count">
              / {state.pageCount}
            </span>
            <button
              type="button"
              aria-label="다음 쪽"
              disabled={state.currentPage >= state.pageCount}
              onClick={actions.nextPage}
            >
              ›
            </button>
          </div>
          <div className="toolbar-group" role="group" aria-label="배율">
            <button type="button" aria-label="축소" disabled={state.scale <= MIN_SCALE} onClick={actions.zoomOut}>
              −
            </button>
            <output className="toolbar-scale" data-testid="zoom-level">
              {Math.round(state.scale * 100)}%
            </output>
            <button type="button" aria-label="확대" disabled={state.scale >= MAX_SCALE} onClick={actions.zoomIn}>
              +
            </button>
            <button type="button" aria-pressed={state.fitMode === 'fit-width'} onClick={actions.fitWidth}>
              폭 맞춤
            </button>
          </div>
        </>
      )}
      <div className="toolbar-end">
        {state !== null && (
          <button
            type="button"
            className="toolbar-area"
            data-testid="area-mode"
            aria-pressed={areaMode}
            disabled={!state.copyAllowed}
            onClick={actions.toggleAreaMode}
          >
            영역 선택
          </button>
        )}
        <button
          ref={panelButtonRef}
          type="button"
          className="toolbar-panel"
          data-testid="panel-toggle"
          aria-expanded={panelOpen}
          aria-label={panelStatus === null ? '패널' : `패널, ${panelStatus}`}
          onClick={actions.togglePanel}
        >
          패널
          {panelStatus !== null && <span className="status-dot" data-testid="panel-status" />}
        </button>
      </div>
    </header>
  );
}

function PageInput({
  state,
  actions,
  inputRef,
}: {
  state: ViewerState;
  actions: ToolbarActions;
  inputRef: React.RefObject<HTMLInputElement | null>;
}) {
  const [text, setText] = useState(String(state.currentPage));

  const commit = (): void => {
    const page = parsePageInput(text, state.pageCount);
    if (page === null) {
      setText(String(state.currentPage));
      return;
    }
    setText(String(page));
    actions.goToPage(page);
  };

  return (
    <input
      ref={inputRef}
      className="toolbar-page"
      inputMode="numeric"
      aria-label={`현재 ${String(state.currentPage)}쪽, 전체 ${String(state.pageCount)}쪽`}
      value={text}
      onChange={(event) => {
        setText(event.target.value);
      }}
      onFocus={(event) => {
        event.target.select();
      }}
      onKeyDown={(event) => {
        // 한글 입력 중 Enter는 조합 확정이므로 쪽 이동으로 처리하지 않는다.
        if (event.nativeEvent.isComposing) return;
        if (event.key === 'Enter') {
          commit();
          actions.focusViewer();
        } else if (event.key === 'Escape') {
          setText(String(state.currentPage));
          actions.focusViewer();
        }
      }}
      onBlur={() => {
        setText(String(state.currentPage));
      }}
    />
  );
}
