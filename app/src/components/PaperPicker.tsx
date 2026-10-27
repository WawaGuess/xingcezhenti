import { useMemo, useState } from 'react';
import type { Paper } from '../types';

const SHORT: Record<string, string> = {
  政治理论: '政治',
  常识判断: '常识',
  言语理解与表达: '言语',
  数量关系: '数量',
  判断推理: '判断',
  资料分析: '资料',
};

export function PaperPicker({
  papers,
  years,
  provinces,
  defaultYear,
  actionLabel = '开始',
  onPick,
  busyId,
}: {
  papers: Paper[];
  years: { year: number; papers: number }[];
  provinces: { province: string; papers: number }[];
  defaultYear?: string;
  actionLabel?: string;
  onPick: (paper: Paper) => void;
  busyId?: string | null;
}) {
  const [year, setYear] = useState(defaultYear ?? String(years[0]?.year ?? ''));
  const [province, setProvince] = useState('');
  const [keyword, setKeyword] = useState('');

  const filtered = useMemo(() => {
    const kw = keyword.trim();
    return papers.filter(
      (p) =>
        (!year || String(p.year) === year) &&
        (!province || p.province === province) &&
        (!kw || p.name.includes(kw)),
    );
  }, [papers, year, province, keyword]);

  return (
    <div className="paper-picker">
      <div className="filter-bar">
        <label className="field">
          <span>年份</span>
          <select value={year} onChange={(e) => setYear(e.target.value)}>
            <option value="">全部年份</option>
            {years.map((y) => (
              <option key={y.year} value={y.year}>
                {y.year}（{y.papers} 套）
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>地区</span>
          <select value={province} onChange={(e) => setProvince(e.target.value)}>
            <option value="">全部地区</option>
            {provinces.map((p) => (
              <option key={p.province} value={p.province}>
                {p.province}（{p.papers}）
              </option>
            ))}
          </select>
        </label>
        <label className="field grow">
          <span>搜索</span>
          <input
            type="search"
            placeholder="输入卷名关键词，如「国考」「江苏」"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
          />
        </label>
      </div>

      <div className="paper-count muted">共 {filtered.length} 套卷</div>

      {filtered.length === 0 ? (
        <div className="empty">
          <div className="empty-title">没有匹配的试卷</div>
          <div className="empty-desc">换一个年份、地区或关键词试试。</div>
        </div>
      ) : (
        <div className="paper-list">
          {filtered.map((p) => (
            <article key={p.id} className="paper-item">
              <div className="paper-main">
                <h3 className="paper-title">{p.name}</h3>
                <div className="paper-meta">
                  <span>{p.year}</span>
                  <span>{p.province}</span>
                  <span>{p.questionCount} 题</span>
                  <span>{p.modules.length} 个模块</span>
                </div>
                <div className="module-chips">
                  {p.modules.map((m) => (
                    <span key={m.module} className="module-chip" title={`${m.module} ${m.questionCount} 题`}>
                      {SHORT[m.module] || m.module}
                      <b>{m.questionCount}</b>
                    </span>
                  ))}
                </div>
              </div>
              <div className="paper-action">
                <button
                  className="btn btn-primary"
                  onClick={() => onPick(p)}
                  disabled={busyId === p.id}
                >
                  {busyId === p.id ? '准备中…' : actionLabel}
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
