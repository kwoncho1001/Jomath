

import React, { useMemo, useRef, useState } from 'react';
import type { QuestionDBItem, ProgressMasterItem, TransactionLogItem, AggregatedUnitData, ScoredStudent, AnalysisConfig, ClassificationCsvItem } from '../types';
import { Download, LoaderCircle, Target, BarChart3, TrendingUp, Mail } from 'lucide-react';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import { LatexRenderer } from './LatexRenderer'; // Fix: Corrected typo in import path
// Removed import { generateStablePdf } from '../services/pdfService'; // No longer used

// Utility function to generate AI summary content
export const generateAiSummaryContent = async (
  studentId: string,
  memoizedData: { examScoreReport: ScoredStudent[]; progressMaster: ProgressMasterItem[]; transactionLog: TransactionLogItem[]; questionDb: QuestionDBItem[]; },
  config: AnalysisConfig // To check generateAiReport
): Promise<string> => {
    if (!config.generateAiReport) return ''; // Skip if AI report is disabled
    if (!process.env.API_KEY) {
        console.error("API key is not set for AI summary generation.");
        return "AI API Key가 설정되지 않아 AI 총평을 생성할 수 없습니다.";
    }
    if (!studentId || memoizedData.progressMaster.length === 0) {
        return `'${studentId}' 학생에 대한 분석 데이터가 부족하여 AI 총평을 생성할 수 있습니다.`;
    }

    try {
        const formatScoreForPrompt = (score: number | undefined): string => {
            if (score === undefined || score < 0) return '데이터 부족';
            return `${score.toFixed(1)}점`;
        };

        const studentExams = memoizedData.examScoreReport
            .filter(r => r['학생 이름'] === studentId)
            .sort((a, b) => new Date(b['시험 응시일']).getTime() - new Date(a['시험 응시일']).getTime());
        const latestExam = studentExams[0];

        const studentLogs = memoizedData.transactionLog.sort((a,b) => new Date(b.Date).getTime() - new Date(a.Date).getTime());
        const latestLog = studentLogs[0];
        const qDbMap = new Map(memoizedData.questionDb.map(q => [`${q['시험 ID/교재명'] || q['시험 ID'] || q['시험ID']}-${q['번호']}`, q]));
        const latestQuestion = latestLog ? qDbMap.get(`${latestLog.ExamID}-${latestLog.QuestionNum}`) : null;
        
        const studentProgress = memoizedData.progressMaster;
        const topStrengths = [...studentProgress].filter(p => p.DisplayScore >= 0).sort((a, b) => b.DisplayScore - a.DisplayScore).slice(0, 3);
        const topWeaknesses = [...studentProgress].filter(p => p.DisplayScore >= 0).sort((a, b) => a.DisplayScore - b.DisplayScore).slice(0, 3);
        const topWeakness = topWeaknesses[0];

        const prompt = `
# 역할 정의 (Role)
당신은 학생의 학습 데이터를 정밀 분석하여 학부모님께 보고서를 작성하는 베테랑 교육 컨설턴트입니다. '데이터 부족'은 해당 유형의 실전 테스트 문제 풀이 횟수가 3회 미만으로, 아직 유의미한 평가를 내리기 어렵다는 의미입니다.

# 데이터 참조
'${studentId}' 학생의 다음 데이터를 바탕으로 보고서를 작성하세요:
- 최근 시험 성과: ${latestExam ? `시험 ID '${latestExam['시험 ID']}'에서 ${latestExam['최종 점수']}점, ${latestExam['맞힌 개수']}개 정답, 석차 ${latestExam['석차']}`: '최근 시험 기록 없음.'}
- 최근 학습 단원: ${latestQuestion ? `과목 '${latestQuestion['과목']}', 대단원 '${latestQuestion['대단원']}'` : '최근 학습 기록 없음.'}
- 강점 유형 TOP 3: ${topStrengths.map(p => `${p.DetailType}(${formatScoreForPrompt(p.DisplayScore)})`).join(', ')}
- 약점 유형 TOP 3: ${topWeaknesses.map(p => `${p.DetailType}(${formatScoreForPrompt(p.DisplayScore)})`).join(', ')}
- 주요 약점 심층 분석 ('${topWeakness ? topWeakness.DetailType : ''}'): '상' 난이도 ${formatScoreForPrompt(topWeakness ? topWeakness.Score_High : undefined)}, '중' 난이도 ${formatScoreForPrompt(topWeakness ? topWeakness.Score_Mid : undefined)}, '하' 난이도 ${formatScoreForPrompt(topWeakness ? topWeakness.Score_Low : undefined)}.

# 보고서 작성 규칙 (Strict Rules)
1.  **핵심 지침**: 최종 결과물은 **[인사말]**과 같은 대괄호 섹션 구분자를 **절대 포함해서는 안 됩니다.** 학부모님께 보내는 하나의 완성된 '편지글'처럼, 모든 내용이 자연스럽게 이어지는 줄글 형식으로 작성되어야 합니다. 각 내용은 문단으로 구분하여 가독성을 높여주세요.

2.  **내부 구조 (AI 참고용)**: 보고서 작성 시 다음 6단계의 논리적 흐름을 따르세요. (단, 앞서 말했듯 최종 결과물에 이 단계명들은 노출되면 안 됩니다.)
    -   **인사말**: 학부모님께 간단히 인사합니다.
    -   **최근 시험 결과**: 가장 최근 시험 결과를 바탕으로 학생의 성취도를 객관적으로 전달합니다.
    -   **최근 학습 단원 & 강점**: 최근 학습한 단원을 언급하고, 학생의 강점을 데이터에 근거하여 설명합니다.
    -   **최근 학습 단원 & 약점**: 보완이 필요한 약점을 분석하고, 그 원인을 진단합니다. '데이터 부족' 항목이 있다면, 이는 아직 평가하기 이르다는 의미로 설명해주세요.
    -   **추후 학습 계획**: 약점을 보완하고, 데이터가 부족한 영역의 평가를 위해 학원의 구체적인 지도 계획을 제시합니다.
    -   **끝맺음**: 정해진 문구로 마무리합니다.

3.  **작성 스타일**:
    -   추상적이거나 문학적인 표현을 피하고, 학부모가 이해하기 쉬운 직관적인 언어를 사용하세요.
    -   선생님이 직접 관찰하고 분석한 듯한 전문적이고 신뢰감 있는 어조를 유지하세요.
    -   수학 기호는 텍스트로 풀어쓰거나 \\sum 와 같이 인라인 형식만 사용하세요. ($$..$$ 형식 금지)

4.  **고정 문구**:
    -   보고서의 가장 마지막 끝맺음은 반드시 다음 문장으로 끝내야 합니다: "늘 저희 학원을 믿고 소중한 아이를 맡겨주셔서 깊이 감사드립니다. 조주석수학학원 원장 조현준 드림."

위 규칙을 엄격히 준수하여 '${studentId}' 학생의 보고서를 지금 작성해주세요.
        `;

        let retries = 0;
        const maxRetries = 3;
        let delay = 2000;

        const fetchSummary = async (): Promise<string> => {
            const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
            try {
                const response = await ai.models.generateContent({
                    model: 'gemini-3-flash-preview',
                    contents: prompt,
                });
                if (!response.text) throw new Error("Empty AI response");
                return response.text;
            } catch (err: any) {
                const isQuotaExhausted = (err.message && err.message.includes("429")) || err.status === 429 || (err.message && err.message.includes("RESOURCE_EXHAUSTED"));
                if (isQuotaExhausted && retries < maxRetries) {
                    retries++;
                    await new Promise(res => setTimeout(res, delay));
                    delay *= 2; 
                    return fetchSummary();
                }
                throw err;
            }
        };

        const result = await fetchSummary();
        return result;

    } catch (err: any) {
        console.error("AI summary generation failed:", err);
        if ((err.message && err.message.includes("429")) || (err.message && err.message.includes("RESOURCE_EXHAUSTED"))) {
            return "AI 서비스 이용량 초과. 잠시 후 다시 시도해주세요.";
        } else {
            return "AI 기반 피드백 생성에 실패했습니다.";
        }
    }
};

