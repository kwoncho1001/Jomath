

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { GoogleGenAI } from '@google/genai';
import { FileCode2, UploadCloud, LoaderCircle, Sparkles, XCircle, CheckCircle2, Copy, Download, Folder, List } from 'lucide-react';
import { FileUpload } from './FileUpload';
import { readFile, fileToBase64, exportFile, appendSheetData } from '../services/fileService';
import type { QuestionDBItem } from '../types';
import { QUESTION_DB_URL } from '../constants'; // Import from constants

const DB_GENERATOR_PROMPT = `너는 수학 교육 콘텐츠 데이터베이스 전문가이다. 업로드된 수학 문제지 PDF와 과목 목차 분류표.csv를 분석하여, 시스템에 즉시 입력 가능한 정규화된 문항 메타데이터(Question DB)를 생성한다. 모든 출력은 JSON 배열 형식이어야 하며, 인사말이나 설명 없이 코드 블록만 출력한다.

[출력 JSON 데이터 구조]
반드시 다음 키 순서와 명칭을 엄격히 준수할 것:
[
  {
    "시험 ID/교재명": "파일명 또는 문서 상단 ID",
    "번호": 1,
    "정답": 3,
    "난이도": "상/중/하",
    "정답율": 0.76,
    "과목": "대수",
    "대단원": "내용",
    "중단원": "내용",
    "소단원": "내용",
    "세부 유형": "내용"
  }
]

[데이터 추출 로직]
1. 정답 추출: PDF의 '빠른정답' 섹션 또는 문항 끝의 '정답' 표시를 시각적으로 판독한다.
2. 난이도 판정: 추출된 정답률 %를 소수점(예: 0.85)으로 변환 후 기준에 따름: 하(0.85 이상), 중(0.65~0.84), 상(0.64 이하).
3. 단원 매칭: PDF의 '유형 제목'을 키워드로 CSV 분류표에서 가장 유사한 행을 매칭한다.
4. 무결성: 모든 필드는 빈칸 없이 채워져야 한다.
`;

// Removed local QUESTION_DB_URL definition here, now imported from constants.ts

// 1. 헤더 순서 수정 (정답률, 과목을 앞으로 이동)
const SHEET_HEADERS: (keyof QuestionDBItem)[] = [
    "시험 ID/교재명", "번호", "정답", "난이도", "정답율", "과목", "대단원", "중단원", "소단원", "세부 유형"
];


interface DbGeneratorProps {
    syncedCsvData: any[] | null;
    registeredQuestionDb: QuestionDBItem[] | null; // New prop for existing question DB data
}

