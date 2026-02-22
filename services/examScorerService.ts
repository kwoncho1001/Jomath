

import type { QuestionDBItem, StudentResponseRaw, ScoredStudent, QuestionStatItem, AnalysisConfig } from '../types';

const normalizeString = (str: string | number | undefined): string => {
  return String(str || '').replace(/[\[\]]/g, '').trim();
}

const getTimestamp = (ts: string | number | Date): string => {
    if (ts instanceof Date) return ts.toISOString();
    if (typeof ts === 'number') {
        const excelEpoch = new Date(1899, 11, 30);
        return new Date(excelEpoch.getTime() + ts * 24 * 60 * 60 * 1000).toISOString();
    }
    return new Date(String(ts)).toISOString();
}

export const calculateExamScores = (
  questionDb: QuestionDBItem[],
  studentResponses: StudentResponseRaw[],
  examId: string, // This is the original examId, not prefixed with subject
  config: AnalysisConfig
): { 
    results: ScoredStudent[], 
    questionStats: QuestionStatItem[],
    summary: { average: number; max: number; studentCount: number } 
} => {
  const cleanedExamId = normalizeString(examId);

  // First, find all questions for the given exam ID
  const allQuestionsForExam = questionDb.filter(q => {
      const id = normalizeString(q['시험 ID/교재명'] || q['시험 ID'] || q['시험ID']);
      return id === cleanedExamId;
  });

  if (allQuestionsForExam.length === 0) {
    throw new Error(`시험 ID '${cleanedExamId}'에 해당하는 문제가 Question DB에 없습니다.`);
  }

  // Then, filter these questions by selected sub-units from the config
  const selectedSubUnits = new Set(config.selectedSubUnits); // These are full paths like "Subject|LargeUnit|SmallUnit"
  
  const relevantQuestionsFilteredBySubUnit = allQuestionsForExam.filter(q => {
    const subject = normalizeString(q['과목'] || q['과목명']);
    const large = normalizeString(q['대단원'] || '미분류');
    const small = normalizeString(q['소단원'] || '일반');
    const fullPath = `${subject}|${large}|${small}`;
    return Array.from(selectedSubUnits).some(selectedPathPrefix => fullPath.startsWith(selectedPathPrefix));
  });

  // Ensure uniqueness by question number (번호) in case source data has duplicates for the same exam
  const uniqueRelevantQuestionsMap = new Map<number, QuestionDBItem>();
  relevantQuestionsFilteredBySubUnit.forEach(q => {
      uniqueRelevantQuestionsMap.set(q['번호'], q);
  });
  const uniqueRelevantQuestions = Array.from(uniqueRelevantQuestionsMap.values()).sort((a,b) => a['번호'] - b['번호']);


  // If after filtering and ensuring uniqueness, no questions are left for this exam, return empty results.
  if (uniqueRelevantQuestions.length === 0) {
    return { results: [], questionStats: [], summary: { average: 0, max: 0, studentCount: 0 }};
  }
  
  const weights = uniqueRelevantQuestions.map(q => {
    switch (q['난이도']) {
        case '상': return config.weights['상'];
        case '중': return config.weights['중'];
        case '하': return config.weights['하'];
        default: return config.weights['중'];
    }
  });
  
  const totalWeight = weights.reduce((sum, w) => sum + w, 0);
  const correctionFactor = totalWeight > 0 ? 100 / totalWeight : 0;
  const pointsPerQuestion = weights.map(w => w * correctionFactor);

  const answerKey = new Map(uniqueRelevantQuestions.map(q => [q['번호'], q['정답']]));
  const qStatsMap = new Map<number, { correct: number; total: number }>();
  uniqueRelevantQuestions.forEach(q => qStatsMap.set(q['번호'], { correct: 0, total: 0 }));

  const relevantResponses = studentResponses.filter(r => normalizeString(r['시험 ID'] || r['시험ID']) === cleanedExamId);
  
  if (relevantResponses.length === 0) {
    // This case might not be an error if no one took the filtered version of the test
    return { results: [], questionStats: [], summary: { average: 0, max: 0, studentCount: 0 }};
  }

  const studentScores: { name: string; score: number; correctCount: number; examDate: string }[] = [];
  const answerRegex = /^문제 답안 입력 \[(\d+)번]/;

  for (const response of relevantResponses) {
    const studentName = normalizeString(response['이름']);
    if (!studentName) continue;

    const examDate = getTimestamp(response['타임스탬프']);
    const studentAnswers = new Map<number, any>();
    
    for (const key in response) {
        const match = answerRegex.exec(key);
        if (match && match[1]) {
            const questionNum = parseInt(match[1], 10);
            if (!isNaN(questionNum)) {
                studentAnswers.set(questionNum, response[key]);
            }
        }
    }

    let score = 0;
    let correctCount = 0;
    
    uniqueRelevantQuestions.forEach((question, index) => { // Use uniqueRelevantQuestions here
      const questionNum = question['번호'];
      const correctAnswer = answerKey.get(questionNum);
      const studentAnswerRaw = studentAnswers.get(questionNum);
      const studentAnswer = (studentAnswerRaw !== undefined && studentAnswerRaw !== null && String(studentAnswerRaw).trim() !== '')
          ? parseInt(String(studentAnswerRaw), 10)
          : NaN;

      const stat = qStatsMap.get(questionNum);
      if (stat) {
          stat.total += 1;
          if (correctAnswer !== undefined && !isNaN(studentAnswer) && studentAnswer === correctAnswer) {
            score += pointsPerQuestion[index];
            correctCount++;
            stat.correct += 1;
          }
      }
    });

    studentScores.push({ name: studentName, score, correctCount, examDate });
  }

  studentScores.sort((a, b) => b.score - a.score);

  const totalStudents = studentScores.length;
  const results: ScoredStudent[] = [];
  let currentRank = 0;
  let lastScore = -1;

  studentScores.forEach((student, index) => {
    if (student.score !== lastScore) {
      currentRank = index + 1;
      lastScore = student.score;
    }
    results.push({
      '시험 ID': cleanedExamId,
      '학생 이름': student.name,
      '시험 응시일': student.examDate.slice(0, 10),
      '맞힌 개수': student.correctCount,
      '최종 점수': parseFloat(student.score.toFixed(1)),
      '석차': `${currentRank} / ${totalStudents}`,
    });
  });

  const questionStats: QuestionStatItem[] = uniqueRelevantQuestions.map(q => { // Use uniqueRelevantQuestions here
      const stat = qStatsMap.get(q['번호']) || { correct: 0, total: 0 };
      const errorCount = stat.total - stat.correct;
      return {
          '번호': q['번호'],
          '난이도': q['난이도'],
          '세부 유형': q['세부 유형'],
          '정답': q['정답'],
          '전체 응시': stat.total,
          '정답수': stat.correct,
          '오답수': errorCount,
          '오답률': stat.total > 0 ? parseFloat(((errorCount / stat.total) * 100).toFixed(1)) : 0
      };
  });
  
  const totalScoreSum = studentScores.reduce((sum, s) => sum + s.score, 0);
  const average = totalStudents > 0 ? totalScoreSum / totalStudents : 0;
  const max = totalStudents > 0 ? studentScores[0].score : 0;

  return {
    results,
    questionStats,
    summary: { 
      average: parseFloat(average.toFixed(1)), 
      max: parseFloat(max.toFixed(1)),
      studentCount: totalStudents 
    }
  };
};