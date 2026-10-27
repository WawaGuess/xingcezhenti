import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { renderBlock, renderInline } from './html.js';

export const MODULE_BY_DIR: Record<string, string> = {
  '01': '政治理论',
  '02': '常识判断',
  '03': '言语理解与表达',
  '04': '数量关系',
  '05': '判断推理',
  '06': '资料分析',
};

export const MODULE_ORDER: Record<string, number> = {
  政治理论: 1,
  常识判断: 2,
  言语理解与表达: 3,
  数量关系: 4,
  判断推理: 5,
  资料分析: 6,
};

export type QuestionType = 'single' | 'multi' | 'judge';

export type RawOption = {
  letter: string;
  text: string;
  html: string;
  isCorrect: boolean;
};

export type RawQuestion = {
  sourceNo: number;
  qid: string;
  tag: string;
  type: QuestionType;
  stemHtml: string;
  options: RawOption[];
  answer: string;
  analysisHtml: string;
  scorable: boolean;
  hasImage: boolean;
  hasMissingImage: boolean;
  materialOrdinal: number | null;
};

export type RawMaterial = {
  ordinal: number;
  html: string;
  hasMissingImage: boolean;
};

export type RawModule = {
  file: string;
  year: number;
  province: string;
  paperName: string;
  paperId: string;
  module: string;
  moduleOrd: number;
  materials: RawMaterial[];
  questions: RawQuestion[];
};

export type ParsedPaper = {
  id: string;
  year: number;
  province: string;
  name: string;
  modules: RawModule[];
};

export type ParseStats = {
  notes: number;
  papers: number;
  questions: number;
  materials: number;
  judge: number;
  multi: number;
  unscorable: number;
  missingImageQuestions: number;
  optionCounts: Record<number, number>;
};

function sha1(s: string): string {
  return crypto.createHash('sha1').update(s).digest('hex');
}

function trimBlock(s: string): string {
  return s
    .replace(/\r/g, '')
    .replace(/(?:\n\s*---\s*)+\s*$/, '')
    .trim();
}

function parseFrontmatter(raw: string): { meta: Record<string, string>; body: string } {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { meta: {}, body: raw };
  const meta: Record<string, string> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const mm = line.match(/^([^:：]+):\s*"?(.*?)"?\s*$/);
    if (mm) meta[mm[1].trim()] = mm[2].trim();
  }
  return { meta, body: raw.slice(m[0].length) };
}

