import { useEffect, useReducer, useRef, useState, type ReactNode } from 'react';

type ToastKind = 'error' | 'info' | 'success';
type ToastItem = { id: number; msg: string; kind: ToastKind };

let toastHandler: ((msg: string, kind: ToastKind) => void) | null = null;

export function toast(msg: string, kind: ToastKind = 'error'): void {
  if (toastHandler) toastHandler(msg, kind);
  else console.warn(msg);
}

export function ToastHost(): ReactNode {
  const [items, setItems] = useState<ToastItem[]>([]);
  useEffect(() => {
    toastHandler = (msg, kind) => {
      const id = Date.now() + Math.random();
      setItems((x) => [...x, { id, msg, kind }]);
      window.setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), 4200);
    };
    return () => {
      toastHandler = null;
    };
  }, []);
  return (
    <div className="toast-host" aria-live="polite">
      {items.map((i) => (
        <div key={i.id} className={`toast ${i.kind}`}>
          {i.msg}
        </div>
      ))}
    </div>
  );
}

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="btn-icon" onClick={onClose} aria-label="关闭">
            ✕
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer ? <div className="modal-foot">{footer}</div> : null}
      </div>
    </div>
  );
}

export function RichHtml({
  html,
  inline,
  className = '',
}: {
  html: string;
  inline?: boolean;
  className?: string;
}) {
  const [zoom, setZoom] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    ref.current.querySelectorAll('img').forEach((img) => {
      img.loading = 'lazy';
      img.decoding = 'async';
    });
  }, [html]);

  useEffect(() => {
    if (!zoom) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setZoom(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [zoom]);

  const onImgClick = (e: React.MouseEvent) => {
    const t = e.target as HTMLElement;
    if (t.tagName === 'IMG') {
      const img = t as HTMLImageElement;
      // 小公式图放大后会非常模糊，直接不弹层
      if ((img.naturalWidth || 0) < 100 && (img.naturalHeight || 0) < 100) return;
      e.preventDefault();
      setZoom(img.src);
    }
  };

  const node = inline ? (
    <span
      ref={ref as any}
      className={`rich rich-inline ${className}`}
      dangerouslySetInnerHTML={{ __html: html }}
      onClick={onImgClick}
    />
  ) : (
    <div
      ref={ref}
      className={`rich ${className}`}
      dangerouslySetInnerHTML={{ __html: html }}
      onClick={onImgClick}
    />
  );

  return (
    <>
      {node}
      {zoom ? (
        <div className="lightbox" onClick={() => setZoom(null)} role="dialog" aria-label="查看大图">
          <img src={zoom} alt="题目图片" />
        </div>
      ) : null}
    </>
  );
}

export function useCountdown(deadlineAt?: number, serverNow?: number): number {
  const offset = useRef(0);
  const [, force] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    if (serverNow) offset.current = serverNow - Date.now();
  }, [serverNow]);
  useEffect(() => {
    const t = window.setInterval(() => force(), 500);
    return () => window.clearInterval(t);
  }, [force]);
  if (!deadlineAt) return 0;
  return Math.max(0, Math.ceil((deadlineAt - (Date.now() + offset.current)) / 1000));
}

export function useElapsed(startedAt?: number, serverNow?: number, finishedAt?: number | null): number {
  const offset = useRef(0);
  const [, force] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    if (serverNow) offset.current = serverNow - Date.now();
  }, [serverNow]);
  useEffect(() => {
    if (finishedAt) return;
    const t = window.setInterval(() => force(), 1000);
    return () => window.clearInterval(t);
  }, [force, finishedAt]);
  if (!startedAt) return 0;
  const end = finishedAt || Date.now() + offset.current;
  return Math.max(0, Math.floor((end - startedAt) / 1000));
}

export function fmtDuration(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  if (h > 0) return `${h}:${pad(m)}:${pad(ss)}`;
  return `${m}:${pad(ss)}`;
}

