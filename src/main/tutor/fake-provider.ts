import type { ParagraphSource } from '../../shared/ipc/contract';
import { formatPageRange } from '../../shared/send-scope-format';
import type { TutorProvider, TutorProviderEvent, TutorProviderRequest } from './provider';

// 화면을 확인하기 위한 가짜 응답. 네트워크를 쓰지 않고 문서 내용도 읽지 않으며, 답변 문장에도 가짜임을 밝힌다.
// 3단계에서 실제 제공사 어댑터로 바꾼다.
const FIRST_WAIT_MS = 300;
const CHUNK_WAIT_MS = 30;
const CHUNK_LENGTH = 6;

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

function needsRecap({ question, scope, correction }: TutorProviderRequest): boolean {
  return correction !== null || scope.selection?.kind === 'area' || /수식|도표|그림/.test(question);
}

function buildParagraphs({ scope, question, correction }: TutorProviderRequest): { text: string; source: ParagraphSource }[] {
  const range = formatPageRange(scope);
  const quoted = question.length > 40 ? `${question.slice(0, 40)}…` : question;
  const corrected = correction === null ? '' : ' 고친 내용을 받았다고 가정한 문장입니다.';
  return [
    {
      text: `[가짜 응답] 이 문장은 AI가 쓴 답이 아니라 화면 확인용 고정 문장입니다. 받은 질문은 "${quoted}"이고, 확정된 범위는 ${range}입니다.${corrected}`,
      source: { kind: 'page', page: scope.basePage },
    },
    {
      text: '[가짜 응답] 이 문단은 일반 지식 라벨이 어떻게 보이는지 확인하기 위한 문장입니다. 문서 내용과 관계없습니다.',
      source: { kind: 'general' },
    },
    {
      text: '[가짜 응답] 이 문단은 범위 밖 쪽을 근거로 내세운 경우입니다. 범위 밖 번호는 누를 수 있는 라벨이 되지 않고 글자로 남아야 합니다.',
      source: { kind: 'page', page: scope.lastPage + 50 },
    },
  ];
}

export const fakeTutorProvider: TutorProvider = {
  async *stream(request: TutorProviderRequest, signal: AbortSignal): AsyncIterable<TutorProviderEvent> {
    // 기다리는 사이에 바뀌는 값이라 매번 함수로 읽는다.
    const stopped = (): boolean => signal.aborted;
    await wait(FIRST_WAIT_MS, signal);
    if (stopped()) return;

    if (needsRecap(request)) {
      yield {
        type: 'recap',
        correction: request.correction,
        segments: [
          { text: '[가짜 응답] 실제로 읽은 내용이 아닌 예시입니다. x_i = ', uncertain: false },
          { text: 'a_i + b', uncertain: true },
        ],
      };
    }

    for (const [paragraph, { text, source }] of buildParagraphs(request).entries()) {
      for (let start = 0; start < text.length; start += CHUNK_LENGTH) {
        await wait(CHUNK_WAIT_MS, signal);
        if (stopped()) return;
        yield { type: 'delta', paragraph, text: text.slice(start, start + CHUNK_LENGTH) };
      }
      yield { type: 'paragraph-end', paragraph, source };
    }
  },
};
