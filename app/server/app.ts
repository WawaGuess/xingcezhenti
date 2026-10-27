import crypto from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { db, getProfile, type ProfileRow } from './db.js';

declare module 'fastify' {
  interface FastifyRequest {
    profile: ProfileRow;
  }
}

const GRACE_MS = 5000;

type PaperRow = {
  id: string;
  year: number;
  province: string;
  name: string;
  question_count: number;
  material_count: number;
};

type ModuleRow = { paper_id: string; module: string; ord: number; question_count: number };

type AttemptRow = {
  id: string;
  profile_id: string;
  paper_id: string;
  duration_sec: number;
  started_at: number;
  deadline_at: number;
  submitted_at: number | null;
  status: 'in_progress' | 'submitted' | 'expired';
  correct_count: number | null;
  scored_total: number | null;
  total: number | null;
  elapsed_sec: number | null;
  expire_reason: string | null;
};

type AttemptAnswerRow = { question_id: string; choice: string; flagged: number };

type PracticeRow = {
  id: string;
  profile_id: string;
  kind: string;
  title: string;
  filter_json: string;
  questions_json: string;
  immediate: number;
  created_at: number;
  finished_at: number | null;
  total: number;
};

type SessionItem = {
  questionId: string;
  paperId: string;
  module: string;
  tag: string;
  materialId: string | null;
};

type QuestionRow = {
  id: string;
  qid: string;
  type: 'single' | 'multi' | 'judge';
  stem_html: string;
  analysis_html: string;
  answer: string;
  option_count: number;
  scorable: number;
  has_image: number;
  has_missing_image: number;
};

type OptionRow = { question_id: string; letter: string; html: string; is_correct: number; ord: number };