export const DbGenerator: React.FC<DbGeneratorProps> = ({ syncedCsvData, registeredQuestionDb }) => {
    const [pdfFile, setPdfFile] = useState<File | null>(null);
    const [csvFile, setCsvFile] = useState<File | null>(null);
    const [csvData, setCsvData] = useState<any[] | null>(null);
    const [generatedData, setGeneratedData] = useState<QuestionDBItem[] | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [isAppending, setIsAppending] = useState(false);
    const [appendStatus, setAppendStatus] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
    const [copyButtonText, setCopyButtonText] = useState('TSV 복사');
    const [manualExamId, setManualExamId] = useState<string>(''); // New state for manual input
    
    useEffect(() => {
        if (syncedCsvData && syncedCsvData.length > 0) {
            setCsvData(syncedCsvData);
            setCsvFile(null);
            setError(null);
        }
    }, [syncedCsvData]);

    const handlePdfSelect = (file: File | null) => {
        setPdfFile(file);
    };

    const handleCsvSelect = async (file: File | null) => {
        setCsvFile(file);
        if (file) {
            try {
                const data = await readFile<any>(file);
                setCsvData(data);
            } catch (err: any) {
                setError('CSV 파일을 파싱하는데 실패했습니다.');
                setCsvData(null);
            }
        } else {
            setCsvData(syncedCsvData || null);
        }
    };

    // Moved getRowValue definition earlier so autoAppendToSheet can use it.
    const getRowValue = useCallback((row: QuestionDBItem, header: keyof QuestionDBItem): any => {
        switch (header) {
            case '시험 ID/교재명':
                return row['시험 ID/교재명'] || (row as any)['시험 ID'] || (row as any)['시험ID'];
            case '정답율':
                return (row as any)['정답율'] || (row as any)['정답률'];
            case '과목':
                 return row['과목'] || (row as any)['과목명'];
            default:
                return row[header];
        }
    }, []);

    // [추가] 시트 전송 로직 분리 (자동 호출용)
    const autoAppendToSheet = async (data: QuestionDBItem[]) => {
        setIsAppending(true);
        try {
            const dataAsArray = data.map(row => 
                SHEET_HEADERS.map(header => {
                    const value = getRowValue(row, header);
                    return value != null ? value : '';
                })
            );
            await appendSheetData(QUESTION_DB_URL, dataAsArray);
            setAppendStatus({ message: 'AI 분석 및 시트 전송이 완료되었습니다!', type: 'success' });
        } catch (err: any) {
            setAppendStatus({ message: '시트 자동 추가 실패. 수동 버튼을 이용하세요.', type: 'error' });
        } finally {
            setIsAppending(false);
            // Hide status message after a few seconds
            setTimeout(() => setAppendStatus(null), 6000);
        }
    };

    const handleGenerate = async () => {
        if (!pdfFile || !csvData) {
            setError('PDF 문제지와 CSV 목차 분류표를 모두 업로드해주세요.');
            return;
        }
        setIsLoading(true);
        setError(null);
        setGeneratedData(null);

        try {
            if (!process.env.API_KEY) throw new Error("API key가 설정되지 않았습니다.");
            const pdfBase64 = await fileToBase64(pdfFile);
            const fullPrompt = `${DB_GENERATOR_PROMPT}\n${JSON.stringify(csvData, null, 2)}`;
            const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
            
            const response = await ai.models.generateContent({
                model: 'gemini-3-pro-preview',
                contents: { parts: [{ text: fullPrompt }, { inlineData: { mimeType: 'application/pdf', data: pdfBase64 } }] },
            });
            
            const rawJson = response.text || '';
            const cleanedJson = rawJson.replace(/^```json\s*|```\s*$/g, '').trim();
            let parsedData: QuestionDBItem[] = JSON.parse(cleanedJson); 
            
            // Override '시험 ID/교재명' if manualExamId is provided
            if (manualExamId.trim() !== '') {
                parsedData = parsedData.map(item => ({
                    ...item,
                    '시험 ID/교재명': manualExamId.trim()
                }));
            }

            setGeneratedData(parsedData);
            
            // [수정] 생성 완료 후 즉시 시트 전송 실행
            await autoAppendToSheet(parsedData);

        } catch (err: any) {
            console.error(err);
            setError('데이터 생성 중 오류가 발생했습니다.');
        } finally {
            setIsLoading(false);
        }
    };
    
    const handleCopyToClipboard = () => {
        if (!generatedData) return;
        
        // [수정] 복사 시 헤더 명칭을 CSV 양식인 '정답률', '과목명'으로 변경
        const headerString = "시험 ID/교재명\t번호\t정답\t난이도\t정답률\t과목명\t대단원\t중단원\t소단원\t세부 유형";

        const rowStrings = generatedData.map(row => 
            SHEET_HEADERS.map(header => {
                const value = getRowValue(row, header);
                return value != null ? String(value) : '';
            }).join('\t')
        );

        const tsvString = [headerString, ...rowStrings].join('\n');
        navigator.clipboard.writeText(tsvString).then(() => {
            setCopyButtonText('복사 완료!');
            setTimeout(() => setCopyButtonText('TSV 복사'), 2000);
        });
    };

    const handleDownload = () => {
        if (!generatedData) return;
        try {
            exportFile(generatedData, 'Question_DB_Generated.xlsx', 'xlsx');
        } catch (e: any) {
            setError('다운로드 실패: 생성된 데이터 형식이 올바르지 않습니다.');
        }
    };

    const handleAppendToSheet = async () => {
        if (!generatedData) return;
        setIsAppending(true);
        setAppendStatus(null);
        try {
            if (!Array.isArray(generatedData) || generatedData.length === 0) {
                throw new Error("유효한 데이터가 없습니다.");
            }
            
            const dataAsArray = generatedData.map(row => 
                SHEET_HEADERS.map(header => {
                    const value = getRowValue(row, header);
                    return value != null ? value : '';
                })
            );

            const response = await appendSheetData(QUESTION_DB_URL, dataAsArray);

            if (response && response.status === 'success') {
                setAppendStatus({ message: '성공적으로 Google Sheet에 추가되었습니다!', type: 'success' });
            } else {
                throw new Error((response && response.message) || 'Apps Script에서 오류가 발생했습니다.');
            }
        } catch (err: any) {
            const errorMessage = err instanceof Error ? err.message : String(err);
            setAppendStatus({ message: `시트 추가 실패: ${errorMessage}. Apps Script가 POST 요청을 처리하도록 설정되었는지 확인하세요.`, type: 'error' });
        } finally {
            setIsAppending(false);
            setTimeout(() => setAppendStatus(null), 6000);
        }
    };

    const canGenerate = pdfFile && csvData && !isLoading;
    // This is for UI display only, can have a different order.
    const tableDisplayHeaders = {
        "시험 ID/교재명": "시험ID", "번호": "번호", "정답": "정답", "난이도": "난이도", "정답율": "정답율", "과목": "과목", "대단원": "대단원", "중단원": "중단원", "소단원": "소단원", "세부 유형": "세부유형"
    };
    const displayHeaderKeys = Object.keys(tableDisplayHeaders) as (keyof QuestionDBItem)[];
    const isCsvSynced = !!syncedCsvData && !csvFile;

    // New useMemo for unique exam IDs
    const uniqueRegisteredExamIds = useMemo(() => {
        if (!registeredQuestionDb || registeredQuestionDb.length === 0) return [];
        const ids = new Set<string>();
        registeredQuestionDb.forEach(item => {
            // Use getRowValue for consistent extraction, but for display might want to trim/normalize.
            const examId = getRowValue(item, '시험 ID/교재명');
            if (examId) ids.add(String(examId).trim());
        });
        return Array.from(ids).sort();
    }, [registeredQuestionDb, getRowValue]);

    return (
        <div className="space-y-8">
            <div className="text-center">
                <h2 className="text-3xl font-extrabold text-gray-800">AI 기반 Question DB 생성기</h2>
                <p className="text-gray-500 mt-2 max-w-2xl mx-auto">PDF 문제지와 목차(CSV)를 업로드하면, AI가 자동으로 분석하여 Question DB를 생성합니다.</p>
            </div>

            {/* Currently Registered Exam Sheets Section */}
            <details className="w-full bg-white border border-gray-200 rounded-2xl shadow-sm transition-all open:shadow-lg">
                <summary className="p-5 cursor-pointer flex justify-between items-center text-lg font-bold text-gray-700 hover:bg-gray-50 rounded-t-2xl">
                    <div className="flex items-center gap-3">
                        <Folder className="w-6 h-6 text-teal-500"/>
                        현재 등록된 시험지 목록 ({uniqueRegisteredExamIds.length}개)
                    </div>
                    <span className="text-sm font-medium text-gray-500 transform transition-transform duration-300 details-arrow">▼</span>
                </summary>
                <div className="p-6 border-t border-gray-200 bg-gray-50/50">
                    {uniqueRegisteredExamIds.length > 0 ? (
                        <div className="flex flex-wrap gap-2 max-h-48 overflow-y-auto pr-2">
                            {uniqueRegisteredExamIds.map(id => (
                                <span key={id} className="inline-flex items-center px-3 py-1 bg-teal-100 text-teal-800 text-sm font-medium rounded-full">
                                    <List className="w-4 h-4 mr-1"/>
                                    {id}
                                </span>
                            ))}
                        </div>
                    ) : (
                        <p className="text-gray-500 text-sm text-center">등록된 시험지 데이터가 없습니다.</p>
                    )}
                </div>
            </details>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <FileUpload title="1. 문제지 PDF 업로드" description="주간 TEST, 교재 등" icon={<FileCode2 className="w-8 h-8" />} onFileSelect={handlePdfSelect} file={pdfFile} isUploaded={!!pdfFile} accept="application/pdf" />
                <FileUpload 
                    title="2. 목차 분류표 CSV 업로드" 
                    description={isCsvSynced ? "Google Sheet에서 동기화됨" : "과목 분류 체계"} 
                    icon={<UploadCloud className="w-8 h-8" />} 
                    onFileSelect={handleCsvSelect} 
                    file={csvFile} 
                    isUploaded={!!csvData}
                />
            </div>
            
            {/* Manual Exam ID Input */}
            <div className="p-4 bg-white rounded-lg border border-gray-200 shadow-sm">
                <label htmlFor="manual-exam-id" className="block text-sm font-medium text-gray-700 mb-2">
                    시험 ID/교재명 직접 입력 (AI 생성값 덮어쓰기)
                </label>
                <input
                    type="text"
                    id="manual-exam-id"
                    value={manualExamId}
                    onChange={(e) => setManualExamId(e.target.value)}
                    placeholder="예: 2024년 3월 중간고사"
                    className="w-full px-4 py-2 bg-gray-50 border border-gray-300 rounded-lg shadow-inner focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-gray-800"
                />
                <p className="text-xs text-gray-500 mt-2">이 필드에 값을 입력하면 AI가 생성한 '시험 ID/교재명' 값을 덮어씁니다. 비워두면 AI가 자동으로 판독합니다.</p>
            </div>

            {error && (<div className="my-4 flex items-center gap-3 bg-red-100 border border-red-300 text-red-800 p-4 rounded-lg"><XCircle className="w-5 h-5 flex-shrink-0" /><p>{error}</p></div>)}

            <div className="text-center">
                <button onClick={handleGenerate} disabled={!canGenerate} className={`px-10 py-4 text-lg font-semibold rounded-lg transition-all duration-300 ease-in-out flex items-center justify-center mx-auto w-full max-w-md ${canGenerate ? 'bg-teal-600 text-white hover:bg-teal-700 shadow-lg shadow-teal-500/30 transform hover:-translate-y-1' : 'bg-gray-300 text-gray-500 cursor-not-allowed'}`}>
                    {isLoading ? <><LoaderCircle className="animate-spin w-6 h-6 mr-3" />생성 중...</> : <>AI로 DB 생성 시작<Sparkles className="w-5 h-5 ml-3" /></>}
                </button>
            </div>
            
            {generatedData && (
                <div className="bg-white p-6 rounded-2xl shadow-lg border border-gray-200">
                    <div className="flex flex-wrap gap-2 justify-between items-center mb-4">
                        <h3 className="text-xl font-bold text-gray-800 flex items-center gap-2">
                           <CheckCircle2 className="w-6 h-6 text-teal-500"/> 생성된 Question DB
                        </h3>
                        <div className="flex gap-2">
                             <button onClick={handleCopyToClipboard} className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-100 text-gray-700 rounded-md text-sm font-semibold hover:bg-gray-200 transition-colors shadow-sm">
                                <Copy className="w-4 h-4"/> {copyButtonText}
                            </button>
                             <button onClick={handleDownload} className="flex items-center gap-1.5 px-3 py-1.5 bg-teal-500 text-white rounded-md text-sm font-semibold hover:bg-teal-600 transition-colors shadow-sm">
                                <Download className="w-4 h-4"/> XLSX 다운로드
                            </button>
                            <button onClick={handleAppendToSheet} disabled={isAppending} className="flex items-center gap-1.5 px-3 py-1.5 bg-green-600 text-white rounded-md text-sm font-semibold hover:bg-green-700 transition-colors shadow-sm disabled:bg-gray-400 disabled:cursor-wait">
                                {isAppending ? <LoaderCircle className="w-4 h-4 animate-spin"/> : <UploadCloud className="w-4 h-4"/>}
                                {isAppending ? '추가 중...' : '시트에 추가'}
                            </button>
                        </div>
                    </div>
                     {appendStatus && (
                        <div className={`my-4 text-sm font-medium p-3 rounded-lg flex items-center gap-2 ${appendStatus.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                            {appendStatus.type === 'success' ? <CheckCircle2 className="w-5 h-5" /> : <XCircle className="w-5 h-5" />}
                            {appendStatus.message}
                        </div>
                    )}
                    <div className="max-h-96 overflow-auto border border-gray-200 rounded-lg shadow-inner">
                        <table className="w-full text-sm text-left whitespace-nowrap">
                            <thead className="sticky top-0 bg-gray-100 text-gray-600 font-semibold text-xs uppercase z-10">
                                <tr>
                                    {displayHeaderKeys.map(key => (
                                        <th key={key} className="px-4 py-3">{tableDisplayHeaders[key]}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-200">
                                {generatedData.map((row, index) => (
                                    <tr key={index} className="hover:bg-gray-50">
                                        {displayHeaderKeys.map(key => (
                                            <td key={`${key}-${index}`} className="px-4 py-3 text-gray-700">
                                                {String(getRowValue(row, key) != null ? getRowValue(row, key) : '')}
                                            </td>
                                        ))}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
             <style>{`
                details > summary::-webkit-details-marker { display: none; }
                details[open] .details-arrow { transform: rotate(180deg); }
            `}</style>
        </div>
    );
};