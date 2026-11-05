import type { AiErrorCode } from '../../shared/ipc/contract';

// https://developers.openai.com/api/docs/guides/error-codes (2026-11-05 확인).
// 결제·한도 코드는 재시도해도 풀리지 않는다. error.type은 이 경우 insufficient_quota일 수 있다.
const QUOTA_CODES = new Set([
  'insufficient_quota',
  'credit_balance_exhausted',
  'organization_spend_limit_exceeded',
  'project_spend_limit_exceeded',
  'organization_usage_limit_exceeded',
]);

function readErrorField(body: string, field: 'code' | 'type'): string | null {
  try {
    const parsed: unknown = JSON.parse(body);
    if (typeof parsed !== 'object' || parsed === null || !('error' in parsed)) return null;
    const { error } = parsed;
    if (typeof error !== 'object' || error === null || !(field in error)) return null;
    const value = (error as Record<string, unknown>)[field];
    return typeof value === 'string' ? value : null;
  } catch {
    return null;
  }
}

// OpenAI의 실패 응답을 공통 코드로 바꾼다. 응답 본문은 판단에만 쓰고 어디에도 보관하지 않는다.
export function classifyOpenAiResponse(status: number, body: string): AiErrorCode {
  const code = readErrorField(body, 'code');
  const type = readErrorField(body, 'type');

  if (status === 401 || code === 'invalid_api_key') return 'invalid-key';
  if (status === 429) {
    const outOfQuota = (code !== null && QUOTA_CODES.has(code)) || (type !== null && QUOTA_CODES.has(type));
    return outOfQuota ? 'insufficient-quota' : 'rate-limited';
  }
  // 403은 문서상 지역 제한이다. 키를 바꿔 입력해도 풀리지 않으므로 키 오류로 안내하지 않는다.
  return 'provider';
}

// 스트림 도중 response.failed나 error 이벤트로 받은 코드를 공통 코드로 바꾼다.
export function classifyOpenAiStreamCode(code: string | null): AiErrorCode {
  if (code === null) return 'provider';
  if (code === 'invalid_api_key') return 'invalid-key';
  if (QUOTA_CODES.has(code)) return 'insufficient-quota';
  if (code === 'rate_limit_exceeded' || code === 'slow_down') return 'rate-limited';
  return 'provider';
}
