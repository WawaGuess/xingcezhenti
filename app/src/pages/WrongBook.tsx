import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { AllOptionReasons, OptionList, QuestionMeta } from '../components/Question';
import { QuestionFlagButton } from '../components/QuestionFlag';
import {
  EmptyState,
  ErrorBox,
  fmtDate,
  Loading,
  MaterialBox,
  RichHtml,
  Tabs,
  toast,
} from '../components/ui';
import type { WrongItem } from '../types';

function stripHtml(html: string): string {
  return html
    .replace(/<img[^>]*>/gi, ' [图片] ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function WrongCard({
  item,
  index,
  onMastered,
  onRemove,
}: {
  item: WrongItem;
  index: number;
  onMastered: (mastered: boolean) => void;
  onRemove: () => void;
}) {
  const preview = stripHtml(item.stemHtml).slice(0, 90);
  return (
    <details className="wrong-card card">
      <summary>
        <span className="wrong-index">{index}</span>
        <span className="wrong-main">
          <span className="wrong-preview">{preview || '（无题干）'}</span>
          <span className="wrong-meta">
            <span>{item.module}</span>
            <span>{item.tag}</span>
            <span>错 {item.wrongCount} 次</span>
            <span>连对 {item.correctStreak}/3</span>
            <span>{fmtDate(item.lastWrongAt)}</span>
          </span>
        </span>
        <span className={`badge ${item.mastered ? 'good' : 'bad'}`}>
          {item.mastered ? '已掌握' : '未掌握'}
        </span>
      </summary>
      <div className="wrong-body">
        {item.materialHtml ? <MaterialBox html={item.materialHtml} /> : null}
        <QuestionMeta
          module={item.module}
          tag={item.tag}
          type={item.type}
          scorable={item.scorable}
          source={item.source}
        />
        <RichHtml html={item.stemHtml} className="stem" />
        <OptionList question={item} choice="" revealed onChange={() => undefined} disabled />
        <div className="answer-line">
          <span>
            正确答案：<b>{item.scorable ? item.answer || '缺失' : '不可判分'}</b>
          </span>
        </div>
        <AllOptionReasons optionReasons={item.optionReasons} answer={item.answer} />
        {item.analysisHtml ? (
          <div className="analysis">
            <h4>官方解析</h4>
            <RichHtml html={item.analysisHtml} />
          </div>
        ) : (
          <div className="muted">暂无官方解析</div>
        )}
        <div className="wrong-actions">
          <button className="btn btn-sm" onClick={() => onMastered(!item.mastered)}>
            {item.mastered ? '标记为未掌握' : '标记已掌握'}
          </button>
          <QuestionFlagButton questionId={item.id} />
          <button className="btn btn-sm btn-danger" onClick={onRemove}>
            移出错题本
          </button>
        </div>
      </div>
    </details>
  );
}

export default function WrongBook() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [mastered, setMastered] = useState<0 | 1>(0);
  const [module, setModule] = useState('');
  const [limit, setLimit] = useState(50);

  const filtersQ = useQuery({ queryKey: ['filters'], queryFn: api.filters });
  const wrongQ = useQuery({
    queryKey: ['wrong-book', module, mastered, limit],
    queryFn: () => api.wrongBook({ module: module || undefined, mastered, limit }),
  });

  const update = useMutation({
    mutationFn: ({ id, mastered: m }: { id: string; mastered: boolean }) => api.updateWrong(id, m),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['wrong-book'] });
      qc.invalidateQueries({ queryKey: ['wrong-count'] });
      qc.invalidateQueries({ queryKey: ['overview'] });
    },
    onError: (e) => toast(e instanceof Error ? e.message : '操作失败'),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.deleteWrong(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['wrong-book'] });
      qc.invalidateQueries({ queryKey: ['wrong-count'] });
      qc.invalidateQueries({ queryKey: ['overview'] });
    },
    onError: (e) => toast(e instanceof Error ? e.message : '移除失败'),
  });

  const startPractice = useMutation({
    mutationFn: (count: number) =>
      api.createPractice({ kind: 'wrong', count, shuffle: true, immediate: true }),
    onSuccess: (data) => navigate(`/practice/${data.session.id}`),
    onError: (e) => toast(e instanceof Error ? e.message : '创建练习失败'),
  });

  const modules = useMemo(() => filtersQ.data?.modules ?? [], [filtersQ.data]);

  if (wrongQ.isLoading) return <Loading text="正在加载错题本…" />;
  if (wrongQ.error) return <ErrorBox error={wrongQ.error} onRetry={() => wrongQ.refetch()} />;

  const data = wrongQ.data!;
  const hasMore = data.items.length < data.total;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <span className="eyebrow">错题本</span>
          <h1>把错题变成得分</h1>
          <p className="muted">
            当前筛选下 {data.total} 道题。答错自动收录，连续答对 3 次会自动标记已掌握，也可以手动调整。
          </p>
        </div>
        <div className="page-actions">
          {data.total > 0 ? (
            <>
              <button
                className="btn"
                onClick={() => startPractice.mutate(20)}
                disabled={startPractice.isPending}
              >
                重练 20 题
              </button>
              <button
                className="btn btn-primary"
                onClick={() => startPractice.mutate(0)}
                disabled={startPractice.isPending}
              >
                {startPractice.isPending ? '创建中…' : '重练全部'}
              </button>
            </>
          ) : (
            <Link className="btn btn-primary" to="/practice/new">
              去练习
            </Link>
          )}
        </div>
      </div>

      <div className="filter-bar">
        <label className="field">
          <span>模块</span>
          <select value={module} onChange={(e) => setModule(e.target.value)}>
            <option value="">全部模块</option>
            {modules.map((m) => (
              <option key={m.module} value={m.module}>
                {m.module}
              </option>
            ))}
          </select>
        </label>
        <div className="grow" />
        <Tabs
          value={mastered === 0 ? 'todo' : 'done'}
          onChange={(v) => {
            setMastered(v === 'done' ? 1 : 0);
            setLimit(50);
          }}
          items={[
            { key: 'todo', label: '未掌握' },
            { key: 'done', label: '已掌握' },
          ]}
        />
      </div>

      {data.items.length === 0 ? (
        <EmptyState
          title={mastered ? '还没有已掌握的题' : '这个范围没有错题'}
          desc={mastered ? '在未掌握列表里标记后会出现在这里。' : '去考试或练习，答错的题会自动进来。'}
          action={
            <Link className="btn btn-primary" to="/practice/new">
              开始练习
            </Link>
          }
        />
      ) : (
        <div className="wrong-list">
          {data.items.map((item, i) => (
            <WrongCard
              key={item.id}
              item={item}
              index={i + 1}
              onMastered={(m) => update.mutate({ id: item.id, mastered: m })}
              onRemove={() => {
                if (window.confirm('确定把这道题移出错题本？')) remove.mutate(item.id);
              }}
            />
          ))}
        </div>
      )}

      {hasMore ? (
        <div className="center">
          <button className="btn" onClick={() => setLimit((n) => Math.min(n + 50, 500))}>
            加载更多（已显示 {data.items.length}/{data.total}）
          </button>
        </div>
      ) : null}
    </div>
  );
}
