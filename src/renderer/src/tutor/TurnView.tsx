import { useCallback, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { providerName } from '../../../shared/ai-model';
import type { AiErrorCode, ParagraphSource, SendScope } from '../../../shared/ipc/contract';
import { formatFrozenScope, formatPageRange } from '../../../shared/send-scope-format';
import { AnswerText } from './AnswerText';
import { Composer } from './Composer';
import { isActive, summarizeSources, type Turn } from './conversation';
import type { RegisterEscape } from './escape-layers';

// 계약 4.11절. 제공사 원문은 받지 않으므로 코드로만 문구를 정한다.
function errorMessage(code: AiErrorCode, provider: SendScope['provider']): string {
  const name = providerName(provider);
  switch (code) {
    case 'invalid-key':
      return '키가 올바르지 않거나 더 이상 쓸 수 없습니다.';
    case 'rate-limited':
      return `${name}의 요청 한도에 걸렸습니다. 앱이나 문서의 문제가 아닙니다. 잠시 후 다시 시도해 주세요.`;
    case 'insufficient-quota':
      return `${name} 잔액이나 사용 한도가 부족합니다. 비용과 한도는 ${name}에서 관리되며 앱과는 별개입니다.`;
    case 'network':
      return '인터넷에 연결되지 않았습니다. 문서 읽기는 계속할 수 있습니다.';
    case 'provider':
      return `${name} 응답을 받지 못했습니다. 질문은 그대로 있습니다.`;
  }
}

function endedMessage(turn: Turn): string {
  if (turn.status === 'stopped') return '중지됨';
  const message = turn.errorCode === null ? '답변을 받지 못했습니다' : errorMessage(turn.errorCode, turn.scope.provider);
  // 답변 도중 실패하면 받은 부분을 유지하고 끊겼음을 함께 알린다.
  return turn.paragraphs.length > 0 ? `중단됨. ${message}` : message;
}

interface TurnViewProps {
  turn: Turn;
  /** 접어 둔 이전 답변은 읽기만 한다. */
  readOnly?: boolean;
  busy: boolean;
  registerEscape: RegisterEscape;
  onGoToPage: (page: number) => void;
  onAgain: (turnId: string, correction: string | null) => void;
  onCorrectingChange: (correcting: boolean) => void;
  onOpenKeySettings: () => void;
}

function PageSource({ page, onGoToPage }: { page: number; onGoToPage: (page: number) => void }) {
  return (
    <button
      type="button"
      className="source-page"
      aria-label={`근거 ${String(page)}쪽`}
      data-testid="source-page"
      onClick={() => {
        onGoToPage(page);
      }}
    >
      근거 p.{page}
    </button>
  );
}

function SourceLabel({ source, onGoToPage }: { source: ParagraphSource; onGoToPage: (page: number) => void }) {
  if (source.kind === 'page') return <PageSource page={source.page} onGoToPage={onGoToPage} />;
  if (source.kind === 'general') {
    return (
      <span className="source-general" data-testid="source-general">
        일반 지식
      </span>
    );
  }
  // 보낸 범위 밖의 번호는 근거처럼 보이지 않도록 글자로 둔다.
  return <span data-testid="source-plain"> ({source.text})</span>;
}

function CorrectionForm({
  turn,
  registerEscape,
  onSubmit,
  onClose,
}: {
  turn: Turn;
  registerEscape: RegisterEscape;
  onSubmit: (text: string) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    registerEscape('correction', onClose);
    return () => {
      registerEscape('correction', null);
    };
  }, [registerEscape, onClose]);

  const send = (value: string): boolean => {
    onSubmit(value.trim());
    return true;
  };
  const selection = turn.scope.selection === null ? '' : ` · ${turn.scope.selection.kind === 'area' ? '선택 영역' : '선택한 글'} 1개`;

  return (
    <div className="correction" data-testid="correction">
      <Composer
        value={text}
        onChange={setText}
        onSubmit={send}
        inputRef={inputRef}
        label="읽은 내용 고치기"
        placeholder="맞는 내용을 적어 주세요. 예: 첨자가 i가 아니라 j입니다."
        testId="correction-input"
      />
      <p className="turn-meta">
        같은 범위({formatPageRange(turn.scope)}
        {selection}){turn.scope.provider === 'fake' ? '로 가짜 응답을 다시 받습니다. 전송하지 않습니다.' : `로 ${providerName(turn.scope.provider)}에 다시 보냅니다.`}
      </p>
      <div className="turn-actions">
        <button type="button" className="primary" disabled={text.trim() === ''} onClick={() => send(text)}>
          고쳐서 다시 답변
        </button>
        <button type="button" onClick={onClose}>
          취소
        </button>
      </div>
    </div>
  );
}

