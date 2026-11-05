import { memo, useLayoutEffect, useMemo, useRef } from 'react';
import temml from 'temml';
import 'temml/dist/Temml-Local.css';
import { parseBlocks, type Inline } from './answer-format';

// 수식은 MathML로 표시한다. 문자열을 HTML로 넣지 않고 temml이 DOM을 직접 만들므로, 배포 CSP(style-src 'self')에 막히지 않는다.
// trust: false라서 \href, \includegraphics 같은 외부 연결 명령은 실패로 처리된다.
function renderMath(latex: string, display: boolean): HTMLElement | null {
  const holder = document.createElement('span');
  try {
    temml.render(latex, holder, { displayMode: display, throwOnError: true, trust: false });
    return holder;
  } catch {
    return null;
  }
}

const MathView = memo(function MathView({ latex, display }: { latex: string; display: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);
  const rendered = useMemo(() => renderMath(latex, display), [latex, display]);

  useLayoutEffect(() => {
    if (rendered !== null) ref.current?.replaceChildren(rendered);
  }, [rendered]);

  if (rendered === null) {
    return (
      <span className="math-failed" data-testid="math-failed">
        <code>{latex}</code> 수식을 표시하지 못했습니다
      </span>
    );
  }
  return <span ref={ref} className={display ? 'math-display' : 'math-inline'} data-testid="math" />;
});

function Inlines({ inlines }: { inlines: Inline[] }) {
  return (
    <>
      {inlines.map((inline, index) => {
        switch (inline.kind) {
          case 'text':
            return <span key={index}>{inline.text}</span>;
          case 'bold':
            return (
              <strong key={index}>
                <Inlines inlines={inline.children} />
              </strong>
            );
          case 'em':
            return (
              <em key={index}>
                <Inlines inlines={inline.children} />
              </em>
            );
          case 'code':
            return <code key={index}>{inline.text}</code>;
          case 'math':
            return <MathView key={index} latex={inline.latex} display={inline.display} />;
          case 'pending-math':
            return (
              <span key={index} className="math-pending" data-testid="math-pending">
                수식…
              </span>
            );
        }
      })}
    </>
  );
}

// 답변 글을 서식에 맞게 표시한다. 문단은 줄 안 요소로 두어 뒤에 붙는 근거 라벨이 같은 줄에 이어진다.
export function AnswerText({ text, streaming = false }: { text: string; streaming?: boolean }) {
  const blocks = useMemo(() => parseBlocks(text, streaming), [text, streaming]);
  return (
    <>
      {blocks.map((block, index) => {
        switch (block.kind) {
          case 'paragraph':
            return (
              <span key={index}>
                <Inlines inlines={block.inlines} />
              </span>
            );
          case 'heading':
            return (
              <strong key={index} className="answer-heading">
                <Inlines inlines={block.inlines} />
              </strong>
            );
          case 'list': {
            const items = block.items.map((item, itemIndex) => (
              <li key={itemIndex}>
                <Inlines inlines={item} />
              </li>
            ));
            return block.ordered ? <ol key={index}>{items}</ol> : <ul key={index}>{items}</ul>;
          }
          case 'code':
            return (
              <pre key={index} className="answer-code">
                <code>{block.text}</code>
              </pre>
            );
        }
      })}
    </>
  );
}
