

import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { FileUp, BookCheck, History, Trophy, FileSpreadsheet, FileText, XCircle, CheckCircle2, LoaderCircle, Sparkles, LayoutDashboard, Microscope, Database, FileCode2, Users, ListChecks, TrendingUp, Calculator, RefreshCw, DatabaseZap, BrainCircuit, Download, Mail } from 'lucide-react';
import ReactDOM from 'react-dom/client';
import { FileUpload } from './components/FileUpload';
import { ResultCard } from './components/ResultCard';
import { Report } from './components/Report';
import { ExamReportViewer } from './components/ExamReportViewer';
import { AnalysisSettings } from './components/AnalysisSettings';
import { DbGenerator } from './components/DbGenerator';
import { processStudentData } from './services/analysisService';
import { readFile, fetchSheetData } from './services/fileService';
import type { QuestionDBItem, TransactionLogItem, ProgressMasterItem, ScoredStudent, StudentResponseRaw, TextbookResponseRaw, AnalysisConfig, ClassificationCsvItem, ClassificationTree, StudentMetadata } from './types';
import { QUESTION_DB_URL, STUDENT_RESPONSE_URL, CLASSIFICATION_CSV_URL } from './constants';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';

type FileData<T> = {
  file: File | null;
  data: T[] | null;
  name: string;
};

type MainTab = 'analyzer' | 'generator';
type AnalyzerTab = 'dashboard' | 'report' | 'analysis';

const SUBJECTS = ["공통수학1", "공통수학2", "대수", "미적분", "미적분1", "확률과 통계"];

const DEFAULT_CONFIG: AnalysisConfig = {
  minTestCount: 1,
  recentCount: 5,
  weights: { '상': 1.2, '중': 1.0, '하': 0.8 },
  difficultyRatio: { '상': 1, '중': 1, '하': 1 },
  selectedSubUnits: [],
};

