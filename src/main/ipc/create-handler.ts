import type { IpcChannel } from '../../shared/ipc/channels';
import { ipcContract, type IpcRequest, type IpcResponse, type IpcResult } from '../../shared/ipc/contract';

export interface IpcSender {
  url: string | undefined;
  isMainFrame: boolean;
}

export interface IpcGuards {
  isTrustedUrl(url: string | undefined): boolean;
  logError(channel: IpcChannel, errorName: string): void;
}

// 모든 IPC 처리기가 지나는 경계: 발신자 확인 -> 입력 검증 -> 처리 -> 응답 검증.
// Electron을 가져오지 않으므로 단위 테스트에서 그대로 실행할 수 있다.
export function createIpcHandler<C extends IpcChannel>(
  channel: C,
  handler: (request: IpcRequest<C>) => IpcResponse<C> | Promise<IpcResponse<C>>,
  guards: IpcGuards,
): (sender: IpcSender, rawRequest: unknown) => Promise<IpcResult<IpcResponse<C>>> {
  const { request: requestSchema, response: responseSchema } = ipcContract[channel];

  return async (sender, rawRequest) => {
    if (!sender.isMainFrame || !guards.isTrustedUrl(sender.url)) {
      return { ok: false, error: { code: 'FORBIDDEN' } };
    }

    const parsed = requestSchema.safeParse(rawRequest);
    if (!parsed.success) return { ok: false, error: { code: 'INVALID_INPUT' } };

    try {
      const response = await handler(parsed.data as IpcRequest<C>);
      return { ok: true, data: responseSchema.parse(response) as IpcResponse<C> };
    } catch (error) {
      // 오류 메시지에는 민감한 값이 섞일 수 있으므로 이름만 남긴다.
      guards.logError(channel, error instanceof Error ? error.name : 'UnknownError');
      return { ok: false, error: { code: 'INTERNAL' } };
    }
  };
}
