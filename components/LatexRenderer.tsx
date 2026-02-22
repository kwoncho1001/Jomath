

import React, { useRef, useEffect } from 'react';
import katex from 'katex';

interface LatexRendererProps {
  text: string;
}

/**
 * 수식 중복 제거 및 전처리 함수
 */
const preprocessLatexString = (rawText: string): string => {
  if (!rawText) return '';

  // 1. $...$ 또는 $$...$$ 패턴과 그 뒤에 오는 텍스트를 찾음
  // ([ \t]*$1)? 부분은 수식 내부의 내용($1)이 수식 바로 뒤에 한 번 더 나오는지 확인
  const dedupePattern = /(?<!\\)(\${1,2})(.*?)(?<!\\)\1([ \t]*\2)?/g;

  return rawText.replace(dedupePattern, (match, delimiter, mathContent, repetition) => {
    // 수식 뒤에 내용이 반복된다면 반복되는 부분(repetition)을 제외하고 수식만 반환
    return `${delimiter}${mathContent}${delimiter}`;
  });
};

export const LatexRenderer: React.FC<LatexRendererProps> = ({ text }) => {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (ref.current) {
      ref.current.innerHTML = ''; 
      const processedText = preprocessLatexString(text);

      // $$...$$ (디스플레이) 또는 $...$ (인라인) 매칭 regex
      const mathRegex = /(?<!\\)(\$\$(.*?)(?<!\\)\$\$)|(?<!\\)(\$(.*?)(?<!\\)\$)/g;
      let lastIndex = 0;
      let match;

      while ((match = mathRegex.exec(processedText)) !== null) {
        // 수식 이전의 일반 텍스트 추가
        if (match.index > lastIndex) {
          const plainText = processedText.substring(lastIndex, match.index);
          ref.current.appendChild(document.createTextNode(plainText));
        }

        // 전체 매칭 결과 중 수식 내용(group 2 또는 group 4) 추출
        const isDisplay = !!match[1];
        const mathExpression = isDisplay ? match[2] : match[4];

        try {
          const mathHtml = katex.renderToString(mathExpression, {
            throwOnError: false,
            displayMode: isDisplay,
            strict: false,
            output: 'html', // PDF 캡처 호환성을 위해 HTML 전용 출력 권장
          });
          const span = document.createElement('span');
          span.innerHTML = mathHtml;
          ref.current.appendChild(span);
        } catch (e) {
          ref.current.appendChild(document.createTextNode(match[0]));
        }
        lastIndex = mathRegex.lastIndex;
      }

      if (lastIndex < processedText.length) {
        ref.current.appendChild(document.createTextNode(processedText.substring(lastIndex)));
      }
    }
  }, [text]);

  return <span ref={ref} className="latex-math"></span>;
};
