import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import {
  EmptyState,
  ErrorBox,
  fmtDate,
  Loading,
  RichHtml,
  toast,
  typeLabel,
} from '../components/ui';

export default function Flags() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const flagsQ = useQuery({ queryKey: ['question-flags'], queryFn: api.questionFlags });

  const practice = useMutation({
    mutationFn: (questionId: string) =>
      api.createPractice({ kind: 'question', questionId, immediate: true }),
    onSuccess: (data) => navigate(`/practice/${data.session.id}`),
    onError: (e) => toast(e instanceof Error ? e.message : '创建练习失败'),
  });

  const remove = useMutation({
    mutationFn: (questionId: string) => api.deleteQuestionFlag(questionId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['question-flags'] });
      toast('已删除标记', 'success');
    },
    onError: (e) => toast(e instanceof Error ? e.message : '删除失败'),
  });

  if (flagsQ.isLoading) return <Loading text="正在加载疑问标记…" />;
  if (flagsQ.error) return <ErrorBox error={flagsQ.error} onRetry={() => flagsQ.refetch()} />;
  const data = flagsQ.data!;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <span className="eyebrow">我的疑问</span>
          <h1>标记过的题目</h1>
          <p className="muted">
            做题时点「题目有问题」会记在这里，只保存在你的成员数据里，不会改题库原文。
          </p>
        </div>
        <div className="page-actions">
          <Link to="/stats" className="btn">
            返回统计
          </Link>
          <Link to="/practice/new" className="btn btn-primary">
            去练习
          </Link>
        </div>
      </div>

      {data.items.length === 0 ? (
        <EmptyState
          title="还没有疑问标记"
          desc="在考试解析、练习解析或错题本里点「题目有问题」就可以标记。"
          action={
            <Link className="btn btn-primary" to="/practice/new">
              开始练习
            </Link>
          }
        />
      ) : (
        <div className="flags-list">
          {data.items.map((item) => (
            <article key={item.id} className="flag-card card">
              <div className="flag-head">
                <div className="search-meta">
                  <span className="q-module">{item.module}</span>
                  <span>{item.tag}</span>
                  <span>{typeLabel(item.type)}</span>
                  {!item.scorable ? <span className="badge warn">答案缺失</span> : null}
                  {item.source ? (
                    <span className="search-source">
                      {item.source.year} · {item.source.province}
                    </span>
                  ) : null}
                </div>
                <span className="muted flag-date">{fmtDate(item.createdAt)}</span>
              </div>
              <div className="flag-stem">
                <RichHtml html={item.stemHtml} />
              </div>
              {item.note ? (
                <div className="flag-note">
                  <b>你的备注</b>
                  <p>{item.note}</p>
                </div>
              ) : (
                <div className="muted">没有填写备注。</div>
              )}
              <div className="flag-actions">
                <button
                  className="btn btn-sm btn-primary"
                  onClick={() => practice.mutate(item.id)}
                  disabled={practice.isPending}
                >
                  {practice.isPending && practice.variables === item.id ? '准备中…' : '练这道'}
                </button>
                <button
                  className="btn btn-sm btn-danger"
                  onClick={() => remove.mutate(item.id)}
                  disabled={remove.isPending}
                >
                  删除标记
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
