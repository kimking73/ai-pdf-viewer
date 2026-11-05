import { describe, expect, it, vi } from 'vitest';
import type { KeyCheckResult } from './ai-error';
import { checkAndSaveKey } from './key-service';

const KEY = 'test-key-value-1234';

function run(check: KeyCheckResult, save: () => Promise<'saved' | 'unavailable'> = () => Promise.resolve('saved')) {
  const saveSpy = vi.fn(save);
  const result = checkAndSaveKey(KEY, { store: { save: saveSpy }, validate: () => Promise.resolve(check) });
  return { result, saveSpy };
}

describe('checkAndSaveKey', () => {
  it('확인되면 저장한다', async () => {
    const { result, saveSpy } = run('ok');
    await expect(result).resolves.toEqual({ result: 'saved' });
    expect(saveSpy).toHaveBeenCalledWith(KEY);
  });

  it.each(['insufficient-quota', 'rate-limited'] as const)('%s는 키가 맞으므로 저장하고 알린다', async (check) => {
    const { result, saveSpy } = run(check);
    await expect(result).resolves.toEqual({ result: 'saved-low-balance' });
    expect(saveSpy).toHaveBeenCalled();
  });

  it.each(['invalid-key', 'network', 'provider'] as const)('%s는 저장하지 않는다', async (check) => {
    const { result, saveSpy } = run(check);
    await expect(result).resolves.toEqual({ result: check });
    expect(saveSpy).not.toHaveBeenCalled();
  });

  it('보안 저장소를 쓸 수 없으면 저장 실패다', async () => {
    await expect(run('ok', () => Promise.resolve('unavailable')).result).resolves.toEqual({ result: 'storage-failed' });
  });

  it('저장 오류는 문구 없이 저장 실패로 알린다', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(run('ok', () => Promise.reject(new Error(KEY))).result).resolves.toEqual({ result: 'storage-failed' });
    expect(JSON.stringify(log.mock.calls)).not.toContain(KEY);
    log.mockRestore();
  });
});
