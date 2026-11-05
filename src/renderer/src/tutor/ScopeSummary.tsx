import { useEffect, useRef, useState } from 'react';
import { AI_PROVIDERS } from '../../../shared/ai-model';
import type { SendScope } from '../../../shared/ipc/contract';
import { formatPageRange, formatProviderLine, formatScopeLine, formatScopeNotice } from '../../../shared/send-scope-format';
import type { ActiveSelection } from '../viewer/selection-model';
import type { RegisterEscape } from './escape-layers';

interface ScopeSummaryProps {
  id: string;
  scope: SendScope | null;
  selection: ActiveSelection | null;
  hasKey: boolean;
  registerEscape: RegisterEscape;
}

const ANNOUNCE_AFTER_MS = 800;

// 다음 질문의 범위를 입력창 바로 위에 항상 보여 준다(계약 6절). 값은 메인이 확정한 것만 쓴다.
export function ScopeSummary({ id, scope, selection, hasKey, registerEscape }: ScopeSummaryProps) {
  const [open, setOpen] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const buttonRef = useRef<HTMLButtonElement>(null);
  const line = scope === null ? null : formatScopeLine(scope);
  const notice = scope === null ? null : formatScopeNotice(scope);

  // 스크린 리더에는 스크롤이 멈춘 뒤 한 번만, 입력 중이 아닐 때만 알린다(계약 6.4절).
  useEffect(() => {
    if (line === null) return;
    const timer = setTimeout(() => {
      if (document.activeElement?.tagName !== 'TEXTAREA') {
        setAnnouncement(`보낼 범위 ${line}${notice === null ? '' : `. ${notice}`}`);
      }
    }, ANNOUNCE_AFTER_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [line, notice]);

  useEffect(() => {
    if (!open) return;
    const close = (): void => {
      setOpen(false);
      buttonRef.current?.focus();
    };
    registerEscape('popover', close);
    const outside = (event: PointerEvent): void => {
      if (event.target instanceof Element && event.target.closest('.scope-details, .scope-toggle') !== null) return;
      setOpen(false);
    };
    window.addEventListener('pointerdown', outside, { capture: true });
    return () => {
      registerEscape('popover', null);
      window.removeEventListener('pointerdown', outside, { capture: true });
    };
  }, [open, registerEscape]);

  if (scope === null) {
    return (
      <div className="scope" id={id} data-testid="scope">
        범위를 확인하는 중…
      </div>
    );
  }

  return (
    <div className="scope" id={id} data-testid="scope">
      <div className="scope-row">
        <span>
          보낼 범위{' '}
          <span key={line} className="scope-value" data-testid="scope-line">
            {line}
          </span>
        </span>
        <button
          ref={buttonRef}
          type="button"
          className="scope-toggle"
          aria-expanded={open}
          onClick={() => {
            setOpen((value) => !value);
          }}
        >
          자세히
        </button>
      </div>
      <div data-testid="scope-provider">{formatProviderLine(scope)}</div>
      {notice !== null && (
        <div className="scope-notice" data-testid="scope-notice">
          {notice}
        </div>
      )}
      <div className="visually-hidden" role="status">
        {announcement}
      </div>
      {open && (
        <div className="scope-details" role="dialog" aria-label="보낼 범위 자세히" data-testid="scope-details">
          <p>쪽: {formatPageRange(scope)}. 쪽은 글자로 보내고, 선택 영역은 이미지로 보냅니다.</p>
          {selection !== null && (
            <p className="scope-preview">
              선택 미리보기: {selection.kind === 'text' ? selection.text : `p.${String(selection.page)}의 선택 영역`}
            </p>
          )}
          <p>
            포함한 이전 대화 {scope.previousTurns}턴 · 내가 고친 내용 {scope.corrections}건
          </p>
          {scope.provider === 'fake' ? (
            <>
              <p>제공사: 없음(가짜 응답) · 모델: 없음</p>
              <p>문서 전체는 보내지 않습니다. 지금은 가짜 응답이라 아무것도 전송하지 않습니다.</p>
            </>
          ) : (
            <>
              <p>
                제공사: {AI_PROVIDERS[scope.provider].name} · {AI_PROVIDERS[scope.provider].target}
              </p>
              <p>문서 전체는 보내지 않습니다. 이 앱에는 별도 서버가 없고, 내 키로 {AI_PROVIDERS[scope.provider].name}에 직접 보냅니다.</p>
              {!hasKey && <p>키를 설정하기 전에는 아무것도 보내지 않습니다.</p>}
            </>
          )}
        </div>
      )}
    </div>
  );
}