// 답변은 글자로만 표시한다. HTML로 해석하지 않으므로 답변 안의 주소도 눌리지 않는다(계약 4.6절).
export function TurnView({ turn, readOnly = false, busy, registerEscape, onGoToPage, onAgain, onCorrectingChange, onOpenKeySettings }: TurnViewProps) {
  const [correcting, setCorrecting] = useState(false);
  const wrongButtonRef = useRef<HTMLButtonElement>(null);
  const summary = summarizeSources(turn.paragraphs);
  const finished = !isActive(turn);

  const closeCorrection = useCallback(() => {
    // 닫은 뒤에 [잘못 읽음]이 다시 나타나므로 렌더링을 끝내고 포커스를 옮긴다.
    flushSync(() => {
      setCorrecting(false);
    });
    onCorrectingChange(false);
    wrongButtonRef.current?.focus();
  }, [onCorrectingChange]);

  return (
    <article className="turn" data-testid="turn" data-status={turn.status}>
      <div className="turn-question">{turn.question}</div>
      <p className="turn-meta" data-testid="frozen-scope">
        {formatFrozenScope(turn.scope)}
      </p>

      {turn.previous !== null && (
        <details className="turn-previous" data-testid="previous-answer">
          <summary>고치기 전 답변</summary>
          <TurnView
            turn={turn.previous}
            readOnly
            busy={busy}
            registerEscape={registerEscape}
            onGoToPage={onGoToPage}
            onAgain={onAgain}
            onCorrectingChange={onCorrectingChange}
            onOpenKeySettings={onOpenKeySettings}
          />
        </details>
      )}

      {turn.status === 'reading' && (
        <p className="turn-meta" data-testid="reading">
          p.{turn.scope.basePage}를 읽는 중…
        </p>
      )}

      {turn.recap !== null && (
        <section className="recap" aria-label="읽은 내용" data-testid="recap">
          <div className="recap-label">읽은 내용</div>
          <div className="recap-body">
            {turn.recap.segments.map((segment, index) =>
              segment.uncertain ? (
                <span key={index}>
                  <span className="recap-uncertain">
                    <AnswerText text={segment.text} />
                  </span>{' '}
                  (불확실)
                </span>
              ) : (
                <span key={index}>
                  <AnswerText text={segment.text} />
                </span>
              ),
            )}
          </div>
          {turn.recap.correction !== null && (
            <p data-testid="recap-correction">
              <strong>내가 고친 내용:</strong> {turn.recap.correction}
            </p>
          )}
          {!readOnly &&
            (correcting ? (
              <CorrectionForm
                turn={turn}
                registerEscape={registerEscape}
                onClose={closeCorrection}
                onSubmit={(text) => {
                  onCorrectingChange(false);
                  onAgain(turn.id, text);
                }}
              />
            ) : (
              <button
                ref={wrongButtonRef}
                type="button"
                data-testid="wrong-read"
                onClick={() => {
                  setCorrecting(true);
                  onCorrectingChange(true);
                }}
              >
                잘못 읽음
              </button>
            ))}
        </section>
      )}

      {turn.scope.provider === 'fake' && turn.paragraphs.length > 0 && (
        <div className="turn-fake-label" data-testid="fake-label">
          가짜 응답: AI가 쓴 답이 아닙니다
        </div>
      )}
      {turn.paragraphs.map((paragraph, index) => (
        <div key={index} className="turn-paragraph" data-testid="answer-paragraph">
          <AnswerText text={paragraph.text} streaming={!finished && index === turn.paragraphs.length - 1} />
          {paragraph.source !== null && (
            <>
              {' '}
              <SourceLabel source={paragraph.source} onGoToPage={onGoToPage} />
            </>
          )}
        </div>
      ))}

      {turn.status === 'done' && (summary.pages.length > 0 || summary.general) && (
        <p className="turn-summary" data-testid="source-summary">
          {summary.pages.length > 0 && '근거: '}
          {summary.pages.map((page, index) => (
            <span key={page}>
              {index > 0 && ', '}
              <button
                type="button"
                className="source-link"
                aria-label={`근거 ${String(page)}쪽`}
                onClick={() => {
                  onGoToPage(page);
                }}
              >
                p.{page}
              </button>
            </span>
          ))}
          {summary.general && `${summary.pages.length > 0 ? ' · ' : ''}일반 지식 포함`}
        </p>
      )}

      {finished && (turn.status === 'stopped' || turn.status === 'error') && (
        <div className="turn-actions">
          <span data-testid="turn-ended" role={turn.status === 'error' ? 'alert' : undefined}>
            {endedMessage(turn)}
          </span>
          {!readOnly && (turn.errorCode === 'invalid-key' || turn.errorCode === 'insufficient-quota') && (
            <button type="button" data-testid="turn-key-settings" onClick={onOpenKeySettings}>
              키 설정
            </button>
          )}
          {!readOnly && (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                onAgain(turn.id, null);
              }}
            >
              다시 보내기
            </button>
          )}
        </div>
      )}
    </article>
  );
}