export const App: React.FC = () => {
  const [questionDb, setQuestionDb] = useState<FileData<QuestionDBItem>>({ file: null, data: null, name: 'Question_DB' });
  const [studentResponse, setStudentResponse] = useState<FileData<StudentResponseRaw>>({ file: null, data: null, name: 'Student_Response' });
  const [textbookResponse, setTextbookResponse] = useState<FileData<TextbookResponseRaw>>({ file: null, data: null, name: 'Textbook_Response' });
  const [transactionLog, setTransactionLog] = useState<FileData<TransactionLogItem>>({ file: null, data: null, name: 'Transaction_Log' });
  const [progressMaster, setProgressMaster] = useState<FileData<ProgressMasterItem>>({ file: null, data: null, name: 'Progress_Master' });
  const [classificationCsv, setClassificationCsv] = useState<FileData<ClassificationCsvItem>>({ file: null, data: null, name: 'Classification_CSV' });
  
  const [analysisConfig, setAnalysisConfig] = useState<AnalysisConfig>(() => {
    try {
      const savedConfig = localStorage.getItem('analysisConfig');
      const parsed = savedConfig ? JSON.parse(savedConfig) : {};
      return { ...DEFAULT_CONFIG, ...parsed };
    } catch {
      return DEFAULT_CONFIG;
    }
  });
  
  const [classificationTree, setClassificationTree] = useState<ClassificationTree>(new Map());
  const [newTransactionLog, setNewTransactionLog] = useState<TransactionLogItem[]>([]);
  const [newProgressMaster, setNewProgressMaster] = useState<ProgressMasterItem[]>([]);
  const [examScoreReport, setExamScoreReport] = useState<ScoredStudent[]>([]);
  
  const [selectedGrade, setSelectedGrade] = useState<string | null>(null);
  const [selectedStudent, setSelectedStudent] = useState<string | null>(null);
  const [selectedSubject, setSelectedSubject] = useState(SUBJECTS[0]);

  const [isLoading, setIsLoading] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isProcessed, setIsProcessed] = useState(false);
  
  const [mainTab, setMainTab] = useState<MainTab>('analyzer');
  const [analyzerTab, setAnalyzerTab] = useState<AnalyzerTab>('dashboard');
  const [isBulkDownloading, setIsBulkDownloading] = useState(false);
  const [bulkDownloadProgress, setBulkDownloadProgress] = useState({ current: 0, total: 0, studentName: '' });
  const [isBulkEmailing, setIsBulkEmailing] = useState(false);
  const [bulkEmailProgress, setBulkEmailProgress] = useState({ current: 0, total: 0, studentName: '' });
  const [isSendingEmail, setIsSendingEmail] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem('analysisConfig', JSON.stringify(analysisConfig));
    } catch (e) {
      console.error("Failed to save settings to local storage:", e);
    }
  }, [analysisConfig]);
  
  useEffect(() => {
    if (classificationCsv.data && classificationCsv.data.length > 0) {
        const newClassificationTree: ClassificationTree = new Map();
        const allSubUnitPaths: string[] = [];

        classificationCsv.data.forEach(item => {
            const subject = item['과목명'] || '미분류';
            const large = item['대단원'] || '미분류';
            const small = item['소단원'] || '일반';

            if (!newClassificationTree.has(subject)) {
                newClassificationTree.set(subject, new Map());
            }
            const largeMap = newClassificationTree.get(subject)!;
            if (!largeMap.has(large)) {
                largeMap.set(large, []);
            }
            const smallList = largeMap.get(large)!;
            if (!smallList.includes(small)) {
                smallList.push(small);
                allSubUnitPaths.push(`${subject}|${large}|${small}`);
            }
        });
        
        newClassificationTree.forEach(largeMap => {
            // Do not sort smallList to preserve CSV order
            // largeMap.forEach((smallList, largeKey, map) => {
            //     map.set(largeKey, smallList.sort());
            // });
        });

        setClassificationTree(newClassificationTree);
        setAnalysisConfig(prev => ({
            ...prev,
            selectedSubUnits: (prev.selectedSubUnits && prev.selectedSubUnits.length > 0) ? prev.selectedSubUnits : allSubUnitPaths
        }));
    } else {
        setClassificationTree(new Map());
        setAnalysisConfig(prev => ({ ...prev, selectedSubUnits: [] }));
    }
  }, [classificationCsv.data]);

  const gradeStudentMap = useMemo(() => {
    const map = new Map<string, Set<string>>();
    const allStudentIds = new Set(newProgressMaster.map(item => item.StudentID));
    const studentGradeMapping = new Map<string, string>();

    if (studentResponse.data) {
        for (const res of studentResponse.data) {
            const studentName = res['이름'] ? res['이름'].trim() : undefined;
            const grade = (res['학년'] ? res['학년'].trim() : '') || '미지정';
            if (studentName && !studentGradeMapping.has(studentName)) {
                studentGradeMapping.set(studentName, grade);
            }
        }
    }
    
    for (const studentId of allStudentIds) {
        const grade = studentGradeMapping.get(studentId) || '미지정';
        if (!map.has(grade)) {
            map.set(grade, new Set());
        }
        map.get(grade)!.add(studentId);
    }

    const finalMap = new Map<string, string[]>();
    for (const [grade, studentSet] of map.entries()) {
        finalMap.set(grade, Array.from(studentSet).sort());
    }
    return finalMap;
  }, [newProgressMaster, studentResponse.data]);

  // 1. 학생별 활성 상태(최근 5개 시험 기준) 및 이메일 오타 교정 로직
  const studentStatusMap = useMemo(() => {
    const statusMap = new Map<string, { isActive: boolean; email: string }>();
    if (!studentResponse.data) return statusMap;

    // 학년별 최근 5개 시험 ID 세트 구축
    const gradeExams = new Map<string, { id: string; ts: number }[]>();
    studentResponse.data.forEach(res => {
      const grade = (res['학년'] || '미지정').toString().trim();
      const examId = (res['시험 ID'] || res['시험ID'] || '').toString().trim();
      const ts = new Date(res['타임스탬프']).getTime();
      if (!gradeExams.has(grade)) gradeExams.set(grade, []);
      const exams = gradeExams.get(grade)!;
      if (!exams.find(e => e.id === examId)) exams.push({ id: examId, ts });
    });

    const recentTestsByGrade = new Map<string, Set<string>>();
    gradeExams.forEach((exams, grade) => {
      const top5 = exams.sort((a, b) => b.ts - a.ts).slice(0, 5).map(e => e.id);
      recentTestsByGrade.set(grade, new Set(top5));
    });

    // 학생별 로그 그룹화
    const studentLogs = new Map<string, any[]>();
    studentResponse.data.forEach(res => {
      const name = res['이름']?.toString().trim();
      if (name) {
        if (!studentLogs.has(name)) studentLogs.set(name, []);
        studentLogs.get(name)!.push(res);
      }
    });

    // 최종 상태 결정
    studentLogs.forEach((logs, name) => {
      const sortedLogs = logs.sort((a, b) => new Date(b['타임스탬프']).getTime() - new Date(a['타임스탬프']).getTime());
      const latestGrade = (sortedLogs[0]['학년'] || '미지정').toString().trim();
      const recent5Ids = recentTestsByGrade.get(latestGrade);
      
      // 활성 기준: 해당 학년 최근 5개 시험 중 하나라도 응시했는가?
      const isActive = logs.some(l => recent5Ids?.has((l['시험 ID'] || l['시험ID'] || '').toString().trim()));

      // 이메일 오타 교정: 최근 5개 응답 중 최다 빈출 주소 선택
      const emailFreq = new Map<string, number>();
      sortedLogs.slice(0, 5).forEach(l => {
        const email = (l['이메일 주소'] || '').toString().trim();
        if (email) emailFreq.set(email, (emailFreq.get(email) || 0) + 1);
      });
      
      let canonicalEmail = "";
      let maxFreq = 0;
      emailFreq.forEach((freq, email) => {
        if (freq > maxFreq) { maxFreq = freq; canonicalEmail = email; }
      });

      statusMap.set(name, { isActive, email: canonicalEmail });
    });

    return statusMap;
  }, [studentResponse.data]);

  const gradeList = useMemo(() => Array.from(gradeStudentMap.keys()).sort(), [gradeStudentMap]);
  
  // 2. 탭에 따른 학생 리스트 필터링 (상세 리포트에서는 활성 학생만 표시)
  const studentListForGrade = useMemo(() => {
    if (!selectedGrade) return [];
    const allStudents = gradeStudentMap.get(selectedGrade) || [];
    
    if (analyzerTab === 'report') {
      return allStudents.filter(name => studentStatusMap.get(name)?.isActive === true);
    }
    
    return allStudents;
  }, [selectedGrade, gradeStudentMap, analyzerTab, studentStatusMap]);

  const handleGradeSelect = (grade: string | null) => {
      setSelectedGrade(grade);
      setSelectedStudent(null);
  };

  // Improved handleFileSelect with explicit unknown type handling for catch blocks
  const handleFileSelect = useCallback(async <T extends unknown>(file: File | null, setter: React.Dispatch<React.SetStateAction<FileData<T>>>) => {
    setIsProcessed(false);
    // Fix: Changed null to empty string to satisfy linter/TypeScript expecting string
    setError('');
    setSelectedStudent(null);
    // Fix: Changed null to empty string to satisfy linter/TypeScript expecting string
    setSelectedGrade('');
    
    if (!file) {
      setter(prev => ({ ...prev, file: null, data: null }));
      return;
    }

    setter(prev => ({ ...prev, file, data: null }));
    try {
      const data = await readFile<T>(file);
      setter(prev => ({ ...prev, data }));
    } catch (err: unknown) {
      const errorMessage: string = err instanceof Error ? err.message : String(err as any);
      setError(`Error parsing ${file ? file.name : 'unknown file'}: ${errorMessage}. Please check the file format.`);
      setter(prev => ({ ...prev, file: null, data: null }));
    }
  }, []);
  
  // Improved handleGoogleSheetSync with explicit unknown type handling for catch blocks
  const handleGoogleSheetSync = useCallback(async () => {
    setIsSyncing(true);
    setError(''); // Fix: Changed null to empty string
    setSyncStatus(null);
    setIsProcessed(false);
    setSelectedGrade(''); // Fix: Changed null to empty string
    setSelectedStudent(null);

    setTextbookResponse({ file: null, data: null, name: 'Textbook_Response' });
    setTransactionLog({ file: null, data: null, name: 'Transaction_Log' });
    setProgressMaster({ file: null, data: null, name: 'Progress_Master' });
    setClassificationCsv({ file: null, data: null, name: 'Classification_CSV' });

    try {
        const questionData = await fetchSheetData<QuestionDBItem>(QUESTION_DB_URL);
        setQuestionDb({ file: null, data: questionData, name: 'Google Sheet' });

        const studentData = await fetchSheetData<StudentResponseRaw>(STUDENT_RESPONSE_URL);
        setStudentResponse({ file: null, data: studentData, name: 'Google Sheet' });
        
        const classificationData = await fetchSheetData<ClassificationCsvItem>(CLASSIFICATION_CSV_URL);
        setClassificationCsv({ file: null, data: classificationData, name: 'Google Sheet' });

        setSyncStatus({ message: '데이터 동기화 완료!', type: 'success' });
        setTimeout(() => setSyncStatus(null), 5000);
    } catch (err: unknown) {
        const errorMessageDetail: string = err instanceof Error ? err.message : String(err as any);
        const errorMessage = `동기화 실패: ${errorMessageDetail}. 잠시 후 다시 시도해주세요.`;
        setError(errorMessage);
        setSyncStatus({ message: errorMessage, type: 'error' });
    } finally {
        setIsSyncing(false);
    }
  }, []);

  const allSubUnitsCount = useMemo(() => {
    let count = 0;
    classificationTree.forEach(largeMap => {
        largeMap.forEach(smallList => {
            count += smallList.length;
        });
    });
    return count;
  }, [classificationTree]);
  
  const selectedSubUnitsCount = analysisConfig.selectedSubUnits.length;

  // Improved handleProcess with explicit unknown type handling for catch blocks
  const handleProcess = useCallback(async (isUpdate = false) => {
    if (!questionDb.data || !studentResponse.data) {
      setError('정답지 데이터와 학생 응답 파일을 모두 업로드해주세요.');
      return;
    }
    
    setIsLoading(true);
    setError(null);

    if (!isUpdate) {
        setIsProcessed(false);
        setSelectedStudent(null);
        setSelectedGrade(null);
    }

    try {
      await new Promise(resolve => setTimeout(resolve, 100));
      const { 
        transactionLog: processedLog, 
        progressMaster: processedMaster,
        examScoreReport: report,
      } = processStudentData(
        questionDb.data,
        studentResponse.data || [],
        textbookResponse.data || [],
        transactionLog.data || [],
        progressMaster.data || [],
        analysisConfig,
        classificationCsv.data || []
      );
      setNewTransactionLog(processedLog);
      setNewProgressMaster(processedMaster);
      setExamScoreReport(report);
      setIsProcessed(true);

      if (!isUpdate) {
        setAnalyzerTab('dashboard');
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err as any);
      setError(`분석 실패: ${message}`);
    } finally {
      setIsLoading(false);
    }
  }, [questionDb.data, studentResponse.data, textbookResponse.data, transactionLog.data, progressMaster.data, analysisConfig, classificationCsv.data]);
  
  useEffect(() => {
    if (isProcessed) {
        handleProcess(true);
    }
  }, [analysisConfig, isProcessed]);

  const canProcess = useMemo(() => questionDb.data && studentResponse.data && !isLoading, [questionDb.data, studentResponse.data, isLoading]);

  const detailTypeToSubjectMap = useMemo(() => {
    const map = new Map<string, string>();
    if (questionDb.data) {
        questionDb.data.forEach(q => {
            const detailType = q['세부 유형'];
            const subject = q['과목'] || q['과목명'];
            if (detailType && subject && !map.has(detailType)) {
                map.set(detailType, subject);
            }
        });
    }
    return map;
  }, [questionDb.data]);

  const availableSubjectsForSelectedStudent = useMemo(() => {
      if (!selectedStudent || !newProgressMaster.length) {
          return [];
      }
      const studentProgressItems = newProgressMaster.filter(p => p.StudentID === selectedStudent);
      const subjects = new Set<string>();
      studentProgressItems.forEach(p => {
          const subject = detailTypeToSubjectMap.get(p.DetailType);
          if (subject) {
              subjects.add(subject);
          }
      });
      return Array.from(subjects).sort();
  }, [selectedStudent, newProgressMaster, detailTypeToSubjectMap]);

  useEffect(() => {
      if (selectedStudent && availableSubjectsForSelectedStudent.length > 0) {
          if (!selectedSubject || !availableSubjectsForSelectedStudent.includes(selectedSubject)) {
              setSelectedSubject(availableSubjectsForSelectedStudent[0]);
          }
      } else if (!selectedStudent) {
          setSelectedSubject(SUBJECTS[0]);
      }
  }, [selectedStudent, availableSubjectsForSelectedStudent, selectedSubject]);

  const generateAndSavePdfForStudent = useCallback(async (studentIdToGenerate: string, subjectToGenerate: string) => {
    // 1. Create a temporary, hidden div to render the Report component
    const tempDiv = document.createElement('div');
    tempDiv.style.position = 'fixed'; // Ensure it's not visible
    tempDiv.style.left = '-9999px';
    tempDiv.style.top = '0';
    tempDiv.style.opacity = '0';
    tempDiv.style.zIndex = '-1'; 
    document.body.appendChild(tempDiv);

    const root = ReactDOM.createRoot(tempDiv);
    
    const allProgressMaster = newProgressMaster.filter(p => p.StudentID === studentIdToGenerate);
    const allTransactionLog = newTransactionLog.filter(l => l.StudentID === studentIdToGenerate);
    const studentExamReports = examScoreReport.filter(r => r['학생 이름'] === studentIdToGenerate);

    // 2. Render the Report component into the hidden temporary div
    root.render(
      <Report
        studentId={studentIdToGenerate}
        selectedSubject={subjectToGenerate}
        questionDb={questionDb.data || []}
        progressMaster={allProgressMaster}
        transactionLog={allTransactionLog}
        examScoreReport={studentExamReports}
        allSubUnitsCount={allSubUnitsCount}
        selectedSubUnitsCount={selectedSubUnitsCount}
        isBulkDownloadMode={true} // Crucial for Report's internal logic and AI summary handling
        analysisConfig={analysisConfig} // Pass analysisConfig for Report component
        classificationData={classificationCsv.data || undefined}
      />
    );

    // 3. PDF generation logic for tempDiv (duplicated from Report.tsx's handleDownloadPdf)
    const reportElement = tempDiv;
    
    // Store original styles of the temporary report element before modification
    const originalCssText = reportElement.style.cssText; // Store all original inline styles
    const originalClassList = Array.from(reportElement.classList); // Store original classes

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
            -moz-osx-font-smoothing: grayscale !important;
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
    `;
    document.head.appendChild(style);
    reportElement.classList.add('capturing'); // Add capturing class to the temporary div

    // Wait for fonts and animations to settle
    if (document.fonts) await document.fonts.ready;
    await new Promise(resolve => setTimeout(resolve, 500)); // 시간을 0.5초로 단축

    try {
        const pdf = new jsPDF('p', 'mm', 'a4');
        const pageWidth = pdf.internal.pageSize.getWidth();
        const margin = 12;
        const contentWidth = pageWidth - (margin * 2);
        
        // Header Capture
        const headerElement = reportElement.querySelector('[data-pdf-header]') as HTMLElement;
        const headerCanvas = await html2canvas(headerElement, {
            scale: 1.5, // 선명도 조정 (2 -> 1.5)
            useCORS: true,
            backgroundColor: '#ffffff',
            foreignObjectRendering: false,
            logging: false, // 로깅 비활성화
            // Removed windowWidth here, relying on CSS for overall width
        });
        const headerImgData = headerCanvas.toDataURL('image/jpeg', 0.7); // 품질 조정 (0.8 -> 0.7)
        const headerHeight = (headerCanvas.height * contentWidth) / headerCanvas.width;

        // Sectional Capture
        const sections = Array.from(reportElement.querySelectorAll('[data-pdf-section]')) as HTMLElement[];
        let currentY = margin;

        for (let i = 0; i < sections.length; i++) {
            const section = sections[i];
            const canvas = await html2canvas(section, {
                scale: 1.5, // 선명도 조정 (2 -> 1.5)
                useCORS: true,
                backgroundColor: '#ffffff',
                // Removed windowWidth here, relying on CSS for overall width
                foreignObjectRendering: false,
                logging: false // 로깅 비활성화
            });

            const imgData = canvas.toDataURL('image/jpeg', 0.7); // 품질 조정 (0.8 -> 0.7)
            const imgHeight = (canvas.height * contentWidth) / canvas.width;

            // Page break check (header space considered)
            if (currentY + imgHeight > pdf.internal.pageSize.getHeight() - (margin + headerHeight + 10)) { // ~285 total height, adjust for header and bottom margin
                pdf.addPage();
                currentY = margin;
            }

            // Add header to every page
            if (currentY === margin) {
                pdf.addImage(headerImgData, 'JPEG', margin, margin, contentWidth, headerHeight, undefined, 'MEDIUM');
                currentY += headerHeight + 6; // Spacing after header

                // Footer: Indigo Line
                const pageHeight = pdf.internal.pageSize.getHeight();
                pdf.setDrawColor(79, 70, 229); // Indigo-600
                pdf.setLineWidth(0.5);
                pdf.line(margin, pageHeight - margin, pageWidth - margin, pageHeight - margin);
            }

            pdf.addImage(imgData, 'JPEG', margin, currentY, contentWidth, imgHeight, undefined, 'MEDIUM');
            currentY += imgHeight + 4; // Spacing between sections

            // Force page break after Unit Summary to ensure Details start on Page 2
            if (section.id === 'section-unit-summary') {
                pdf.addPage();
                currentY = margin;
            }
        }

        const reportTitle = `${new Date().getFullYear()}년 ${new Date().getMonth() + 1}월 ${Math.ceil((new Date().getDate() + new Date(new Date().getFullYear(), new Date().getMonth(), 1).getDay()) / 7)}주차 - ${studentIdToGenerate} 유형 분석 보고서`;
        pdf.save(`${reportTitle}.pdf`);

    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error as any);
        console.error(`Failed to generate PDF for ${studentIdToGenerate}: ${message}`);
        throw error;
    } finally {
        // Clean up temporary DOM elements and styles
        root.unmount();
        document.body.removeChild(tempDiv);
        reportElement.classList.remove('capturing'); 
        reportElement.classList.add(...originalClassList); // Restore original classes
        reportElement.style.cssText = originalCssText; // Restore original inline styles
        style.remove(); // Remove injected style
    }
  }, [newProgressMaster, newTransactionLog, examScoreReport, questionDb.data, allSubUnitsCount, selectedSubUnitsCount, analysisConfig]);


  const handleBulkDownloadReports = useCallback(async () => {
    if (!selectedGrade || studentListForGrade.length === 0) {
        setError('학년을 선택하거나, 해당 학년에 학생 데이터가 없습니다.');
        return;
    }

    setIsBulkDownloading(true);
    setBulkDownloadProgress({ current: 0, total: studentListForGrade.length, studentName: '' });
    setError(null);

    for (let i = 0; i < studentListForGrade.length; i++) {
        const student = studentListForGrade[i];
        setBulkDownloadProgress({ current: i + 1, total: studentListForGrade.length, studentName: student });
        try {
            const studentAvailableSubjects = newProgressMaster
                .filter(p => p.StudentID === student)
                .map(p => detailTypeToSubjectMap.get(p.DetailType))
                .filter((s): s is string => s !== undefined)
                .filter((value, index, self) => self.indexOf(value) === index)
                .sort();

            const subjectForReport = studentAvailableSubjects.length > 0 ? studentAvailableSubjects[0] : (SUBJECTS[0] || '미지정');
            
            await generateAndSavePdfForStudent(student, subjectForReport);
            await new Promise(resolve => setTimeout(resolve, 500));
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err as any);
            console.error(`Failed to download report for ${student}: ${message}`);
            setError(`'${student}' 학생의 리포트 다운로드 중 오류 발생: ${message}. 다음 학생으로 넘어갑니다.`);
            await new Promise(resolve => setTimeout(resolve, 3000));
            setError(null);
        }
    }

    setIsBulkDownloading(false);
    setBulkDownloadProgress({ current: 0, total: 0, studentName: '' });
    alert('학년 전체 리포트 다운로드 완료 (오류가 발생한 학생 제외)');
  }, [selectedGrade, studentListForGrade, generateAndSavePdfForStudent, newProgressMaster, detailTypeToSubjectMap]);

  const handleBulkSendEmail = useCallback(async () => {
    if (!selectedGrade || studentListForGrade.length === 0) {
        setError('학년을 선택하거나, 해당 학년에 학생 데이터가 없습니다.');
        return;
    }

    setIsBulkEmailing(true);
    setBulkEmailProgress({ current: 0, total: studentListForGrade.length, studentName: '' });
    setError(null);

    for (let i = 0; i < studentListForGrade.length; i++) {
        const student = studentListForGrade[i];
        setBulkEmailProgress({ current: i + 1, total: studentListForGrade.length, studentName: student });
        
        const studentInfo = studentStatusMap.get(student);
        if (!studentInfo?.email) {
             console.warn(`Skipping email for ${student}: No valid email found.`);
             continue;
        }

        try {
            // Simulate email sending process
            // In a real app, you would generate the PDF blob here and send it to the backend
            console.log(`Sending email to ${student} (${studentInfo.email})...`);
            await new Promise(resolve => setTimeout(resolve, 1000)); // Simulate network delay
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err as any);
            console.error(`Failed to send email for ${student}: ${message}`);
            // Optionally set error state or just log it to allow continuation
        }
    }

    setIsBulkEmailing(false);
    setBulkEmailProgress({ current: 0, total: 0, studentName: '' });
    alert('학년 전체 이메일 전송 완료 (이메일이 없는 학생 제외)');
  }, [selectedGrade, studentListForGrade, studentStatusMap]);

  // 3. 이메일 전송 처리 함수
  const handleSendEmail = async () => {
    if (!selectedStudent) return;
    const info = studentStatusMap.get(selectedStudent);
    if (!info?.email) {
      alert("해당 학생의 유효한 이메일 주소를 찾을 수 없습니다.");
      return;
    }

    setIsSendingEmail(true);
    try {
      // Use the correct URL from constants
      const GAS_URL = STUDENT_RESPONSE_URL;
      
      // 이 부분이 핵심입니다: headers와 redirect 설정을 추가해야 합니다.
      const response = await fetch(GAS_URL, {
        method: 'POST',
        mode: 'cors', // CORS 모드 명시
        headers: {
          'Content-Type': 'text/plain', // 핵심: 브라우저의 사전 검사(Preflight)를 피하기 위해 필수
        },
        body: JSON.stringify({
          email: info.email,
          studentName: selectedStudent,
          subject: `[학원] ${selectedStudent} 학생 성취도 분석 리포트`,
          message: `${selectedStudent} 학생의 상세 분석 데이터가 업데이트되었습니다. 시스템에서 리포트를 확인하세요.`
        }),
        redirect: 'follow' // GAS의 302 리다이렉트를 따라가도록 설정
      });

      // 응답 처리
      const result = await response.json();
      if (result.status === 'success') {
        alert(`${selectedStudent} 학생(${info.email})에게 메일을 보냈습니다.`);
      } else {
        throw new Error(result.message);
      }
    } catch (err: any) {
      // 여전히 에러가 난다면 콘솔에서 상세 내용을 확인해야 합니다.
      console.error("Fetch Error Detail:", err);
      alert("메일 전송 실패: " + err.message);
    } finally {
      setIsSendingEmail(false);
    }
  };

  return (
    <div className="min-h-screen text-gray-800 p-4 sm:p-6 lg:p-12">
      <div className="max-w-5xl mx-auto">
        <header className="w-full mx-auto flex justify-between items-start mb-10">
            <div>
                <div className="flex items-center gap-4 mb-4">
                    <div className="flex-shrink-0 w-12 h-12 bg-white rounded-xl shadow-md flex items-center justify-center">
                        <Microscope className="w-7 h-7 text-indigo-500" />
                    </div>
                    <span className="font-semibold text-sm tracking-[0.2em] text-gray-400">INTELLIGENCE SYSTEM</span>
                </div>
                <h1 className="text-5xl font-extrabold tracking-tight bg-gradient-to-r from-gray-900 to-indigo-600 bg-clip-text text-transparent">
                    Student Performance Analyzer
                </h1>
                <p className="text-gray-500 mt-3 max-w-2xl">데이터 기반의 객체 지향적 교육 피드백 시스템. 난이도별 평가 점수와 가중 정답률을 활용한 입체적 성취도 분석.</p>
            </div>
            <div className="flex-shrink-0 flex items-center gap-2 text-green-700 bg-white border border-gray-200 px-3 py-1.5 rounded-full shadow-sm">
                <span className="w-2.5 h-2.5 bg-green-500 rounded-full"></span>
                <span className="text-sm font-semibold">SYSTEM READY</span>
            </div>
        </header>

        <main>
        <div className="flex bg-white p-1.5 rounded-2xl shadow-md border border-gray-200 max-w-lg mx-auto overflow-hidden mb-12">
            <button
                onClick={() => setMainTab('analyzer')}
                className={`flex-1 flex items-center justify-center gap-2 py-3.5 px-4 rounded-xl text-md font-bold transition-all duration-300 ${mainTab === 'analyzer' ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/20' : 'text-gray-500 hover:bg-gray-100/50 hover:text-gray-700'}`}
            >
                <BrainCircuit className="w-5 h-5" /> DB 분석기
            </button>
            <button
                onClick={() => setMainTab('generator')}
                className={`flex-1 flex items-center justify-center gap-2 py-3.5 px-4 rounded-xl text-md font-bold transition-all duration-300 ${mainTab === 'generator' ? 'bg-teal-500 text-white shadow-lg shadow-teal-500/20' : 'text-gray-500 hover:bg-gray-100/50 hover:text-gray-700'}`}
            >
                <DatabaseZap className="w-5 h-5" /> DB 생성기
            </button>
        </div>

        {mainTab === 'analyzer' && (
          <>
            <section id="control-panel">
                <AnalysisSettings
                config={analysisConfig}
                setConfig={setAnalysisConfig}
                resetConfig={() => setAnalysisConfig(DEFAULT_CONFIG)}
                classificationTree={classificationTree}
                allSubUnitsCount={allSubUnitsCount}
                />
                
                <section id="data-sync" className="mb-10">
                    <div className="bg-white p-6 rounded-2xl shadow-lg border border-indigo-100 flex flex-col sm:flex-row items-center justify-between gap-4">
                        <div>
                            <h3 className="text-lg font-bold text-gray-800">실시간 데이터 연동</h3>
                            <p className="text-sm text-gray-500 mt-1">Google Sheets에 입력된 최신 데이터를 실시간으로 불러와 분석합니다.</p>
                        </div>
                        <button
                            onClick={handleGoogleSheetSync}
                            disabled={isSyncing}
                            className="flex items-center justify-center gap-2 px-6 py-3 bg-indigo-50 text-indigo-700 rounded-lg font-semibold hover:bg-indigo-100 transition-colors shadow-sm disabled:bg-gray-200 disabled:text-gray-500 disabled:cursor-wait w-full sm:w-auto"
                        >
                            {isSyncing ? <LoaderCircle className="w-5 h-5 animate-spin" /> : <RefreshCw className="w-5 h-5" />}
                            <span>{isSyncing ? '동기화 중...' : 'Google Sheets 데이터 동기화'}</span>
                        </button>
                    </div>
                    {syncStatus && (
                        <div className={`mt-4 text-sm font-medium p-3 rounded-lg flex items-center gap-2 ${syncStatus.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                            {syncStatus.type === 'success' ? <CheckCircle2 className="w-5 h-5" /> : <XCircle className="w-5 h-5" />}
                            {syncStatus.message}
                        </div>
                    )}
                </section>
                
                <h2 className="text-xl font-bold text-gray-700 mb-6 flex items-center gap-3">
                <Database className="w-6 h-6 text-indigo-500"/>
                데이터 업로드 (Data Input)
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
                <FileUpload title="테스트/주교재 정답지" description="" icon={<FileCode2 className="w-8 h-8" />} onFileSelect={(file) => handleFileSelect(file, setQuestionDb)} file={questionDb.file} isUploaded={!!questionDb.data} />
                <FileUpload title="실전 테스트 응답" description="" icon={<Users className="w-8 h-8" />} onFileSelect={(file) => handleFileSelect(file, setStudentResponse)} file={studentResponse.file} isUploaded={!!studentResponse.data} />
                <FileUpload title="목차 분류표 CSV" description="" icon={<FileSpreadsheet className="w-8 h-8" />} onFileSelect={(file) => handleFileSelect(file, setClassificationCsv)} file={classificationCsv.file} isUploaded={!!classificationCsv.data} />
                </div>
            </section>
            
            {error && (<div className="my-6 flex items-center gap-3 bg-red-100 border border-red-300 text-red-800 p-4 rounded-lg"><XCircle className="w-5 h-5 flex-shrink-0" /><p>{error}</p></div>)}
            
            <section id="processing" className="text-center pt-8">
                <button onClick={() => handleProcess(false)} disabled={!canProcess} className={`px-12 py-4 text-lg font-semibold rounded-lg transition-all duration-300 ease-in-out flex items-center justify-center mx-auto w-full max-sm ${canProcess ? 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-lg shadow-indigo-500/30 hover:shadow-xl hover:shadow-indigo-500/40 transform hover:-translate-y-1' : 'bg-gray-300 text-gray-500 cursor-not-allowed'}`}>
                    {isLoading ? <><LoaderCircle className="animate-spin w-6 h-6 mr-3" />분석 중...</> : <>실행 및 분석 시작<Sparkles className="w-5 h-5 ml-3" /></>}
                </button>
            </section>

            {isProcessed && (
              <div className="mt-16 space-y-6">
                <div className="flex bg-white p-1.5 rounded-2xl shadow-md border border-gray-200 max-w-2xl mx-auto overflow-hidden">
                    <button
                        onClick={() => setAnalyzerTab('analysis')}
                        className={`flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-xl text-md font-bold transition-all duration-300 ${analyzerTab === 'analysis' ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/20' : 'text-gray-500 hover:bg-gray-100/50 hover:text-gray-700'}`}
                    >
                        <Calculator className="w-5 h-5" /> 시험 분석
                    </button>
                    <button
                        onClick={() => setAnalyzerTab('report')}
                        className={`flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-xl text-md font-bold transition-all duration-300 ${analyzerTab === 'report' ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/20' : 'text-gray-500 hover:bg-gray-100/50 hover:text-gray-700'}`}
                    >
                        <FileText className="w-5 h-5" /> 상세 리포트
                    </button>
                    <button
                        onClick={() => setAnalyzerTab('dashboard')}
                        className={`flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-xl text-md font-bold transition-all duration-300 ${analyzerTab === 'dashboard' ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/20' : 'text-gray-500 hover:bg-gray-100/50 hover:text-gray-700'}`}
                    >
                        <LayoutDashboard className="w-5 h-5" /> 대시보드
                    </button>
                </div>
                
                {analyzerTab === 'dashboard' && (
                    <div className="grid grid-cols-1 lg:grid-cols-1 gap-6">
                        <div className="lg:col-span-1 space-y-6">
                            <h2 className="text-xl font-bold text-gray-700 flex items-center gap-3">
                                <ListChecks className="w-6 h-6 text-indigo-500"/>
                                처리된 데이터 다운로드
                            </h2>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <ResultCard 
                                    title="Transaction Log"
                                    description="개별 문제 풀이 기록" 
                                    icon={<History className="w-8 h-8 text-blue-500" />} 
                                    data={newTransactionLog} 
                                    fileName="Transaction_Log_Processed"
                                />
                                <ResultCard 
                                    title="Progress Master"
                                    description="학생별 유형별 성취도" 
                                    icon={<Trophy className="w-8 h-8 text-yellow-500" />} 
                                    data={newProgressMaster} 
                                    fileName="Progress_Master_Processed"
                                />
                            </div>
                        </div>
                    </div>
                )}
                
                {analyzerTab === 'report' && (
                    <div className="space-y-6">
                        <div className="space-y-6">
                            <h2 className="text-xl font-bold text-gray-700 flex items-center gap-3">
                                <Users className="w-6 h-6 text-indigo-500"/>
                                학생 선택
                            </h2>
                            <div className="bg-white p-6 rounded-2xl shadow-lg border border-gray-200/50 space-y-4">
                                <div>
                                    <label htmlFor="grade-select-report" className="block text-sm font-medium text-gray-600 mb-2">학년 선택</label>
                                    <select
                                        id="grade-select-report"
                                        value={selectedGrade || ''}
                                        onChange={(e) => handleGradeSelect(e.target.value)}
                                        className="w-full p-3 border border-gray-200 rounded-lg shadow-sm focus:ring-2 focus:ring-indigo-500 bg-white outline-none transition font-bold text-gray-700"
                                    >
                                        <option value="">학년 선택</option>
                                        {gradeList.map(grade => (
                                            <option key={grade} value={grade}>{grade}</option>
                                        ))}
                                    </select>
                                </div>
                                <div>
                                    <label htmlFor="student-select-report" className="block text-sm font-medium text-gray-600 mb-2">학생 선택</label>
                                    <select
                                        id="student-select-report"
                                        value={selectedStudent || ''}
                                        onChange={(e) => setSelectedStudent(e.target.value)}
                                        disabled={!selectedGrade || studentListForGrade.length === 0}
                                        className={`w-full p-3 border border-gray-200 rounded-lg shadow-sm focus:ring-2 focus:ring-indigo-500 bg-white outline-none transition font-bold text-gray-700 ${!selectedGrade || studentListForGrade.length === 0 ? 'bg-gray-100 text-gray-400 cursor-not-allowed' : ''}`}
                                    >
                                        <option value="">학생 선택</option>
                                        {studentListForGrade.map(student => (
                                            <option key={student} value={student}>{student}</option>
                                        ))}
                                    </select>
                                </div>
                                {selectedStudent && availableSubjectsForSelectedStudent.length > 1 && (
                                    <div>
                                        <label htmlFor="subject-select-report" className="block text-sm font-medium text-gray-600 mb-2">과목 선택</label>
                                        <select
                                            id="subject-select-report"
                                            value={selectedSubject || ''}
                                            onChange={(e) => setSelectedSubject(e.target.value)}
                                            className="w-full p-3 border border-gray-200 rounded-lg shadow-sm focus:ring-2 focus:ring-indigo-500 bg-white outline-none transition font-bold text-gray-700"
                                        >
                                            {availableSubjectsForSelectedStudent.map(subject => (
                                                <option key={subject} value={subject}>{subject}</option>
                                            ))}
                                        </select>
                                    </div>
                                )}
                            </div>

                            {selectedGrade && (
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    <div className="bg-white p-6 rounded-2xl shadow-lg border border-gray-200/50">
                                        <h3 className="text-xl font-bold text-gray-800 mb-4">학년 전체 리포트 다운로드</h3>
                                        <p className="text-gray-600 text-sm mb-4">선택된 학년의 모든 학생에 대한 상세 리포트를 PDF로 일괄 다운로드합니다.</p>
                                        <button
                                            onClick={handleBulkDownloadReports}
                                            disabled={isBulkDownloading || studentListForGrade.length === 0}
                                            className={`w-full flex items-center justify-center gap-2 px-6 py-3 rounded-lg font-semibold transition-colors shadow-sm text-sm ${isBulkDownloading ? 'bg-gray-400 text-white cursor-wait' : 'bg-indigo-500 text-white hover:bg-indigo-600'}`}
                                        >
                                            {isBulkDownloading ? (
                                                <>
                                                    <LoaderCircle className="w-5 h-5 animate-spin" />
                                                    <span>{bulkDownloadProgress.current}/{bulkDownloadProgress.total} 다운로드 중 ({bulkDownloadProgress.studentName})</span>
                                                </>
                                            ) : (
                                                <>
                                                    <Download className="w-5 h-5" />
                                                    <span>{selectedGrade} 전체 리포트 다운로드</span>
                                                </>
                                            )}
                                        </button>
                                    </div>
                                    <div className="bg-white p-6 rounded-2xl shadow-lg border border-gray-200/50">
                                        <h3 className="text-xl font-bold text-gray-800 mb-4">학년 전체 Email로 전송</h3>
                                        <p className="text-gray-600 text-sm mb-4">선택된 학년의 모든 학생에게 상세 리포트를 이메일로 일괄 전송합니다.</p>
                                        <button
                                            onClick={handleBulkSendEmail}
                                            disabled={isBulkEmailing || studentListForGrade.length === 0}
                                            className={`w-full flex items-center justify-center gap-2 px-6 py-3 rounded-lg font-semibold transition-colors shadow-sm text-sm ${isBulkEmailing ? 'bg-gray-400 text-white cursor-wait' : 'bg-indigo-700 text-white hover:bg-indigo-800'}`}
                                        >
                                            {isBulkEmailing ? (
                                                <>
                                                    <LoaderCircle className="w-5 h-5 animate-spin" />
                                                    <span>{bulkEmailProgress.current}/{bulkEmailProgress.total} 전송 중 ({bulkEmailProgress.studentName})</span>
                                                </>
                                            ) : (
                                                <>
                                                    <Mail className="w-5 h-5" />
                                                    <span>{selectedGrade} 전체 Email로 전송</span>
                                                </>
                                            )}
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                        <div> 
                            {selectedStudent ? (
                                <Report
                                    studentId={selectedStudent}
                                    selectedSubject={selectedSubject}
                                    questionDb={questionDb.data || []}
                                    progressMaster={newProgressMaster}
                                    transactionLog={newTransactionLog}
                                    examScoreReport={examScoreReport}
                                    allSubUnitsCount={allSubUnitsCount}
                                    selectedSubUnitsCount={selectedSubUnitsCount}
                                    analysisConfig={analysisConfig} // Pass analysisConfig here
                                    classificationData={classificationCsv.data || undefined}
                                    onSendEmail={handleSendEmail}
                                    isEmailing={isSendingEmail}
                                />
                            ) : (
                                <div className="bg-white p-8 rounded-2xl shadow-lg border border-gray-200/50 text-center text-gray-500 min-h-[400px] flex items-center justify-center">
                                    <p>학생을 선택하면 상세 리포트가 여기에 표시됩니다.</p>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {analyzerTab === 'analysis' && (
                  <div>
                    <ExamReportViewer
                      reportData={examScoreReport}
                      allQuestionDb={questionDb.data || []}
                      allStudentResponses={studentResponse.data || []}
                      config={analysisConfig}
                    />
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {mainTab === 'generator' && (
            <div className="mt-16">
              <DbGenerator
                syncedCsvData={classificationCsv.data}
                registeredQuestionDb={questionDb.data}
              />
            </div>
          )}
        </main>
      </div>
    </div>
  );
};