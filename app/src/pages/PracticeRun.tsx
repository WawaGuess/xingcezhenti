import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { OptionList, QuestionMeta, WrongReason } from '../components/Question';
import { QuestionFlagButton } from '../components/QuestionFlag';
import {
  AnswerSheet,
  EmptyState,
  ErrorBox,
  fmtDuration,
  Loading,
  MaterialBox,
  Modal,
  ProgressBar,
  RichHtml,
  toast,
  useElapsed,
} from '../components/ui';
import type { PracticeQuestion } from '../types';

type AnswerState = { choice: string; revealed: boolean; isCorrect: boolean | null };

export default function PracticeRun() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const sessionQ = useQuery({
    queryKey: ['practice', id],
    queryFn: () => api.getPractice(id!),
    enabled: !!id,
  });
  const pagesQ = useInfiniteQuery({
    queryKey: ['practice-questions', id],
    queryFn: ({ pageParam }) => api.getPracticeQuestions(id!, pageParam as number, 50),
    initialPageParam: 0,
    getNextPageParam: (last) =>
      last.offset + last.items.length < last.total ? last.offset + last.items.length : undefined,
    enabled: !!id,
  });

  const items = useMemo(
    () => pagesQ.data?.pages.flatMap((p) => p.items) ?? [],
    [pagesQ.data],
  );
  const session = sessionQ.data?.session;
  const indexList = sessionQ.data?.index ?? [];
  const total = session?.total ?? pagesQ.data?.pages[0]?.total ?? 0;

  const [states, setStates] = useState<Record<string, AnswerState>>({});
  const [index, setIndex] = useState(() => {
    if (!id) return 0;
    try {
      const n = Number(localStorage.getItem(`xczt.practice.pos.${id}`));
      return Number.isInteger(n) && n >= 0 ? n : 0;
    } catch {
      return 0;
    }
  });
  const posInit = useRef(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [finishOpen, setFinishOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [finishing, setFinishing] = useState(false);

  useEffect(() => {
    if (!items.length) return;
    setStates((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const it of items) {
        if (!(it.id in next)) {
          next[it.id] = { choice: it.choice, revealed: it.revealed, isCorrect: it.isCorrect };
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [items]);

  useEffect(() => {
    if (posInit.current || !session || !items.length) return;
    posInit.current = true;
    try {
      const stored = Number(localStorage.getItem(`xczt.practice.pos.${id}`));
      if (!(Number.isInteger(stored) && stored >= 0 && stored < total)) setIndex(0);
    } catch {
      setIndex(0);
    }
  }, [session, items.length, total, id]);

  useEffect(() => {
    if (!id) return;
    try {
      localStorage.setItem(`xczt.practice.pos.${id}`, String(index));
    } catch {
      /* ignore */
    }
  }, [id, index]);

  useEffect(() => {
    if (!pagesQ.hasNextPage || pagesQ.isFetchingNextPage) return;
    if (index >= items.length - 8) {
      void pagesQ.fetchNextPage();
    }
  }, [index, items.length, pagesQ.hasNextPage, pagesQ.isFetchingNextPage, pagesQ.fetchNextPage]);

  const current = items[index];
  const currentState =
    (current && states[current.id]) || { choice: '', revealed: false, isCorrect: null as boolean | null };
  const elapsed = useElapsed(session?.createdAt, session?.serverNow, session?.finishedAt);

  const answered = useMemo(
    () => Object.values(states).filter((s) => s.revealed && s.choice).length,
    [states],
  );
  const correct = useMemo(
    () => Object.values(states).filter((s) => s.revealed && s.isCorrect === true).length,
    [states],
  );
  const wrong = useMemo(
    () => Object.values(states).filter((s) => s.revealed && s.isCorrect === false).length,
    [states],
  );

  const answersMap = useMemo(() => {
    const m: Record<string, string> = {};
    for (const [k, s] of Object.entries(states)) if (s.choice) m[k] = s.choice;
    return m;
  }, [states]);
  const resultsMap = useMemo(() => {
    const m: Record<string, boolean | null> = {};
    for (const [k, s] of Object.entries(states)) if (s.revealed) m[k] = s.isCorrect;
    return m;
  }, [states]);

  const patch = useCallback(
    async (q: PracticeQuestion, nextChoice: string, reveal: boolean) => {
      if (!id) return;
      try {
        const res = await api.savePracticeAnswer(id, q.id, nextChoice, reveal);
        setStates((prev) => {
          const cur = prev[q.id] || { choice: nextChoice, revealed: false, isCorrect: null };
          return {
            ...prev,
            [q.id]: {
              choice: cur.choice,
              revealed: reveal ? true : cur.revealed,
              isCorrect:
                reveal && cur.choice === nextChoice
                  ? res.isCorrect == null
                    ? null
                    : !!res.isCorrect
                  : cur.isCorrect,
            },
          };
        });
      } catch (e) {
        toast(e instanceof Error ? e.message : '保存失败');
      }
    },
    [id],
  );

  const choose = useCallback(
    (letter: string) => {
      if (!current || currentState.revealed || !session) return;
      let next: string;
      if (current.type === 'multi') {
        const set = new Set(currentState.choice.split(''));
        if (set.has(letter)) set.delete(letter);
        else set.add(letter);
        next = [...set].sort().join('');
      } else {
        if (currentState.choice === letter) return;
        next = letter;
      }
      setStates((prev) => ({
        ...prev,
        [current.id]: { ...currentState, choice: next },
      }));
      const revealNow = session.immediate && current.type !== 'multi';
      void patch(current, next, revealNow);
    },
    [current, currentState, session, patch],
  );

  const confirmMulti = useCallback(() => {
    if (!current || currentState.revealed || !currentState.choice) return;
    void patch(current, currentState.choice, true);
  }, [current, currentState, patch]);

  const revealAnswer = useCallback(() => {
    if (!current || currentState.revealed) return;
    void patch(current, currentState.choice, true);
  }, [current, currentState, patch]);

  const go = useCallback(
    (delta: number) => {
      setIndex((i) => Math.max(0, Math.min(total - 1, i + delta)));
    },
    [total],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (sheetOpen || finishOpen || helpOpen) return;
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        go(-1);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        go(1);
      } else if (e.key === 'Enter') {
        if (tag === 'BUTTON') return;
        e.preventDefault();
        if (current?.type === 'multi' && !currentState.revealed && currentState.choice) confirmMulti();
        else go(1);
      } else if (e.key.toLowerCase() === 'r') {
        if (!currentState.revealed) {
          e.preventDefault();
          revealAnswer();
        }
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
  }, [go, choose, confirmMulti, revealAnswer, current, currentState.revealed, currentState.choice, sheetOpen, finishOpen, helpOpen]);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [index]);

  const finish = async () => {
    if (!id) return;
    setFinishing(true);
    try {
      await api.finishPractice(id);
      try {
        localStorage.removeItem(`xczt.practice.pos.${id}`);
      } catch {
        /* ignore */
      }
      navigate(`/practice/${id}/result`, { replace: true });
    } catch (e) {
      setFinishing(false);
      toast(e instanceof Error ? e.message : '结束练习失败');
    }
  };

  if (!id) return <ErrorBox error="缺少练习 id" />;
  if (sessionQ.isLoading || pagesQ.isLoading) return <Loading text="正在准备练习题…" />;
  if (sessionQ.error) return <ErrorBox error={sessionQ.error} onRetry={() => sessionQ.refetch()} />;
  if (pagesQ.error) return <ErrorBox error={pagesQ.error} onRetry={() => pagesQ.refetch()} />;
  if (session?.finishedAt) return <Navigate to={`/practice/${id}/result`} replace />;
  if (!session) return <ErrorBox error="练习不存在" />;

  if (!current) {
    if (pagesQ.hasNextPage) return <Loading text="正在加载题目…" />;
    return (
      <div className="page">
        <EmptyState title="没有题目" desc="这个练习可能已经更新，请重新创建。" />
      </div>
    );
  }

  const sheetQuestions =
    indexList.length > 0
      ? indexList
      : items.map((q) => ({ id: q.id, ordinal: q.ordinal, module: q.module }));

  return (
    <div className="runner">
      <div className="runner-top card">
        <div className="runner-top-left">
          <Link to="/practice/new" className="btn btn-ghost btn-sm">
            ← 退出
          </Link>
          <div className="runner-paper">
            <b>{session.title}</b>
            <small>
              第 {current.ordinal} / {total} 题 · 已答 {answered} · 正确 {correct}
            </small>
          </div>
        </div>
        <div className="timer" aria-label="已用时间">
          <small>用时</small>
          <b>{fmtDuration(elapsed)}</b>
        </div>
        <div className="runner-top-actions">
          <button className="btn btn-sm" onClick={() => setHelpOpen(true)}>
            快捷键
          </button>
          <button className="btn btn-sm" onClick={() => setSheetOpen(true)}>
            答题卡
          </button>
          <button className="btn btn-primary btn-sm" onClick={() => setFinishOpen(true)}>
            结束
          </button>
        </div>
      </div>

      <div className="practice-progress">
        <ProgressBar value={answered} max={total} />
        <span className="muted">
          {answered}/{total} 已答 · 正确率 {answered ? Math.round((correct / answered) * 1000) / 10 : 0}%
        </span>
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
            source={session.kind === 'paper' ? null : current.source}
            extra={`第 ${current.ordinal} / ${total} 题`}
          />
          <RichHtml html={current.stemHtml} className="stem" />
          <OptionList
            question={current}
            choice={currentState.choice}
            revealed={currentState.revealed}
            onChange={choose}
            disabled={currentState.revealed}
          />

          {!currentState.revealed ? (
            <div className="practice-actions">
              {current.type === 'multi' ? (
                <button
                  className="btn btn-primary"
                  onClick={confirmMulti}
                  disabled={!currentState.choice}
                >
                  确认答案
                </button>
              ) : session.immediate ? null : (
                <button className="btn" onClick={revealAnswer}>
                  查看答案
                </button>
              )}
              {current.type === 'multi' && !currentState.choice ? (
                <span className="muted">多选题：选好后点「确认答案」</span>
              ) : null}
            </div>
          ) : (
            <div className="reveal-box">
              <div className={`answer-line ${currentState.isCorrect === true ? 'good' : currentState.isCorrect === false ? 'bad' : ''}`}>
                <span>
                  你的答案：<b>{currentState.choice || '未作答'}</b>
                </span>
                <span>
                  正确答案：<b>{current.scorable ? current.answer || '缺失' : '不可判分'}</b>
                </span>
                {currentState.isCorrect === true ? <b className="good">答对了</b> : null}
                {currentState.isCorrect === false ? <b className="bad">答错了</b> : null}
                {!current.scorable ? <b className="muted">本题不计分</b> : null}
              </div>
              <WrongReason
                choice={currentState.choice}
                answer={current.answer}
                optionReasons={current.optionReasons}
              />
              {current.analysisHtml ? (
                <div className="analysis">
                  <h4>官方解析</h4>
                  <RichHtml html={current.analysisHtml} />
                </div>
              ) : (
                <div className="muted">暂无官方解析</div>
              )}
              <div className="review-foot">
                <QuestionFlagButton questionId={current.id} />
              </div>
            </div>
          )}
        </section>
      </div>

      <div className="runner-bottom">
        <button className="btn" onClick={() => go(-1)} disabled={index === 0}>
          上一题
        </button>
        <button
          className="btn"
          onClick={() => {
            if (!currentState.revealed) revealAnswer();
          }}
          disabled={currentState.revealed}
        >
          {currentState.revealed ? '已看答案' : '查看答案'}
        </button>
        <button className="btn btn-primary" onClick={() => go(1)} disabled={index >= total - 1}>
          下一题
        </button>
      </div>

      <Modal open={sheetOpen} onClose={() => setSheetOpen(false)} title="答题卡" wide>
        <AnswerSheet
          questions={sheetQuestions}
          current={index}
          answers={answersMap}
          flags={new Set()}
          results={resultsMap}
          onJump={(i) => {
            setIndex(i);
            setSheetOpen(false);
          }}
        />
      </Modal>

      <Modal
        open={finishOpen}
        onClose={() => setFinishOpen(false)}
        title="结束练习"
        footer={
          <>
            <button className="btn" onClick={() => setFinishOpen(false)} disabled={finishing}>
              继续练习
            </button>
            <button className="btn btn-primary" onClick={finish} disabled={finishing}>
              {finishing ? '结算中…' : '结束并看结果'}
            </button>
          </>
        }
      >
        <div className="submit-summary">
          <div>
            <span className="muted">已答</span>
            <b>{answered}</b>
          </div>
          <div>
            <span className="muted">正确</span>
            <b>{correct}</b>
          </div>
          <div>
            <span className="muted">错误</span>
            <b>{wrong}</b>
          </div>
          <div>
            <span className="muted">正确率</span>
            <b>{answered ? Math.round((correct / answered) * 1000) / 10 : 0}%</b>
          </div>
        </div>
      </Modal>

      <Modal open={helpOpen} onClose={() => setHelpOpen(false)} title="键盘快捷键">
        <div className="shortcut-list">
          <div><kbd>1</kbd>–<kbd>8</kbd> / <kbd>A</kbd>–<kbd>H</kbd><span>选择选项（多选可连续按）</span></div>
          <div><kbd>←</kbd> / <kbd>→</kbd><span>上一题 / 下一题</span></div>
          <div><kbd>Enter</kbd><span>多选确认 / 下一题</span></div>
          <div><kbd>R</kbd><span>查看答案</span></div>
        </div>
      </Modal>
    </div>
  );
}
