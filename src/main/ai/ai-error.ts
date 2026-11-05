import type { AiErrorCode } from '../../shared/ipc/contract';

export type KeyCheckResult = 'ok' | AiErrorCode;

// 제공사의 원문 오류에는 요청 내용이 섞일 수 있어 코드만 담는다.
export class AiError extends Error {
  override readonly name = 'AiError';

  constructor(readonly code: AiErrorCode) {
    super(code);
  }
}

const NETWORK_ERROR_NAMES = new Set(['AbortError', 'TimeoutError']);
const NETWORK_ERROR_MESSAGES = new Set(['fetch failed', 'terminated']);
const NETWORK_ERROR_CODES = new Set([
  'ECONNABORTED',
  'ECONNREFUSED',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENETDOWN',
  'ENETUNREACH',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EPIPE',
  'ETIMEDOUT',
]);

function isNetworkFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (NETWORK_ERROR_NAMES.has(error.name) || NETWORK_ERROR_MESSAGES.has(error.message)) return true;
  // Electron net.fetch는 Chromium 오류 이름을 문구로 돌려준다.
  if (error.message.startsWith('net::ERR_')) return true;
  if ('code' in error && typeof error.code === 'string' && NETWORK_ERROR_CODES.has(error.code)) return true;
  return isNetworkFailure(error.cause);
}

// 호출 실패를 공통 코드로 바꾼다. 사용자가 멈춘 경우는 오류가 아니므로 'cancelled'로 구분한다.
export function classifyFailure(error: unknown, signal: AbortSignal): AiErrorCode | 'cancelled' {
  if (signal.aborted) return 'cancelled';
  if (error instanceof AiError) return error.code;
  return isNetworkFailure(error) ? 'network' : 'provider';
}
