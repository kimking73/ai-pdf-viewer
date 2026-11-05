import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { KeyStatus, SendScope, TutorContext } from '../../../shared/ipc/contract';
import type { ActiveSelection } from '../viewer/selection-model';
import { conversationReducer, isActive } from './conversation';

interface TutorInput {
  documentId: string | null;
  currentPage: number;
  pageCount: number;
  selection: ActiveSelection | null;
  /** 전송 순간의 현재 쪽. currentPage는 스크롤이 멈춘 뒤에 갱신되므로 전송에는 이 값을 쓴다(계약 3.1절). */
  readCurrentPage: () => number | null;
  /** 확정된 범위에 맞춰 실제로 보낼 내용을 모은다. */
  readContext: (scope: SendScope) => Promise<TutorContext>;
  /** 이 쪽의 글자 정보가 부족해 쪽 전체를 이미지로 보내야 하는지. */
  needsPageImage: (page: number) => Promise<boolean>;
  isCopyAllowed: () => boolean;
  /** 패널이 접혀 있을 때 끝난 답변을 '새 답변 있음'으로 표시한다. */
  isPanelOpen: () => boolean;
}

// 대화 상태와 메인과의 왕복. 전송 범위는 렌더러가 계산하지 않고 메인이 돌려준 값만 쓴다.
export function useTutor({ documentId, currentPage, pageCount, selection, readCurrentPage, readContext, needsPageImage, isCopyAllowed, isPanelOpen }: TutorInput) {
  const [turns, dispatch] = useReducer(conversationReducer, []);
  const [scope, setScope] = useState<SendScope | null>(null);
  const [failed, setFailed] = useState(false);
  const [unseenAnswer, setUnseenAnswer] = useState(false);
  const [keyStatus, setKeyStatus] = useState<KeyStatus>('none');
  const [provider, setProvider] = useState<SendScope['provider']>('openai');
  // 키 없이 보내려 했을 때 입력창 위에 안내를 띄운다(계약 4.5절).
  const [noKey, setNoKey] = useState(false);
  // 범위 표시에 미리 보여 주기 위한 값. 어느 문서, 어느 쪽에 대한 답인지 함께 둔다.
  const [imagePage, setImagePage] = useState<{ documentId: string; page: number } | null>(null);
  // 응답을 기다리는 사이의 두 번째 전송을 막는다.
  const sendingRef = useRef(false);

  const active = useMemo(() => turns.find(isActive) ?? null, [turns]);
  const running = active !== null;
  const activeId = active?.id ?? null;
  const selectionKind = selection?.kind ?? null;
  const selectionPage = selection?.page ?? null;
  // 턴이 끝나거나 고친 내용이 늘면 다음 범위의 이전 대화 수가 바뀐다.
  const revision = turns.map(({ id, status }) => `${id}:${status}`).join();

  const pageImage = imagePage?.documentId === documentId && imagePage.page === currentPage;
  const material = useMemo(
    () =>
      documentId === null || pageCount === 0
        ? null
        : {
            documentId,
            currentPage,
            pageCount,
            selection: selectionKind === null || selectionPage === null ? null : { kind: selectionKind, page: selectionPage },
            pageImage,
          },
    [documentId, currentPage, pageCount, selectionKind, selectionPage, pageImage],
  );

  useEffect(() => {
    if (documentId === null || currentPage < 1) return;
    let cancelled = false;
    void needsPageImage(currentPage).then((needed) => {
      if (!cancelled) setImagePage(needed ? { documentId, page: currentPage } : null);
    });
    return () => {
      cancelled = true;
    };
  }, [documentId, currentPage, needsPageImage]);

  useEffect(
    () =>
      window.api.onTutorEvent((event) => {
        dispatch({ type: 'event', event });
        if (['done', 'stopped', 'error'].includes(event.type) && !isPanelOpen()) setUnseenAnswer(true);
      }),
    [isPanelOpen],
  );

  useEffect(() => {
    let cancelled = false;
    const refresh = (): void => {
      void window.api.getKeyStatus().then((result) => {
        if (cancelled || !result.ok) return;
        setKeyStatus(result.data.status);
        setProvider(result.data.provider);
        if (result.data.status === 'stored') setNoKey(false);
      });
    };
    refresh();
    const unsubscribe = window.api.onKeyChanged(refresh);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (material === null) return;
    let cancelled = false;
    void window.api.resolveSendScope(material).then((result) => {
      if (cancelled) return;
      setScope(result.ok && result.data.status === 'ok' ? result.data.scope : null);
    });
    return () => {
      cancelled = true;
    };
  }, [material, revision, provider]);

  /** 입력창의 전송. 받아들였으면 true를 돌려 입력창을 비운다. */
  const ask = useCallback(
    (question: string, onSent: () => void, onRejected: () => void): boolean => {
      if (material === null || running || sendingRef.current) return false;
      sendingRef.current = true;
      setFailed(false);
      setNoKey(false);
      const page = Math.min(readCurrentPage() ?? material.currentPage, material.pageCount);
      const reject = (): void => {
        setFailed(true);
        onRejected();
      };
      const send = async (): Promise<void> => {
        // 범위는 메인이 정한다. 그 범위의 내용만 모아 보낸다.
        // 표시가 따라오기 전에 쪽을 옮겼을 수 있으므로 보내는 쪽 기준으로 다시 판단한다.
        const input = { ...material, currentPage: page, pageImage: await needsPageImage(page) };
        const resolved = await window.api.resolveSendScope(input);
        if (!resolved.ok || resolved.data.status !== 'ok') {
          reject();
          return;
        }
        const context = await readContext(resolved.data.scope);
        const result = await window.api.askTutor({ mode: 'new', question, scope: input, context, copyAllowed: isCopyAllowed() });
        if (result.ok && result.data.status === 'started') {
          const { requestId, scope: frozen } = result.data;
          dispatch({ type: 'started', id: requestId, question: result.data.question, scope: frozen, replaces: null });
          onSent();
        } else if (result.ok && result.data.status === 'no-key') {
          setNoKey(true);
          onRejected();
        } else {
          reject();
        }
      };
      void send()
        .catch(reject)
        .finally(() => {
          sendingRef.current = false;
        });
      return true;
    },
    [material, running, readCurrentPage, readContext, needsPageImage, isCopyAllowed],
  );

  /** 같은 범위로 다시 받는다. 고친 내용이 있으면 그 턴을 교체한다. */
  const again = useCallback(
    (turnId: string, correction: string | null): void => {
      if (documentId === null || sendingRef.current) return;
      sendingRef.current = true;
      void window.api
        .askTutor({ mode: 'again', documentId, requestId: turnId, correction })
        .then((result) => {
          if (result.ok && result.data.status === 'started') {
            dispatch({
              type: 'started',
              id: result.data.requestId,
              question: result.data.question,
              scope: result.data.scope,
              replaces: correction === null ? null : turnId,
            });
            return;
          }
          if (result.ok && result.data.status === 'no-key') {
            setNoKey(true);
            return;
          }
          setFailed(true);
        })
        .finally(() => {
          sendingRef.current = false;
        });
    },
    [documentId],
  );

  const stop = useCallback(() => {
    if (activeId !== null) void window.api.stopTutor({ requestId: activeId });
  }, [activeId]);

  const reset = useCallback(() => {
    dispatch({ type: 'reset' });
    setScope(null);
    setFailed(false);
    setUnseenAnswer(false);
    setNoKey(false);
  }, []);

  const markSeen = useCallback(() => {
    setUnseenAnswer(false);
  }, []);

  return { turns, scope, running, failed, unseenAnswer, keyStatus, provider, noKey, ask, again, stop, reset, markSeen };
}

export type Tutor = ReturnType<typeof useTutor>;
