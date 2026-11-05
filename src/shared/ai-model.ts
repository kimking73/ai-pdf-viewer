import type { AiProviderId, SendScope } from './ipc/contract';

// 제공사별 표시 이름과 호출 대상. 메인의 어댑터와 화면이 함께 쓴다.
// OpenAI 모델은 4단계 품질 확인 전까지의 임시값이다. 이미지 입력을 지원하는 가장 저렴한 모델을 골랐다(2026-11-05 공식 문서 기준).
export const OPENAI_MODEL = 'gpt-6-luna';

export const AI_PROVIDERS: Record<AiProviderId, { name: string; target: string }> = {
  openai: { name: 'OpenAI', target: `모델 ${OPENAI_MODEL}` },
  // POSTECH AI는 모델을 요청으로 고르지 않고 에이전트 주소로 정해진다.
  postech: { name: 'POSTECH AI', target: '에이전트 a1/gpt' },
};

export const AI_PROVIDER_IDS: AiProviderId[] = ['openai', 'postech'];

export function providerName(provider: SendScope['provider']): string {
  return provider === 'fake' ? '가짜 응답' : AI_PROVIDERS[provider].name;
}
