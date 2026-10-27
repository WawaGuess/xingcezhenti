import type {
  Attempt,
  AttemptListItem,
  Filters,
  ModuleScore,
  Overview,
  Paper,
  PracticeQuestion,
  Profile,
  QuestionFlag,
  ReviewQuestion,
  SearchResult,
  Session,
  Stats,
  WrongItem,
} from './types';

const PROFILE_KEY = 'xczt.profileId';

function readProfileId(): string {
  try {
    // 每个标签页优先用自己的成员，避免两个标签页互相把对方切走；
    // localStorage 只作为“上次使用”的默认值。
    return sessionStorage.getItem(PROFILE_KEY) || localStorage.getItem(PROFILE_KEY) || '';
  } catch {
    return '';
  }
}

export function getProfileId(): string {
  return readProfileId() || 'default';
}

export function setProfileId(id: string): void {
  try {
    sessionStorage.setItem(PROFILE_KEY, id);
    localStorage.setItem(PROFILE_KEY, id);
  } catch {
    /* ignore */
  }
}

export class ApiError extends Error {
  status: number;
  data: any;
  constructor(message: string, status: number, data: any) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

const ERROR_MESSAGES: Record<string, string> = {
  name_exists: '这个名字已经有人用了',
  last_profile: '至少保留一个成员',
  name_required: '请输入成员名字',
  name_too_long: '名字最多 20 个字',
  profile_not_found: '成员不存在',
  unknown_profile: '当前成员不存在，请重新选择',
  paper_required: '请选择试卷',
  paper_not_found: '试卷不存在或已更新',
  attempt_not_found: '考试不存在',
  attempt_finished: '这场考试已经结束',
  session_not_found: '练习不存在',
  session_finished: '练习已经结束',
  question_not_in_session: '题目不在本次练习中',
  question_not_in_paper: '题目不在本次试卷中',
  invalid_choice: '选项无效',
  single_choice_only: '单选题只能选一个选项',
  no_questions: '这个范围没有题目',
  question_required: '缺少题目',
  question_not_found: '题目不存在或已更新',
};

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    'X-Profile-Id': getProfileId(),
    ...((init.headers as Record<string, string> | undefined) || {}),
  };
  // GET/DELETE 不带 body 时不要声明 JSON，否则 Fastify 会拒绝空 JSON 体
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(path, {
    ...init,
    headers,
  });
  let data: any = null;
  const text = await res.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!res.ok) {
    const code =
      data && typeof data === 'object'
        ? String(data.error || data.message || '')
        : '';
    const message = ERROR_MESSAGES[code] || code || `HTTP ${res.status}`;
    throw new ApiError(message, res.status, data);
  }
  return data as T;
}

function qs(params: Record<string, string | number | undefined | null>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v != null && v !== '') sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

