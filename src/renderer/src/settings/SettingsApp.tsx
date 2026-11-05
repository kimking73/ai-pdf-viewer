import { useCallback, useEffect, useRef, useState } from 'react';
import { AI_PROVIDER_IDS, AI_PROVIDERS } from '../../../shared/ai-model';
import type { AiProviderId, KeySaveResponse, KeyStatus } from '../../../shared/ipc/contract';

// 계약 4.5절의 문구. 결과 코드로만 정하고 키 값은 어디에도 표시하지 않는다.
function saveMessage(result: KeySaveResponse['result'], name: string): string {
  switch (result) {
    case 'saved':
      return '키를 저장했습니다.';
    case 'saved-low-balance':
      return `키는 맞지만 ${name} 잔액이나 한도가 부족합니다. 키는 저장했습니다.`;
    case 'invalid-key':
      return '키를 인식하지 못했습니다.';
    case 'network':
      return '인터넷에 연결되지 않아 키를 확인하지 못했습니다. 키는 저장되지 않았습니다.';
    case 'provider':
      return `${name} 응답을 받지 못해 키를 확인하지 못했습니다. 키는 저장되지 않았습니다.`;
    case 'storage-failed':
      return 'macOS 보안 저장소에 키를 저장하지 못했습니다.';
  }
}

function statusLabel(status: KeyStatus | null): string {
  if (status === null) return '확인 중…';
  if (status === 'stored') return '저장됨';
  if (status === 'unreadable') return '저장된 키를 읽지 못했습니다. 다시 입력해 주세요.';
  if (status === 'unavailable') return 'macOS 보안 저장소를 쓸 수 없습니다.';
  return '없음';
}

export function SettingsApp() {
  const [provider, setProvider] = useState<AiProviderId | null>(null);
  const [status, setStatus] = useState<KeyStatus | null>(null);
  const [draft, setDraft] = useState('');
  const [checking, setChecking] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // 고른 제공사와 그 키 상태를 메인에서 다시 읽는다.
  const refresh = useCallback(async (): Promise<void> => {
    const result = await window.api.getKeyStatus();
    if (!result.ok) return;
    // 가짜 응답 모드에서도 설정 화면은 실제 제공사 기준으로 보여 준다.
    const current = result.data.provider === 'fake' ? 'openai' : result.data.provider;
    setProvider(current);
    setStatus(result.data.keys[current]);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void window.api.getKeyStatus().then((result) => {
      if (cancelled || !result.ok) return;
      const current = result.data.provider === 'fake' ? 'openai' : result.data.provider;
      setProvider(current);
      setStatus(result.data.keys[current]);
    });
    inputRef.current?.focus();
    return () => {
      cancelled = true;
    };
  }, []);

  const choose = async (next: AiProviderId): Promise<void> => {
    if (next === provider || checking) return;
    // 입력 중인 키가 다른 제공사로 가지 않게 먼저 비운다.
    setDraft('');
    setMessage(null);
    setConfirmingDelete(false);
    setProvider(next);
    setStatus(null);
    await window.api.setProvider({ provider: next });
    await refresh();
    inputRef.current?.focus();
  };

  const save = async (): Promise<void> => {
    const apiKey = draft.trim();
    if (apiKey === '' || checking || provider === null) return;
    // 키는 메인으로 한 번 넘기고 입력란을 바로 비운다. 렌더러에 남기지 않는다.
    setDraft('');
    setChecking(true);
    setMessage(null);
    const response = await window.api.saveKey({ provider, apiKey });
    setChecking(false);
    // 서버가 거부한 경우와, 서버로 보내기 전에 앱이 거부한 경우를 구분해 안내한다.
    if (response.ok) setMessage(saveMessage(response.data.result, AI_PROVIDERS[provider].name));
    else if (response.error.code === 'INVALID_INPUT') setMessage('키 형식이 맞지 않아 서버로 보내지 않았습니다. 공백이나 줄바꿈 없이 붙여 넣어 주세요.');
    else setMessage('앱 내부 오류로 키를 확인하지 못했습니다. 키는 저장되지 않았습니다.');
    await refresh();
    const saved = response.ok && (response.data.result === 'saved' || response.data.result === 'saved-low-balance');
    if (!saved) inputRef.current?.focus();
  };

  const remove = async (): Promise<void> => {
    if (provider === null) return;
    setConfirmingDelete(false);
    const response = await window.api.deleteKey({ provider });
    setMessage(response.ok ? '키를 삭제했습니다.' : '키를 삭제하지 못했습니다.');
    await refresh();
  };

  return (
    <main className="settings" data-testid="settings">
      <h1>AI 제공사</h1>
      <div className="settings-row" role="radiogroup" aria-label="AI 제공사">
        {AI_PROVIDER_IDS.map((id) => (
          <label key={id} className="settings-choice">
            <input
              type="radio"
              name="provider"
              checked={provider === id}
              disabled={checking}
              data-testid={`provider-${id}`}
              onChange={() => void choose(id)}
            />
            {AI_PROVIDERS[id].name}
          </label>
        ))}
      </div>
      <h1>API 키</h1>
      <p data-testid="key-status">상태: {statusLabel(status)}</p>
      <form
        className="settings-row"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <input
          ref={inputRef}
          type="password"
          aria-label="새 키 입력"
          placeholder="새 키 입력"
          autoComplete="off"
          spellCheck={false}
          disabled={checking}
          value={draft}
          data-testid="key-input"
          onChange={(event) => {
            setDraft(event.target.value);
          }}
        />
        <button type="submit" className="primary" disabled={checking || draft.trim() === ''} data-testid="key-save">
          {checking ? '확인 중…' : '확인하고 저장'}
        </button>
      </form>
      {message !== null && (
        <p className="settings-message" role="status" data-testid="key-message">
          {message}
        </p>
      )}
      {status === 'stored' && (
        <div className="settings-row">
          {confirmingDelete ? (
            <>
              <span>키를 삭제할까요?</span>
              <button type="button" data-testid="key-delete-confirm" onClick={() => void remove()}>
                삭제
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirmingDelete(false);
                }}
              >
                취소
              </button>
            </>
          ) : (
            <button
              type="button"
              data-testid="key-delete"
              onClick={() => {
                setConfirmingDelete(true);
              }}
            >
              키 삭제
            </button>
          )}
        </div>
      )}
    </main>
  );
}
