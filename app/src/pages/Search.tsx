import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import {
  EmptyState,
  ErrorBox,
  Loading,
  toast,
  typeLabel,
} from '../components/ui';

const EXAMPLES = ['基期量', '惟妙惟肖', '刑事责任年龄', '图形推理', '增长率'];

function Highlight({ text }: { text: string }) {
  const parts = text.split(/[\u0001\u0002]/);
  return (
    <>
      {parts.map((p, i) =>
        i % 2 === 1 ? <mark key={i}>{p}</mark> : <span key={i}>{p}</span>,
      )}
    </>
  );
}

export default function Search() {
  const navigate = useNavigate();
  const [input, setInput] = useState('');
  const [q, setQ] = useState('');

  const searchQ = useQuery({
    queryKey: ['search', q],
    queryFn: () => api.search(q),
    enabled: q.length > 0,
  });

  const practice = useMutation({
    mutationFn: (questionId: string) =>
      api.createPractice({ kind: 'question', questionId, immediate: true }),
    onSuccess: (data) => navigate(`/practice/${data.session.id}`),
    onError: (e) => toast(e instanceof Error ? e.message : '创建练习失败'),
  });

  const submit = (value: string) => {
    const next = value.trim();
    setInput(next);
    setQ(next);
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <span className="eyebrow">题库搜索</span>
          <h1>找题、查解析</h1>
          <p className="muted">
            搜索题干和官方解析；找到题后可以直接开一道单题练习，答题后看完整解析。
          </p>
        </div>
      </div>

      <form
        className="search-form card"
        onSubmit={(e) => {
          e.preventDefault();
          submit(input);
        }}
      >
        <input
          className="search-input"
          type="search"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="输入关键词，如「基期量」「惟妙惟肖」"
          autoFocus
        />
        <button className="btn btn-primary" type="submit" disabled={!input.trim() || searchQ.isFetching}>
          {searchQ.isFetching ? '搜索中…' : '搜索'}
        </button>
      </form>

      {!q ? (
        <div className="search-intro card">
          <b>试试这些关键词</b>
          <div className="example-chips">
            {EXAMPLES.map((x) => (
              <button key={x} className="tag-chip" onClick={() => submit(x)}>
                {x}
              </button>
            ))}
          </div>
          <p className="muted">
            搜索范围是当前 27,473 道去重后的题目；同一道题跨省重复出现只展示一次。
          </p>
        </div>
      ) : null}

      {searchQ.isLoading ? <Loading text="正在搜索题库…" /> : null}
      {searchQ.error ? <ErrorBox error={searchQ.error} onRetry={() => searchQ.refetch()} /> : null}

      {searchQ.data ? (
        <section className="section">
          <div className="section-head">
            <h2>搜索结果</h2>
            <span className="muted">
              {searchQ.data.items.length} 条{searchQ.data.truncated ? '（已截断）' : ''}
            </span>
          </div>
          {searchQ.data.items.length === 0 ? (
            <EmptyState
              title="没有找到相关题目"
              desc="换一个更短的关键词，或试试题干里更确定的词。"
            />
          ) : (
            <div className="search-list">
              {searchQ.data.items.map((item) => (
                <article key={item.id} className="search-item card">
                  <div className="search-meta">
                    <span className="q-module">{item.module}</span>
                    <span>{item.tag}</span>
                    <span>{typeLabel(item.type)}</span>
                    {!item.scorable ? <span className="badge warn">答案缺失</span> : null}
                    {item.source ? (
                      <span className="search-source">
                        {item.source.year} · {item.source.province} · {item.source.name}
                      </span>
                    ) : null}
                    {!item.inStem ? <span className="badge neutral">解析中匹配</span> : null}
                  </div>
                  <p className="search-snippet">
                    <Highlight text={item.snippet} />
                  </p>
                  <div className="search-actions">
                    <button
                      className="btn btn-sm btn-primary"
                      onClick={() => practice.mutate(item.id)}
                      disabled={practice.isPending}
                    >
                      {practice.isPending && practice.variables === item.id ? '准备中…' : '练这道'}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}
