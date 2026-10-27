import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from './config.js';
import { db, setMeta, getMeta, tableExists, markContentReady } from './db.js';
import { parseContent, type ParsedPaper, type ParseStats } from './parse.js';

const CONTENT_TABLES = [
  'paper_questions',
  'options',
  'questions',
  'materials',
  'paper_modules',
  'papers',
] as const;

// 用当前题库实测出来的黄金数字，防止解析器悄悄退化。
// 如果你换了一整套题库，设置 STRICT_ETL=0 跳过强校验。
const GOLDEN: Partial<Record<keyof ParseStats, number>> = {
  notes: 2956,
  papers: 515,
  questions: 58890,
  judge: 111,
  multi: 405,
  unscorable: 4,
};

const CONTENT_SCHEMA = `
CREATE TABLE papers (
  id TEXT PRIMARY KEY,
  year INTEGER NOT NULL,
  province TEXT NOT NULL,
  name TEXT NOT NULL,
  question_count INTEGER NOT NULL,
  material_count INTEGER NOT NULL DEFAULT 0,
  source_file TEXT
);
CREATE UNIQUE INDEX ux_papers_identity ON papers(year, province, name);

CREATE TABLE paper_modules (
  paper_id TEXT NOT NULL,
  module TEXT NOT NULL,
  ord INTEGER NOT NULL,
  question_count INTEGER NOT NULL,
  PRIMARY KEY(paper_id, module)
);

CREATE TABLE materials (
  id TEXT PRIMARY KEY,
  paper_id TEXT NOT NULL,
  module TEXT NOT NULL,
  module_ord INTEGER NOT NULL,
  ordinal INTEGER NOT NULL,
  html TEXT NOT NULL,
  has_missing_image INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX ix_materials_paper ON materials(paper_id, module_ord, ordinal);

CREATE TABLE questions (
  id TEXT PRIMARY KEY,
  qid TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL,
  stem_html TEXT NOT NULL,
  analysis_html TEXT NOT NULL,
  answer TEXT NOT NULL,
  option_count INTEGER NOT NULL,
  scorable INTEGER NOT NULL,
  has_image INTEGER NOT NULL,
  has_missing_image INTEGER NOT NULL,
  content_hash TEXT NOT NULL
);

CREATE TABLE options (
  question_id TEXT NOT NULL,
  letter TEXT NOT NULL,
  html TEXT NOT NULL,
  is_correct INTEGER NOT NULL,
  ord INTEGER NOT NULL,
  PRIMARY KEY(question_id, letter)
);

CREATE TABLE paper_questions (
  paper_id TEXT NOT NULL,
  question_id TEXT NOT NULL,
  ord INTEGER NOT NULL,
  module TEXT NOT NULL,
  module_ord INTEGER NOT NULL,
  tag TEXT NOT NULL,
  material_id TEXT,
  PRIMARY KEY(paper_id, ord)
);
CREATE INDEX ix_pq_question ON paper_questions(question_id);
CREATE INDEX ix_pq_tag ON paper_questions(tag, question_id);
CREATE INDEX ix_pq_module ON paper_questions(module, question_id);
`;

function sha1(s: string): string {
  return crypto.createHash('sha1').update(s).digest('hex');
}

const PARSER_VERSION = 2;

function contentDirs(contentDir: string): string[] {
  return fs
    .readdirSync(contentDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && /^\d\d-/.test(e.name))
    .map((e) => e.name)
    .sort();
}

export function contentFingerprint(contentDir: string): string {
  const parts: string[] = [`parser:${PARSER_VERSION}`];
  for (const dir of contentDirs(contentDir)) {
    const full = path.join(contentDir, dir);
    for (const name of fs.readdirSync(full).sort()) {
      if (!name.endsWith('.md') || name === 'README.md') continue;
      const st = fs.statSync(path.join(full, name));
      parts.push(`${dir}/${name}:${st.size}:${Math.round(st.mtimeMs)}`);
    }
  }
  const imagesDir = path.join(contentDir, '90-图片');
  for (const sub of ['题目图', '公式图']) {
    const p = path.join(imagesDir, sub);
    if (fs.existsSync(p)) {
      const st = fs.statSync(p);
      parts.push(`${sub}:${fs.readdirSync(p).length}:${Math.round(st.mtimeMs)}`);
    }
  }
  return sha1(parts.join('\n'));
}

function validateStats(stats: ParseStats): void {
  if (process.env.STRICT_ETL === '0') return;
  const diffs: string[] = [];
  for (const [key, expected] of Object.entries(GOLDEN) as [keyof ParseStats, number][]) {
    const actual = stats[key] as number;
    if (actual !== expected) diffs.push(`${key}: 期望 ${expected}，实际 ${actual}`);
  }
  if (diffs.length) {
    throw new Error(
      `题库解析结果与黄金数字不一致（设置 STRICT_ETL=0 可跳过）：\n${diffs.join('\n')}`,
    );
  }
}

