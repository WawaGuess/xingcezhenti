import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { api, ApiError } from '../api';
import { OptionList, QuestionMeta } from '../components/Question';
import {
  AnswerSheet,
  Badge,
  ErrorBox,
  fmtDuration,
  Loading,
  MaterialBox,
  Modal,
  RichHtml,
  toast,
  useCountdown,
} from '../components/ui';

export default function ExamRun() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const stateQ = useQuery({
    queryKey: ['exam', id],
    queryFn: () => api.getExam(id!),
    enabled: !!id,
  });
  const questionsQ = useQuery({
    queryKey: ['exam-questions', id],
    queryFn: () => api.getExamQuestions(id!),
    enabled: !!id,
    staleTime: Infinity,
  });

  const attempt = stateQ.data?.attempt;
  const paper = stateQ.data?.paper;
  const questions = questionsQ.data?.questions ?? [];

  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [flags, setFlags] = useState<Set<string>>(new Set());
  const [index, setIndex] = useState(() => {
    if (!id) return 0;
    try {
      const n = Number(localStorage.getItem(`xczt.exam.pos.${id}`));
      return Number.isInteger(n) && n >= 0 ? n : 0;
    } catch {
      return 0;
    }
  });
  const [sheetOpen, setSheetOpen] = useState(false);
  const [submitOpen, setSubmitOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const submittedRef = useRef(false);
  const autoTried = useRef(false);
  const initialized = useRef(false);

  useEffect(() => {
    if (initialized.current || !stateQ.data || !questionsQ.data) return;
    initialized.current = true;
    setAnswers(stateQ.data.answers);
    setFlags(new Set(stateQ.data.flags));
    const first = questionsQ.data.questions.findIndex((q) => !stateQ.data!.answers[q.id]);
    let stored: number | null = null;
    try {
      const n = Number(localStorage.getItem(`xczt.exam.pos.${id}`));
      if (Number.isInteger(n) && n >= 0 && n < questionsQ.data.questions.length) stored = n;
    } catch {
      /* ignore */
    }
    setIndex(stored ?? (first < 0 ? 0 : first));
  }, [stateQ.data, questionsQ.data, id]);

  useEffect(() => {
    if (!id) return;
    try {
      localStorage.setItem(`xczt.exam.pos.${id}`, String(index));
    } catch {
      /* ignore */
    }
  }, [id, index]);

  const current = questions[index];
  const remaining = useCountdown(attempt?.deadlineAt, attempt?.serverNow);
  const answeredCount = useMemo(() => Object.values(answers).filter(Boolean).length, [answers]);

  const doSubmit = useCallback(async () => {
    if (!id || submittedRef.current) return;
    submittedRef.current = true;
    setSubmitting(true);
    try {
      await api.submitExam(id);
      try {
        localStorage.removeItem(`xczt.exam.pos.${id}`);
      } catch {
        /* ignore */
      }
      navigate(`/exam/${id}/result`, { replace: true });
    } catch (e) {
      submittedRef.current = false;
      setSubmitting(false);
      toast(e instanceof Error ? e.message : '交卷失败，请重试');
    }
  }, [id, navigate]);

  useEffect(() => {
    if (!attempt || attempt.status !== 'in_progress') return;
    if (remaining === 0 && !autoTried.current) {
      autoTried.current = true;
      void doSubmit();
    }
  }, [remaining, attempt, doSubmit]);

  const choose = useCallback(
    (letter: string) => {
      if (!current || !id) return;
      const prev = answers[current.id] || '';
      let next: string;
      if (current.type === 'multi') {
        const set = new Set(prev.split(''));
        if (set.has(letter)) set.delete(letter);
        else set.add(letter);
        next = [...set].sort().join('');
      } else {
        next = prev === letter ? '' : letter;
      }
      setAnswers((a) => ({ ...a, [current.id]: next }));
      api.saveExamAnswer(id, current.id, next).catch((e) => {
        if (e instanceof ApiError && e.status === 409) {
          navigate(`/exam/${id}/result`, { replace: true });
          return;
        }
        toast(e instanceof Error ? e.message : '保存失败');
      });
    },
    [current, answers, id, navigate],
  );

  const toggleFlag = useCallback(() => {
    if (!current || !id) return;
    const next = !flags.has(current.id);
    setFlags((prev) => {
      const n = new Set(prev);
      if (next) n.add(current.id);
      else n.delete(current.id);
      return n;
    });
    api.saveExamFlag(id, current.id, next).catch((e) => {
      toast(e instanceof Error ? e.message : '标记失败');
    });
  }, [current, flags, id]);

  const go = useCallback(
    (delta: number) => {
      setIndex((i) => Math.max(0, Math.min(questions.length - 1, i + delta)));
    },
    [questions.length],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (sheetOpen || submitOpen || helpOpen) return;
      if (tag === 'BUTTON' && e.key === 'Enter') return;
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        go(-1);
      } else if (e.key === 'ArrowRight' || e.key === 'Enter') {
        e.preventDefault();
        go(1);
      } else if (e.key.toLowerCase() === 'f') {
        e.preventDefault();
        toggleFlag();
      } else if (/^[1-8]$/.test(e.key)) {
        const opt = current?.options[Number(e.key) - 1];
        if (opt) {
          e.preventDefault();
          choose(opt.letter);
        }
      } else if (/^[a-hA-H]$/.test(e.key)) {
        const opt = current?.options.find((o) => o.letter === e.key.toUpperCase());
        if (opt) {
          e.preventDefault();
          choose(opt.letter);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, toggleFlag, choose, current, sheetOpen, submitOpen, helpOpen]);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [index]);

  if (!id) return <ErrorBox error="缺少考试 id" />;
  if (stateQ.isLoading || questionsQ.isLoading) return <Loading text="正在准备试卷…" />;
  if (stateQ.error || questionsQ.error) {
    return <ErrorBox error={stateQ.error || questionsQ.error} onRetry={() => {
      stateQ.refetch();
      questionsQ.refetch();
    }} />;
  }
  if (attempt && attempt.status !== 'in_progress') {
    return <Navigate to={`/exam/${id}/result`} replace />;
  }
  if (!attempt || !current) {
    return <ErrorBox error="试卷没有题目，或题目已更新" />;
  }

  const unanswered = questions.filter((q) => !answers[q.id]).length;
  const timeWarn = remaining < 300;

  return (
    <div className="runner">
      <div className="runner-top card">
        <div className="runner-top-left">
          <Link to="/" className="btn btn-ghost btn-sm" title="退出后计时继续">
            ← 退出
          </Link>
          <div className="runner-paper">
            <b>{paper?.name || '考试'}</b>
            <small>
              第 {index + 1} / {questions.length} 题 · 已答 {answeredCount}
            </small>
          </div>
        </div>
        <div className={`timer ${timeWarn ? 'warn' : ''}`} aria-label="剩余时间">
          <small>剩余</small>
          <b>{fmtDuration(remaining)}</b>
        </div>
        <div className="runner-top-actions">
          <button className="btn btn-sm" onClick={() => setHelpOpen(true)}>
            快捷键
          </button>
          <button className="btn btn-sm" onClick={() => setSheetOpen(true)}>
            答题卡
          </button>
          <button className="btn btn-primary btn-sm" onClick={() => setSubmitOpen(true)}>
            交卷
          </button>
        </div>
      </div>

      <div className={`q-layout ${current.materialHtml ? 'has-material' : ''}`}>
        {current.materialHtml ? (
          <aside className="q-side">
            <MaterialBox html={current.materialHtml} />
          </aside>
        ) : null}
        <section className="q-main card">
          <QuestionMeta
            module={current.module}
            tag={current.tag}
            type={current.type}
            scorable={current.scorable}
            extra={`第 ${index + 1} / ${questions.length} 题`}
          />
          <RichHtml html={current.stemHtml} className="stem" />
          <OptionList
            question={current}
            choice={answers[current.id] || ''}
            revealed={false}
            onChange={choose}
          />
          {!current.scorable ? (
            <div className="notice">本题官方答案缺失，交卷后不计入得分。</div>
          ) : null}
        </section>
      </div>

      <div className="runner-bottom">
        <button className="btn" onClick={() => go(-1)} disabled={index === 0}>
          上一题
        </button>
        <button className={`btn ${flags.has(current.id) ? 'active' : ''}`} onClick={toggleFlag}>
          {flags.has(current.id) ? '已标记' : '标记'}
        </button>
        <button className="btn btn-primary" onClick={() => go(1)} disabled={index === questions.length - 1}>
          下一题
        </button>
      </div>

      <Modal open={sheetOpen} onClose={() => setSheetOpen(false)} title="答题卡" wide>
        <AnswerSheet
          questions={questions}
          current={index}
          answers={answers}
          flags={flags}
          onJump={(i) => {
            setIndex(i);
            setSheetOpen(false);
          }}
        />
      </Modal>

      <Modal
        open={submitOpen}
        onClose={() => setSubmitOpen(false)}
        title="确认交卷"
        footer={
          <>
            <button className="btn" onClick={() => setSubmitOpen(false)} disabled={submitting}>
              继续答题
            </button>
            <button
              className="btn btn-primary"
              onClick={() => {
                setSubmitOpen(false);
                void doSubmit();
              }}
              disabled={submitting}
            >
              {submitting ? '交卷中…' : '确认交卷'}
            </button>
          </>
        }
      >
        <div className="stack">
          <div className="submit-summary">
            <div>
              <span className="muted">未答</span>
              <b>{unanswered}</b>
            </div>
            <div>
              <span className="muted">已标记</span>
              <b>{flags.size}</b>
            </div>
            <div>
              <span className="muted">剩余时间</span>
              <b>{fmtDuration(remaining)}</b>
            </div>
          </div>
          {unanswered > 0 ? (
            <div className="notice warn">还有 {unanswered} 题未作答，交卷后按错题计。</div>
          ) : (
            <div className="notice good">全部题目已作答。</div>
          )}
        </div>
      </Modal>

      <Modal open={helpOpen} onClose={() => setHelpOpen(false)} title="键盘快捷键">
        <div className="shortcut-list">
          <div><kbd>1</kbd>–<kbd>8</kbd> / <kbd>A</kbd>–<kbd>H</kbd><span>选择选项（多选可连续按）</span></div>
          <div><kbd>←</kbd> / <kbd>→</kbd><span>上一题 / 下一题</span></div>
          <div><kbd>Enter</kbd><span>下一题</span></div>
          <div><kbd>F</kbd><span>标记本题</span></div>
        </div>
      </Modal>
    </div>
  );
}
