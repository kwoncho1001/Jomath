
import type { QuestionDBItem, StudentResponseRaw, TextbookResponseRaw, TransactionLogItem, ProgressMasterItem, ScoredStudent, AnalysisConfig, ClassificationCsvItem } from '../types';
import { calculateExamScores } from './examScorerService';

const KEY_SEPARATOR = '||';

const normalizeString = (str: string | number | undefined): string => {
  return String(str || '').replace(/[\[\]]/g, '').trim();
}

const getQuestionIdentifier = (q: QuestionDBItem): string => {
    const id = normalizeString(q['시험 ID/교재명'] || q['시험 ID'] || q['시험ID']);
    const subject = normalizeString(q['과목'] || q['과목명']); // Ensure subject is part of the identifier
    return `${subject}|${id}`;
};

const getWeightByDifficulty = (difficulty: '상' | '중' | '하' | undefined, config: AnalysisConfig): number => {
  switch (difficulty) {
    case '상': return config.weights['상'];
    case '중': return config.weights['중'];
    case '하': return config.weights['하'];
    default: return config.weights['중'];
  }
};

/**
 * The main data processing engine, updated to handle both tests and textbook responses.
 */
export const processStudentData = (
  questionDb: QuestionDBItem[],
  studentResponses: StudentResponseRaw[],
  textbookResponses: TextbookResponseRaw[],
  existingLog: TransactionLogItem[],
  existingMaster: ProgressMasterItem[],
  config: AnalysisConfig,
  classificationCsvData: ClassificationCsvItem[] // New argument
): { 
  transactionLog: TransactionLogItem[], 
  progressMaster: Omit<ProgressMasterItem, 'Correct_Answers'>[],
  examScoreReport: ScoredStudent[]
} => {
  
  const newProgressMasterMap: Map<string, ProgressMasterItem> = new Map(
    existingMaster.map(item => [`${item.StudentID}${KEY_SEPARATOR}${item.DetailType}`, { ...item }])
  );
  
  const existingRecords = new Set(existingLog.map(l => 
    `${new Date(l.Date).getTime()}_${l.StudentID}_${l.ExamID}_${l.QuestionNum}`
  ));
  
  // Use a more robust key for questionDbMap including subject
  const questionDbMap = new Map(questionDb.map(q => {
    const examId = normalizeString(q['시험 ID/교재명'] || q['시험 ID'] || q['시험ID']);
    const subject = normalizeString(q['과목'] || q['과목명']);
    return [`${subject}|${examId}-${q['번호']}`, q];
  }));

  const newlyGeneratedLogs: TransactionLogItem[] = [];

  const getTimestamp = (ts: string | number | Date): string => {
    if (ts instanceof Date) return ts.toISOString();
    if (typeof ts === 'number') { // Excel date number
        const excelEpoch = new Date(1899, 11, 30);
        return new Date(excelEpoch.getTime() + ts * 24 * 60 * 60 * 1000).toISOString();
    }
    return new Date(String(ts)).toISOString();
  }

  // Pre-indexing question DB for performance
  const questionsByExamId = new Map<string, QuestionDBItem[]>();
  const questionsByBookId = new Map<string, QuestionDBItem[]>();
  questionDb.forEach(q => {
      const examId = normalizeString(q['시험 ID/교재명'] || q['시험 ID'] || q['시험ID']);
      const subject = normalizeString(q['과목'] || q['과목명']);
      const bookKey = `${subject}|${examId}`;

      if (!questionsByExamId.has(examId)) {
          questionsByExamId.set(examId, []);
      }
      questionsByExamId.get(examId)!.push(q);
      
      if (!questionsByBookId.has(bookKey)) {
          questionsByBookId.set(bookKey, []);
      }
      questionsByBookId.get(bookKey)!.push(q);
  });

  const answerRegex = /^문제 답안 입력 \[(\d+)번]/;

  const extractAnswers = (response: any): Map<number, any> => {
      const answers = new Map<number, any>();
      for (const key in response) {
          const match = answerRegex.exec(key);
          if (match && match[1]) {
              const questionNum = parseInt(match[1], 10);
              if (!isNaN(questionNum)) {
                  answers.set(questionNum, response[key]);
              }
          }
      }
      return answers;
  };

  // 1. Process Test Responses (Type: 'Test')
  for (const response of studentResponses) {
    const studentId = normalizeString(response['이름'] || response['이메일 주소'] || 'Unknown');
    if (studentId === 'Unknown') continue;
    
    const examId = normalizeString(response['시험 ID'] || response['시험ID']);
    if (!examId) continue;
    
    const timestamp = getTimestamp(response['타임스탬프']);
    
    const studentAnswers = extractAnswers(response);
    
    const questionsForThisExamUnfiltered = questionsByExamId.get(examId) || [];
    if (questionsForThisExamUnfiltered.length === 0) continue;

    const subjectForExam = normalizeString(questionsForThisExamUnfiltered[0]['과목'] || questionsForThisExamUnfiltered[0]['과목명']);

    for (const [questionNum, studentAnswerRaw] of studentAnswers.entries()) {
        const questionInfo = questionsForThisExamUnfiltered.find(q => q['번호'] === questionNum);
        if(!questionInfo) continue;

        const recordKey = `${new Date(timestamp).getTime()}_${studentId}_${examId}_${questionNum}`;
        if (existingRecords.has(recordKey)) continue;

        const studentAnswer = (studentAnswerRaw !== undefined && studentAnswerRaw !== null && String(studentAnswerRaw).trim() !== '')
            ? parseInt(String(studentAnswerRaw), 10) : NaN;
        
        const isCorrect = !isNaN(studentAnswer) && questionInfo['정답'] === studentAnswer;
        const weight = getWeightByDifficulty(questionInfo['난이도'], config);
        const score = isCorrect ? weight : -weight;
        
        newlyGeneratedLogs.push({
            Date: timestamp, StudentID: studentId, ExamID: `${subjectForExam}|${examId}`, QuestionNum: questionNum, // Store examID with subject
            Result: isCorrect ? 'O' : 'X', Type: 'Test',
            Weight: parseFloat(weight.toFixed(4)), Score: parseFloat(score.toFixed(4)),
        });
        existingRecords.add(recordKey);
    }
  }

  // 2. Process Textbook Responses (Type: 'Book')
  for (const response of textbookResponses) {
    const studentId = normalizeString(response['이름']);
    const textbookName = normalizeString(response['교재명']);
    const subjectName = normalizeString(response['과목명']);
    const rangeString = response['문제 자릿수'];

    if (!studentId || !textbookName || !subjectName || !rangeString) continue;

    const startNumMatch = rangeString.match(/^(\d+)/);
    if (!startNumMatch) continue;
    const startNumber = parseInt(startNumMatch[1], 10);

    const timestamp = getTimestamp(response['타임스탬프']);
    const studentAnswers = extractAnswers(response);
    
    const bookKey = `${subjectName}|${textbookName}`;
    const questionsForThisBook = questionsByBookId.get(bookKey) || [];

    if (questionsForThisBook.length === 0) continue;
    const bookQuestionMap = new Map(questionsForThisBook.map(q => [q['번호'], q]));

    for (const [relativeNum, studentAnswerRaw] of studentAnswers.entries()) {
        const absoluteQuestionNum = startNumber + relativeNum - 1;
        const questionInfo = bookQuestionMap.get(absoluteQuestionNum);
        if (!questionInfo) continue;
        
        const recordKey = `${new Date(timestamp).getTime()}_${studentId}_${textbookName}_${absoluteQuestionNum}`;
        if (existingRecords.has(recordKey)) continue;

        const studentAnswer = (studentAnswerRaw !== undefined && studentAnswerRaw !== null && String(studentAnswerRaw).trim() !== '')
            ? parseInt(String(studentAnswerRaw), 10) : NaN;

        const isCorrect = !isNaN(studentAnswer) && questionInfo['정답'] === studentAnswer;
        const weight = getWeightByDifficulty(questionInfo['난이도'], config);
        const score = isCorrect ? weight : -weight;

        newlyGeneratedLogs.push({
            Date: timestamp, StudentID: studentId, ExamID: `${subjectName}|${textbookName}`, QuestionNum: absoluteQuestionNum, // Store examID with subject
            Result: isCorrect ? 'O' : 'X', Type: 'Book',
            Weight: parseFloat(weight.toFixed(4)), Score: parseFloat(score.toFixed(4)),
        });
        existingRecords.add(recordKey);
    }
  }

  const fullTransactionLog = [...existingLog, ...newlyGeneratedLogs];
  
  // Create a map for quick sub-unit lookup, now including the full path.
  const questionSubUnitPathMap = new Map<string, string>(); // Key: Subject|ExamID-QuestionNum, Value: Subject|LargeUnit|SmallUnit
  questionDb.forEach(q => {
      const examId = normalizeString(q['시험 ID/교재명'] || q['시험 ID'] || q['시험ID']);
      const subject = normalizeString(q['과목'] || q['과목명']);
      const largeUnit = normalizeString(q['대단원'] || '미분류');
      const smallUnit = normalizeString(q['소단원'] || '일반');
      const detailType = normalizeString(q['세부 유형']);
      questionSubUnitPathMap.set(`${subject}|${examId}-${q['번호']}`, `${subject}|${largeUnit}|${smallUnit}|${detailType}`);
  });

  // Filter the full log based on selected sub-units (full paths).
  const selectedSubUnits = new Set(config.selectedSubUnits); // These are full paths
  const filteredTransactionLog = fullTransactionLog.filter(log => {
    // log.ExamID already contains "Subject|ExamID"
    const key = `${log.ExamID}-${log.QuestionNum}`; 
    const subUnitPath = questionSubUnitPathMap.get(key);
    // Here we check if the full subUnitPath (Subject|Large|Small|Detail) is found.
    // If config.selectedSubUnits contains "Subject|Large|Small", then all DetailTypes under it are implicitly selected.
    // So, we need to check if the `subUnitPath` starts with any of the `selectedSubUnits`
    return subUnitPath ? Array.from(selectedSubUnits).some(selectedPathPrefix => subUnitPath.startsWith(selectedPathPrefix)) : false;
  });

  const logsByStudentAndType = new Map<string, TransactionLogItem[]>();
  for (const log of filteredTransactionLog) {
      // log.ExamID is "Subject|ExamID"
      const questionInfo = questionDbMap.get(`${log.ExamID}-${log.QuestionNum}`);
      if (!questionInfo) continue;
      const detailType = questionInfo['세부 유형'];
      const key = `${log.StudentID}${KEY_SEPARATOR}${detailType}`;
      if (!logsByStudentAndType.has(key)) {
          logsByStudentAndType.set(key, []);
      }
      logsByStudentAndType.get(key)!.push(log);
  }
  
  const pairsToUpdate = new Set<string>();
  for (const log of newlyGeneratedLogs) { // Check new logs to see which master records to update
      // log.ExamID is "Subject|ExamID"
      const key = `${log.ExamID}-${log.QuestionNum}`;
      const subUnitPath = questionSubUnitPathMap.get(key);
      if (subUnitPath && Array.from(selectedSubUnits).some(selectedPathPrefix => subUnitPath.startsWith(selectedPathPrefix))) {
          const questionInfo = questionDbMap.get(key);
          if (questionInfo) {
              const detailType = questionInfo['세부 유형'];
              pairsToUpdate.add(`${log.StudentID}${KEY_SEPARATOR}${detailType}`);
          }
      }
  }
  
  // Also need to re-calculate for all existing types in case the filter changed
  existingMaster.forEach(item => pairsToUpdate.add(`${item.StudentID}${KEY_SEPARATOR}${item.DetailType}`));


  // Helper for new index-based scoring
  const calculateDifficultyIndex = (logs: TransactionLogItem[]): number => {
      if (!logs || logs.length === 0) return 0;
      
      logs.sort((a, b) => new Date(b.Date).getTime() - new Date(a.Date).getTime());
      const recentLogs = logs.slice(0, config.recentCount);
      
      const scoreSum = recentLogs.reduce((sum, l) => sum + l.Score, 0);
      const weightSum = recentLogs.reduce((sum, l) => sum + l.Weight, 0);

      if (weightSum === 0) return 0;
      
      return scoreSum / weightSum;
  };

  // 4. Recalculate Progress Master for affected student-type pairs.
  for (const key of pairsToUpdate) {
      const [studentId, detailType] = key.split(KEY_SEPARATOR);
      
      const allLogsForPair = logsByStudentAndType.get(key) || [];
      
      const logsWithDifficulty = allLogsForPair.map(log => {
        const q = questionDbMap.get(`${log.ExamID}-${log.QuestionNum}`); // log.ExamID is "Subject|ExamID"
        return q ? { ...log, 난이도: q['난이도'] } : null;
      }).filter(Boolean) as (TransactionLogItem & { 난이도: '상' | '중' | '하' })[];

      const highLogs = logsWithDifficulty.filter(l => l.난이도 === '상');
      const midLogs = logsWithDifficulty.filter(l => l.난이도 === '중');
      const lowLogs = logsWithDifficulty.filter(l => l.난이도 === '하');

      const processDifficulty = (logs: (TransactionLogItem & { 난이도: '상' | '중' | '하' })[]) => {
          if (logs.length === 0) return -1; // No data for this difficulty
          const testLogs = logs.filter(l => l.Type === 'Test');
          
          if (testLogs.length < config.minTestCount) {
            return -1;
          }

          const bookLogs = logs.filter(l => l.Type === 'Book');
          
          const testIndex = calculateDifficultyIndex(testLogs);
          const hasBookData = bookLogs.length > 0;
          
          let finalIndex = 0;
          if (hasBookData) {
              const bookIndex = calculateDifficultyIndex(bookLogs);
              finalIndex = (testIndex * 0.7) + (bookIndex * 0.3);
          } else {
              finalIndex = testIndex;
          }
          return (finalIndex * 50) + 50;
      };

      const scoreHigh = processDifficulty(highLogs);
      const scoreMid = processDifficulty(midLogs);
      const scoreLow = processDifficulty(lowLogs);
      
      const scores = { '상': scoreHigh, '중': scoreMid, '하': scoreLow };
      const ratio = config.difficultyRatio;
      let weightedScoreSum = 0;
      let ratioSum = 0;

      if (scores['상'] >= 0) {
        weightedScoreSum += scores['상'] * ratio['상'];
        ratioSum += ratio['상'];
      }
      if (scores['중'] >= 0) {
        weightedScoreSum += scores['중'] * ratio['중'];
        ratioSum += ratio['중'];
      }
      if (scores['하'] >= 0) {
        weightedScoreSum += scores['하'] * ratio['하'];
        ratioSum += ratio['하'];
      }

      const displayScore = ratioSum > 0 ? weightedScoreSum / ratioSum : -1;

      const totalAttempts = allLogsForPair.length;
      
      if (totalAttempts === 0) {
        // If filtering removed all attempts, reset the scores.
        newProgressMasterMap.set(key, {
           StudentID: studentId, DetailType: detailType, Score_High: -1, Score_Mid: -1, Score_Low: -1,
           Total_Attempts: 0, Correct_Answers: 0, Accuracy: 0,
           Last_Updated: new Date().toISOString(), DisplayScore: -1
        });
        continue;
      }

      const correctAnswers = allLogsForPair.filter(log => log.Result === 'O').length;
      const accuracy = totalAttempts > 0 ? (correctAnswers / totalAttempts) * 100 : 0;
      const lastUpdated = allLogsForPair.length > 0 
        ? allLogsForPair.sort((a, b) => new Date(b.Date).getTime() - new Date(a.Date).getTime())[0].Date 
        : new Date().toISOString();

      newProgressMasterMap.set(key, {
          StudentID: studentId, 
          DetailType: detailType, 
          Score_High: scoreHigh,
          Score_Mid: scoreMid,
          Score_Low: scoreLow,
          Total_Attempts: totalAttempts, 
          Correct_Answers: correctAnswers, 
          Accuracy: accuracy,
          Last_Updated: lastUpdated, 
          DisplayScore: displayScore
      });
  }

  // 5. Batch generate Exam Score Report (only for tests)
  let fullExamScoreReport: ScoredStudent[] = [];
  if (studentResponses && studentResponses.length > 0) {
      // Extract unique exam IDs from student responses (original exam ID without subject prefix)
      const uniqueExamIdsInResponses = new Set(studentResponses.map(r => normalizeString(r['시험 ID'] || r['시험ID'])));
      
      for (const examId of uniqueExamIdsInResponses) {
          if (!examId) continue;
          try {
            // Pass the full question DB and config; the scorer will filter by selectedSubUnits
            const { results } = calculateExamScores(questionDb, studentResponses, examId, config);
            if (results.length > 0) {
                const resultsWithExamId = results.map(r => ({ ...r, '시험 ID': examId }));
                fullExamScoreReport = fullExamScoreReport.concat(resultsWithExamId);
            }
          } catch (e) {
            console.warn(`Could not calculate scores for Exam ID ${examId}:`, e);
          }
      }
  }

  // 6. Finalize and format output data.
  const finalProgressMasterList = Array.from(newProgressMasterMap.values());
  const formattedProgressMaster = finalProgressMasterList.map(item => {
    const { Correct_Answers, ...rest } = item;
    return { ...rest,
      Accuracy: parseFloat(item.Accuracy.toFixed(2)),
      DisplayScore: parseFloat(item.DisplayScore.toFixed(1)),
      Score_High: parseFloat(item.Score_High.toFixed(1)),
      Score_Mid: parseFloat(item.Score_Mid.toFixed(1)),
      Score_Low: parseFloat(item.Score_Low.toFixed(1)),
    };
  });
  
  filteredTransactionLog.sort((a, b) => new Date(a.Date).getTime() - new Date(b.Date).getTime() || a.StudentID.localeCompare(b.StudentID) || a.ExamID.localeCompare(b.ExamID) || a.QuestionNum - b.QuestionNum);
  formattedProgressMaster.sort((a, b) => a.StudentID.localeCompare(b.StudentID) || a.DetailType.localeCompare(b.DetailType));
  fullExamScoreReport.sort((a,b) => a['시험 ID'].localeCompare(b['시험 ID']) || a['학생 이름'].localeCompare(b['학생 이름']));

  return { 
    transactionLog: filteredTransactionLog, 
    progressMaster: formattedProgressMaster,
    examScoreReport: fullExamScoreReport
  };
};