export type QuestionType = 'single' | 'multi' | 'judge';

export type Option = {
  letter: string;
  html: string;
  isCorrect?: boolean;
};

export type ModuleInfo = {
  module: string;
  ord: number;
  questionCount: number;
};

export type Paper = {
  id: string;
  year: number;
  province: string;
  name: string;
  questionCount: number;
  materialCount: number;
  modules: ModuleInfo[];
};

export type Filters = {
  years: { year: number; papers: number }[];
  provinces: { province: string; papers: number }[];
  modules: { module: string; ord: number; papers: number; questions: number }[];
  tags: { tag: string; module: string; moduleOrd: number; questions: number; occurrences: number }[];
  counts: { papers: number; questions: number; occurrences: number; materials: number };
};

export type Attempt = {
  id: string;
  paperId: string;
  durationSec: number;
  startedAt: number;
  deadlineAt: number;
  submittedAt: number | null;
  status: 'in_progress' | 'submitted' | 'expired';
  correctCount: number;
  scoredTotal: number;
  total: number;
  elapsedSec: number;
  serverNow: number;
  answered?: number;
  unanswered?: number;
};

export type AttemptListItem = Attempt & {
  paperName: string;
  year: number;
  province: string;
};

export type ExamQuestion = {
  id: string;
  ordinal: number;
  module: string;
  tag: string;
  type: QuestionType;
  stemHtml: string;
  options: Option[];
  optionCount: number;
  scorable: boolean;
  materialId: string | null;
  materialHtml: string | null;
  choice: string;
  flagged: boolean;
};

export type ReviewQuestion = ExamQuestion & {
  analysisHtml: string;
  optionReasons?: Record<string, string>;
  answer: string;
  isCorrect: boolean | null;
};

export type ModuleScore = {
  module: string;
  total: number;
  scored: number;
  correct: number;
  answered: number;
};

export type Session = {
  id: string;
  kind: 'paper' | 'tag' | 'wrong' | 'question' | 'custom';
  title: string;
  total: number;
  immediate: boolean;
  createdAt: number;
  finishedAt: number | null;
  elapsedSec: number;
  answered: number;
  correct: number;
  wrong: number;
  accuracy: number;
  serverNow: number;
};

export type PracticeIndexItem = { id: string; ordinal: number; module: string; tag: string };

export type PracticeQuestion = {
  id: string;
  ordinal: number;
  module: string;
  tag: string;
  type: QuestionType;
  stemHtml: string;
  analysisHtml: string;
  optionReasons?: Record<string, string>;
  answer: string;
  scorable: boolean;
  optionCount: number;
  materialId: string | null;
  materialHtml: string | null;
  options: Option[];
  source: { paperId: string; year: number; province: string; name: string } | null;
  choice: string;
  revealed: boolean;
  isCorrect: boolean | null;
};

export type WrongItem = {
  id: string;
  wrongCount: number;
  correctStreak: number;
  addedAt: number;
  lastWrongAt: number;
  mastered: boolean;
  module: string;
  tag: string;
  type: QuestionType;
  stemHtml: string;
  analysisHtml: string;
  optionReasons?: Record<string, string>;
  answer: string;
  scorable: boolean;
  optionCount: number;
  materialId: string | null;
  materialHtml: string | null;
  options: Option[];
  source: { paperId: string; year: number; province: string; name: string } | null;
};

export type Overview = {
  profile: { id: string; name: string; color: string | null };
  counts: { papers: number; questions: number; occurrences: number; materials: number };
  wrongCount: number;
  activeAttempts: AttemptListItem[];
  recentAttempts: AttemptListItem[];
  activePractice: { id: string; kind: string; title: string; total: number; answered: number; createdAt: number }[];
};

export type Profile = { id: string; name: string; color: string | null; created_at?: number };

export type Stats = {
  summary: {
    exams: number;
    examCorrect: number;
    examScored: number;
    examAccuracy: number;
    practiceSessions: number;
    practiceAnswered: number;
    practiceCorrect: number;
    practiceAccuracy: number;
    wrongOpen: number;
    wrongMastered: number;
  };
  byModule: { module: string; total: number; answered: number; correct: number; accuracy: number }[];
  byTag: { tag: string; module: string; total: number; answered: number; correct: number; accuracy: number }[];
  activity: {
    date: string;
    examCount: number;
    examCorrect: number;
    examScored: number;
    practiceAnswered: number;
    practiceCorrect: number;
  }[];
  recentExams: {
    id: string;
    correctCount: number;
    scoredTotal: number;
    elapsedSec: number;
    submittedAt: number;
    paperName: string | null;
    year: number | null;
    province: string | null;
    accuracy: number;
  }[];
  family: {
    id: string;
    name: string;
    color: string | null;
    exams: number;
    examCorrect: number;
    examScored: number;
    examAccuracy: number;
    practiceAnswered: number;
    practiceCorrect: number;
    practiceAccuracy: number;
    wrongOpen: number;
  }[];
};

export type SearchItem = {
  id: string;
  module: string;
  tag: string;
  type: QuestionType;
  scorable: boolean;
  inStem: boolean;
  snippet: string;
  source: { paperId: string; year: number; province: string; name: string } | null;
};

export type SearchResult = {
  q: string;
  items: SearchItem[];
  truncated: boolean;
};

export type QuestionFlag = {
  id: string;
  note: string;
  createdAt: number;
  resolved: boolean;
  module: string;
  tag: string;
  type: QuestionType;
  stemHtml: string;
  scorable: boolean;
  source: { paperId: string; year: number; province: string; name: string } | null;
};
