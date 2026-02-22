

import React, { useState, useMemo, useEffect } from 'react';
import type { ScoredStudent, QuestionStatItem, QuestionDBItem, StudentResponseRaw, AnalysisConfig } from '../types';
import { 
  Calculator, Users, Star, Award, ArrowDownAZ, SortAsc, 
  LayoutList, ClipboardCheck, ArrowUpNarrowWide, Hash, 
  GraduationCap, UserX, UserCheck, Layers, Filter 
} from 'lucide-react';
import { calculateExamScores } from '../services/examScorerService';
import { LatexRenderer } from './LatexRenderer'; // Fix: Corrected typo in import path

interface StatCardProps { 
  icon: React.ReactNode; 
  label: string; 
  value: string | number; 
  color?: string 
}

const StatCard: React.FC<StatCardProps> = ({ icon, label, value, color = "indigo" }) => (
  <div className={`flex items-center p-4 bg-white rounded-xl border border-gray-200 shadow-sm transition-all hover:shadow-lg hover:-translate-y-1`}>
    <div className={`mr-4 text-${color}-500 bg-${color}-100/50 p-3 rounded-full`}>{icon}</div>
    <div>
      <p className="text-sm text-gray-500 font-medium">{label}</p>
      <p className="text-2xl font-black text-gray-800 tracking-tight">{value}</p>
    </div>
  </div>
);

interface ExamReportViewerProps {
  reportData: ScoredStudent[];
  allQuestionDb: QuestionDBItem[];
  allStudentResponses: StudentResponseRaw[];
  config: AnalysisConfig;
}

