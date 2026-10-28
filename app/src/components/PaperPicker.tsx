import { useEffect, useMemo, useState } from 'react';
import type { Paper } from '../types';

const SHORT: Record<string, string> = {
  政治理论: '政治',
  常识判断: '常识',
  言语理解与表达: '言语',
  数量关系: '数量',
  判断推理: '判断',
  资料分析: '资料',
};

const TYPE_ORDER = ['国考', '省考', '选调', '市考'] as const;

export function PaperPicker({
  papers,
  defaultYear,
  actionLabel = '开始',
  onPick,
  busyId,
}: {
  papers: Paper[];
  defaultYear?: string;
  actionLabel?: string;
  onPick: (paper: Paper) => void;
  busyId?: string | null;
}) {
  const latestYear = useMemo(
    () => String(papers.reduce((max, p) => Math.max(max, p.year), 0) || ''),
    [papers],
  );
  const [year, setYear] = useState(defaultYear || latestYear);
  const [examType, setExamType] = useState('');
  const [province, setProvince] = useState('');
  const [keyword, setKeyword] = useState('');

  // 年份数字：只受“考试类型”影响，不受地区影响
  const yearOptions = useMemo(() => {
    const map = new Map<number, number>();
    for (const p of papers) {
      if (examType && p.examType !== examType) continue;
      map.set(p.year, (map.get(p.year) || 0) + 1);
    }
    return [...map.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([y, count]) => ({ year: y, papers: count }));
  }, [papers, examType]);

  // 类型数字：全库分布，不受年份/地区影响（第一级）
  const typeOptions = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of papers) {
      map.set(p.examType, (map.get(p.examType) || 0) + 1);
    }
    return TYPE_ORDER.map((type) => ({ type, count: map.get(type) || 0 }));
  }, [papers]);

  // 地区数字：受“年份 + 考试类型”影响
  const provinceOptions = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of papers) {
      if (year && String(p.year) !== year) continue;
      if (examType && p.examType !== examType) continue;
      map.set(p.province, (map.get(p.province) || 0) + 1);
    }
    return [...map.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh-CN'))
      .map(([name, count]) => ({ province: name, papers: count }));
  }, [papers, year, examType]);

  useEffect(() => {
    if (examType && !typeOptions.some((t) => t.type === examType && t.count > 0)) setExamType('');
  }, [examType, typeOptions]);

  useEffect(() => {
    if (province && !provinceOptions.some((o) => o.province === province)) setProvince('');
  }, [province, provinceOptions]);

  useEffect(() => {
    if (year && !yearOptions.some((o) => String(o.year) === year)) setYear('');
  }, [year, yearOptions]);

  const filtered = useMemo(() => {
    const kw = keyword.trim();
    return papers.filter(
      (p) =>
        (!year || String(p.year) === year) &&
        (!examType || p.examType === examType) &&
        (!province || p.province === province) &&
        (!kw || p.name.includes(kw)),
    );
  }, [papers, year, examType, province, keyword]);

  return (
    <div className="paper-picker">
      <div className="filter-bar">
        <label className="field">
          <span>考试类型</span>
          <select
            value={examType}
            onChange={(e) => {
              setExamType(e.target.value);
              setProvince('');
            }}
          >
            <option value="">全部类型</option>
            {typeOptions.map((t) => (
              <option key={t.type} value={t.type} disabled={t.count === 0}>
                {t.type}（{t.count} 套）
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>年份</span>
          <select value={year} onChange={(e) => setYear(e.target.value)}>
            <option value="">全部年份</option>
            {yearOptions.map((y) => (
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
            {provinceOptions.map((p) => (
              <option key={p.province} value={p.province}>
                {p.province}（{p.papers} 套）
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

      <div className="paper-count muted">
        共 {filtered.length} 套卷
        <span className="filter-hint">按 类型 → 年份 → 地区 逐级筛选；数字只受前面条件影响</span>
      </div>

      {filtered.length === 0 ? (
        <div className="empty">
          <div className="empty-title">没有匹配的试卷</div>
          <div className="empty-desc">换一个年份、类型、地区或关键词试试。</div>
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
                  {p.examType !== p.province ? <span>{p.examType}</span> : null}
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
