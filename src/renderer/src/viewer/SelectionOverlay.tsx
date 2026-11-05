import { useLayoutEffect, useRef } from 'react';
import type { ActiveSelection, PageRect } from './selection-model';

interface SelectionOverlayProps {
  selection: ActiveSelection;
  /** 스크롤 영역 좌표의 쪽 위치. */
  pageBox: (page: number) => { left: number; top: number; width: number; height: number } | null;
  /** 쪽을 담은 요소. 크기가 바뀌면 배율이나 폭이 바뀐 것이므로 위치를 다시 잡는다. */
  pagesElement: HTMLElement | null;
  showAsk: boolean;
  onAsk: () => void;
}

const percentStyle = (rect: PageRect) => ({
  left: `${String(rect.x * 100)}%`,
  top: `${String(rect.y * 100)}%`,
  width: `${String(rect.width * 100)}%`,
  height: `${String(rect.height * 100)}%`,
});

// 포커스가 입력창으로 옮겨 가도 선택이 보이도록 앱이 직접 그린다(계약 5.4절). pdf.js가 쪽 DOM을 다시 만들어도
// 지워지지 않게 쪽 바깥에 두고, 위치는 쪽 비율로 잡는다. 저장하지 않으며 주석이 아니다.
export function SelectionOverlay({ selection, pageBox, pagesElement, showAsk, onAsk }: SelectionOverlayProps) {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const element = ref.current;
    if (element === null || pagesElement === null) return;
    const position = (): void => {
      const box = pageBox(selection.page);
      if (box === null) return;
      element.style.left = `${String(box.left)}px`;
      element.style.top = `${String(box.top)}px`;
      element.style.width = `${String(box.width)}px`;
      element.style.height = `${String(box.height)}px`;
    };
    position();
    const observer = new ResizeObserver(position);
    observer.observe(pagesElement);
    return () => {
      observer.disconnect();
    };
  }, [selection.page, pageBox, pagesElement]);

  const lastRect = selection.kind === 'area' ? selection.rect : selection.rects.at(-1);

  return (
    <div ref={ref} className="selection-overlay" data-testid="selection-overlay" data-kind={selection.kind}>
      {selection.kind === 'area' ? (
        <div className="selection-area" data-testid="selection-area" style={percentStyle(selection.rect)} />
      ) : (
        selection.rects.map((rect, index) => <div key={index} className="selection-text" style={percentStyle(rect)} />)
      )}
      {showAsk && lastRect !== undefined && (
        <button
          type="button"
          className="selection-ask"
          data-testid="selection-ask"
          style={{
            left: `${String(Math.min(90, (lastRect.x + lastRect.width) * 100))}%`,
            top: `${String(Math.min(96, (lastRect.y + lastRect.height) * 100))}%`,
          }}
          onClick={onAsk}
        >
          질문하기
        </button>
      )}
    </div>
  );
}
