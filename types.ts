
export interface QuestionDBItem {
  '시험 ID/교재명': string;
  '번호': number;
  '정답': number;
  '난이도': '상' | '중' | '하';
  '정답율': number;
  '과목': string; // Ensure '과목' is consistently typed
  '대단원': string;
  '중단원': string;
  '소단원': string;
  '세부 유형': string;
  [key: string]: any;
}

export interface StudentResponseRaw {
  '타임스탬프': string | number | Date;
  '이메일 주소'?: string;
  '학년'?: string;
  '이름': string;
  '시험 ID': string;
  [key: string]: any; 
}

export interface TextbookResponseRaw {
  '타임스탬프': string | number | Date;
  '이름': string;
  '교재명': string;
  '과목명': string;
  '문제 자릿수': string;
  [key:string]: any;
}

export interface TransactionLogItem {
  Date: string;
  StudentID: string;
  ExamID: string;
  QuestionNum: number;
  Result: 'O' | 'X';
  Type: 'Test' | 'Book';
  Weight: number;
  Score: number;
}

export interface ProgressMasterItem {
  StudentID: string;
  DetailType: string;
  Score_High: number;
  Score_Mid: number;
  Score_Low: number;
  Total_Attempts: number;
  Accuracy: number;
  Last_Updated: string;
  DisplayScore: number;
  Correct_Answers?: number;
}

export interface ScoredStudent {
  '시험 ID': string;
  '학생 이름': string;
  '시험 응시일': string;
  '맞힌 개수': number;
  '최종 점수': number;
  '석차': string;
}

export interface QuestionStatItem {
  '번호': number;
  '난이도': string;
  '세부 유형': string;
  '정답': number;
  '전체 응시': number;
  '정답수': number;
  '오답수': number;
  '오답률': number;
}

export interface AggregatedUnitData {
  name: string;
  displayScore: number;
  accuracy: number;
  totalAttempts: number;
  constituentTypes: number;
  subUnits: AggregatedUnitData[];
}

// New interface for classification CSV items
export interface ClassificationCsvItem {
  '과목명': string;
  '대단원': string;
  '중단원': string;
  '소단원': string;
  '세부 유형': string;
}

export type ClassificationTree = Map<string, Map<string, string[]>>; // Subject -> Large Unit -> Small Units

export interface AnalysisConfig {
  minTestCount: number;
  recentCount: number;
  weights: {
    '상': number;
    '중': number;
    '하': number;
  };
  difficultyRatio: {
    '상': number;
    '중': number;
    '하': number;
  };
  selectedSubUnits: string[]; // Stores full paths, e.g., "과목1|대단원A|소단원X"
}

export interface StudentMetadata {
  isActive: boolean;
  email: string;
}