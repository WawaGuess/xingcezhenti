import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api';
import { ReviewItem } from '../components/Question';
import {
  Badge,
  EmptyState,
  ErrorBox,
  fmtDuration,
  Loading,
  Stat,
  Tabs,
} from '../components/ui';

export default function PracticeResult() {
  const { id } = useParams<{ id: string }>();
  const [scope, setScope] = useState<'wrong' | 'all'>('wrong');

  const sessionQ = useQuery({
    queryKey: ['practice', id],
    queryFn: () => api.getPractice(id!),
    enabled: !!id,
  });
  const reviewQ = useQuery({
    queryKey: ['practice-review', id, scope],
    queryFn: () => api.reviewPractice(id!, scope),
    enabled: !!id,
  });

  const session = reviewQ.data?.session || sessionQ.data?.session;
  const items = useMemo(() => reviewQ.data?.items ?? [], [reviewQ.data]);

  if (sessionQ.isLoading || reviewQ.isLoading) return <Loading text="正在生成练习结果…" />;
  if (sessionQ.error) return <ErrorBox error={sessionQ.error} onRetry={() => sessionQ.refetch()} />;
  if (reviewQ.error) return <ErrorBox error={reviewQ.error} onRetry={() => reviewQ.refetch()} />;
  if (!session) return <ErrorBox error="练习不存在" />;

  const accuracy = session.answered
    ? Math.round((session.correct / session.answered) * 1000) / 10
    : 0;

  return (
    <div className="page result-page">
      <div className="page-head">
        <div>
          <span className="eyebrow">练习结果</span>
          <h1>{session.title}</h1>
          <div className="muted">
            用时 {fmtDuration(session.elapsedSec)} · {session.finishedAt ? '已结束' : '进行中'}
          </div>
        </div>
        <div className="page-actions">
          <Link to="/practice/new" className="btn">
            再练一组
          </Link>
          <Link to="/wrong" className="btn btn-primary">
            去错题本
          </Link>
        </div>
      </div>

      <section className="score-hero card">
        <div className="score-main">
          <div className="score-num">
            <b>{session.correct}</b>
            <span>/ {session.answered}</span>
          </div>
          <div className="score-sub">
            <Badge tone={accuracy >= 60 ? 'good' : 'warn'}>正确率 {accuracy}%</Badge>
            <Badge tone="bad">错题 {session.wrong}</Badge>
            <Badge tone="neutral">总题 {session.total}</Badge>
          </div>
        </div>
        <div className="score-stats">
          <Stat label="已答" value={session.answered} />
          <Stat label="正确" value={session.correct} />
          <Stat label="用时" value={fmtDuration(session.elapsedSec)} />
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <h2>题目回顾</h2>
          <span className="muted">错题已自动收进错题本</span>
        </div>
        <Tabs
          value={scope}
          onChange={setScope}
          items={[
            { key: 'wrong', label: '错题', count: session.wrong },
            { key: 'all', label: '全部已加载' },
          ]}
        />
        {items.length === 0 ? (
          <EmptyState
            title={scope === 'wrong' ? '这组练习没有错题' : '暂无题目'}
            desc={scope === 'wrong' ? '继续保持。' : '换一组题再试试。'}
          />
        ) : (
          <div className="review-list">
            {items.map((q) => (
              <ReviewItem key={`${q.id}-${q.ordinal}`} q={q} />
            ))}
          </div>
        )}
        {scope === 'all' && items.length >= 200 ? (
          <div className="muted">「全部」最多展示 200 题。</div>
        ) : null}
      </section>
    </div>
  );
}