export const api = {
  overview: () => request<Overview>('/api/overview'),
  filters: () => request<Filters>('/api/filters'),
  profiles: () => request<{ profiles: Profile[] }>('/api/profiles'),
  createProfile: (name: string, color: string) =>
    request<{ profile: Profile }>('/api/profiles', { method: 'POST', body: JSON.stringify({ name, color }) }),
  updateProfile: (id: string, patch: { name?: string; color?: string }) =>
    request<{ profile: Profile }>(`/api/profiles/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  archiveProfile: (id: string) =>
    request<{ ok: true }>(`/api/profiles/${id}/archive`, { method: 'POST', body: '{}' }),

  papers: (params: { year?: number; province?: string; module?: string; q?: string } = {}) =>
    request<{ papers: Paper[]; total: number }>(`/api/papers${qs(params)}`),
  paper: (id: string) => request<{ paper: Paper & { tags: { tag: string; n: number }[] } }>(`/api/papers/${id}`),

  createExam: (paperId: string, durationSec: number) =>
    request<{ attempt: Attempt; paper: Paper }>('/api/exams', {
      method: 'POST',
      body: JSON.stringify({ paperId, durationSec }),
    }),
  getExam: (id: string) =>
    request<{ attempt: Attempt; paper: Paper | null; answers: Record<string, string>; flags: string[] }>(`/api/exams/${id}`),
  getExamQuestions: (id: string) =>
    request<{ attempt: Attempt; total: number; questions: import('./types').ExamQuestion[] }>(`/api/exams/${id}/questions`),
  saveExamAnswer: (id: string, questionId: string, choice: string) =>
    request<{ ok: true }>(`/api/exams/${id}/answers`, {
      method: 'PATCH',
      body: JSON.stringify({ questionId, choice }),
    }),
  saveExamFlag: (id: string, questionId: string, flagged: boolean) =>
    request<{ ok: true }>(`/api/exams/${id}/flags`, {
      method: 'PATCH',
      body: JSON.stringify({ questionId, flagged }),
    }),
  submitExam: (id: string) =>
    request<{ result: Attempt }>(`/api/exams/${id}/submit`, { method: 'POST', body: '{}' }),
  reviewExam: (id: string) =>
    request<{ attempt: Attempt; paper: Paper | null; questions: ReviewQuestion[]; byModule: ModuleScore[] }>(
      `/api/exams/${id}/review`,
    ),
  exams: (status?: string) =>
    request<{ attempts: AttemptListItem[] }>(`/api/exams${qs({ status })}`),

  createPractice: (body: {
    kind: 'paper' | 'tag' | 'wrong' | 'question' | 'custom';
    paperId?: string;
    tag?: string;
    module?: string;
    modules?: string[];
    questionId?: string;
    count?: number;
    shuffle?: boolean;
    immediate?: boolean;
  }) => request<{ session: Session }>('/api/practice', { method: 'POST', body: JSON.stringify(body) }),
  getPractice: (id: string) =>
    request<{ session: Session; index: import('./types').PracticeIndexItem[] }>(`/api/practice/${id}`),
  getPracticeQuestions: (id: string, offset: number, limit = 50) =>
    request<{ session: Session; items: PracticeQuestion[]; total: number; offset: number; limit: number }>(
      `/api/practice/${id}/questions${qs({ offset, limit })}`,
    ),
  savePracticeAnswer: (id: string, questionId: string, choice: string, reveal: boolean) =>
    request<{ ok: true; isCorrect: number | null; answer: string; revealed: boolean }>(
      `/api/practice/${id}/answers`,
      { method: 'PATCH', body: JSON.stringify({ questionId, choice, reveal }) },
    ),
  finishPractice: (id: string) =>
    request<{ session: Session }>(`/api/practice/${id}/finish`, { method: 'POST', body: '{}' }),
  reviewPractice: (id: string, scope: 'wrong' | 'all' = 'wrong') =>
    request<{ session: Session; scope: string; items: PracticeQuestion[] }>(
      `/api/practice/${id}/review${qs({ scope })}`,
    ),

  wrongBook: (params: { module?: string; tag?: string; mastered?: 0 | 1; limit?: number; offset?: number } = {}) =>
    request<{ total: number; items: WrongItem[] }>(`/api/wrong-book${qs(params as any)}`),
  updateWrong: (questionId: string, mastered: boolean) =>
    request<{ ok: true }>(`/api/wrong-book/${questionId}`, {
      method: 'PATCH',
      body: JSON.stringify({ mastered }),
    }),
  deleteWrong: (questionId: string) =>
    request<{ ok: true }>(`/api/wrong-book/${questionId}`, { method: 'DELETE' }),

  stats: () => request<Stats>('/api/stats'),
  search: (q: string) => request<SearchResult>(`/api/search${qs({ q })}`),
  questionFlags: () => request<{ total: number; items: QuestionFlag[] }>('/api/question-flags'),
  flagQuestion: (questionId: string, note: string) =>
    request<{ ok: true }>('/api/question-flags', {
      method: 'POST',
      body: JSON.stringify({ questionId, note }),
    }),
  deleteQuestionFlag: (questionId: string) =>
    request<{ ok: true }>(`/api/question-flags/${questionId}`, { method: 'DELETE' }),
};
