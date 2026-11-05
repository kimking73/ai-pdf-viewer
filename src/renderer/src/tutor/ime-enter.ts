// 한글 조합 중 Enter 처리(docs/design-contract.md 7.3절). DOM과 분리해 이벤트 순서를 단위 테스트로 확인한다.
// macOS와 Chromium의 순서는 고정되어 있지 않다. 다음 두 순서를 모두 한 번만 전송으로 처리한다.
//   A. keydown(조합 중) -> compositionend
//   B. compositionend -> keydown(조합 아님)

const HANGUL = /[ᄀ-ᇿ㄰-㆏ꥠ-꥿가-힯ힰ-퟿]/;

export interface EnterKey {
  key: string;
  shiftKey: boolean;
  isComposing: boolean;
  keyCode: number;
}

/** submit: 전송, block: 기본 동작만 막음, pass: 브라우저에 맡김. */
export type KeyDecision = 'submit' | 'block' | 'pass';

/** 조합이 끝난 뒤 할 일. */
export type CompositionDecision = 'submit' | 'newline' | 'none';

export class ImeEnterGuard {
  private pending: 'submit' | 'newline' | null = null;
  private ignoreNextEnter = false;

  onKeyDown(event: EnterKey): KeyDecision {
    if (event.key !== 'Enter' && event.keyCode !== 229) {
      this.ignoreNextEnter = false;
      return 'pass';
    }
    const composing = event.isComposing || event.keyCode === 229;
    if (composing) {
      // 조합 중 일반 글자 입력도 keyCode 229로 온다. Enter일 때만 예약한다.
      if (event.key === 'Enter') this.pending = event.shiftKey ? 'newline' : 'submit';
      return 'pass';
    }
    if (this.ignoreNextEnter) {
      this.ignoreNextEnter = false;
      return 'block';
    }
    return event.shiftKey ? 'pass' : 'submit';
  }

  /** 조합이 끝났을 때 호출한다. 결과는 입력값이 갱신된 뒤 실행한다. */
  onCompositionEnd(data: string): CompositionDecision {
    const { pending } = this;
    if (pending === null) return 'none';
    this.pending = null;
    // 조합을 끝낸 그 Enter가 뒤따라 다시 오면 무시한다.
    this.ignoreNextEnter = true;
    if (pending === 'newline') return 'newline';
    return HANGUL.test(data) ? 'submit' : 'none';
  }

  /** 뒤따르는 Enter가 오지 않은 경우를 대비해 잠시 뒤 호출한다. */
  clearIgnore(): void {
    this.ignoreNextEnter = false;
  }
}