interface ReportProps {
  studentId: string;
  selectedSubject: string;
  questionDb: QuestionDBItem[];
  progressMaster: ProgressMasterItem[];
  transactionLog: TransactionLogItem[];
  examScoreReport: ScoredStudent[];
  allSubUnitsCount: number;
  selectedSubUnitsCount: number;
  isBulkDownloadMode?: boolean;
  analysisConfig: AnalysisConfig;
  classificationData?: ClassificationCsvItem[]; // Add classification data for ordering
  onSendEmail?: () => void;
  isEmailing?: boolean;
}

const getBarColorStyle = (score: number): React.CSSProperties => {
  if (score < 0) return { backgroundColor: '#e5e7eb' }; // 데이터 부족 (회색)
  
  if (score < 40) return { 
    backgroundColor: '#ef4444', // 단색 대비책 (빨강)
    backgroundImage: 'linear-gradient(to right, #fca5a5, #ef4444)' 
  };
  if (score < 70) return { 
    backgroundColor: '#f97316', // 단색 대비책 (주황)
    backgroundImage: 'linear-gradient(to right, #fdba74, #f97316)' 
  };
  return { 
    backgroundColor: '#14b8a6', // 단색 대비책 (청록)
    backgroundImage: 'linear-gradient(to right, #5eead4, #14b8a6)' 
  };
};