class HttpError extends Error {
  status: number;
  data?: unknown;
  constructor(status: number, message: string, data?: unknown) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

function badRequest(message: string): never {
  throw new HttpError(400, message);
}

function notFound(message = 'not_found'): never {
  throw new HttpError(404, message);
}

function now(): number {
  return Date.now();
}

function id(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replaceAll('-', '').slice(0, 20)}`;
}

function parseJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function normalizeChoice(raw: unknown, allowed: Set<string>, type: string): string {
  if (raw == null || raw === '') return '';
  if (typeof raw !== 'string') badRequest('invalid_choice');
  const letters = Array.from(new Set(raw.toUpperCase().match(/[A-H]/g) || [])).sort();
  if (!letters.length) return '';
  if (letters.some((l) => !allowed.has(l))) badRequest('invalid_choice');
  if ((type === 'single' || type === 'judge') && letters.length > 1) badRequest('single_choice_only');
  return letters.join('');
}

function optionsFor(ids: string[], withCorrect: boolean): Map<string, { letter: string; html: string; isCorrect?: boolean }[]> {
  const out = new Map<string, { letter: string; html: string; isCorrect?: boolean }[]>();
  if (!ids.length) return out;
  const placeholders = ids.map(() => '?').join(',');
  const rows = db
    .prepare(
      `SELECT question_id, letter, html, is_correct, ord FROM options
       WHERE question_id IN (${placeholders}) ORDER BY question_id, ord`,
    )
    .all(...ids) as OptionRow[];
  for (const r of rows) {
    const list = out.get(r.question_id) || [];
    list.push(withCorrect ? { letter: r.letter, html: r.html, isCorrect: !!r.is_correct } : { letter: r.letter, html: r.html });
    out.set(r.question_id, list);
  }
  return out;
}

function materialsFor(ids: string[]): Map<string, { html: string; paperId: string; module: string }> {
  const out = new Map<string, { html: string; paperId: string; module: string }>();
  if (!ids.length) return out;
  const unique = [...new Set(ids)];
  const placeholders = unique.map(() => '?').join(',');
  const rows = db
    .prepare(`SELECT id, html, paper_id, module FROM materials WHERE id IN (${placeholders})`)
    .all(...unique) as { id: string; html: string; paper_id: string; module: string }[];
  for (const r of rows) out.set(r.id, { html: r.html, paperId: r.paper_id, module: r.module });
  return out;
}

function papersFor(ids: string[]): Map<string, PaperRow> {
  const out = new Map<string, PaperRow>();
  if (!ids.length) return out;
  const unique = [...new Set(ids)];
  const placeholders = unique.map(() => '?').join(',');
  const rows = db
    .prepare(`SELECT id, year, province, name, question_count, material_count FROM papers WHERE id IN (${placeholders})`)
    .all(...unique) as PaperRow[];
  for (const r of rows) out.set(r.id, r);
  return out;
}

function plainText(html: string): string {
  return html
    .replace(/<img[^>]*flag="tex"[^>]*>/gi, ' ')
    .replace(/<img[^>]*>/gi, ' [图片] ')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function makeSnippet(text: string, q: string, width = 55): string {
  const idx = text.toLowerCase().indexOf(q.toLowerCase());
  if (idx < 0) return text.slice(0, width * 2);
  const start = Math.max(0, idx - width);
  const end = Math.min(text.length, idx + q.length + width);
  return `${start > 0 ? '…' : ''}${text.slice(start, idx)}\u0001${text.slice(idx, idx + q.length)}\u0002${text.slice(idx + q.length, end)}${end < text.length ? '…' : ''}`;
}

function extractOptionReasons(html: string): Record<string, string> {
  const text = plainText(html).replace(/\[图片\]/g, ' ');
  const marker = /([A-H])项\s*(?:错误|正确|不正确|符合|不符合|表述|说法|理解|分析|中|，|,|：|:)/g;
  const matches = [...text.matchAll(marker)];
  const out: Record<string, string> = {};
  for (let i = 0; i < matches.length; i += 1) {
    const letter = matches[i][1];
    const start = matches[i].index ?? 0;
    const end = i + 1 < matches.length ? matches[i + 1].index ?? text.length : text.length;
    if (out[letter]) continue;
    const segment = text.slice(start, end).trim();
    if (segment) {
      // 去掉开头的“A项错误，”，前端会用颜色标签表达对错
      const cleaned = segment
        .replace(/^[A-H]\s*项\s*(?:错误|正确|不正确|符合|不符合|表述|说法|理解|分析)?\s*[，,：:]?\s*/, '')
        .trim();
      out[letter] = (cleaned || segment).slice(0, 1500);
    }
  }
  return out;
}

function pct(correct: number, answered: number): number {
  return answered > 0 ? Math.round((correct / answered) * 1000) / 10 : 0;
}

function paperSummaries(rows: PaperRow[]): any[] {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const placeholders = ids.map(() => '?').join(',');
  const mods = db
    .prepare(`SELECT paper_id, module, ord, question_count FROM paper_modules WHERE paper_id IN (${placeholders}) ORDER BY ord`)
    .all(...ids) as ModuleRow[];
  const map = new Map<string, ModuleRow[]>();
  for (const m of mods) {
    const list = map.get(m.paper_id) || [];
    list.push(m);
    map.set(m.paper_id, list);
  }
  return rows.map((p) => ({
    id: p.id,
    year: p.year,
    province: p.province,
    name: p.name,
    questionCount: p.question_count,
    materialCount: p.material_count,
    modules: (map.get(p.id) || []).map((m) => ({
      module: m.module,
      ord: m.ord,
      questionCount: m.question_count,
    })),
  }));
}

function getPaper(paperId: string): PaperRow | undefined {
  return db
    .prepare('SELECT id, year, province, name, question_count, material_count FROM papers WHERE id = ?')
    .get(paperId) as PaperRow | undefined;
}

function getAttempt(attemptId: string, profileId: string): AttemptRow | undefined {
  return db
    .prepare('SELECT * FROM attempts WHERE id = ? AND profile_id = ?')
    .get(attemptId, profileId) as AttemptRow | undefined;
}

function getSession(sessionId: string, profileId: string): PracticeRow | undefined {
  return db
    .prepare('SELECT * FROM practice_sessions WHERE id = ? AND profile_id = ?')
    .get(sessionId, profileId) as PracticeRow | undefined;
}

function attemptAnswers(attemptId: string): AttemptAnswerRow[] {
  return db
    .prepare('SELECT question_id, choice, flagged FROM attempt_answers WHERE attempt_id = ?')
    .all(attemptId) as AttemptAnswerRow[];
}

function paperQuestionRows(paperId: string): (QuestionRow & { module: string; tag: string; material_id: string | null; ord: number })[] {
  return db
    .prepare(
      `SELECT q.id, q.qid, q.type, q.stem_html, q.analysis_html, q.answer, q.option_count,
              q.scorable, q.has_image, q.has_missing_image,
              pq.module, pq.tag, pq.material_id, pq.ord
       FROM paper_questions pq JOIN questions q ON q.id = pq.question_id
       WHERE pq.paper_id = ? ORDER BY pq.ord`,
    )
    .all(paperId) as any[];
}

function scoreRows(
  rows: { answer: string; scorable: number; choice: string | null }[],
): { total: number; scoredTotal: number; answered: number; correct: number } {
  let scoredTotal = 0;
  let answered = 0;
  let correct = 0;
  for (const r of rows) {
    if (r.scorable) scoredTotal += 1;
    if (r.choice) answered += 1;
    if (r.scorable && r.choice && r.choice === r.answer) correct += 1;
  }
  return { total: rows.length, scoredTotal, answered, correct };
}

const upsertWrong = db.prepare(
  `INSERT INTO wrong_book(profile_id, question_id, wrong_count, correct_streak, added_at, last_wrong_at, mastered)
   VALUES (?, ?, 1, 0, ?, ?, 0)
   ON CONFLICT(profile_id, question_id) DO UPDATE SET
     wrong_count = wrong_book.wrong_count + 1,
     last_wrong_at = excluded.last_wrong_at,
     correct_streak = 0,
     mastered = 0`,
);

function addWrong(profileId: string, questionId: string, ts = now()): void {
  upsertWrong.run(profileId, questionId, ts, ts);
}

function finalizeAttempt(attempt: AttemptRow, forceStatus?: 'submitted' | 'expired'): any {
  if (attempt.status !== 'in_progress') return attemptSummary(attempt);

  const rows = db
    .prepare(
      `SELECT q.id AS question_id, q.answer, q.scorable, aa.choice
       FROM paper_questions pq
       JOIN questions q ON q.id = pq.question_id
       LEFT JOIN attempt_answers aa ON aa.attempt_id = ? AND aa.question_id = pq.question_id
       WHERE pq.paper_id = ? ORDER BY pq.ord`,
    )
    .all(attempt.id, attempt.paper_id) as { question_id: string; answer: string; scorable: number; choice: string | null }[];

  const stats = scoreRows(rows);
  const ts = now();
  const status: 'submitted' | 'expired' =
    forceStatus === 'submitted'
      ? ts > attempt.deadline_at + GRACE_MS
        ? 'expired'
        : 'submitted'
      : forceStatus === 'expired'
        ? 'expired'
        : ts > attempt.deadline_at + GRACE_MS
          ? 'expired'
          : 'submitted';
  const end = Math.min(ts, attempt.deadline_at);
  const elapsedSec = Math.max(0, Math.round((end - attempt.started_at) / 1000));

  db.prepare(
    `UPDATE attempts SET status = ?, submitted_at = ?, correct_count = ?, scored_total = ?,
       total = ?, elapsed_sec = ?, expire_reason = ? WHERE id = ?`,
  ).run(
    status,
    ts,
    stats.correct,
    stats.scoredTotal,
    stats.total,
    elapsedSec,
    status === 'expired' ? 'timeout' : null,
    attempt.id,
  );

  for (const r of rows) {
    if (r.scorable && r.choice && r.choice !== r.answer) addWrong(attempt.profile_id, r.question_id, ts);
  }

  return {
    ...attemptSummary({ ...attempt, status, submitted_at: ts, correct_count: stats.correct, scored_total: stats.scoredTotal, total: stats.total, elapsed_sec: elapsedSec }),
    answered: stats.answered,
    unanswered: stats.total - stats.answered,
  };
}

function attemptSummary(a: AttemptRow): any {
  return {
    id: a.id,
    paperId: a.paper_id,
    durationSec: a.duration_sec,
    startedAt: a.started_at,
    deadlineAt: a.deadline_at,
    submittedAt: a.submitted_at,
    status: a.status,
    correctCount: a.correct_count ?? 0,
    scoredTotal: a.scored_total ?? 0,
    total: a.total ?? 0,
    elapsedSec: a.elapsed_sec ?? 0,
    serverNow: now(),
  };
}

function maybeFinalize(attempt: AttemptRow): AttemptRow {
  if (attempt.status === 'in_progress' && now() > attempt.deadline_at + GRACE_MS) {
    finalizeAttempt(attempt, 'expired');
    return getAttempt(attempt.id, attempt.profile_id) || attempt;
  }
  return attempt;
}

function sessionItems(session: PracticeRow): SessionItem[] {
  return parseJson<SessionItem[]>(session.questions_json, []);
}

function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function hydratePractice(
  items: SessionItem[],
  offset: number,
  answers: Map<string, { choice: string; is_correct: number | null; revealed: number }>,
  includeCorrect: boolean,
): any[] {
  const ids = items.map((i) => i.questionId);
  const placeholders = ids.map(() => '?').join(',');
  const qRows = db
    .prepare(
      `SELECT id, qid, type, stem_html, analysis_html, answer, option_count, scorable,
              has_image, has_missing_image FROM questions WHERE id IN (${placeholders})`,
    )
    .all(...ids) as QuestionRow[];
  const qMap = new Map(qRows.map((q) => [q.id, q]));
  const optMap = optionsFor(ids, includeCorrect);
  const matMap = materialsFor(items.map((i) => i.materialId).filter((x): x is string => !!x));
  const paperMap = papersFor(items.map((i) => i.paperId));

  return items.map((item, i) => {
    const q = qMap.get(item.questionId);
    if (!q) return null;
    const st = answers.get(item.questionId);
    const paper = paperMap.get(item.paperId);
    const mat = item.materialId ? matMap.get(item.materialId) : undefined;
    return {
      id: q.id,
      ordinal: offset + i + 1,
      module: item.module,
      tag: item.tag,
      type: q.type,
      stemHtml: q.stem_html,
      analysisHtml: q.analysis_html,
      optionReasons: extractOptionReasons(q.analysis_html),
      answer: q.answer,
      scorable: !!q.scorable,
      optionCount: q.option_count,
      materialId: item.materialId,
      materialHtml: mat?.html || null,
      options: optMap.get(q.id) || [],
      source: paper
        ? { paperId: paper.id, year: paper.year, province: paper.province, name: paper.name }
        : null,
      choice: st?.choice || '',
      revealed: !!st?.revealed && !!st?.choice,
      isCorrect: st?.revealed && st?.choice ? (st.is_correct == null ? null : !!st.is_correct) : null,
    };
  }).filter(Boolean);
}

function practiceSummary(session: PracticeRow): any {
  const row = db
    .prepare(
      `SELECT
         SUM(CASE WHEN revealed = 1 AND choice <> '' THEN 1 ELSE 0 END) AS answered,
         SUM(CASE WHEN revealed = 1 AND is_correct = 1 THEN 1 ELSE 0 END) AS correct,
         SUM(CASE WHEN revealed = 1 AND is_correct = 0 THEN 1 ELSE 0 END) AS wrong
       FROM practice_answers WHERE session_id = ?`,
    )
    .get(session.id) as { answered: number | null; correct: number | null; wrong: number | null };
  const answered = row.answered || 0;
  const correct = row.correct || 0;
  const wrong = row.wrong || 0;
  const end = session.finished_at || now();
  return {
    id: session.id,
    kind: session.kind,
    title: session.title,
    total: session.total,
    immediate: !!session.immediate,
    createdAt: session.created_at,
    finishedAt: session.finished_at,
    elapsedSec: Math.max(0, Math.round((end - session.created_at) / 1000)),
    answered,
    correct,
    wrong,
    accuracy: answered ? Math.round((correct / answered) * 1000) / 10 : 0,
    serverNow: now(),
  };
}

export async function apiRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', async (req: FastifyRequest, reply: FastifyReply) => {
    // 成员列表/新建/改名/归档本身不能依赖“当前成员”有效，
    // 否则 localStorage 里存了已归档成员时无法自愈。
    if ((req.url || '').startsWith('/api/profiles')) return;
    const raw = req.headers['x-profile-id'];
    const pid = (Array.isArray(raw) ? raw[0] : raw) || 'default';
    const profile = getProfile(pid);
    if (!profile) {
      reply.code(400).send({ error: 'unknown_profile' });
      return reply;
    }
    req.profile = profile;
  });

  // ---------- profiles ----------
  app.get('/profiles', async () => {
    const rows = db
      .prepare('SELECT id, name, color, created_at FROM profiles WHERE archived_at IS NULL ORDER BY created_at')
      .all();
    return { profiles: rows };
  });

  app.post('/profiles', async (req) => {
    const body = (req.body || {}) as { name?: string; color?: string };
    const name = String(body.name || '').trim();
    if (!name) badRequest('name_required');
    if (name.length > 20) badRequest('name_too_long');
    const exists = db.prepare('SELECT 1 FROM profiles WHERE name = ?').get(name);
    if (exists) badRequest('name_exists');
    const newId = id('u');
    const color = String(body.color || '#4f6ef7').slice(0, 20);
    db.prepare('INSERT INTO profiles(id, name, color, created_at) VALUES(?,?,?,?)').run(
      newId,
      name,
      color,
      now(),
    );
    return { profile: { id: newId, name, color } };
  });

  app.patch('/profiles/:id', async (req) => {
    const { id: profileId } = req.params as { id: string };
    const body = (req.body || {}) as { name?: string; color?: string };
    const row = db
      .prepare('SELECT id, name, color FROM profiles WHERE id = ? AND archived_at IS NULL')
      .get(profileId) as { id: string; name: string; color: string | null } | undefined;
    if (!row) notFound('profile_not_found');
    const name = body.name !== undefined ? String(body.name).trim() : row.name;
    if (!name) badRequest('name_required');
    if (name.length > 20) badRequest('name_too_long');
    const exists = db.prepare('SELECT 1 FROM profiles WHERE name = ? AND id <> ?').get(name, profileId);
    if (exists) badRequest('name_exists');
    const color = body.color !== undefined ? String(body.color).slice(0, 20) : row.color;
    db.prepare('UPDATE profiles SET name = ?, color = ? WHERE id = ?').run(name, color, profileId);
    return { profile: { id: profileId, name, color } };
  });

  app.post('/profiles/:id/archive', async (req) => {
    const { id: profileId } = req.params as { id: string };
    const row = db
      .prepare('SELECT id, name FROM profiles WHERE id = ? AND archived_at IS NULL')
      .get(profileId) as { id: string; name: string } | undefined;
    if (!row) notFound('profile_not_found');
    const count = (
      db.prepare('SELECT COUNT(*) AS c FROM profiles WHERE archived_at IS NULL').get() as { c: number }
    ).c;
    if (count <= 1) badRequest('last_profile');
    // 归档时改名，腾出原名字，方便以后重新创建同名成员
    const archivedName = `${row.name}（已删除 ${profileId.slice(-4)}）`.slice(0, 30);
    db.prepare('UPDATE profiles SET name = ?, archived_at = ? WHERE id = ?').run(
      archivedName,
      now(),
      profileId,
    );
    return { ok: true };
  });

  // ---------- meta ----------
  app.get('/filters', async () => {
    const years = db.prepare('SELECT year, COUNT(*) AS papers FROM papers GROUP BY year ORDER BY year DESC').all();
    const provinces = db
      .prepare('SELECT province, COUNT(*) AS papers FROM papers GROUP BY province ORDER BY papers DESC, province')
      .all();
    const modules = db
      .prepare(
        `SELECT module, MIN(ord) AS ord, COUNT(*) AS papers, SUM(question_count) AS questions
         FROM paper_modules GROUP BY module ORDER BY ord`,
      )
      .all();
    const tags = db
      .prepare(
        `SELECT tag, module, MIN(module_ord) AS moduleOrd,
                COUNT(DISTINCT question_id) AS questions, COUNT(*) AS occurrences
         FROM paper_questions GROUP BY tag, module ORDER BY moduleOrd, questions DESC`,
      )
      .all();
    const counts = db
      .prepare(
        `SELECT (SELECT COUNT(*) FROM papers) AS papers,
                (SELECT COUNT(*) FROM questions) AS questions,
                (SELECT COUNT(*) FROM paper_questions) AS occurrences,
                (SELECT COUNT(*) FROM materials) AS materials`,
      )
      .get();
    return { years, provinces, modules, tags, counts };
  });

  app.get('/overview', async (req) => {
    const profile = req.profile;
    const counts = db
      .prepare(
        `SELECT (SELECT COUNT(*) FROM papers) AS papers,
                (SELECT COUNT(*) FROM questions) AS questions,
                (SELECT COUNT(*) FROM paper_questions) AS occurrences,
                (SELECT COUNT(*) FROM materials) AS materials`,
      )
      .get();
    const activeAttempts = db
      .prepare(
        `SELECT a.*, p.name AS paper_name, p.year, p.province
         FROM attempts a LEFT JOIN papers p ON p.id = a.paper_id
         WHERE a.profile_id = ? AND a.status = 'in_progress'
         ORDER BY a.started_at DESC LIMIT 5`,
      )
      .all(profile.id) as any[];
    const recentAttempts = db
      .prepare(
        `SELECT a.*, p.name AS paper_name, p.year, p.province
         FROM attempts a LEFT JOIN papers p ON p.id = a.paper_id
         WHERE a.profile_id = ? AND a.status <> 'in_progress'
         ORDER BY a.submitted_at DESC LIMIT 5`,
      )
      .all(profile.id) as any[];
    const activePractice = db
      .prepare(
        `SELECT s.*,
           (SELECT COUNT(*) FROM practice_answers x WHERE x.session_id = s.id AND x.revealed = 1 AND x.choice <> '') AS answered
         FROM practice_sessions s
         WHERE s.profile_id = ? AND s.finished_at IS NULL
         ORDER BY s.created_at DESC LIMIT 5`,
      )
      .all(profile.id) as any[];
    const wrongCount = (
      db.prepare('SELECT COUNT(*) AS c FROM wrong_book WHERE profile_id = ? AND mastered = 0').get(profile.id) as { c: number }
    ).c;

    return {
      profile: { id: profile.id, name: profile.name, color: profile.color },
      counts,
      wrongCount,
      activeAttempts: activeAttempts.map((a) => ({
        ...attemptSummary(a),
        paperName: a.paper_name,
        year: a.year,
        province: a.province,
      })),
      recentAttempts: recentAttempts.map((a) => ({
        ...attemptSummary(a),
        paperName: a.paper_name,
        year: a.year,
        province: a.province,
      })),
      activePractice: activePractice.map((s) => ({
        id: s.id,
        kind: s.kind,
        title: s.title,
        total: s.total,
        answered: s.answered || 0,
        createdAt: s.created_at,
      })),
    };
  });

  // ---------- stats ----------
  app.get('/stats', async (req) => {
    const pid = req.profile.id;
    const exam = db
      .prepare(
        `SELECT COUNT(*) AS exams, COALESCE(SUM(correct_count),0) AS correct,
                COALESCE(SUM(scored_total),0) AS scored
         FROM attempts WHERE profile_id = ? AND status <> 'in_progress'`,
      )
      .get(pid) as { exams: number; correct: number; scored: number };
    const practice = db
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM practice_sessions WHERE profile_id = ? AND finished_at IS NOT NULL) AS sessions,
           (SELECT COUNT(*) FROM practice_answers pa
              JOIN practice_sessions ps ON ps.id = pa.session_id
              WHERE ps.profile_id = ? AND pa.revealed = 1 AND pa.choice <> '') AS answered,
           (SELECT COUNT(*) FROM practice_answers pa
              JOIN practice_sessions ps ON ps.id = pa.session_id
              WHERE ps.profile_id = ? AND pa.revealed = 1 AND pa.is_correct = 1) AS correct`,
      )
      .get(pid, pid, pid) as { sessions: number; answered: number; correct: number };
    const wrong = db
      .prepare(
        `SELECT COALESCE(SUM(CASE WHEN mastered = 0 THEN 1 ELSE 0 END), 0) AS open,
                COALESCE(SUM(CASE WHEN mastered = 1 THEN 1 ELSE 0 END), 0) AS mastered
         FROM wrong_book WHERE profile_id = ?`,
      )
      .get(pid) as { open: number; mastered: number };

    const examModules = db
      .prepare(
        `SELECT pq.module, COUNT(*) AS total,
                SUM(CASE WHEN aa.choice <> '' AND q.scorable = 1 THEN 1 ELSE 0 END) AS answered,
                SUM(CASE WHEN aa.choice <> '' AND q.scorable = 1 AND aa.choice = q.answer THEN 1 ELSE 0 END) AS correct
         FROM attempts a
         JOIN paper_questions pq ON pq.paper_id = a.paper_id
         JOIN questions q ON q.id = pq.question_id
         LEFT JOIN attempt_answers aa ON aa.attempt_id = a.id AND aa.question_id = pq.question_id
         WHERE a.profile_id = ? AND a.status <> 'in_progress'
         GROUP BY pq.module`,
      )
      .all(pid) as { module: string; total: number; answered: number; correct: number }[];
    const practiceModules = db
      .prepare(
        `SELECT x.module, COUNT(*) AS total,
                SUM(CASE WHEN pa.revealed = 1 AND pa.choice <> '' THEN 1 ELSE 0 END) AS answered,
                SUM(CASE WHEN pa.revealed = 1 AND pa.is_correct = 1 THEN 1 ELSE 0 END) AS correct
         FROM practice_sessions ps
         JOIN practice_answers pa ON pa.session_id = ps.id
         JOIN (SELECT question_id, MIN(module) AS module FROM paper_questions GROUP BY question_id) x
           ON x.question_id = pa.question_id
         WHERE ps.profile_id = ?
         GROUP BY x.module`,
      )
      .all(pid) as { module: string; total: number; answered: number; correct: number }[];

    const moduleMap = new Map<string, { module: string; total: number; answered: number; correct: number }>();
    for (const r of [...examModules, ...practiceModules]) {
      const cur = moduleMap.get(r.module) || { module: r.module, total: 0, answered: 0, correct: 0 };
      cur.total += r.total || 0;
      cur.answered += r.answered || 0;
      cur.correct += r.correct || 0;
      moduleMap.set(r.module, cur);
    }
    const moduleOrder = ['政治理论', '常识判断', '言语理解与表达', '数量关系', '判断推理', '资料分析'];
    const byModule = [...moduleMap.values()]
      .filter((m) => m.answered > 0)
      .sort((a, b) => {
        const ia = moduleOrder.indexOf(a.module);
        const ib = moduleOrder.indexOf(b.module);
        return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
      })
      .map((m) => ({ ...m, accuracy: pct(m.correct, m.answered) }));

    const examTags = db
      .prepare(
        `SELECT pq.tag, pq.module, COUNT(*) AS total,
                SUM(CASE WHEN aa.choice <> '' AND q.scorable = 1 THEN 1 ELSE 0 END) AS answered,
                SUM(CASE WHEN aa.choice <> '' AND q.scorable = 1 AND aa.choice = q.answer THEN 1 ELSE 0 END) AS correct
         FROM attempts a
         JOIN paper_questions pq ON pq.paper_id = a.paper_id
         JOIN questions q ON q.id = pq.question_id
         LEFT JOIN attempt_answers aa ON aa.attempt_id = a.id AND aa.question_id = pq.question_id
         WHERE a.profile_id = ? AND a.status <> 'in_progress'
         GROUP BY pq.tag, pq.module`,
      )
      .all(pid) as { tag: string; module: string; total: number; answered: number; correct: number }[];
    const practiceTags = db
      .prepare(
        `SELECT x.tag, x.module, COUNT(*) AS total,
                SUM(CASE WHEN pa.revealed = 1 AND pa.choice <> '' THEN 1 ELSE 0 END) AS answered,
                SUM(CASE WHEN pa.revealed = 1 AND pa.is_correct = 1 THEN 1 ELSE 0 END) AS correct
         FROM practice_sessions ps
         JOIN practice_answers pa ON pa.session_id = ps.id
         JOIN (SELECT question_id, MIN(tag) AS tag, MIN(module) AS module FROM paper_questions GROUP BY question_id) x
           ON x.question_id = pa.question_id
         WHERE ps.profile_id = ?
         GROUP BY x.tag, x.module`,
      )
      .all(pid) as { tag: string; module: string; total: number; answered: number; correct: number }[];

    const tagMap = new Map<string, { tag: string; module: string; total: number; answered: number; correct: number }>();
    for (const r of [...examTags, ...practiceTags]) {
      const cur = tagMap.get(r.tag) || { tag: r.tag, module: r.module, total: 0, answered: 0, correct: 0 };
      cur.total += r.total || 0;
      cur.answered += r.answered || 0;
      cur.correct += r.correct || 0;
      tagMap.set(r.tag, cur);
    }
    const byTag = [...tagMap.values()]
      .filter((t) => t.answered > 0)
      .sort((a, b) => b.answered - a.answered || b.correct - a.correct)
      .slice(0, 15)
      .map((t) => ({ ...t, accuracy: pct(t.correct, t.answered) }));

    const start = new Date();
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - 13);
    const startMs = start.getTime();
    const examDays = db
      .prepare(
        `SELECT date(submitted_at / 1000, 'unixepoch', 'localtime') AS day,
                COUNT(*) AS n, COALESCE(SUM(correct_count), 0) AS correct, COALESCE(SUM(scored_total), 0) AS scored
         FROM attempts WHERE profile_id = ? AND status <> 'in_progress' AND submitted_at >= ?
         GROUP BY day`,
      )
      .all(pid, startMs) as { day: string; n: number; correct: number; scored: number }[];
    const practiceDays = db
      .prepare(
        `SELECT date(pa.answered_at / 1000, 'unixepoch', 'localtime') AS day,
                COUNT(*) AS n, COALESCE(SUM(CASE WHEN pa.is_correct = 1 THEN 1 ELSE 0 END), 0) AS correct
         FROM practice_answers pa JOIN practice_sessions ps ON ps.id = pa.session_id
         WHERE ps.profile_id = ? AND pa.revealed = 1 AND pa.choice <> '' AND pa.answered_at >= ?
         GROUP BY day`,
      )
      .all(pid, startMs) as { day: string; n: number; correct: number }[];

    const blankDay = () => ({
      examCount: 0,
      examCorrect: 0,
      examScored: 0,
      practiceAnswered: 0,
      practiceCorrect: 0,
    });
    const dayMap = new Map<string, ReturnType<typeof blankDay>>();
    for (const r of examDays) {
      const d = dayMap.get(r.day) || blankDay();
      d.examCount += r.n;
      d.examCorrect += r.correct;
      d.examScored += r.scored;
      dayMap.set(r.day, d);
    }
    for (const r of practiceDays) {
      const d = dayMap.get(r.day) || blankDay();
      d.practiceAnswered += r.n;
      d.practiceCorrect += r.correct;
      dayMap.set(r.day, d);
    }
    const pad = (n: number) => String(n).padStart(2, '0');
    const activity = [];
    for (let i = 0; i < 14; i += 1) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const key = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      activity.push({ date: key, ...(dayMap.get(key) || blankDay()) });
    }

    const recentExams = db
      .prepare(
        `SELECT a.id, a.correct_count, a.scored_total, a.elapsed_sec, a.submitted_at,
                p.name AS paper_name, p.year, p.province
         FROM attempts a LEFT JOIN papers p ON p.id = a.paper_id
         WHERE a.profile_id = ? AND a.status <> 'in_progress'
         ORDER BY a.submitted_at DESC LIMIT 8`,
      )
      .all(pid) as any[];

    const family = db
      .prepare(
        `SELECT p.id, p.name, p.color,
           (SELECT COUNT(*) FROM attempts a WHERE a.profile_id = p.id AND a.status <> 'in_progress') AS exams,
           (SELECT COALESCE(SUM(correct_count),0) FROM attempts a WHERE a.profile_id = p.id AND a.status <> 'in_progress') AS exam_correct,
           (SELECT COALESCE(SUM(scored_total),0) FROM attempts a WHERE a.profile_id = p.id AND a.status <> 'in_progress') AS exam_scored,
           (SELECT COUNT(*) FROM practice_answers pa JOIN practice_sessions ps ON ps.id = pa.session_id
              WHERE ps.profile_id = p.id AND pa.revealed = 1 AND pa.choice <> '') AS practice_answered,
           (SELECT COUNT(*) FROM practice_answers pa JOIN practice_sessions ps ON ps.id = pa.session_id
              WHERE ps.profile_id = p.id AND pa.revealed = 1 AND pa.is_correct = 1) AS practice_correct,
           (SELECT COUNT(*) FROM wrong_book w WHERE w.profile_id = p.id AND w.mastered = 0) AS wrong_open
         FROM profiles p WHERE p.archived_at IS NULL ORDER BY p.created_at`,
      )
      .all() as any[];

    return {
      summary: {
        exams: exam.exams,
        examCorrect: exam.correct,
        examScored: exam.scored,
        examAccuracy: pct(exam.correct, exam.scored),
        practiceSessions: practice.sessions,
        practiceAnswered: practice.answered,
        practiceCorrect: practice.correct,
        practiceAccuracy: pct(practice.correct, practice.answered),
        wrongOpen: wrong.open,
        wrongMastered: wrong.mastered,
      },
      byModule,
      byTag,
      activity,
      recentExams: recentExams.map((a) => ({
        id: a.id,
        correctCount: a.correct_count,
        scoredTotal: a.scored_total,
        elapsedSec: a.elapsed_sec,
        submittedAt: a.submitted_at,
        paperName: a.paper_name,
        year: a.year,
        province: a.province,
        accuracy: pct(a.correct_count, a.scored_total),
      })),
      family: family.map((p) => ({
        id: p.id,
        name: p.name,
        color: p.color,
        exams: p.exams,
        examCorrect: p.exam_correct,
        examScored: p.exam_scored,
        examAccuracy: pct(p.exam_correct, p.exam_scored),
        practiceAnswered: p.practice_answered,
        practiceCorrect: p.practice_correct,
        practiceAccuracy: pct(p.practice_correct, p.practice_answered),
        wrongOpen: p.wrong_open,
      })),
    };
  });

  // ---------- search ----------
  app.get('/search', async (req) => {
    const qs = req.query as { q?: string; limit?: string };
    const q = (qs.q || '').trim();
    if (!q) return { q: '', items: [], truncated: false };
    const limit = Math.min(Math.max(Number(qs.limit) || 30, 1), 50);
    const escaped = q.replace(/[\\%_]/g, '\\$&');
    const like = `%${escaped}%`;
    const rows = db
      .prepare(
        `SELECT q.id, q.type, q.stem_html, q.analysis_html, q.scorable,
                (SELECT module FROM paper_questions x WHERE x.question_id = q.id LIMIT 1) AS module,
                (SELECT tag FROM paper_questions x WHERE x.question_id = q.id LIMIT 1) AS tag,
                (SELECT paper_id FROM paper_questions x WHERE x.question_id = q.id LIMIT 1) AS paper_id
         FROM questions q
         WHERE q.stem_html LIKE ? ESCAPE '\\' OR q.analysis_html LIKE ? ESCAPE '\\'
         ORDER BY CASE WHEN q.stem_html LIKE ? ESCAPE '\\' THEN 0 ELSE 1 END, q.id
         LIMIT ?`,
      )
      .all(like, like, like, limit + 1) as any[];
    const truncated = rows.length > limit;
    const picked = rows.slice(0, limit);
    const paperMap = papersFor(picked.map((r) => r.paper_id).filter(Boolean));
    return {
      q,
      truncated,
      items: picked.map((r) => {
        const stem = plainText(r.stem_html);
        const analysis = plainText(r.analysis_html);
        const inStem = stem.toLowerCase().includes(q.toLowerCase());
        const text = inStem ? stem : analysis;
        const paper = paperMap.get(r.paper_id);
        return {
          id: r.id,
          module: r.module,
          tag: r.tag,
          type: r.type,
          scorable: !!r.scorable,
          inStem,
          snippet: makeSnippet(text, q),
          source: paper
            ? { paperId: paper.id, year: paper.year, province: paper.province, name: paper.name }
            : null,
        };
      }),
    };
  });

  // ---------- papers ----------
  app.get('/papers', async (req) => {
    const q = req.query as { year?: string; province?: string; module?: string; q?: string; limit?: string; offset?: string };
    const where: string[] = [];
    const params: any[] = [];
    if (q.year) {
      where.push('p.year = ?');
      params.push(Number(q.year));
    }
    if (q.province) {
      where.push('p.province = ?');
      params.push(q.province);
    }
    if (q.module) {
      where.push('EXISTS (SELECT 1 FROM paper_modules pm WHERE pm.paper_id = p.id AND pm.module = ?)');
      params.push(q.module);
    }
    if (q.q) {
      where.push('p.name LIKE ?');
      params.push(`%${q.q}%`);
    }
    const limit = Math.min(Math.max(Number(q.limit) || 1000, 1), 1000);
    const offset = Math.max(Number(q.offset) || 0, 0);
    const sql = `SELECT p.id, p.year, p.province, p.name, p.question_count, p.material_count
                 FROM papers p ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
                 ORDER BY p.year DESC, p.province, p.name LIMIT ? OFFSET ?`;
    const rows = db.prepare(sql).all(...params, limit, offset) as PaperRow[];
    const total = (
      db.prepare(`SELECT COUNT(*) AS c FROM papers p ${where.length ? 'WHERE ' + where.join(' AND ') : ''}`).get(...params) as { c: number }
    ).c;
    return { papers: paperSummaries(rows), total };
  });

  app.get('/papers/:id', async (req) => {
    const { id: paperId } = req.params as { id: string };
    const paper = getPaper(paperId);
    if (!paper) notFound('paper_not_found');
    const tags = db
      .prepare('SELECT tag, COUNT(*) AS n FROM paper_questions WHERE paper_id = ? GROUP BY tag ORDER BY n DESC')
      .all(paperId);
    return { paper: { ...paperSummaries([paper])[0], tags } };
  });

  // ---------- exams ----------
  app.post('/exams', async (req) => {
    const body = (req.body || {}) as { paperId?: string; durationSec?: number };
    if (!body.paperId) badRequest('paper_required');
    const paper = getPaper(body.paperId);
    if (!paper) notFound('paper_not_found');
    const durationSec = Math.min(Math.max(Number(body.durationSec) || 7200, 300), 14400);
    const counts = db
      .prepare(
        `SELECT COUNT(*) AS total, COALESCE(SUM(CASE WHEN q.scorable = 1 THEN 1 ELSE 0 END), 0) AS scored
         FROM paper_questions pq JOIN questions q ON q.id = pq.question_id WHERE pq.paper_id = ?`,
      )
      .get(paper.id) as { total: number; scored: number };
    if (!counts.total) badRequest('empty_paper');
    const attemptId = id('a');
    const startedAt = now();
    const deadlineAt = startedAt + durationSec * 1000;
    db.prepare(
      `INSERT INTO attempts(id, profile_id, paper_id, duration_sec, started_at, deadline_at, status, total, scored_total)
       VALUES (?, ?, ?, ?, ?, ?, 'in_progress', ?, ?)`,
    ).run(attemptId, req.profile.id, paper.id, durationSec, startedAt, deadlineAt, counts.total, counts.scored);
    const attempt = getAttempt(attemptId, req.profile.id)!;
    return {
      attempt: { ...attemptSummary(attempt), answered: 0, unanswered: counts.total },
      paper: paperSummaries([paper])[0],
    };
  });

  app.get('/exams', async (req) => {
    const q = req.query as { status?: string; limit?: string };
    const limit = Math.min(Math.max(Number(q.limit) || 20, 1), 100);
    const rows = q.status
      ? (db
          .prepare(
            `SELECT a.*, p.name AS paper_name, p.year, p.province FROM attempts a
             LEFT JOIN papers p ON p.id = a.paper_id
             WHERE a.profile_id = ? AND a.status = ? ORDER BY a.started_at DESC LIMIT ?`,
          )
          .all(req.profile.id, q.status, limit) as any[])
      : (db
          .prepare(
            `SELECT a.*, p.name AS paper_name, p.year, p.province FROM attempts a
             LEFT JOIN papers p ON p.id = a.paper_id
             WHERE a.profile_id = ? ORDER BY a.started_at DESC LIMIT ?`,
          )
          .all(req.profile.id, limit) as any[]);
    return {
      attempts: rows.map((a) => ({
        ...attemptSummary(a),
        paperName: a.paper_name,
        year: a.year,
        province: a.province,
      })),
    };
  });

  app.get('/exams/:id', async (req) => {
    const { id: attemptId } = req.params as { id: string };
    let attempt = getAttempt(attemptId, req.profile.id);
    if (!attempt) notFound('attempt_not_found');
    attempt = maybeFinalize(attempt);
    const paper = getPaper(attempt.paper_id);
    const answers = attemptAnswers(attemptId);
    const answerMap: Record<string, string> = {};
    const flags: string[] = [];
    for (const a of answers) {
      if (a.choice) answerMap[a.question_id] = a.choice;
      if (a.flagged) flags.push(a.question_id);
    }
    return {
      attempt: { ...attemptSummary(attempt), answered: Object.keys(answerMap).length },
      paper: paper ? paperSummaries([paper])[0] : null,
      answers: answerMap,
      flags,
    };
  });

  app.get('/exams/:id/questions', async (req) => {
    const { id: attemptId } = req.params as { id: string };
    let attempt = getAttempt(attemptId, req.profile.id);
    if (!attempt) notFound('attempt_not_found');
    attempt = maybeFinalize(attempt);
    if (attempt.status !== 'in_progress') {
      throw new HttpError(409, 'attempt_finished');
    }
    const rows = paperQuestionRows(attempt.paper_id);
    const ids = rows.map((r) => r.id);
    const optMap = optionsFor(ids, false);
    const matMap = materialsFor(rows.map((r) => r.material_id).filter((x): x is string => !!x));
    const answers = new Map(attemptAnswers(attemptId).map((a) => [a.question_id, a]));
    return {
      attempt: attemptSummary(attempt),
      total: rows.length,
      questions: rows.map((r) => ({
        id: r.id,
        ordinal: r.ord,
        module: r.module,
        tag: r.tag,
        type: r.type,
        stemHtml: r.stem_html,
        options: optMap.get(r.id) || [],
        optionCount: r.option_count,
        scorable: !!r.scorable,
        materialId: r.material_id,
        materialHtml: r.material_id ? matMap.get(r.material_id)?.html || null : null,
        choice: answers.get(r.id)?.choice || '',
        flagged: !!answers.get(r.id)?.flagged,
      })),
    };
  });

  app.patch('/exams/:id/answers', async (req) => {
    const { id: attemptId } = req.params as { id: string };
    const body = (req.body || {}) as { questionId?: string; choice?: string };
    if (!body.questionId) badRequest('question_required');
    const attempt = getAttempt(attemptId, req.profile.id);
    if (!attempt) notFound('attempt_not_found');
    if (attempt.status !== 'in_progress') throw new HttpError(409, 'attempt_finished');
    if (now() > attempt.deadline_at + GRACE_MS) {
      const result = finalizeAttempt(attempt, 'expired');
      throw new HttpError(409, 'timeout', { error: 'timeout', result });
    }
    const q = db
      .prepare(
        `SELECT q.id, q.type FROM paper_questions pq JOIN questions q ON q.id = pq.question_id
         WHERE pq.paper_id = ? AND pq.question_id = ? LIMIT 1`,
      )
      .get(attempt.paper_id, body.questionId) as { id: string; type: string } | undefined;
    if (!q) notFound('question_not_in_paper');
    const allowed = new Set(
      (db.prepare('SELECT letter FROM options WHERE question_id = ?').all(q.id) as { letter: string }[]).map((o) => o.letter),
    );
    const choice = normalizeChoice(body.choice, allowed, q.type);
    db.prepare(
      `INSERT INTO attempt_answers(attempt_id, question_id, choice, flagged, answered_at)
       VALUES (?, ?, ?, 0, ?)
       ON CONFLICT(attempt_id, question_id) DO UPDATE SET
         choice = excluded.choice, answered_at = excluded.answered_at`,
    ).run(attemptId, q.id, choice, now());
    return { ok: true };
  });

  app.patch('/exams/:id/flags', async (req) => {
    const { id: attemptId } = req.params as { id: string };
    const body = (req.body || {}) as { questionId?: string; flagged?: boolean };
    if (!body.questionId) badRequest('question_required');
    const attempt = getAttempt(attemptId, req.profile.id);
    if (!attempt) notFound('attempt_not_found');
    if (attempt.status !== 'in_progress') throw new HttpError(409, 'attempt_finished');
    const exists = db
      .prepare('SELECT 1 FROM paper_questions WHERE paper_id = ? AND question_id = ?')
      .get(attempt.paper_id, body.questionId);
    if (!exists) notFound('question_not_in_paper');
    db.prepare(
      `INSERT INTO attempt_answers(attempt_id, question_id, choice, flagged, answered_at)
       VALUES (?, ?, '', ?, NULL)
       ON CONFLICT(attempt_id, question_id) DO UPDATE SET flagged = excluded.flagged`,
    ).run(attemptId, body.questionId, body.flagged ? 1 : 0);
    return { ok: true };
  });

  app.post('/exams/:id/submit', async (req) => {
    const { id: attemptId } = req.params as { id: string };
    const attempt = getAttempt(attemptId, req.profile.id);
    if (!attempt) notFound('attempt_not_found');
    if (attempt.status !== 'in_progress') return { result: attemptSummary(attempt) };
    return { result: finalizeAttempt(attempt, 'submitted') };
  });

  app.get('/exams/:id/review', async (req) => {
    const { id: attemptId } = req.params as { id: string };
    let attempt = getAttempt(attemptId, req.profile.id);
    if (!attempt) notFound('attempt_not_found');
    attempt = maybeFinalize(attempt);
    const paper = getPaper(attempt.paper_id);
    const rows = paperQuestionRows(attempt.paper_id);
    const ids = rows.map((r) => r.id);
    const optMap = optionsFor(ids, true);
    const matMap = materialsFor(rows.map((r) => r.material_id).filter((x): x is string => !!x));
    const answers = new Map(attemptAnswers(attemptId).map((a) => [a.question_id, a]));
    const byModule = new Map<string, { module: string; total: number; scored: number; correct: number; answered: number }>();
    const questions = rows.map((r) => {
      const a = answers.get(r.id);
      const choice = a?.choice || '';
      const isCorrect = r.scorable && choice ? choice === r.answer : null;
      const agg = byModule.get(r.module) || { module: r.module, total: 0, scored: 0, correct: 0, answered: 0 };
      agg.total += 1;
      if (r.scorable) agg.scored += 1;
      if (choice) agg.answered += 1;
      if (isCorrect) agg.correct += 1;
      byModule.set(r.module, agg);
      return {
        id: r.id,
        ordinal: r.ord,
        module: r.module,
        tag: r.tag,
        type: r.type,
        stemHtml: r.stem_html,
        analysisHtml: r.analysis_html,
        optionReasons: extractOptionReasons(r.analysis_html),
        answer: r.answer,
        options: optMap.get(r.id) || [],
        optionCount: r.option_count,
        scorable: !!r.scorable,
        materialId: r.material_id,
        materialHtml: r.material_id ? matMap.get(r.material_id)?.html || null : null,
        choice,
        flagged: !!a?.flagged,
        isCorrect,
      };
    });
    return {
      attempt: attemptSummary(attempt),
      paper: paper ? paperSummaries([paper])[0] : null,
      questions,
      byModule: [...byModule.values()],
    };
  });

  // ---------- practice ----------
  app.post('/practice', async (req) => {
    const body = (req.body || {}) as {
      kind?: string;
      paperId?: string;
      tag?: string;
      module?: string;
      modules?: string[];
      questionId?: string;
      count?: number;
      shuffle?: boolean;
      immediate?: boolean;
    };
    const kind = body.kind || 'paper';
    const profileId = req.profile.id;
    let items: SessionItem[] = [];
    let title = '';
    const filter: Record<string, any> = { kind };

    if (kind === 'paper') {
      if (!body.paperId) badRequest('paper_required');
      const paper = getPaper(body.paperId);
      if (!paper) notFound('paper_not_found');
      const rows = db
        .prepare(
          `SELECT question_id, paper_id, module, tag, material_id
           FROM paper_questions WHERE paper_id = ? ${body.module ? 'AND module = ?' : ''}
           ORDER BY ord`,
        )
        .all(...(body.module ? [paper.id, body.module] : [paper.id])) as any[];
      items = rows.map((r) => ({
        questionId: r.question_id,
        paperId: r.paper_id,
        module: r.module,
        tag: r.tag,
        materialId: r.material_id,
      }));
      title = `${paper.name}${body.module ? ` · ${body.module}` : ''}`;
      filter.paperId = paper.id;
      filter.module = body.module || null;
    } else if (kind === 'tag') {
      if (!body.tag) badRequest('tag_required');
      const rows = db
        .prepare(
          `SELECT question_id, paper_id, module, tag, material_id
           FROM paper_questions WHERE tag = ? ${body.module ? 'AND module = ?' : ''}
           ORDER BY paper_id, ord`,
        )
        .all(...(body.module ? [body.tag, body.module] : [body.tag])) as any[];
      const seen = new Set<string>();
      items = [];
      for (const r of rows) {
        if (seen.has(r.question_id)) continue;
        seen.add(r.question_id);
        items.push({
          questionId: r.question_id,
          paperId: r.paper_id,
          module: r.module,
          tag: r.tag,
          materialId: r.material_id,
        });
      }
      title = `${body.tag}${body.module ? ` · ${body.module}` : ''}`;
      filter.tag = body.tag;
      filter.module = body.module || null;
    } else if (kind === 'question') {
      if (!body.questionId) badRequest('question_required');
      const row = db
        .prepare(
          `SELECT question_id, paper_id, module, tag, material_id
           FROM paper_questions WHERE question_id = ? LIMIT 1`,
        )
        .get(body.questionId) as any;
      if (!row) notFound('question_not_found');
      items = [
        {
          questionId: row.question_id,
          paperId: row.paper_id,
          module: row.module,
          tag: row.tag,
          materialId: row.material_id,
        },
      ];
      title = `单题练习 · ${row.tag}`;
      filter.questionId = row.question_id;
    } else if (kind === 'custom') {
      const modules = Array.isArray(body.modules)
        ? body.modules.filter((m): m is string => typeof m === 'string' && m.length > 0)
        : [];
      const placeholders = modules.map(() => '?').join(',');
      const rows = db
        .prepare(
          `SELECT question_id, paper_id, module, tag, material_id
           FROM paper_questions ${modules.length ? `WHERE module IN (${placeholders})` : ''}
           ORDER BY paper_id, ord`,
        )
        .all(...modules) as any[];
      const seen = new Set<string>();
      items = [];
      for (const r of rows) {
        if (seen.has(r.question_id)) continue;
        seen.add(r.question_id);
        items.push({
          questionId: r.question_id,
          paperId: r.paper_id,
          module: r.module,
          tag: r.tag,
          materialId: r.material_id,
        });
      }
      title = `自定义练习 · ${modules.length ? modules.join(' + ') : '全模块'}`;
      filter.modules = modules;
    } else if (kind === 'wrong') {
      const rows = db
        .prepare(
          `SELECT wb.question_id, pq.paper_id, pq.module, pq.tag, pq.material_id
           FROM wrong_book wb
           JOIN paper_questions pq ON pq.question_id = wb.question_id
           WHERE wb.profile_id = ? AND wb.mastered = 0
           GROUP BY wb.question_id
           ORDER BY wb.last_wrong_at DESC`,
        )
        .all(profileId) as any[];
      items = rows.map((r) => ({
        questionId: r.question_id,
        paperId: r.paper_id,
        module: r.module,
        tag: r.tag,
        materialId: r.material_id,
      }));
      title = '错题重练';
      filter.kind = 'wrong';
    } else {
      badRequest('invalid_kind');
    }

    if (!items.length) badRequest('no_questions');
    if (kind === 'tag' || kind === 'wrong' || kind === 'custom') {
      if (body.shuffle !== false) items = shuffle(items);
    }
    if (kind === 'custom') {
      const raw = body.count === undefined ? 20 : Number(body.count) || 0;
      const limit = raw === 0 ? Math.min(items.length, 5000) : Math.min(Math.max(raw, 1), 5000);
      items = items.slice(0, limit);
    } else if (kind !== 'question') {
      const count = Number(body.count) || 0;
      if (count > 0) items = items.slice(0, Math.min(count, 5000));
    }

    const sessionId = id('s');
    const immediate = body.immediate !== false;
    db.prepare(
      `INSERT INTO practice_sessions(id, profile_id, kind, title, filter_json, questions_json, immediate, created_at, total)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      sessionId,
      profileId,
      kind,
      title,
      JSON.stringify(filter),
      JSON.stringify(items),
      immediate ? 1 : 0,
      now(),
      items.length,
    );
    const session = getSession(sessionId, profileId)!;
    return { session: practiceSummary(session) };
  });

  app.get('/practice/:id', async (req) => {
    const { id: sessionId } = req.params as { id: string };
    const session = getSession(sessionId, req.profile.id);
    if (!session) notFound('session_not_found');
    const items = sessionItems(session);
    return {
      session: practiceSummary(session),
      index: items.map((it, i) => ({
        id: it.questionId,
        ordinal: i + 1,
        module: it.module,
        tag: it.tag,
      })),
    };
  });

  app.get('/practice/:id/questions', async (req) => {
    const { id: sessionId } = req.params as { id: string };
    const q = req.query as { offset?: string; limit?: string };
    const session = getSession(sessionId, req.profile.id);
    if (!session) notFound('session_not_found');
    const all = sessionItems(session);
    const offset = Math.max(Number(q.offset) || 0, 0);
    const limit = Math.min(Math.max(Number(q.limit) || 50, 1), 200);
    const slice = all.slice(offset, offset + limit);
    const answers = new Map(
      (db.prepare('SELECT question_id, choice, is_correct, revealed FROM practice_answers WHERE session_id = ?').all(sessionId) as any[]).map(
        (a) => [a.question_id, { choice: a.choice, is_correct: a.is_correct, revealed: a.revealed }],
      ),
    );
    return {
      session: practiceSummary(session),
      items: hydratePractice(slice, offset, answers, true),
      total: all.length,
      offset,
      limit,
    };
  });

  app.patch('/practice/:id/answers', async (req) => {
    const { id: sessionId } = req.params as { id: string };
    const body = (req.body || {}) as { questionId?: string; choice?: string; reveal?: boolean };
    if (!body.questionId) badRequest('question_required');
    const session = getSession(sessionId, req.profile.id);
    if (!session) notFound('session_not_found');
    if (session.finished_at) throw new HttpError(409, 'session_finished');
    const item = sessionItems(session).find((i) => i.questionId === body.questionId);
    if (!item) notFound('question_not_in_session');
    const q = db
      .prepare('SELECT id, type, answer, scorable FROM questions WHERE id = ?')
      .get(body.questionId) as { id: string; type: string; answer: string; scorable: number } | undefined;
    if (!q) notFound('question_not_found');
    const allowed = new Set(
      (db.prepare('SELECT letter FROM options WHERE question_id = ?').all(q.id) as { letter: string }[]).map((o) => o.letter),
    );
    const choice = normalizeChoice(body.choice, allowed, q.type);
    const revealed = body.reveal === true;
    const isCorrect = choice && q.scorable ? (choice === q.answer ? 1 : 0) : null;
    const previous = db
      .prepare('SELECT revealed FROM practice_answers WHERE session_id = ? AND question_id = ?')
      .get(sessionId, q.id) as { revealed: number } | undefined;

    db.prepare(
      `INSERT INTO practice_answers(session_id, question_id, choice, is_correct, revealed, answered_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(session_id, question_id) DO UPDATE SET
         choice = excluded.choice,
         is_correct = excluded.is_correct,
         revealed = MAX(practice_answers.revealed, excluded.revealed),
         answered_at = excluded.answered_at`,
    ).run(sessionId, q.id, choice, isCorrect, revealed ? 1 : 0, now());

    if (revealed && isCorrect === 0) addWrong(req.profile.id, q.id);
    if (revealed && isCorrect === 1) {
      db.prepare(
        `UPDATE wrong_book
         SET correct_streak = correct_streak + 1,
             mastered = CASE WHEN correct_streak + 1 >= 3 THEN 1 ELSE mastered END
         WHERE profile_id = ? AND question_id = ?`,
      ).run(req.profile.id, q.id);
    }

    return {
      ok: true,
      isCorrect,
      answer: q.answer,
      revealed: revealed || !!previous?.revealed,
    };
  });

  app.post('/practice/:id/finish', async (req) => {
    const { id: sessionId } = req.params as { id: string };
    const session = getSession(sessionId, req.profile.id);
    if (!session) notFound('session_not_found');
    if (!session.finished_at) {
      db.prepare('UPDATE practice_sessions SET finished_at = ? WHERE id = ?').run(now(), sessionId);
    }
    return { session: practiceSummary(getSession(sessionId, req.profile.id)!) };
  });

  app.get('/practice/:id/review', async (req) => {
    const { id: sessionId } = req.params as { id: string };
    const q = req.query as { scope?: string; limit?: string };
    const session = getSession(sessionId, req.profile.id);
    if (!session) notFound('session_not_found');
    const scope = q.scope === 'all' ? 'all' : 'wrong';
    const limit = Math.min(Math.max(Number(q.limit) || 200, 1), 500);
    const all = sessionItems(session);
    const answerRows = db
      .prepare('SELECT question_id, choice, is_correct, revealed FROM practice_answers WHERE session_id = ?')
      .all(sessionId) as { question_id: string; choice: string; is_correct: number | null; revealed: number }[];
    const answerMap = new Map(answerRows.map((a) => [a.question_id, { choice: a.choice, is_correct: a.is_correct, revealed: a.revealed }]));
    let items = all;
    if (scope === 'wrong') {
      const wrongIds = new Set(answerRows.filter((a) => a.revealed && a.is_correct === 0).map((a) => a.question_id));
      items = all.filter((i) => wrongIds.has(i.questionId));
    }
    items = items.slice(0, limit);
    return {
      session: practiceSummary(session),
      scope,
      items: hydratePractice(items, 0, answerMap, true),
    };
  });

  // ---------- question flags ----------
  app.get('/question-flags', async (req) => {
    const rows = db
      .prepare(
        `SELECT f.question_id, f.note, f.created_at, f.resolved,
                q.type, q.stem_html, q.scorable,
                (SELECT module FROM paper_questions x WHERE x.question_id = f.question_id LIMIT 1) AS module,
                (SELECT tag FROM paper_questions x WHERE x.question_id = f.question_id LIMIT 1) AS tag,
                (SELECT paper_id FROM paper_questions x WHERE x.question_id = f.question_id LIMIT 1) AS paper_id
         FROM question_flags f JOIN questions q ON q.id = f.question_id
         WHERE f.profile_id = ? ORDER BY f.created_at DESC`,
      )
      .all(req.profile.id) as any[];
    const paperMap = papersFor(rows.map((r) => r.paper_id).filter(Boolean));
    return {
      total: rows.length,
      items: rows.map((r) => {
        const paper = paperMap.get(r.paper_id);
        return {
          id: r.question_id,
          note: r.note,
          createdAt: r.created_at,
          resolved: !!r.resolved,
          module: r.module,
          tag: r.tag,
          type: r.type,
          stemHtml: r.stem_html,
          scorable: !!r.scorable,
          source: paper
            ? { paperId: paper.id, year: paper.year, province: paper.province, name: paper.name }
            : null,
        };
      }),
    };
  });

  app.post('/question-flags', async (req) => {
    const body = (req.body || {}) as { questionId?: string; note?: string };
    if (!body.questionId) badRequest('question_required');
    const note = String(body.note || '').trim().slice(0, 500);
    const exists = db.prepare('SELECT 1 FROM questions WHERE id = ?').get(body.questionId);
    if (!exists) notFound('question_not_found');
    db.prepare(
      `INSERT INTO question_flags(profile_id, question_id, note, created_at, resolved)
       VALUES (?, ?, ?, ?, 0)
       ON CONFLICT(profile_id, question_id) DO UPDATE SET
         note = excluded.note, created_at = excluded.created_at, resolved = 0`,
    ).run(req.profile.id, body.questionId, note, now());
    return { ok: true };
  });

  app.delete('/question-flags/:questionId', async (req) => {
    const { questionId } = req.params as { questionId: string };
    db.prepare('DELETE FROM question_flags WHERE profile_id = ? AND question_id = ?').run(
      req.profile.id,
      questionId,
    );
    return { ok: true };
  });

  // ---------- wrong book ----------
  app.get('/wrong-book', async (req) => {
    const q = req.query as { module?: string; tag?: string; mastered?: string; limit?: string; offset?: string };
    const mastered = q.mastered === '1' ? 1 : 0;
    const limit = Math.min(Math.max(Number(q.limit) || 50, 1), 200);
    const offset = Math.max(Number(q.offset) || 0, 0);
    const where: string[] = ['wb.profile_id = ?', 'wb.mastered = ?'];
    const params: any[] = [req.profile.id, mastered];
    if (q.module) {
      where.push('EXISTS (SELECT 1 FROM paper_questions x WHERE x.question_id = wb.question_id AND x.module = ?)');
      params.push(q.module);
    }
    if (q.tag) {
      where.push('EXISTS (SELECT 1 FROM paper_questions x WHERE x.question_id = wb.question_id AND x.tag = ?)');
      params.push(q.tag);
    }
    const rows = db
      .prepare(
        `SELECT wb.question_id, wb.wrong_count, wb.correct_streak, wb.added_at, wb.last_wrong_at, wb.mastered,
                q.type, q.stem_html, q.analysis_html, q.answer, q.scorable, q.option_count,
                (SELECT module FROM paper_questions x WHERE x.question_id = wb.question_id LIMIT 1) AS module,
                (SELECT tag FROM paper_questions x WHERE x.question_id = wb.question_id LIMIT 1) AS tag,
                (SELECT paper_id FROM paper_questions x WHERE x.question_id = wb.question_id LIMIT 1) AS paper_id,
                (SELECT material_id FROM paper_questions x WHERE x.question_id = wb.question_id LIMIT 1) AS material_id
         FROM wrong_book wb JOIN questions q ON q.id = wb.question_id
         WHERE ${where.join(' AND ')}
         ORDER BY wb.last_wrong_at DESC LIMIT ? OFFSET ?`,
      )
      .all(...params, limit, offset) as any[];
    const total = (
      db
        .prepare(
          `SELECT COUNT(*) AS c FROM wrong_book wb WHERE ${where.join(' AND ')}`,
        )
        .get(...params) as { c: number }
    ).c;
    const ids = rows.map((r) => r.question_id);
    const optMap = optionsFor(ids, true);
    const paperMap = papersFor(rows.map((r) => r.paper_id).filter(Boolean));
    const matMap = materialsFor(rows.map((r) => r.material_id).filter(Boolean));
    return {
      total,
      items: rows.map((r) => ({
        id: r.question_id,
        wrongCount: r.wrong_count,
        correctStreak: r.correct_streak,
        addedAt: r.added_at,
        lastWrongAt: r.last_wrong_at,
        mastered: !!r.mastered,
        module: r.module,
        tag: r.tag,
        type: r.type,
        stemHtml: r.stem_html,
        analysisHtml: r.analysis_html,
        optionReasons: extractOptionReasons(r.analysis_html),
        answer: r.answer,
        scorable: !!r.scorable,
        optionCount: r.option_count,
        materialId: r.material_id,
        materialHtml: r.material_id ? matMap.get(r.material_id)?.html || null : null,
        options: optMap.get(r.question_id) || [],
        source: paperMap.get(r.paper_id)
          ? {
              paperId: r.paper_id,
              year: paperMap.get(r.paper_id)!.year,
              province: paperMap.get(r.paper_id)!.province,
              name: paperMap.get(r.paper_id)!.name,
            }
          : null,
      })),
    };
  });

  app.patch('/wrong-book/:questionId', async (req) => {
    const { questionId } = req.params as { questionId: string };
    const body = (req.body || {}) as { mastered?: boolean };
    const result = db
      .prepare('UPDATE wrong_book SET mastered = ? WHERE profile_id = ? AND question_id = ?')
      .run(body.mastered ? 1 : 0, req.profile.id, questionId);
    if (!result.changes) notFound('not_in_wrong_book');
    return { ok: true };
  });

  app.delete('/wrong-book/:questionId', async (req) => {
    const { questionId } = req.params as { questionId: string };
    db.prepare('DELETE FROM wrong_book WHERE profile_id = ? AND question_id = ?').run(req.profile.id, questionId);
    return { ok: true };
  });
}
