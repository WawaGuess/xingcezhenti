import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../api';
import {
  Badge,
  ErrorBox,
  fmtDuration,
  Loading,
  ProgressBar,
  Stat,
} from '../components/ui';

export default function Home() {
  const overviewQ = useQuery({ queryKey: ['overview'], queryFn: api.overview });
  const filtersQ = useQuery({ queryKey: ['filters'], queryFn: api.filters });

  if (overviewQ.isLoading) return <Loading text="正在打开题库…" />;
  if (overviewQ.error) return <ErrorBox error={overviewQ.error} onRetry={() => overviewQ.refetch()} />;

  const ov = overviewQ.data!;
  const tags = filtersQ.data?.tags?.slice(0, 10) ?? [];
  return (
    <div className="page home">
      <section className="hero card">
        <div className="hero-copy">
          <span className="eyebrow">公务员 · 行测 · 2016–2026</span>
          <h1>把真题刷成自己的</h1>
          <p>
            515 套卷、58,890 道真题。考试模式仿真计时，练习模式按套卷或题型逐个突破，
            错题自动收进错题本。
          </p>
          <div className="hero-actions">
            <Link className="btn btn-primary btn-lg" to="/exam/new">
              开始考试
            </Link>
            <Link className="btn btn-lg" to="/practice/new">
              开始练习
            </Link>
          </div>
        </div>
        <div className="hero-stats">
          <Stat label="套卷" value={ov.counts.papers} sub="2016–2026" />
          <Stat label="唯一题" value={ov.counts.questions.toLocaleString()} sub={`${ov.counts.occurrences.toLocaleString()} 题次`} />
          <Stat label="错题" value={ov.wrongCount} sub="待掌握" />
        </div>
      </section>

      {ov.activeAttempts.length > 0 ? (
        <section className="section">
          <div className="section-head">
            <h2>继续考试</h2>
            <span className="muted">退出后计时继续</span>
          </div>
          <div className="continue-list">
            {ov.activeAttempts.map((a) => {
              const remain = Math.max(0, Math.floor((a.deadlineAt - a.serverNow) / 1000));
              return (
                <Link key={a.id} to={`/exam/${a.id}`} className="continue-card card">
                  <div className="continue-main">
                    <b>{a.paperName || '试卷已更新'}</b>
                    <span className="muted">
                      {a.year} · {a.province} · {a.answered ?? 0}/{a.total} 题
                    </span>
                  </div>
                  <div className={`continue-time ${remain < 300 ? 'warn' : ''}`}>
                    <small>剩余</small>
                    <b>{fmtDuration(remain)}</b>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      ) : null}

      {ov.activePractice.length > 0 ? (
        <section className="section">
          <div className="section-head">
            <h2>继续练习</h2>
          </div>
          <div className="continue-list">
            {ov.activePractice.map((s) => (
              <Link key={s.id} to={`/practice/${s.id}`} className="continue-card card">
                <div className="continue-main">
                  <b>{s.title}</b>
                  <span className="muted">
                    已答 {s.answered}/{s.total} 题
                  </span>
                  <ProgressBar value={s.answered} max={s.total} />
                </div>
                <span className="btn btn-sm">继续</span>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      <section className="section">
        <div className="section-head">
          <h2>两种模式</h2>
        </div>
        <div className="mode-grid">
          <Link to="/exam/new" className="mode-card card">
            <span className="mode-icon">⏱</span>
            <h3>考试模式</h3>
            <p>按年份 / 地区选一套完整真题，倒计时、答题卡、交卷后逐题解析。</p>
            <span className="mode-link">进入考试 →</span>
          </Link>
          <Link to="/practice/new" className="mode-card card">
            <span className="mode-icon">📖</span>
            <h3>练习模式</h3>
            <p>按套卷或按题型抽题，选完立即判题；错题自动收录，随时重练。</p>
            <span className="mode-link">进入练习 →</span>
          </Link>
          <Link to="/wrong" className="mode-card card">
            <span className="mode-icon">✎</span>
            <h3>错题本</h3>
            <p>考试和练习答错的题都会进来，按模块筛选，标记已掌握。</p>
            <span className="mode-link">查看错题 →</span>
          </Link>
        </div>
      </section>

      {tags.length > 0 ? (
        <section className="section">
          <div className="section-head">
            <h2>按题型快速练习</h2>
            <Link to="/practice/new" className="link">
              全部题型
            </Link>
          </div>
          <div className="tag-cloud">
            {tags.map((t) => (
              <Link
                key={`${t.module}-${t.tag}`}
                className="tag-chip"
                to={`/practice/new?tab=tag&tag=${encodeURIComponent(t.tag)}`}
              >
                {t.tag}
                <span>{t.questions.toLocaleString()}</span>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {ov.recentAttempts.length > 0 ? (
        <section className="section">
          <div className="section-head">
            <h2>最近考试</h2>
          </div>
          <div className="result-list">
            {ov.recentAttempts.map((a) => {
              const acc = a.scoredTotal ? Math.round((a.correctCount / a.scoredTotal) * 1000) / 10 : 0;
              return (
                <Link key={a.id} to={`/exam/${a.id}/result`} className="result-row card">
                  <div className="result-main">
                    <b>{a.paperName || '试卷已更新'}</b>
                    <span className="muted">
                      {a.year} · {a.province} · 用时 {fmtDuration(a.elapsedSec)}
                    </span>
                  </div>
                  <div className="result-score">
                    <b>{a.correctCount}</b>
                    <span>/ {a.scoredTotal}</span>
                    <Badge tone={acc >= 60 ? 'good' : 'warn'}>{acc}%</Badge>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      ) : null}
    </div>
  );
}