const getMasteryLevel = (score: number): string => {
    if (score < 0) return '데이터 부족';
    if (score <= 64) return 'Initial';
    if (score <= 84) return 'Intermediate';
    return 'Master';
};

const MetricGrid: React.FC<{ metrics: Record<string, string | number> }> = ({ metrics }) => (
  <div className="grid grid-cols-4 gap-2 mt-4 text-center">
    {Object.entries(metrics).map(([key, value]) => {
      let displayValue: string | number = value;
      let isDataMissing = false;

      if (key === '상 난이도' || key === '중 난이도' || key === '하 난이도') {
        const numValue = parseFloat(String(value));
        if (numValue < 0) {
          displayValue = '데이터 부족';
          isDataMissing = true;
        } else {
          displayValue = numValue.toFixed(1);
        }
      }

      return (
        <div key={key} className="bg-slate-50 p-2 rounded-lg border border-slate-100 shadow-sm">
          <div className="text-[10px] text-slate-400 font-bold uppercase tracking-tight mb-1">{key}</div>
          <div className={`font-bold text-slate-700 ${isDataMissing ? 'text-xs' : 'text-sm'}`}>
            {displayValue}
          </div>
        </div>
      );
    })}
  </div>
);

export const Report: React.FC<ReportProps> = ({ 
    studentId, selectedSubject, questionDb, progressMaster, transactionLog, examScoreReport,
    allSubUnitsCount, selectedSubUnitsCount, isBulkDownloadMode, analysisConfig, classificationData,
    onSendEmail, isEmailing
}) => {
    const [isDownloadingPdf, setIsDownloadingPdf] = useState(false);

    const reportRef = useRef<HTMLDivElement>(null);
    
    // Helper to get sort index from classification data
    const getSortIndex = useMemo(() => {
        const orderMap = new Map<string, number>();
        if (classificationData) {
            classificationData.forEach((item, index) => {
                const subject = item['과목명'] || '미분류';
                const large = item['대단원'] || '미분류';
                const small = item['소단원'] || '일반';
                const detail = item['세부 유형'];
                
                // Create composite keys for different levels of granularity
                const subjectKey = subject;
                const largeKey = `${subject}|${large}`;
                const smallKey = `${subject}|${large}|${small}`;
                const detailKey = `${subject}|${large}|${small}|${detail}`;

                // Only set if not already set (to preserve first occurrence order)
                if (!orderMap.has(subjectKey)) orderMap.set(subjectKey, index);
                if (!orderMap.has(largeKey)) orderMap.set(largeKey, index);
                if (!orderMap.has(smallKey)) orderMap.set(smallKey, index);
                if (!orderMap.has(detailKey)) orderMap.set(detailKey, index);
            });
        }
        return (key: string, level: 'subject' | 'large' | 'small' | 'detail', parentKey: string = '') => {
            let lookupKey = key;
            if (level !== 'subject') {
                lookupKey = parentKey ? `${parentKey}|${key}` : key;
            }
            return orderMap.get(lookupKey) ?? 999999;
        };
    }, [classificationData]);

    const studentProgress = useMemo(() => progressMaster.filter(p => p.StudentID === studentId), [progressMaster, studentId]);
    const studentLog = useMemo(() => transactionLog.filter(l => l.StudentID === studentId), [transactionLog, studentId]);
    
    const progressMap = useMemo(() => {
        const map = new Map<string, ProgressMasterItem>();
        studentProgress.forEach(item => map.set(item.DetailType, item));
        return map;
    }, [studentProgress]);
    
    const groupedData = useMemo(() => {
        const root = new Map<string, Map<string, Map<string, string[]>>>();
        const filteredQ = questionDb.filter(q => (q['과목명'] || q['과목']) === selectedSubject);

        filteredQ.forEach(item => {
            const subject = item['과목'] || item['과목명'] || '미분류';
            const large = item['대단원'] || '미분류';
            const small = item['소단원'] || '일반';
            const detail = item['세부 유형'];

            if (!root.has(subject)) root.set(subject, new Map());
            const largeMap = root.get(subject)!;
            if (!largeMap.has(large)) largeMap.set(large, new Map());
            const smallMap = largeMap.get(large)!;
            if (!smallMap.has(small)) smallMap.set(small, []);
            const detailList = smallMap.get(small)!;
            if (!detailList.includes(detail)) detailList.push(detail);
        });

        return Array.from(root.entries()).sort((a, b) => {
            return getSortIndex(a[0], 'subject') - getSortIndex(b[0], 'subject');
        });
    }, [questionDb, selectedSubject, getSortIndex]);

    const unitLevelAnalysis = useMemo(() => {
        const typeToUnitMap = new Map<string, { subject: string; large: string; medium: string }>();
        questionDb
            .filter(q => (q['과목명'] || q['과목']) === selectedSubject)
            .forEach(q => {
                if (!typeToUnitMap.has(q['세부 유형'])) {
                    typeToUnitMap.set(q['세부 유형'], {
                        subject: q['과목'] || q['과목명'] || '미분류',
                        large: q['대단원'] || '미분류',
                        medium: q['중단원'] || '일반',
                    });
                }
            });

        const aggregation = new Map<string, Map<string, Map<string, {
            weightedScoreSum: number;
            totalAttempts: number;
            totalCorrect: number;
            types: Set<string>;
        }>>>();

        studentProgress.forEach(progress => {
            const effectiveDisplayScore = progress.DisplayScore >= 0 ? progress.DisplayScore : 0;
            const unitInfo = typeToUnitMap.get(progress.DetailType);
            if (unitInfo) {
                const { subject, large, medium } = unitInfo;
                if (!aggregation.has(subject)) aggregation.set(subject, new Map());
                const subjectMap = aggregation.get(subject)!;
                if (!subjectMap.has(large)) subjectMap.set(large, new Map());
                const largeMap = subjectMap.get(large)!;
                if (!largeMap.has(medium)) {
                    largeMap.set(medium, { weightedScoreSum: 0, totalAttempts: 0, totalCorrect: 0, types: new Set() });
                }
                const mediumUnitData = largeMap.get(medium)!;
                const correctAnswers = Math.round((progress.Accuracy / 100) * progress.Total_Attempts);
                mediumUnitData.weightedScoreSum += effectiveDisplayScore * progress.Total_Attempts;
                mediumUnitData.totalAttempts += progress.Total_Attempts; // Fix: Correctly aggregate total attempts
                mediumUnitData.totalCorrect += correctAnswers;
                mediumUnitData.types.add(progress.DetailType);
            }
        });
        
        const result: AggregatedUnitData[] = [];
        for (const [subjectName, subjectMap] of aggregation.entries()) {
            for (const [largeUnitName, largeUnitRaw] of subjectMap.entries()) {
                const largeUnitSubUnits: AggregatedUnitData[] = [];
                let largeUnitWeightedScoreSum = 0;
                let largeUnitTotalAttempts = 0;
                let largeUnitTotalCorrect = 0;
                let largeUnitTypes = new Set<string>();

                for (const [mediumUnitName, mediumUnitRaw] of largeUnitRaw.entries()) {
                    if (mediumUnitRaw.totalAttempts > 0) {
                        largeUnitSubUnits.push({
                            name: mediumUnitName,
                            displayScore: mediumUnitRaw.weightedScoreSum / mediumUnitRaw.totalAttempts,
                            accuracy: (mediumUnitRaw.totalCorrect / mediumUnitRaw.totalAttempts) * 100,
                            totalAttempts: mediumUnitRaw.totalAttempts,
                            constituentTypes: mediumUnitRaw.types.size,
                            subUnits: [],
                        });
                        largeUnitWeightedScoreSum += mediumUnitRaw.weightedScoreSum;
                        largeUnitTotalAttempts += mediumUnitRaw.totalAttempts;
                        largeUnitTotalCorrect += mediumUnitRaw.totalCorrect;
                        mediumUnitRaw.types.forEach(type => largeUnitTypes.add(type));
                    }
                }

                if (largeUnitTotalAttempts > 0) {
                    result.push({
                        name: `${subjectName} > ${largeUnitName}`,
                        displayScore: largeUnitWeightedScoreSum / largeUnitTotalAttempts,
                        accuracy: (largeUnitTotalCorrect / largeUnitTotalAttempts) * 100,
                        totalAttempts: largeUnitTotalAttempts,
                        constituentTypes: largeUnitTypes.size,
                        subUnits: largeUnitSubUnits.sort((a,b) => {
                             // Sort small units by classification order
                             return getSortIndex(a.name, 'small', `${subjectName}|${largeUnitName}`) - getSortIndex(b.name, 'small', `${subjectName}|${largeUnitName}`);
                        }),
                    });
                }
            }
        }
        return result.sort((a,b) => {
             // Sort large units (formatted as "Subject > Large") by classification order
             const [subjectA, largeA] = a.name.split(' > ');
             const [subjectB, largeB] = b.name.split(' > ');
             
             if (subjectA !== subjectB) {
                 return getSortIndex(subjectA, 'subject') - getSortIndex(subjectB, 'subject');
             }
             return getSortIndex(largeA, 'large', subjectA) - getSortIndex(largeB, 'large', subjectB);
        });
    }, [questionDb, selectedSubject, studentProgress, getSortIndex]);

    const reportTitle = useMemo(() => {
        const today = new Date();
        const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1).getDay();
        const week = Math.ceil((today.getDate() + firstDayOfMonth) / 7);
        return `${today.getFullYear()}년 ${today.getMonth() + 1}월 ${week}주차 - ${studentId} 유형 분석 보고서`;
    }, [studentId]);

    // Removed AI summary related logic and effects


    const handleDownloadPdf = async () => {
        if (!reportRef.current) return;
        setIsDownloadingPdf(true);

        const reportElement = reportRef.current;
        
        // Store original inline styles and classes of the report element before modification
        const originalCssText = reportElement.style.cssText;
        const originalClassList = Array.from(reportElement.classList);

        // Inject temporary CSS to freeze animations, shadows, and apply specific capture layout
        const style = document.createElement('style');
        style.innerHTML = `
            /* Generic capture mode disabling transitions/animations/shadows */
            .capturing * {
                transition: none !important;
                animation: none !important;
                box-shadow: none !important;
                text-shadow: none !important;
            }
            .capturing .h-full {
                transition-property: none !important; /* Prevent 0% color bar */
            }
            /* Overall report container styles for consistent PDF rendering */
            .capturing {
                width: 900px !important;
                min-width: 900px !important;
                background-color: white !important;
                line-height: 1.2 !important; /* Prevent text shifting */
                -webkit-font-smoothing: antialiased !important;
                -moz-osx-smoothing: grayscale !important;
                position: relative !important; /* Ensure relative positioning for correct rendering context */
                z-index: 9999 !important; /* Bring to front to ensure visibility for capture */
            }
            /* 텍스트 짤림 방지 */
            .capturing .truncate {
                overflow: visible !important;
                white-space: normal !important;
            }
            /* 섹션 강제 페이지 나누기 방지 및 여백 */
            .capturing [data-pdf-section] {
                break-inside: avoid !important;
                page-break-inside: avoid !important;
                margin-bottom: 20px !important; /* Add consistent margin between sections */
            }
            /* LaTeX 수식 캡처 보정 */
            .capturing .latex-math {
                display: inline-block !important; /* 캡처 시 위치 이탈 방지 */
                font-family: 'KaTeX_Main', 'Inter', sans-serif !important;
            }
        `;
        document.head.appendChild(style);
        reportElement.classList.add('capturing'); // Add capturing class to the report div

        // 폰트 및 이미지 로딩 완벽 대기
        if (document.fonts) await document.fonts.ready;
        await new Promise(resolve => setTimeout(resolve, 500)); // 시간을 0.5초로 단축

        try {
            const pdf = new jsPDF('p', 'mm', 'a4');
            const pageWidth = pdf.internal.pageSize.getWidth();
            const margin = 12;
            const contentWidth = pageWidth - (margin * 2);
            
            // 3. 머리글(Header) 캡처
            const headerElement = reportElement.querySelector('[data-pdf-header]') as HTMLElement;
            const headerCanvas = await html2canvas(headerElement, {
                scale: 1.5, // 선명도 조정 (2 -> 1.5)
                useCORS: true,
                backgroundColor: '#ffffff',
                foreignObjectRendering: false, // 검은 박스 방지 핵심 설정
                logging: false, // 로깅 비활성화
                fontEmbedCSS: true // 폰트 포함 설정 추가
                // Removed windowWidth: 900, relying on CSS for overall width
            });
            const headerImgData = headerCanvas.toDataURL('image/jpeg', 0.7); // 품질 조정 (0.8 -> 0.7)
            const headerHeight = (headerCanvas.height * contentWidth) / headerCanvas.width; // Corrected height calculation

            // 4. 섹션별 순차 캡처 (요소가 잘리지 않도록 섹션 단위로 처리)
            const sections = Array.from(reportElement.querySelectorAll('[data-pdf-section]')) as HTMLElement[];
            let currentY = margin;

            for (let i = 0; i < sections.length; i++) {
                const section = sections[i];
                const canvas = await html2canvas(section, {
                    scale: 1.5, // 선명도 조정 (2 -> 1.5)
                    useCORS: true,
                    backgroundColor: '#ffffff',
                    // Removed windowWidth: 900, relying on CSS for overall width
                    foreignObjectRendering: false,
                    logging: false, // 로깅 비활성화
                    fontEmbedCSS: true // 폰트 포함 설정 추가
                });

                const imgData = canvas.toDataURL('image/jpeg', 0.7); // 품질 조정 (0.8 -> 0.7)
                const imgHeight = (canvas.height * contentWidth) / canvas.width;

                // 페이지 넘김 처리 (머리글 공간 확보)
                if (currentY + imgHeight > pdf.internal.pageSize.getHeight() - (margin + headerHeight + 10)) { // ~285 total height, adjust for header and bottom margin
                    pdf.addPage();
                    currentY = margin;
                }

                // 모든 페이지 상단에 머리글 삽입
                if (currentY === margin) {
                    pdf.addImage(headerImgData, 'JPEG', margin, margin, contentWidth, headerHeight, undefined, 'MEDIUM');
                    currentY += headerHeight + 6;

                    // Footer: Indigo Line
                    const pageHeight = pdf.internal.pageSize.getHeight();
                    pdf.setDrawColor(79, 70, 229); // Indigo-600
                    pdf.setLineWidth(0.5);
                    pdf.line(margin, pageHeight - margin, pageWidth - margin, pageHeight - margin);
                }

                pdf.addImage(imgData, 'JPEG', margin, currentY, contentWidth, imgHeight, undefined, 'MEDIUM');
                currentY += imgHeight + 4;

                // Force page break after Unit Summary to ensure Details start on Page 2
                if (section.id === 'section-unit-summary') {
                    pdf.addPage();
                    currentY = margin;
                }
            }

            pdf.save(`${reportTitle}.pdf`);
        } catch (error) {
            console.error("PDF 생성 중 치명적 오류:", error);
            alert("리포트 생성에 실패했습니다. 화면을 새로고침 후 다시 시도해 주세요.");
        } finally {
            // 5. 스타일 복구
            reportElement.classList.remove('capturing'); // Remove temporary class
            reportElement.classList.add(...originalClassList); // Restore original classes
            reportElement.style.cssText = originalCssText; // Restore original inline styles
            style.remove(); // Remove injected style
            setIsDownloadingPdf(false);
        }
    };
    
    return (
        <div className="mt-6 border-t border-gray-200 pt-8">
            {!isBulkDownloadMode && (
                <div className="flex flex-col sm:flex-row justify-between items-center mb-8 gap-4 px-2">
                    <div className="text-center sm:text-left">
                        <h3 className="text-2xl font-bold text-gray-800 tracking-tight">
                        <span className="text-indigo-600 border-b-2 border-indigo-200">{studentId}</span> 학생 상세 분석
                        </h3>
                        <p className="text-gray-500 mt-1 font-medium italic">실시간 학습 성취도 및 단원별 숙련도 분석</p>
                    </div>
                    <div className="flex gap-3">
                        <button 
                            onClick={handleDownloadPdf}
                            disabled={isDownloadingPdf}
                            className="flex items-center gap-2 px-6 py-3 bg-indigo-500 text-white rounded-2xl font-bold hover:bg-indigo-600 transition-all shadow-xl shadow-indigo-100 disabled:bg-gray-400"
                        >
                            {isDownloadingPdf ? <LoaderCircle className="w-5 h-5 animate-spin" /> : <Download className="w-5 h-5" />}
                            <span>{isDownloadingPdf ? "PDF 생성 중..." : "PDF 다운로드"}</span>
                        </button>
                        {onSendEmail && (
                            <button 
                                onClick={onSendEmail}
                                disabled={isEmailing}
                                className="flex items-center gap-2 px-6 py-3 bg-indigo-700 text-white rounded-2xl font-bold hover:bg-indigo-800 transition-all shadow-xl shadow-indigo-100 disabled:bg-gray-400"
                            >
                                {isEmailing ? <LoaderCircle className="w-5 h-5 animate-spin" /> : <Mail className="w-5 h-5" />}
                                <span>Email로 전송</span>
                            </button>
                        )}
                    </div>
                </div>
            )}
            
            <div ref={reportRef} className="space-y-12 bg-white p-8 rounded-3xl shadow-2xl border border-gray-100 mx-auto">
                {/* [헤더] - id를 추가하여 스크립트에서 별도 캡처 가능하게 함 */}
                <div id="pdf-header" data-pdf-header className="border-b-2 border-indigo-600 pb-4 mb-6">
                    <div className="flex justify-between items-end">
                        <div className="space-y-1">
                            <h2 className="text-xl font-black text-slate-900 leading-tight tracking-tight">
                                {reportTitle}
                            </h2>
                            <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">
                                Student Intelligence Analysis Report
                            </p>
                        </div>
                        <div className="text-right flex-shrink-0">
                            <p className="font-black text-xl text-indigo-600">조주석수학학원</p>
                            <p className="text-[9px] text-gray-400 font-bold uppercase tracking-widest mt-0.5">
                                Intelligence Feedback System
                            </p>
                        </div>
                    </div>
                </div>
                
                {/* [단원별 요약 섹션] */}
                {unitLevelAnalysis.length > 0 && (
                    <div id="section-unit-summary" data-pdf-section className="space-y-8 bg-slate-50/50 p-8 rounded-[2rem] border border-slate-100 shadow-sm">
                        <div className="flex items-center gap-3 pb-4 border-b border-slate-200">
                            <BarChart3 className="w-6 h-6 text-indigo-500" />
                            <h2 className="text-2xl font-bold text-slate-800 tracking-tight">단원별 성취도 요약</h2>
                        </div>
                        <div className="space-y-8">
                        {unitLevelAnalysis.map((largeUnit) => (
                            <div key={largeUnit.name} className="space-y-4">
                                <div className="flex justify-between items-center px-1">
                                    <h3 className="text-lg font-bold text-slate-700">{largeUnit.name}</h3>
                                    <span className="text-xl font-black text-indigo-600">{largeUnit.displayScore.toFixed(1)}점</span>
                                </div>
                                <div className="w-full bg-slate-200 rounded-full h-4 overflow-hidden shadow-inner">
                                    <div 
                                        className="h-full rounded-full transition-all duration-1000" 
                                        style={{ width: `${largeUnit.displayScore < 0 ? 0 : largeUnit.displayScore}%`, ...getBarColorStyle(largeUnit.displayScore) }}
                                    ></div>
                                </div>
                                {largeUnit.subUnits.length > 0 && (
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-4 mt-6 pt-6 border-t border-slate-200">
                                        {largeUnit.subUnits.map((mediumUnit) => (
                                            <div key={mediumUnit.name} className="flex items-center justify-between">
                                                <h4 className="text-xs font-bold text-slate-500 truncate w-36">{mediumUnit.name}</h4>
                                                <div className="flex items-center gap-3 flex-grow justify-end">
                                                    <div className="w-24 bg-slate-200 rounded-full h-2 overflow-hidden">
                                                        <div 
                                                            className="h-full rounded-full transition-all duration-1000" 
                                                            style={{ width: `${mediumUnit.displayScore < 0 ? 0 : mediumUnit.displayScore}%`, ...getBarColorStyle(mediumUnit.displayScore) }}
                                                        ></div>
                                                    </div>
                                                    <p className="text-xs font-black text-slate-800 w-10 text-right">{mediumUnit.displayScore.toFixed(1)}</p>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        ))}
                        </div>
                    </div>
                )}

                {/* Detailed Analysis with Subject -> Large Unit grouping */}
                {groupedData.map(([subject, largeUnits]) => {
                    const activeLargeUnits = Array.from(largeUnits.entries()).filter(([_, smallUnitsMap]) => {
                        return Array.from(smallUnitsMap.values()).some((details: any) => 
                            details.some((type: any) => {
                                const prog = progressMap.get(type);
                                return prog && prog.Total_Attempts > 0;
                            })
                        );
                    });

                    if (activeLargeUnits.length === 0) return null;

                    return (
                        <div key={subject} className="space-y-10">
                            <div className="space-y-16">
                                {activeLargeUnits.sort((a, b) => getSortIndex(a[0], 'large', subject) - getSortIndex(b[0], 'large', subject)).map(([largeUnit, smallUnitsMap]) => {
                                    const activeSmallUnits = Array.from(smallUnitsMap.entries()).filter(([_, detailTypes]) => {
                                        return (detailTypes as string[]).some((type: string) => {
                                            const prog = progressMap.get(type);
                                            return prog && prog.Total_Attempts > 0;
                                        });
                                    });

                                    if (activeSmallUnits.length === 0) return null;

                                    return (
                                        <div key={largeUnit} className="space-y-12">
                                            {activeSmallUnits.sort((a, b) => getSortIndex(a[0], 'small', `${subject}|${largeUnit}`) - getSortIndex(b[0], 'small', `${subject}|${largeUnit}`)).map(([smallUnit, detailTypes], smallUnitIndex) => {
                                                const activeDetails = (detailTypes as string[]).filter((type: string) => {
                                                    const prog = progressMap.get(type);
                                                    return prog && prog.Total_Attempts > 0;
                                                });
                                                
                                                // Sort active details based on classification order
                                                activeDetails.sort((a, b) => getSortIndex(a, 'detail', `${subject}|${largeUnit}|${smallUnit}`) - getSortIndex(b, 'detail', `${subject}|${largeUnit}|${smallUnit}`));

                                                // Pagination logic: Chunk details into groups of 8
                                                const chunkSize = 8;
                                                const detailChunks = [];
                                                for (let i = 0; i < activeDetails.length; i += chunkSize) {
                                                    detailChunks.push(activeDetails.slice(i, i + chunkSize));
                                                }

                                                return (
                                                    <React.Fragment key={smallUnit}>
                                                        {detailChunks.map((chunk, chunkIndex) => (
                                                            <div 
                                                                id={`section-detail-${largeUnit.replace(/\s+/g, '_')}-${smallUnit.replace(/\s+/g, '_')}-${smallUnitIndex}-${chunkIndex}`} 
                                                                key={`${smallUnit}-${chunkIndex}`} 
                                                                data-pdf-section 
                                                                className="space-y-6"
                                                            >
                                                                
                                                                <div className="flex items-center gap-4 mb-2">
                                                                    <TrendingUp className="w-4 h-4 text-indigo-400" />
                                                                    <h5 className="text-base font-black text-slate-500 uppercase tracking-widest flex items-center gap-2">
                                                                        <span className="text-indigo-600">대단원:</span> <span className="text-slate-700">{largeUnit}</span>
                                                                        <span className="mx-2 text-slate-300">|</span>
                                                                        <span className="text-indigo-400">소단원:</span> <span className="text-slate-700">{smallUnit}</span>
                                                                        {detailChunks.length > 1 && <span className="text-xs text-gray-400 ml-2">({chunkIndex + 1}/{detailChunks.length})</span>}
                                                                    </h5>
                                                                    <div className="flex-grow h-px bg-slate-200"></div>
                                                                </div>
                                                                
                                                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                                                    {chunk.map(type => {
                                                                        const progress = progressMap.get(type);
                                                                        if (!progress) return null;
                                                                        const displayScore = progress.DisplayScore != null ? progress.DisplayScore : -1;
                                                                        
                                                                        return (
                                                                            <div key={type} className="p-8 bg-white rounded-[2rem] border border-gray-300 shadow-lg hover:shadow-2xl transition-all group border-b-4 border-b-transparent hover:border-b-indigo-500">
                                                                                <div className="flex items-start justify-between mb-6 gap-4">
                                                                                    <div className="space-y-1">
                                                                                        <p className="font-black text-slate-800 text-xl leading-snug group-hover:text-indigo-600 transition-colors min-h-[3.5rem] flex items-center">
                                                                                            <LatexRenderer text={type} />
                                                                                        </p>
                                                                                    </div>
                                                                                    <div className="text-right">
                                                                                        <p className="text-3xl font-black text-slate-900 leading-none">{displayScore < 0 ? '데이터 부족' : displayScore.toFixed(1)}</p>
                                                                                        <p className="text-[10px] font-bold text-slate-400 mt-2 uppercase tracking-widest">{getMasteryLevel(displayScore)}</p>
                                                                                    </div>
                                                                                </div>
                                                                                
                                                                                <div className="w-full bg-slate-100 rounded-full h-4 overflow-hidden shadow-inner mb-4">
                                                                                    <div 
                                                                                        className="h-full rounded-full transition-all duration-1000" 
                                                                                        style={{ width: `${displayScore < 0 ? 0 : displayScore}%`, ...getBarColorStyle(displayScore) }}
                                                                                    ></div>
                                                                                </div>
                                                                                
                                                                                <MetricGrid metrics={{
                                                                                    "총 풀이": progress.Total_Attempts,
                                                                                    "하 난이도": progress.Score_Low,
                                                                                    "중 난이도": progress.Score_Mid,
                                                                                    "상 난이도": progress.Score_High,
                                                                                }}/>
                                                                            </div>
                                                                        );
                                                                    })}
                                                                </div>
                                                            </div>
                                                        ))}
                                                    </React.Fragment>
                                                );
                                            })}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Footer Line */}
            <div data-pdf-section className="mt-16 pb-8">
                <div className="w-full border-t-2 border-slate-200"></div>
            </div>

            {/* Removed the inline style block as these rules are now dynamically injected */}
        </div>
    );
};