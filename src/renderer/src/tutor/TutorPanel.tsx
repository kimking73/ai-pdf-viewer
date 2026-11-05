import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import type { ActiveSelection } from '../viewer/selection-model';
import { Composer } from './Composer';
import type { RegisterEscape } from './escape-layers';
import { ScopeSummary } from './ScopeSummary';
import { SelectionChip } from './SelectionChip';
import { TurnView } from './TurnView';
import type { Tutor } from './use-tutor';

interface TutorPanelProps {
  open: boolean;
  width: number;
  documentOpen: boolean;
  copyAllowed: boolean;
  tutor: Tutor;
  selection: ActiveSelection | null;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  registerEscape: RegisterEscape;
  onClearSelection: () => void;
  onGoToPage: (page: number) => void;
  onSent: () => void;
}

const BOTTOM_SLOP_PX = 24;
const SCOPE_ID = 'tutor-scope';

export function TutorPanel(props: TutorPanelProps) {
  const { open, width, documentOpen, copyAllowed, tutor, selection, inputRef, registerEscape, onClearSelection, onGoToPage, onSent } = props;
  const [draft, setDraft] = useState('');
  const [correcting, setCorrecting] = useState(false);
  const [showJump, setShowJump] = useState(false);
  const conversationRef = useRef<HTMLDivElement>(null);
  // 마지막으로 잰 내용 높이. 새 글이 붙기 전에 맨 아래였는지를 이 값으로 판단한다. 스크롤 이벤트는 프레임마다
  // 늦게 오므로, 그 사이에 글이 붙어도 사용자가 올린 스크롤을 되돌리지 않는다.
  const lastHeightRef = useRef(0);

  // 사용자가 맨 아래에 있을 때만 따라간다. '잘못 읽음' 입력 중에는 멈춘다(계약 4.6절).
  useLayoutEffect(() => {
    const element = conversationRef.current;
    if (element === null) return;
    const wasAtBottom = lastHeightRef.current - element.scrollTop - element.clientHeight <= BOTTOM_SLOP_PX;
    if (wasAtBottom && !correcting) element.scrollTop = element.scrollHeight;
    lastHeightRef.current = element.scrollHeight;
  }, [tutor.turns, correcting]);

  const handleScroll = (): void => {
    const element = conversationRef.current;
    if (element === null) return;
    lastHeightRef.current = element.scrollHeight;
    setShowJump(element.scrollHeight - element.scrollTop - element.clientHeight > BOTTOM_SLOP_PX);
  };

  const submit = (text: string): boolean =>
    tutor.ask(text.trim(), onSent, () => {
      // 받아들여지지 않았으면 질문을 잃지 않게 되돌린다. 그 사이 새로 입력한 글은 덮지 않는다.
      setDraft((current) => (current === '' ? text : current));
    });

  const openKeySettings = useCallback(() => {
    void window.api.openSettings({ returnFocus: true });
  }, []);

  const handleAgain = useCallback(
    (turnId: string, correction: string | null) => {
      setCorrecting(false);
      tutor.again(turnId, correction);
      inputRef.current?.focus();
    },
    [tutor, inputRef],
  );

  return (
    <aside className="tutor-panel" hidden={!open} aria-label="튜터" data-testid="tutor-panel" style={{ width }}>
      <header className="tutor-head">
        <h2>튜터</h2>
        <button
          type="button"
          className="tutor-settings"
          data-testid="open-settings"
          onClick={() => {
            void window.api.openSettings({ returnFocus: false });
          }}
        >
          설정
        </button>
      </header>
      {tutor.provider === 'fake' && (
        <p className="tutor-fake-banner" data-testid="fake-banner">
          가짜 응답 모드: AI를 호출하지 않고 화면 확인용 고정 문장을 표시합니다.
        </p>
      )}

      <div ref={conversationRef} className="tutor-conversation" data-testid="conversation" onScroll={handleScroll}>
        {!documentOpen && <p className="tutor-empty">문서를 열면 지금 보는 쪽을 함께 보며 답합니다</p>}
        {documentOpen && !copyAllowed && (
          <p className="tutor-blocked" data-testid="tutor-blocked">
            이 문서는 복사 금지로 설정되어 AI로 보내지 않습니다. 읽기는 계속할 수 있습니다.
          </p>
        )}
        {documentOpen && copyAllowed && tutor.turns.length === 0 && (
          <p className="tutor-empty">막히는 곳을 질문하거나, 수식과 도표를 끌어서 선택해 물어보세요.</p>
        )}
        {tutor.turns.map((turn) => (
          <TurnView
            key={turn.id}
            turn={turn}
            busy={tutor.running}
            registerEscape={registerEscape}
            onGoToPage={onGoToPage}
            onAgain={handleAgain}
            onCorrectingChange={setCorrecting}
            onOpenKeySettings={openKeySettings}
          />
        ))}
      </div>

      {showJump && (
        <button
          type="button"
          className="tutor-jump"
          data-testid="jump-bottom"
          onClick={() => {
            const element = conversationRef.current;
            if (element !== null) element.scrollTop = element.scrollHeight;
          }}
        >
          맨 아래로
        </button>
      )}

      {documentOpen && (
        <div className="tutor-input">
          {copyAllowed ? (
            <ScopeSummary
              id={SCOPE_ID}
              scope={tutor.scope}
              selection={selection}
              hasKey={tutor.keyStatus === 'stored'}
              registerEscape={registerEscape}
            />
          ) : (
            <div className="scope" id={SCOPE_ID} data-testid="scope">
              이 문서는 AI로 보내지 않습니다
            </div>
          )}
          {selection !== null && <SelectionChip selection={selection} onClear={onClearSelection} />}
          {tutor.noKey && (
            <p className="tutor-failed" role="alert" data-testid="no-key">
              API 키가 없습니다.{' '}
              <button type="button" className="source-link" data-testid="open-key-settings" onClick={openKeySettings}>
                키 설정
              </button>
            </p>
          )}
          {tutor.failed && (
            <p className="tutor-failed" role="alert" data-testid="tutor-failed">
              질문을 처리하지 못했습니다. 입력한 내용은 그대로 두었습니다.
            </p>
          )}
          <div className="composer-row">
            <Composer
              value={draft}
              onChange={setDraft}
              onSubmit={submit}
              inputRef={inputRef}
              label="질문"
              placeholder={copyAllowed ? '질문을 입력하세요' : '이 문서는 질문을 보낼 수 없습니다'}
              describedBy={SCOPE_ID}
              disabled={!copyAllowed}
              testId="question-input"
            />
            {tutor.running ? (
              <button type="button" className="primary" data-testid="stop" onClick={tutor.stop}>
                중지
              </button>
            ) : (
              <button
                type="button"
                className="primary"
                data-testid="send"
                disabled={!copyAllowed || draft.trim() === ''}
                onClick={() => {
                  if (submit(draft)) setDraft('');
                  inputRef.current?.focus();
                }}
              >
                보내기
              </button>
            )}
          </div>
        </div>
      )}
    </aside>
  );
}
