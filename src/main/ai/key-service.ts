import type { KeySaveResponse } from '../../shared/ipc/contract';
import type { KeyCheckResult } from './ai-error';
import type { ApiKeyStore } from './key-store';

export interface KeyServiceOptions {
  store: Pick<ApiKeyStore, 'save'>;
  validate: (apiKey: string) => Promise<KeyCheckResult>;
}

// 키를 확인한 뒤 저장한다. 결과 코드만 돌려주고 키나 원문 오류는 어디에도 남기지 않는다.
export async function checkAndSaveKey(apiKey: string, { store, validate }: KeyServiceOptions): Promise<KeySaveResponse> {
  const check = await validate(apiKey);
  // 키 자체가 틀렸거나 확인하지 못했으면 저장하지 않는다.
  if (check === 'invalid-key' || check === 'network' || check === 'provider') return { result: check };

  try {
    if ((await store.save(apiKey)) === 'unavailable') return { result: 'storage-failed' };
  } catch (error) {
    console.error(`[key] 저장 실패: ${error instanceof Error ? error.name : 'UnknownError'}`);
    return { result: 'storage-failed' };
  }
  // 키가 맞다는 것은 확인했으므로 잔액이나 한도 문제여도 저장한다. 충전한 뒤 다시 입력하지 않아도 된다.
  return { result: check === 'ok' ? 'saved' : 'saved-low-balance' };
}
