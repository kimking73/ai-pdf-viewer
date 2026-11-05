import { useRef, useState } from 'react';
import { ImeEnterGuard } from './ime-enter';

interface ComposerProps {
  value: string;
  onChange: (value: string) => void;
  /** 받아들였으면 true. 입력창을 비운다. 공백뿐인 입력은 여기까지 오지 않는다. */
  onSubmit: (text: string) => boolean;
  label: string;
  placeholder?: string;
  describedBy?: string;
  disabled?: boolean;
  inputRef?: React.RefObject<HTMLTextAreaElement | null>;
  testId?: string;
}

const IGNORE_FOLLOWING_ENTER_MS = 100;

// 질문 입력창과 '잘못 읽음' 입력이 함께 쓰는 공용 입력(docs/design-contract.md 7.3절).
export function Composer({ value, onChange, onSubmit, label, placeholder, describedBy, disabled, inputRef, testId }: ComposerProps) {
  const [guard] = useState(() => new ImeEnterGuard());
  const ownRef = useRef<HTMLTextAreaElement>(null);
  const ref = inputRef ?? ownRef;

  const submit = (): void => {
    const text = ref.current?.value ?? '';
    if (text.trim() !== '' && onSubmit(text)) onChange('');
  };

  return (
    <textarea
      ref={ref}
      className="composer"
      data-testid={testId}
      aria-label={label}
      aria-describedby={describedBy}
      placeholder={placeholder}
      disabled={disabled}
      value={value}
      onChange={(event) => {
        onChange(event.target.value);
      }}
      onKeyDown={(event) => {
        const decision = guard.onKeyDown({
          key: event.key,
          shiftKey: event.shiftKey,
          isComposing: event.nativeEvent.isComposing,
          // 입력기 조합은 아직 keyCode 229로만 알 수 있는 순서가 있다(계약 7.3절).
          // eslint-disable-next-line @typescript-eslint/no-deprecated
          keyCode: event.keyCode,
        });
        if (decision === 'pass') return;
        event.preventDefault();
        if (decision === 'submit') submit();
      }}
      onCompositionEnd={(event) => {
        const decision = guard.onCompositionEnd(event.data);
        if (decision === 'none') {
          setTimeout(() => {
            guard.clearIgnore();
          }, IGNORE_FOLLOWING_ENTER_MS);
          return;
        }
        // 확정된 글자가 입력값에 들어간 뒤 실행한다.
        setTimeout(() => {
          const element = ref.current;
          if (decision === 'submit') {
            submit();
          } else if (element !== null) {
            element.setRangeText('\n', element.selectionStart, element.selectionEnd, 'end');
            onChange(element.value);
          }
        }, 0);
        setTimeout(() => {
          guard.clearIgnore();
        }, IGNORE_FOLLOWING_ENTER_MS);
      }}
    />
  );
}