const MATERIAL_RE = /^##\s*材料\s*(\d+)\s*$/;
const QUESTION_RE = /^(#{2,3})\s*第\s*(\d+)\s*题(?:\s*<sub>\s*qid\s*(\d+)\s*·\s*([^<]*?)\s*<\/sub>)?\s*$/;

type OpenMaterial = {
  ordinal: number;
  lines: string[];
  rangeSpan: number | null;
  assigned: number;
  lastQid: number | null;
  closed: boolean;
};
type OpenQuestion = {
  level: number;
  sourceNo: number;
  qid: string;
  tag: string;
  lines: string[];
  materialRef: OpenMaterial | null;
};

function stripHtmlText(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractRangeSpan(text: string): number | null {
  const m = text.match(/回答\s*(\d+)\s*[~～\-—至]\s*(\d+)\s*题/);
  if (!m) return null;
  const span = Number(m[2]) - Number(m[1]) + 1;
  return span > 0 && span <= 50 ? span : null;
}

const STRONG_MATERIAL_REF =
  /以上|上述|该(?:公文|材料|案例|表|图|资料)|上表|下表|表中|图中|根据材料|根据资料|根据上述|根据以上|材料(?:一|二|三|中|提到|显示|表明|可知)/;

function isStandaloneTag(module: string, tag: string): boolean {
  if (module === '言语理解与表达') return tag === '逻辑填空';
  if (module === '判断推理') return tag === '类比推理' || tag === '定义判断' || tag === '图形推理';
  return false;
}

function parseQuestion(q: OpenQuestion): RawQuestion {
  let body = trimBlock(q.lines.join('\n'));

  let analysisRaw = '';
  const analysisMatch = body.match(/^\*\*官方解析\*\*\s*$/m);
  if (analysisMatch && analysisMatch.index !== undefined) {
    analysisRaw = body.slice(analysisMatch.index + analysisMatch[0].length);
    body = body.slice(0, analysisMatch.index);
  }

  let answerRaw = '';
  const answerMatch = body.match(/^\*\*答案\*\*\s*[：:]\s*(.*)$/m);
  if (answerMatch) {
    answerRaw = answerMatch[1].trim();
    body = body.replace(/^\*\*答案\*\*\s*[：:].*$/m, '');
  }

  const isJudge = /^-\s*（选项）\[\]\s*$/m.test(body);
  if (isJudge) body = body.replace(/^-\s*（选项）\[\]\s*$/m, '');

  const stemLines: string[] = [];
  const optionDrafts: { letter: string; text: string }[] = [];
  let current: { letter: string; text: string } | null = null;

  for (const line of body.split('\n')) {
    const om = line.match(/^-\s*\*\*([A-H])\*\*\s*[.．]\s?(.*)$/);
    if (om) {
      current = { letter: om[1], text: om[2] };
      optionDrafts.push(current);
      continue;
    }
    if (current) {
      if (line.trim()) current.text += '\n' + line;
    } else {
      stemLines.push(line);
    }
  }

  const missingAnswer = !answerRaw || /（缺）|\(缺\)/.test(answerRaw);
  const answerLetters = missingAnswer ? '' : Array.from(new Set(answerRaw.toUpperCase().match(/[A-H]/g) || [])).sort().join('');

  const cleanOptions = isJudge
    ? [
        { letter: 'A', text: '正确', isCorrect: answerLetters === 'A' },
        { letter: 'B', text: '错误', isCorrect: answerLetters === 'B' },
      ]
    : optionDrafts.map((o) => ({
        letter: o.letter,
        text: o.text.replace(/✅/g, '').trim(),
        isCorrect: answerLetters.includes(o.letter),
      }));

  const stem = renderBlock(trimBlock(stemLines.join('\n')));
  const renderedOptions = cleanOptions.map((o) => {
    const r = renderInline(o.text);
    return { ...o, html: r.html, hasImage: r.hasImage, hasMissingImage: r.hasMissingImage };
  });
  const analysis = renderBlock(analysisRaw);

  const hasImage = stem.hasImage || renderedOptions.some((o) => o.hasImage) || analysis.hasImage;
  const hasMissingImage =
    stem.hasMissingImage || renderedOptions.some((o) => o.hasMissingImage) || analysis.hasMissingImage;

  return {
    sourceNo: q.sourceNo,
    qid: q.qid || `h_${sha1(stem.html + renderedOptions.map((o) => o.letter + o.text).join(''))}`,
    tag: q.tag || '未分类',
    type: isJudge ? 'judge' : answerLetters.length > 1 ? 'multi' : 'single',
    stemHtml: stem.html,
    options: renderedOptions.map((o) => ({
      letter: o.letter,
      text: o.text,
      html: o.html,
      isCorrect: o.isCorrect,
    })),
    answer: answerLetters,
    analysisHtml: analysis.html,
    scorable: answerLetters.length > 0,
    hasImage,
    hasMissingImage,
    materialOrdinal: null,
  };
}

export function parseNote(file: string, dirPrefix: string): RawModule | null {
  const raw = fs.readFileSync(file, 'utf8');
  const { meta, body } = parseFrontmatter(raw);

  const year = Number(meta['年份']);
  const province = (meta['地区'] || '').trim();
  const paperName = (meta['试卷'] || '').trim();
  const module = (meta['模块'] || MODULE_BY_DIR[dirPrefix] || '').trim();
  if (!year || !paperName || !module) return null;

  const paperId = `p_${sha1(`${year}|${province}|${paperName}`).slice(0, 12)}`;
  const materials: RawMaterial[] = [];
  const questions: RawQuestion[] = [];

  let currentMaterial: OpenMaterial | null = null;
  let currentQuestion: OpenQuestion | null = null;

  const finishMaterial = () => {
    if (!currentMaterial) return;
    const rawText = trimBlock(currentMaterial.lines.join('\n'));
    if (rawText) {
      const r = renderBlock(rawText);
      materials.push({
        ordinal: currentMaterial.ordinal,
        html: r.html,
        hasMissingImage: r.hasMissingImage,
      });
    }
    currentMaterial = null;
  };

  const finishQuestion = () => {
    if (!currentQuestion) return;
    const parsed = parseQuestion(currentQuestion);
    const ref = currentQuestion.materialRef;

    if (ref && !ref.closed) {
      if (module === '资料分析') {
        // 资料分析的结构最规整：材料之后的小题都属于这份材料，直到下一份材料
        parsed.materialOrdinal = ref.ordinal;
        ref.assigned += 1;
        const n = Number(parsed.qid);
        if (Number.isFinite(n)) ref.lastQid = n;
      } else {
        if (ref.rangeSpan == null) ref.rangeSpan = extractRangeSpan(ref.lines.join('\n'));
        const qidNum = /^\d+$/.test(parsed.qid) ? Number(parsed.qid) : null;
        const qidDrop = ref.lastQid != null && qidNum != null && qidNum < ref.lastQid;
        const stemText = stripHtmlText(parsed.stemHtml);
        const strongRef = STRONG_MATERIAL_REF.test(stemText);
        const tagBoundary = isStandaloneTag(module, parsed.tag);
        const rangeExceeded = ref.rangeSpan != null && ref.assigned >= ref.rangeSpan;
        // 材料小组的边界：显式题号范围用完，或 qid 分块回退且题目开始“自包含”，
        // 或题干明显变成一整段独立材料。第一条总是归入材料。
        const boundary =
          ref.assigned > 0 &&
          (rangeExceeded ||
            (qidDrop && (tagBoundary || (stemText.length > 50 && !strongRef))) ||
            (stemText.length > 150 && !strongRef));

        if (boundary) {
          parsed.materialOrdinal = null;
          ref.closed = true;
        } else {
          parsed.materialOrdinal = ref.ordinal;
          ref.assigned += 1;
          if (qidNum != null) ref.lastQid = qidNum;
        }
      }
    } else {
      parsed.materialOrdinal = null;
    }

    questions.push(parsed);
    currentQuestion = null;
  };

  for (const line of body.split(/\r?\n/)) {
    const mm = MATERIAL_RE.exec(line);
    if (mm) {
      finishQuestion();
      finishMaterial();
      currentMaterial = {
        ordinal: Number(mm[1]),
        lines: [],
        rangeSpan: null,
        assigned: 0,
        lastQid: null,
        closed: false,
      };
      continue;
    }

    const qm = QUESTION_RE.exec(line);
    if (qm) {
      finishQuestion();
      const level = qm[1].length;
      // 06 里正常的材料题是 ###；独立题用 ##，此时不带材料
      if (level === 2) finishMaterial();
      currentQuestion = {
        level,
        sourceNo: Number(qm[2]),
        qid: qm[3] || '',
        tag: (qm[4] || '').trim(),
        lines: [],
        materialRef: level === 3 ? currentMaterial : null,
      };
      continue;
    }

    if (currentQuestion) currentQuestion.lines.push(line);
    else if (currentMaterial) currentMaterial.lines.push(line);
  }

  finishQuestion();
  finishMaterial();

  return {
    file,
    year,
    province,
    paperName,
    paperId,
    module,
    moduleOrd: MODULE_ORDER[module] || Number(dirPrefix) || 99,
    materials,
    questions,
  };
}

export function parseContent(contentDir: string): { papers: ParsedPaper[]; stats: ParseStats } {
  const dirs = fs
    .readdirSync(contentDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && /^\d\d-/.test(e.name))
    .map((e) => e.name)
    .sort();

  const modules: RawModule[] = [];
  let notes = 0;

  for (const dir of dirs) {
    const prefix = dir.slice(0, 2);
    const full = path.join(contentDir, dir);
    for (const name of fs.readdirSync(full)) {
      if (!name.endsWith('.md') || name === 'README.md') continue;
      notes += 1;
      const parsed = parseNote(path.join(full, name), prefix);
      if (parsed) modules.push(parsed);
    }
  }

  const byPaper = new Map<string, ParsedPaper>();
  for (const m of modules) {
    let paper = byPaper.get(m.paperId);
    if (!paper) {
      paper = { id: m.paperId, year: m.year, province: m.province, name: m.paperName, modules: [] };
      byPaper.set(m.paperId, paper);
    }
    paper.modules.push(m);
  }

  const papers = [...byPaper.values()];
  for (const p of papers) p.modules.sort((a, b) => a.moduleOrd - b.moduleOrd);

  let questionCount = 0;
  let materialCount = 0;
  let judge = 0;
  let multi = 0;
  let unscorable = 0;
  let missingImageQuestions = 0;
  const optionCounts: Record<number, number> = {};

  for (const p of papers) {
    for (const m of p.modules) {
      materialCount += m.materials.length;
      for (const q of m.questions) {
        questionCount += 1;
        if (q.type === 'judge') judge += 1;
        if (q.type === 'multi') multi += 1;
        if (!q.scorable) unscorable += 1;
        if (q.hasMissingImage) missingImageQuestions += 1;
        optionCounts[q.options.length] = (optionCounts[q.options.length] || 0) + 1;
      }
    }
  }

  return {
    papers,
    stats: {
      notes,
      papers: papers.length,
      questions: questionCount,
      materials: materialCount,
      judge,
      multi,
      unscorable,
      missingImageQuestions,
      optionCounts,
    },
  };
}
