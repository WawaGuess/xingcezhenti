import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { ReviewItem } from '../components/Question';
import {
  Badge,
  EmptyState,
  ErrorBox,
  fmtDuration,
  Loading,
  ProgressBar,
  Stat,
  Tabs,
  toast,
} from '../components/ui';

type Filter = 'all' | 'wrong' | 'unanswered' | 'flagged';

export default function ExamResult() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const reviewQ = useQuery({
    queryKey: ['exam-review', id],
    queryFn: () => api.reviewExam(id!),
    enabled: !!id,
  });
  const [filter, setFilter] = useState<Filter>('wrong');
  const filterInit = useRef(false);

  useEffect(() => {
    if (filterInit.current || !reviewQ.data) return;
    filterInit.current = true;
    const qs = reviewQ.data.questions;
    const wrong = qs.filter((q) => q.isCorrect === false).length;
    const unanswered = qs.filter((q) => q.scorable && !q.choice).length;
    if (wrong > 0) setFilter('wrong');
    else if (unanswered > 0) setFilter('unanswered');
    else setFilter('all');
  }, [reviewQ.data]);

  const retake = useMutation({
    mutationFn: () => {
      const attempt = reviewQ.data!.attempt;
      return api.createExam(attempt.paperId, attempt.durationSec);
    },
    onSuccess: (data) => navigate(`/exam/${data.attempt.id}`),
    onError: (e) => toast(e instanceof Error ? e.message : '创建失败'),
  });

  const counts = useMemo(() => {
    const qs = reviewQ.data?.questions ?? [];
    return {
      all: qs.length,
      wrong: qs.filter((q) => q.isCorrect === false).length,
      unanswered: qs.filter((q) => q.scorable && !q.choice).length,
      flagged: qs.filter((q) => q.flagged).length,
    };
  }, [reviewQ.data]);

  const filtered = useMemo(() => {
    const qs = reviewQ.data?.questions ?? [];
    if (filter === 'all') return qs;
    if (filter === 'wrong') return qs.filter((q) => q.isCorrect === false);
    if (filter === 'unanswered') return qs.filter((q) => q.scorable && !q.choice);
    return qs.filter((q) => q.flagged);
  }, [reviewQ.data, filter]);

  if (reviewQ.isLoading) return <Loading text="正在生成成绩单…" />;
  if (reviewQ.error) return <ErrorBox error={reviewQ.error} onRetry={() => reviewQ.refetch()} />;
  const data = reviewQ.data!;
  const attempt = data.attempt;
  const scored = attempt.scoredTotal;
  const accuracy = scored ? Math.round((attempt.correctCount / scored) * 1000) / 10 : 0;
  const unanswered = data.questions.filter((q) => q.scorable && !q.choice).length;
  const expired = attempt.status === 'expired';

  return (
    <div className="page result-page">
      <div className="page-head">
        <div>
          <span className="eyebrow">成绩单</span>
          <h1>{data.paper?.name || '试卷已更新'}</h1>
          <div className="muted">
            {data.paper ? `${data.paper.year} · ${data.paper.province} · ` : ''}
            {expired ? '超时自动交卷' : '已交卷'} · 用时 {fmtDuration(attempt.elapsedSec)}
          </div>
        </div>
        <div className="page-actions">
          <Link to="/" className="btn">
            返回首页
          </Link>
          <button className="btn btn-primary" onClick={() => retake.mutate()} disabled={retake.isPending}>
            {retake.isPending ? '创建中…' : '再考一次'}
          </button>
        </div>
      </div>

      <section className="score-hero card">
        <div className="score-main">
          <div className="score-num">
            <b>{attempt.correctCount}</b>
            <span>/ {scored}</span>
          </div>
          <div className="score-sub">
            <Badge tone={accuracy >= 60 ? 'good' : 'warn'}>正确率 {accuracy}%</Badge>
            {expired ? <Badge tone="warn">超时交卷</Badge> : null}
            {unanswered > 0 ? <Badge tone="neutral">未答 {unanswered}</Badge> : null}
          </div>
        </div>
        <div className="score-stats">
          <Stat label="总题数" value={attempt.total} />
          <Stat label="计分题" value={scored} sub="缺答案题不计分" />
          <Stat label="用时" value={fmtDuration(attempt.elapsedSec)} />
        </div>
      </section>

      <section className="section card module-score">
        <h2>模块得分</h2>
        <div className="module-bars">
          {data.byModule.map((m) => {
            const rate = m.scored ? Math.round((m.correct / m.scored) * 1000) / 10 : 0;
            return (
              <div key={m.module} className="module-bar">
                <div className="module-bar-head">
                  <span>{m.module}</span>
                  <b>
                    {m.correct} / {m.scored}
                    <em>{rate}%</em>
                  </b>
                </div>
                <ProgressBar value={m.correct} max={m.scored} tone={rate >= 60 ? 'good' : 'bad'} />
              </div>
            );
          })}
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <h2>逐题解析</h2>
          <span className="muted">点开题目查看你的答案、正确答案和官方解析</span>
        </div>
        <Tabs
          value={filter}
          onChange={setFilter}
          items={[
            { key: 'wrong', label: '错题', count: counts.wrong },
            { key: 'unanswered', label: '未答', count: counts.unanswered },
            { key: 'flagged', label: '标记', count: counts.flagged },
            { key: 'all', label: '全部', count: counts.all },
          ]}
        />
        {filtered.length === 0 ? (
          <EmptyState title={filter === 'wrong' ? '没有错题' : '没有符合条件的题目'} desc="切换上方的分类看看。" />
        ) : (
          <div className="review-list">
            {filtered.map((q) => (
              <ReviewItem key={q.id} q={q} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