function rebuildContent(papers: ParsedPaper[], stats: ParseStats, fingerprint: string): void {
  const qidRe = new Map<string, { hash: string; file: string }>();

  db.exec('BEGIN');
  try {
    for (const t of CONTENT_TABLES) db.exec(`DROP TABLE IF EXISTS ${t}`);
    db.exec(CONTENT_SCHEMA);

    const insertPaper = db.prepare(
      `INSERT INTO papers(id, year, province, name, question_count, material_count, source_file)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    const insertModule = db.prepare(
      `INSERT INTO paper_modules(paper_id, module, ord, question_count) VALUES (?, ?, ?, ?)`,
    );
    const insertMaterial = db.prepare(
      `INSERT INTO materials(id, paper_id, module, module_ord, ordinal, html, has_missing_image)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    const selectQuestion = db.prepare('SELECT content_hash FROM questions WHERE id = ?');
    const insertQuestion = db.prepare(
      `INSERT INTO questions(id, qid, type, stem_html, analysis_html, answer, option_count,
                             scorable, has_image, has_missing_image, content_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const insertOption = db.prepare(
      'INSERT INTO options(question_id, letter, html, is_correct, ord) VALUES (?, ?, ?, ?, ?)',
    );
    const insertPQ = db.prepare(
      `INSERT INTO paper_questions(paper_id, question_id, ord, module, module_ord, tag, material_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );

    let duplicateQid = 0;
    let mismatchedDuplicate = 0;

    for (const paper of papers) {
      let ord = 0;
      let materialCount = 0;
      let questionCount = 0;
      for (const m of paper.modules) {
        materialCount += m.materials.length;
        questionCount += m.questions.length;
      }
      insertPaper.run(
        paper.id,
        paper.year,
        paper.province,
        paper.name,
        questionCount,
        materialCount,
        paper.modules[0]?.file ?? null,
      );

      for (const m of paper.modules) {
        insertModule.run(paper.id, m.module, m.moduleOrd, m.questions.length);
        const materialIds = new Map<number, string>();
        for (const mat of m.materials) {
          const id = `m_${paper.id}_${m.moduleOrd}_${mat.ordinal}`;
          materialIds.set(mat.ordinal, id);
          insertMaterial.run(
            id,
            paper.id,
            m.module,
            m.moduleOrd,
            mat.ordinal,
            mat.html,
            mat.hasMissingImage ? 1 : 0,
          );
        }

        for (const q of m.questions) {
          ord += 1;
          const id = `q_${q.qid}`;
          const hash = sha1(
            [q.stemHtml, ...q.options.map((o) => `${o.letter}:${o.html}`), q.answer, q.analysisHtml].join('\n'),
          );
          const existing = selectQuestion.get(id) as { content_hash: string } | undefined;
          if (!existing) {
            insertQuestion.run(
              id,
              q.qid,
              q.type,
              q.stemHtml,
              q.analysisHtml,
              q.answer,
              q.options.length,
              q.scorable ? 1 : 0,
              q.hasImage ? 1 : 0,
              q.hasMissingImage ? 1 : 0,
              hash,
            );
            q.options.forEach((o, i) => {
              insertOption.run(id, o.letter, o.html, o.isCorrect ? 1 : 0, i);
            });
            qidRe.set(id, { hash, file: m.file });
          } else {
            duplicateQid += 1;
            if (existing.content_hash !== hash) {
              mismatchedDuplicate += 1;
              if (mismatchedDuplicate <= 5) {
                console.warn(`[etl] qid ${q.qid} 内容不一致，保留首次出现的版本`);
              }
            }
          }

          const materialId = q.materialOrdinal != null ? materialIds.get(q.materialOrdinal) ?? null : null;
          insertPQ.run(paper.id, id, ord, m.module, m.moduleOrd, q.tag, materialId);
        }
      }
    }

    setMeta('content_fingerprint', fingerprint);
    setMeta('content_stats', JSON.stringify(stats));
    setMeta('content_built_at', String(Date.now()));
    setMeta('content_duplicate_occurrences', String(duplicateQid));
    setMeta('content_duplicate_mismatch', String(mismatchedDuplicate));
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export type EnsureContentResult = {
  stats: ParseStats;
  rebuilt: boolean;
  ms: number;
  canonicalQuestions: number;
};

export function ensureContent(): EnsureContentResult {
  const t0 = performance.now();
  const fingerprint = contentFingerprint(config.contentDir);
  const storedFp = getMeta('content_fingerprint');
  const storedStats = getMeta('content_stats');
  const hasContent = tableExists('papers') && tableExists('questions');

  if (hasContent && storedFp === fingerprint && storedStats) {
    markContentReady();
    const canonical = (
      db.prepare('SELECT COUNT(*) AS c FROM questions').get() as { c: number }
    ).c;
    return {
      stats: JSON.parse(storedStats) as ParseStats,
      rebuilt: false,
      ms: Math.round(performance.now() - t0),
      canonicalQuestions: canonical,
    };
  }

  const { papers, stats } = parseContent(config.contentDir);
  if (!papers.length || !stats.questions) {
    throw new Error(`题库目录没有解析出内容：${config.contentDir}`);
  }
  validateStats(stats);

  const t1 = performance.now();
  rebuildContent(papers, stats, fingerprint);
  markContentReady();

  const canonical = (
    db.prepare('SELECT COUNT(*) AS c FROM questions').get() as { c: number }
  ).c;
  const ms = Math.round(performance.now() - t0);
  console.log(
    `[etl] 重建完成 ${ms}ms（解析 ${Math.round(t1 - t0)}ms）：` +
      `${stats.papers} 套 / ${stats.questions} 题 / ${canonical} 唯一题 / ` +
      `判断 ${stats.judge} / 多选 ${stats.multi} / 不可判分 ${stats.unscorable} / 材料 ${stats.materials}`,
  );
  console.log(`[etl] 选项数量分布：${JSON.stringify(stats.optionCounts)}`);
  if (stats.missingImageQuestions) {
    console.log(`[etl] 含缺失图片的题：${stats.missingImageQuestions}`);
  }

  return { stats, rebuilt: true, ms, canonicalQuestions: canonical };
}
