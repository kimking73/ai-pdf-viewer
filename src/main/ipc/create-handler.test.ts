import { describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from '../../shared/ipc/channels';
import { createIpcHandler, type IpcGuards, type IpcSender } from './create-handler';

const CHANNEL = IPC_CHANNELS.appGetVersion;
const TRUSTED_SENDER: IpcSender = { url: 'app://bundle/index.html', isMainFrame: true };
const VALID_REQUEST = { component: 'app' };

function setup(handler = vi.fn(() => ({ version: '1.2.3' }))) {
  const logError = vi.fn<IpcGuards['logError']>();
  const run = createIpcHandler(CHANNEL, handler, {
    isTrustedUrl: (url) => url === TRUSTED_SENDER.url,
    logError,
  });
  return { run, handler, logError };
}

describe('createIpcHandler', () => {
  it('유효한 요청을 처리하고 결과를 돌려준다', async () => {
    const { run, handler } = setup();
    await expect(run(TRUSTED_SENDER, VALID_REQUEST)).resolves.toEqual({ ok: true, data: { version: '1.2.3' } });
    expect(handler).toHaveBeenCalledWith(VALID_REQUEST);
  });

  it('신뢰하지 않는 출처는 처리기를 호출하지 않고 거부한다', async () => {
    const { run, handler } = setup();
    const result = await run({ url: 'https://example.com/', isMainFrame: true }, VALID_REQUEST);
    expect(result).toEqual({ ok: false, error: { code: 'FORBIDDEN' } });
    expect(handler).not.toHaveBeenCalled();
  });

  it('하위 프레임은 출처가 같아도 거부한다', async () => {
    const { run, handler } = setup();
    const result = await run({ ...TRUSTED_SENDER, isMainFrame: false }, VALID_REQUEST);
    expect(result).toEqual({ ok: false, error: { code: 'FORBIDDEN' } });
    expect(handler).not.toHaveBeenCalled();
  });

  it('잘못된 입력은 처리기를 호출하지 않고 거부한다', async () => {
    const { run, handler } = setup();
    const result = await run(TRUSTED_SENDER, { component: '../../etc/passwd' });
    expect(result).toEqual({ ok: false, error: { code: 'INVALID_INPUT' } });
    expect(handler).not.toHaveBeenCalled();
  });

  it('처리기 오류의 메시지는 렌더러와 로그에 나가지 않는다', async () => {
    const { run, logError } = setup(
      vi.fn(() => {
        throw new TypeError('secret-key-value');
      }),
    );
    const result = await run(TRUSTED_SENDER, VALID_REQUEST);
    expect(result).toEqual({ ok: false, error: { code: 'INTERNAL' } });
    expect(JSON.stringify(result)).not.toContain('secret-key-value');
    expect(logError).toHaveBeenCalledWith(CHANNEL, 'TypeError');
    expect(JSON.stringify(logError.mock.calls)).not.toContain('secret-key-value');
  });

  it('계약에 맞지 않는 응답은 렌더러로 보내지 않는다', async () => {
    const { run } = setup(vi.fn(() => ({ version: '' })));
    await expect(run(TRUSTED_SENDER, VALID_REQUEST)).resolves.toEqual({ ok: false, error: { code: 'INTERNAL' } });
  });
});