export function fmtDate(ts?: number | null): string {
  if (!ts) return '—';
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function typeLabel(type: string): string {
  if (type === 'multi') return '多选题';
  if (type === 'judge') return '判断题';
  return '单选题';
}

export function Tabs<T extends string>({
  items,
  value,
  onChange,
}: {
  items: { key: T; label: string; count?: number }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="tabs" role="tablist">
      {items.map((i) => (
        <button
          key={i.key}
          role="tab"
          aria-selected={value === i.key}
          className={`tab ${value === i.key ? 'active' : ''}`}
          onClick={() => onChange(i.key)}
        >
          {i.label}
          {i.count != null ? <span className="tab-count">{i.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function Badge({ tone = 'neutral', children }: { tone?: 'neutral' | 'good' | 'bad' | 'warn' | 'accent'; children: ReactNode }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: string }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {sub ? <div className="stat-sub">{sub}</div> : null}
    </div>
  );
}

export function Loading({ text = '加载中…' }: { text?: string }) {
  return (
    <div className="loading">
      <span className="spinner" />
      {text}
    </div>
  );
}

export function ErrorBox({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const msg = error instanceof Error ? error.message : String(error || '加载失败');
  return (
    <div className="error-box">
      <div>{msg}</div>
      {onRetry ? (
        <button className="btn btn-sm" onClick={onRetry}>
          重试
        </button>
      ) : null}
    </div>
  );
}

export function EmptyState({ title, desc, action }: { title: string; desc?: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-title">{title}</div>
      {desc ? <div className="empty-desc">{desc}</div> : null}
      {action}
    </div>
  );
}

export function ProgressBar({ value, max, tone = 'accent' }: { value: number; max: number; tone?: 'accent' | 'good' | 'bad' }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div className="progress" aria-label={`进度 ${pct}%`}>
      <div className={`progress-fill ${tone}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  desc,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  desc?: string;
}) {
  return (
    <div className="switch-row">
      <span className="switch-copy">
        <b>{label}</b>
        {desc ? <small>{desc}</small> : null}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        className={`switch ${checked ? 'on' : ''}`}
        onClick={() => onChange(!checked)}
      >
        <i />
      </button>
    </div>
  );
}

export function MaterialBox({ html, defaultOpen = true }: { html: string; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(() => {
    if (!defaultOpen) return false;
    if (typeof window === 'undefined') return true;
    // 手机屏幕先收起材料，让题目优先出现
    return !window.matchMedia('(max-width: 720px)').matches;
  });
  return (
    <details
      className="material"
      open={open}
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
    >
      <summary>资料 / 材料</summary>
      <div className="material-body">
        <RichHtml html={html} />
      </div>
    </details>
  );
}

export function AnswerSheet({
  questions,
  current,
  answers,
  flags,
  results,
  onJump,
}: {
  questions: { id: string; ordinal: number; module: string }[];
  current: number;
  answers: Record<string, string>;
  flags: Set<string>;
  results?: Record<string, boolean | null>;
  onJump: (index: number) => void;
}) {
  const groups: { module: string; items: { q: (typeof questions)[number]; index: number }[] }[] = [];
  questions.forEach((q, index) => {
    let g = groups[groups.length - 1];
    if (!g || g.module !== q.module) {
      g = { module: q.module, items: [] };
      groups.push(g);
    }
    g.items.push({ q, index });
  });

  return (
    <div className="sheet">
      <div className="sheet-legend">
        <span><i className="dot answered" />已答</span>
        <span><i className="dot flagged" />标记</span>
        <span><i className="dot" />未答</span>
      </div>
      {groups.map((g) => (
        <section key={g.module} className="sheet-group">
          <h4>
            {g.module} <span className="muted">{g.items.length} 题</span>
          </h4>
          <div className="sheet-grid">
            {g.items.map(({ q, index }) => {
              const cls: string[] = [];
              if (index === current) cls.push('current');
              if (answers[q.id]) cls.push('answered');
              if (flags.has(q.id)) cls.push('flagged');
              const r = results?.[q.id];
              if (r === true) cls.push('correct');
              if (r === false) cls.push('wrong');
              return (
                <button key={`${q.id}-${index}`} className={`sheet-btn ${cls.join(' ')}`} onClick={() => onJump(index)}>
                  {q.ordinal}
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
