import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { ProfileAvatar } from '../profile';
import {
  EmptyState,
  ErrorBox,
  fmtDate,
  fmtDuration,
  Loading,
  ProgressBar,
  Stat,
} from '../components/ui';

export default function Stats() {
  const statsQ = useQuery({ queryKey: ['stats'], queryFn: api.stats });

  if (statsQ.isLoading) return <Loading text="正在汇总数据…" />;
  if (statsQ.error) return <ErrorBox error={statsQ.error} onRetry={() => statsQ.refetch()} />;
  const s = statsQ.data!;

  const maxExam = Math.max(1, ...s.activity.map((d) => d.examCount));
  const maxPractice = Math.max(1, ...s.activity.map((d) => d.practiceAnswered));
  const totalActivity = s.summary.exams + s.summary.practiceAnswered;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <span className="eyebrow">学习统计</span>
          <h1>把进步看得见</h1>
          <p className="muted">统计当前成员；家庭成员之间只比较总量，不混记录。</p>
        </div>
        <div className="page-actions">
          <Link to="/flags" className="btn">
            我的疑问
          </Link>
          <Link to="/practice/new" className="btn btn-primary">
            去练习
          </Link>
        </div>
      </div>

      <div className="stat-grid">
        <Stat label="已考套数" value={s.summary.exams} sub={`${s.summary.examCorrect} / ${s.summary.examScored} 题`} />
        <Stat label="考试正确率" value={`${s.summary.examAccuracy}%`} sub="按计分题" />
        <Stat label="练习已答" value={s.summary.practiceAnswered} sub={`${s.summary.practiceSessions} 组练习`} />
        <Stat label="练习正确率" value={`${s.summary.practiceAccuracy}%`} sub={`正确 ${s.summary.practiceCorrect}`} />
        <Stat label="待掌握错题" value={s.summary.wrongOpen} sub="连续答对 3 次自动掌握" />
        <Stat label="已掌握" value={s.summary.wrongMastered} sub="可在错题本调整" />
      </div>

      {totalActivity === 0 ? (
        <div className="notice" style={{ marginTop: 16 }}>
          还没有考试或练习记录。完成一场考试、或练几道题，这里就会出现统计。
        </div>
      ) : null}

      <section className="section card chart-card">
        <div className="section-head">
          <h2>最近 14 天</h2>
          <span className="muted">考试场次 / 练习答题数</span>
        </div>
        <div className="activity-chart">
          {s.activity.map((d) => {
            const examH = d.examCount ? 8 + Math.round((d.examCount / maxExam) * 72) : 2;
            const practiceH = d.practiceAnswered ? 8 + Math.round((d.practiceAnswered / maxPractice) * 72) : 2;
            return (
              <div
                className="activity-col"
                key={d.date}
                title={`${d.date}：考试 ${d.examCount} 场（${d.examCorrect}/${d.examScored}），练习 ${d.practiceAnswered} 题（正确 ${d.practiceCorrect}）`}
              >
                <div className="activity-bars">
                  <span className="bar exam" style={{ height: examH }} />
                  <span className="bar practice" style={{ height: practiceH }} />
                </div>
                <span className="activity-date">{d.date.slice(5)}</span>
              </div>
            );
          })}
        </div>
        <div className="legend">
          <span>
            <i className="dot exam" />
            考试
          </span>
          <span>
            <i className="dot practice" />
            练习
          </span>
        </div>
      </section>

      <section className="section card module-score">
        <div className="section-head">
          <h2>模块正确率</h2>
          <span className="muted">考试 + 练习</span>
        </div>
        {s.byModule.length === 0 ? (
          <div className="muted">还没有可统计的作答。</div>
        ) : (
          <div className="module-bars">
            {s.byModule.map((m) => (
              <div key={m.module} className="module-bar">
                <div className="module-bar-head">
                  <span>{m.module}</span>
                  <b>
                    {m.correct} / {m.answered}
                    <em>{m.accuracy}%</em>
                  </b>
                </div>
                <ProgressBar value={m.correct} max={m.answered} tone={m.accuracy >= 60 ? 'good' : 'bad'} />
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="section card tag-stat-card">
        <div className="section-head">
          <h2>题型正确率</h2>
          <span className="muted">按已答量排序，最多 15 个</span>
        </div>
        {s.byTag.length === 0 ? (
          <div className="muted">还没有可统计的作答。</div>
        ) : (
          <div className="tag-stat-list">
            {s.byTag.map((t) => (
              <div key={t.tag} className="tag-stat">
                <div className="tag-stat-name">
                  <b>{t.tag}</b>
                  <small>{t.module}</small>
                </div>
                <div className="tag-stat-bar">
                  <ProgressBar value={t.correct} max={t.answered} tone={t.accuracy >= 60 ? 'good' : 'bad'} />
                </div>
                <div className="tag-stat-num">
                  {t.correct}/{t.answered}
                  <em>{t.accuracy}%</em>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="section">
        <div className="section-head">
          <h2>最近考试</h2>
          <Link to="/exam/new" className="link">
            再考一场
          </Link>
        </div>
        {s.recentExams.length === 0 ? (
          <EmptyState title="还没有考试记录" desc="去考试模式选一套卷开始。" />
        ) : (
          <div className="result-list">
            {s.recentExams.map((e) => (
              <Link key={e.id} to={`/exam/${e.id}/result`} className="result-row card">
                <div className="result-main">
                  <b>{e.paperName || '试卷已更新'}</b>
                  <span className="muted">
                    {e.year} · {e.province} · {fmtDate(e.submittedAt)} · 用时 {fmtDuration(e.elapsedSec)}
                  </span>
                </div>
                <div className="result-score">
                  <b>{e.correctCount}</b>
                  <span>/ {e.scoredTotal}</span>
                  <em className={`result-acc ${e.accuracy >= 60 ? 'good' : 'bad'}`}>{e.accuracy}%</em>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      {s.family.length > 1 ? (
        <section className="section">
          <div className="section-head">
            <h2>家庭成员</h2>
            <span className="muted">只比较总量，不展开个人题目</span>
          </div>
          <div className="family-grid">
            {s.family.map((f) => (
              <div key={f.id} className="family-card card">
                <div className="family-head">
                  <ProfileAvatar profile={f} size={36} />
                  <b>{f.name}</b>
                </div>
                <div className="family-row">
                  <span>考试</span>
                  <b>{f.exams} 场</b>
                  <em>{f.examAccuracy}%</em>
                </div>
                <div className="family-row">
                  <span>练习</span>
                  <b>{f.practiceAnswered} 题</b>
                  <em>{f.practiceAccuracy}%</em>
                </div>
                <div className="family-row">
                  <span>待掌握错题</span>
                  <b>{f.wrongOpen}</b>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