export const ExamReportViewer: React.FC<ExamReportViewerProps> = ({ reportData, allQuestionDb, allStudentResponses, config }) => {
  const [selectedGrade, setSelectedGrade] = useState<string | null>(null);
  const [selectedExamId, setSelectedExamId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'students' | 'questions'>('students');
  const [studentSortOrder, setStudentSortOrder] = useState<'rank' | 'name'>('rank');
  const [questionSortOrder, setQuestionSortOrder] = useState<'num' | 'error'>('num');
  
  const [currentExamAnalysis, setCurrentExamAnalysis] = useState<{
    results: ScoredStudent[];
    questionStats: QuestionStatItem[];
    summary: { average: number; max: number; studentCount: number };
  } | null>(null);

  // 1. 유틸리티: 학년/이름 클리닝 및 정규화
  const cleanStr = (s: any) => String(s || '').trim();
  const cleanGrade = (g: any) => cleanStr(g || '미분류').replace(/\s+/g, '');

  // 2. 기초 데이터 맵핑 (최적화)
  const baseData = useMemo(() => {
    // 시험 ID -> 과목 맵핑
    const examToSubject = new Map<string, string>();
    allQuestionDb.forEach(q => {
      const eId = cleanStr(q['시험 ID/교재명'] || q['시험 ID'] || q['시험ID']);
      if (eId && !examToSubject.has(eId)) {
        examToSubject.set(eId, cleanStr(q['과목'] || q['과목명']));
      }
    });

    // 학생별 가장 최근 응답을 기준으로 현재 학년 파악
    const studentLatestInfo = new Map<string, { grade: string; ts: number }>();
    allStudentResponses.forEach(res => {
      const name = cleanStr(res['이름']);
      const grade = cleanGrade(res['학년']);
      const tsValue = res['타임스탬프'];
      const ts = tsValue instanceof Date ? tsValue.getTime() : new Date(String(tsValue)).getTime();

      if (name && (!studentLatestInfo.has(name) || ts > studentLatestInfo.get(name)!.ts)) {
        studentLatestInfo.set(name, { grade, ts });
      }
    });

    return { examToSubject, studentLatestInfo };
  }, [allQuestionDb, allStudentResponses]);

  // 3. 과목별 최근 5개 시험 및 해당 시험 응시 학생(활성 학생) 추출
  const activeStudentsBySubject = useMemo(() => {
    const subjectExams = new Map<string, { examId: string; date: number }[]>();
    
    // 시험별 최신 응시일 파악
    const examMaxDates = new Map<string, number>();
    allStudentResponses.forEach(res => {
      const eId = cleanStr(res['시험 ID'] || res['시험ID']);
      const tsValue = res['타임스탬프'];
      const ts = tsValue instanceof Date ? tsValue.getTime() : new Date(String(tsValue)).getTime();
      examMaxDates.set(eId, Math.max(examMaxDates.get(eId) || 0, ts));
    });

    // 과목별로 시험 정렬하여 보관
    examMaxDates.forEach((date, eId) => {
      const sub = baseData.examToSubject.get(eId) || '미분류';
      if (!subjectExams.has(sub)) subjectExams.set(sub, []);
      subjectExams.get(sub)!.push({ examId: eId, date });
    });

    const activeMap = new Map<string, Set<string>>(); // 과목 -> 활성 학생 이름 Set

    subjectExams.forEach((exams, sub) => {
      // 해당 과목의 최근 5개 시험 ID 추출
      const recent5ExamIds = new Set(
        exams.sort((a, b) => b.date - a.date).slice(0, 5).map(e => e.examId)
      );

      // 최근 5개 시험 중 하나라도 본 학생들을 '해당 과목 수강생'으로 간주
      const activeSet = new Set<string>();
      allStudentResponses.forEach(res => {
        const eId = cleanStr(res['시험 ID'] || res['시험ID']);
        if (recent5ExamIds.has(eId)) {
          activeSet.add(cleanStr(res['이름']));
        }
      });
      activeMap.set(sub, activeSet);
    });

    return activeMap;
  }, [allStudentResponses, baseData.examToSubject]);

  // 4. 시험지별 '대표 학년' 결정 (다수결 로직)
  const examMajorityGrade = useMemo(() => {
    const examToGradeCount = new Map<string, Map<string, number>>();
    const analyzableExams = new Set(reportData.map(r => r['시험 ID']));

    allStudentResponses.forEach(res => {
      const examId = cleanStr(res['시험 ID'] || res['시험ID']);
      const grade = cleanGrade(res['학년']);
      
      if (examId && analyzableExams.has(examId)) {
        if (!examToGradeCount.has(examId)) examToGradeCount.set(examId, new Map());
        const counts = examToGradeCount.get(examId)!;
        counts.set(grade, (counts.get(grade) || 0) + 1);
      }
    });

    const finalMapping = new Map<string, string>();
    examToGradeCount.forEach((counts, examId) => {
      const majorityGrade = Array.from(counts.entries()).reduce((a, b) => a[1] > b[1] ? a : b)[0];
      finalMapping.set(examId, majorityGrade);
    });

    return finalMapping;
  }, [allStudentResponses, reportData]);

  // 5. 학년별 시험지 목록 구성
  const gradesWithExams = useMemo(() => {
    const map = new Map<string, string[]>();
    examMajorityGrade.forEach((grade, examId) => {
      if (!map.has(grade)) map.set(grade, []);
      map.get(grade)!.push(examId);
    });

    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([grade, exams]) => ({ grade, exams: exams.sort() }));
  }, [examMajorityGrade]);

  const availableGrades = useMemo(() => gradesWithExams.map(g => g.grade), [gradesWithExams]);

  // 학년/시험지 선택 자동화
  useEffect(() => {
    if (availableGrades.length > 0 && !selectedGrade) {
      setSelectedGrade(availableGrades[0]);
    }
  }, [availableGrades, selectedGrade]);

  useEffect(() => {
    const currentGradeExams = gradesWithExams.find(g => g.grade === selectedGrade)?.exams || [];
    if (currentGradeExams.length > 0) {
      if (!selectedExamId || !currentGradeExams.includes(selectedExamId)) {
        setSelectedExamId(currentGradeExams[0]);
      }
    } else {
      setSelectedExamId(null);
    }
  }, [selectedGrade, gradesWithExams, selectedExamId]);

  // 분석 데이터 계산
  useEffect(() => {
    if (selectedExamId && allQuestionDb && allStudentResponses && config) {
        try {
            const analysis = calculateExamScores(allQuestionDb, allStudentResponses, selectedExamId, config);
            setCurrentExamAnalysis(analysis);
        } catch (e: unknown) {
            console.error("Failed to calculate exam analysis:", String(e));
            setCurrentExamAnalysis(null);
        }
    } else {
        setCurrentExamAnalysis(null);
    }
  }, [selectedExamId, allQuestionDb, allStudentResponses, config]);

  // 6. 현재 선택된 학년/시험에 따른 응시 현황 정밀 계산
  const currentAttendance = useMemo(() => {
    if (!selectedExamId || !currentExamAnalysis || !selectedGrade) return { took: [], missing: [], subjectName: '' };

    const currentSubject = baseData.examToSubject.get(selectedExamId) || '미분류';
    const activeInSubject = activeStudentsBySubject.get(currentSubject) || new Set();
    const tookNamesInThisExam = new Set(currentExamAnalysis.results.map(r => r['학생 이름']));

    const took: string[] = [];
    const missing: string[] = [];

    // [핵심] 1. 과목 활성 학생(최근 5시험 응시자) 중 + 2. 현재 학년이 선택된 학년인 학생만 필터링
    baseData.studentLatestInfo.forEach((info, name) => {
      if (info.grade === selectedGrade && activeInSubject.has(name)) {
        if (tookNamesInThisExam.has(name)) {
          took.push(name);
        } else {
          missing.push(name);
        }
      }
    });

    return { 
      took: took.sort(), 
      missing: missing.sort(),
      subjectName: currentSubject 
    };
  }, [selectedExamId, selectedGrade, currentExamAnalysis, activeStudentsBySubject, baseData]);

  const sortedStudentData = useMemo(() => {
    if (!currentExamAnalysis) return [];
    const dataCopy = [...currentExamAnalysis.results];
    if (studentSortOrder === 'name') {
        dataCopy.sort((a, b) => a['학생 이름'].localeCompare(b['학생 이름']));
    } else {
        dataCopy.sort((a, b) => {
            const rankA = parseInt(a['석차'].split(' / ')[0]);
            const rankB = parseInt(b['석차'].split(' / ')[0]);
            return rankA - rankB;
        });
    }
    return dataCopy;
  }, [currentExamAnalysis, studentSortOrder]);

  const sortedQuestionData = useMemo(() => {
    if (!currentExamAnalysis) return [];
    const dataCopy = [...currentExamAnalysis.questionStats];
    if (questionSortOrder === 'error') {
        dataCopy.sort((a, b) => b['오답률'] - a['오답률']);
    } else {
        dataCopy.sort((a, b) => a['번호'] - b['번호']);
    }
    return dataCopy;
  }, [currentExamAnalysis, questionSortOrder]);

  if (!reportData || reportData.length === 0) return null;
  
  return (
    <div className="bg-white p-6 sm:p-8 rounded-2xl shadow-lg border border-gray-200/50">
      <section id="exam-report-viewer">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-gray-200 pb-6 mb-8">
            <div className="flex items-center gap-3">
                <div className="p-2 bg-indigo-600 rounded-lg shadow-indigo-200 shadow-lg">
                    <Calculator className="w-6 h-6 text-white" />
                </div>
                <h2 className="text-2xl font-extrabold text-gray-800 tracking-tight">시험 결과 정밀 분석</h2>
            </div>
            
            <div className="flex bg-indigo-50 p-1 rounded-xl border border-indigo-100">
                <button 
                    onClick={() => setViewMode('students')}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all ${viewMode === 'students' ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                >
                    <Users className="w-4 h-4" /> 학생별 분석
                </button>
                <button 
                    onClick={() => setViewMode('questions')}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all ${viewMode === 'questions' ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                >
                    <ClipboardCheck className="w-4 h-4" /> 문제별 분석
                </button>
            </div>
        </div>

        {/* 학년 선택 및 시험지 필터 섹션 */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
          <div className="p-4 bg-gray-50 rounded-xl border border-gray-200">
            <label className="block text-xs font-black text-gray-400 uppercase tracking-widest mb-3 px-1 flex items-center gap-2">
              <GraduationCap className="w-3 h-3" /> Grade Selection
            </label>
            <div className="flex flex-wrap gap-2">
              {availableGrades.map(grade => (
                <button
                  key={grade}
                  onClick={() => setSelectedGrade(grade)}
                  className={`px-4 py-2 rounded-lg text-sm font-bold transition-all border ${
                    selectedGrade === grade 
                    ? 'bg-indigo-600 text-white border-indigo-600 shadow-md' 
                    : 'bg-white text-gray-600 border-gray-200 hover:border-indigo-300'
                  }`}
                >
                  {grade}
                </button>
              ))}
            </div>
          </div>

          <div className="p-4 bg-gray-50 rounded-xl border border-gray-200">
            <label htmlFor="exam-id-select" className="block text-xs font-black text-gray-400 uppercase tracking-widest mb-3 px-1 flex items-center gap-2">
              <Filter className="w-3 h-3" /> Filtered Exam List
            </label>
            <select
              id="exam-id-select"
              value={selectedExamId || ''}
              onChange={(e) => setSelectedExamId(e.target.value)}
              disabled={!selectedGrade || (gradesWithExams.find(g => g.grade === selectedGrade)?.exams.length === 0)}
              className="w-full p-2.5 border border-gray-200 rounded-lg shadow-sm focus:ring-2 focus:ring-indigo-500 bg-white outline-none transition font-bold text-gray-700 disabled:bg-gray-100 disabled:text-gray-400"
            >
              {selectedGrade ? (
                gradesWithExams.find(g => g.grade === selectedGrade)?.exams.map(id => (
                  <option key={id} value={id}>{id}</option>
                ))
              ) : (
                <option value="">학년을 먼저 선택하세요</option>
              )}
            </select>
          </div>
        </div>

        {currentExamAnalysis ? (
          <div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-10">
              <StatCard icon={<Users className="w-6 h-6" />} label="응시 인원" value={`${currentExamAnalysis.summary.studentCount}명`} color="indigo" />
              <StatCard icon={<Star className="w-6 h-6" />} label="평균 점수" value={`${currentExamAnalysis.summary.average}점`} color="indigo" />
              <StatCard icon={<Award className="w-6 h-6" />} label="최고 점수" value={`${currentExamAnalysis.summary.max}점`} color="indigo" />
            </div>

            {viewMode === 'students' ? (
              <div className="space-y-4">
                <div className="flex justify-between items-center mb-4">
                    <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                        <LayoutList className="w-5 h-5 text-indigo-500" /> 학생 성적 일람
                    </h3>
                    <div className="flex items-center gap-2 bg-indigo-50 p-1 rounded-lg border border-indigo-100">
                        <button
                            onClick={() => setStudentSortOrder('rank')}
                            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-md transition-all ${studentSortOrder === 'rank' ? 'bg-white text-indigo-600 shadow-sm border border-gray-200' : 'text-gray-500 hover:text-gray-700'}`}
                        >
                            <SortAsc className="w-3.5 h-3.5" /> 석차순
                        </button>
                        <button
                            onClick={() => setStudentSortOrder('name')}
                            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-md transition-all ${studentSortOrder === 'name' ? 'bg-white text-indigo-600 shadow-sm border border-gray-200' : 'text-gray-500 hover:text-gray-700'}`}
                        >
                            <ArrowDownAZ className="w-3.5 h-3.5" /> 이름순
                        </button>
                    </div>
                </div>

                <div className="overflow-hidden rounded-xl border border-gray-200 shadow-sm">
                  <table className="w-full text-sm text-left">
                    <thead className="bg-gray-100 text-gray-500 font-bold border-b border-gray-200">
                      <tr>
                        <th className="px-6 py-4">학생 이름</th>
                        <th className="px-6 py-4">응시일</th>
                        <th className="px-6 py-4 text-center">정답수</th>
                        <th className="px-6 py-4 text-center">최종 점수</th>
                        <th className="px-6 py-4 text-center">석차</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 bg-white">
                      {sortedStudentData.map((res, index) => (
                        <tr key={`${res['학생 이름']}-${index}`} className="hover:bg-indigo-50/30 transition-colors">
                          <td className="px-6 py-4 font-bold text-gray-800">{res['학생 이름']}</td>
                          <td className="px-6 py-4 text-gray-500">{res['시험 응시일']}</td>
                          <td className="px-6 py-4 text-center font-medium">
                            {res['맞힌 개수']} / {currentExamAnalysis.questionStats.length}
                          </td>
                          <td className="px-6 py-4 text-center font-black text-indigo-600">{res['최종 점수'].toFixed(1)}</td>
                          <td className="px-6 py-4 text-center">
                            <span className="px-3 py-1 bg-gray-100 rounded-full text-xs font-bold text-gray-600">
                                {res['석차']}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                 <div className="flex justify-between items-center mb-4">
                    <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                        <ClipboardCheck className="w-5 h-5 text-indigo-500" /> 문항별 오답률 분석
                    </h3>
                    <div className="flex items-center gap-2 bg-indigo-50 p-1 rounded-lg border border-indigo-100">
                        <button
                            onClick={() => setQuestionSortOrder('num')}
                            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-md transition-all ${questionSortOrder === 'num' ? 'bg-white text-indigo-600 shadow-sm border border-gray-200' : 'text-gray-500 hover:text-gray-700'}`}
                        >
                            <Hash className="w-3.5 h-3.5" /> 번호순
                        </button>
                        <button
                            onClick={() => setQuestionSortOrder('error')}
                            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-md transition-all ${questionSortOrder === 'error' ? 'bg-white text-indigo-600 shadow-sm border border-gray-200' : 'text-gray-500 hover:text-gray-700'}`}
                        >
                            <ArrowUpNarrowWide className="w-3.5 h-3.5" /> 오답률순
                        </button>
                    </div>
                </div>

                <div className="overflow-hidden rounded-xl border border-gray-200 shadow-sm">
                  <table className="w-full text-sm text-left">
                    <thead className="bg-gray-100 text-gray-500 font-bold border-b border-gray-200">
                      <tr>
                        <th className="px-6 py-4 text-center w-16">No.</th>
                        <th className="px-6 py-4">난이도</th>
                        <th className="px-6 py-4">세부 유형</th>
                        <th className="px-6 py-4 text-center">전체 응시</th>
                        <th className="px-6 py-4 text-center">오답수</th>
                        <th className="px-6 py-4 text-center">오답률</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 bg-white">
                      {sortedQuestionData.map((stat) => (
                        <tr key={stat['번호']} className="hover:bg-indigo-50/30 transition-colors">
                          <td className="px-6 py-4 text-center font-black text-gray-400">{stat['번호']}</td>
                          <td className="px-6 py-4">
                             <span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase ${
                                 stat['난이도'] === '상' ? 'bg-red-100 text-red-600' : 
                                 stat['난이도'] === '중' ? 'bg-orange-100 text-orange-600' : 'bg-green-100 text-green-600'
                             }`}>
                                 {stat['난이도']}
                             </span>
                          </td>
                          <td className="px-6 py-4 font-medium text-gray-700">
                            <LatexRenderer text={stat['세부 유형']} />
                          </td>
                          <td className="px-6 py-4 text-center text-gray-500">{stat['전체 응시']}</td>
                          <td className="px-6 py-4 text-center font-bold text-red-500">{stat['오답수']}</td>
                          <td className="px-6 py-4 text-center">
                            <div className="flex items-center justify-center gap-3">
                                <div className="w-24 bg-gray-100 h-2 rounded-full overflow-hidden hidden sm:block">
                                    <div 
                                        className={`h-full ${stat['오답률'] > 70 ? 'bg-red-500' : stat['오답률'] > 40 ? 'bg-orange-500' : 'bg-teal-500'}`}
                                        style={{ width: `${stat['오답률']}%` }}
                                    ></div>
                                </div>
                                <span className={`text-sm font-black ${stat['오답률'] > 50 ? 'text-red-600' : 'text-gray-800'}`}>
                                    {stat['오답률']}%
                                </span>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div className="mt-12 pt-8 border-t border-gray-100">
              <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2 mb-2">
                <Users className="w-5 h-5 text-indigo-500" /> {selectedGrade} {currentAttendance.subjectName} 응시 현황
              </h3>
              <p className="text-xs text-gray-500 mb-6 font-medium">
                * 해당 과목의 최근 5개 시험 중 1회 이상 응시한 학생만 집계 대상에 포함됩니다.
              </p>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* 응시자 카드 */}
                <div className="bg-white p-4 rounded-xl border border-green-100 shadow-sm">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2 text-green-600">
                      <UserCheck className="w-4 h-4" />
                      <span className="text-sm font-bold">응시자 ({currentAttendance.took.length})</span>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {currentAttendance.took.map(name => (
                      <span key={name} className="text-xs font-medium text-gray-700 bg-gray-100 px-2 py-1 rounded">
                        {name}
                      </span>
                    ))}
                  </div>
                </div>

                {/* 미응시자 카드 */}
                <div className="bg-white p-4 rounded-xl border border-red-100 shadow-sm">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2 text-red-500">
                      <UserX className="w-4 h-4" />
                      <span className="text-sm font-bold">미응시자 ({currentAttendance.missing.length})</span>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {currentAttendance.missing.length > 0 ? currentAttendance.missing.map(name => (
                      <span key={name} className="text-xs font-medium text-red-700 bg-red-50 px-2 py-1 rounded border border-red-100">
                        {name}
                      </span>
                    )) : (
                      <span className="text-xs text-green-600 font-bold">해당 과목 수강생 전원 응시</span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="text-center py-20 bg-gray-50 rounded-2xl border border-dashed border-gray-300">
            <Layers className="w-12 h-12 text-gray-300 mx-auto mb-4" />
            <p className="text-gray-500 font-medium">분석할 시험지를 선택해주세요.</p>
          </div>
        )}
      </section>
    </div>
  );
};