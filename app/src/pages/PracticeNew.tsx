import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { PaperPicker } from '../components/PaperPicker';
import { Select } from '../components/Select';
import {
  ErrorBox,
  Loading,
  Modal,
  Switch,
  Tabs,
  toast,
} from '../components/ui';
import type { Filters, Paper } from '../types';

type Tab = 'paper' | 'tag' | 'custom' | 'wrong';
type TagInfo = Filters['tags'][number];

export default function PracticeNew() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const initialTab: Tab = searchParams.get('tab') === 'tag' ? 'tag' : 'paper';
  const [tab, setTab] = useState<Tab>(initialTab);

  const filtersQ = useQuery({ queryKey: ['filters'], queryFn: api.filters });
  const papersQ = useQuery({ queryKey: ['papers'], queryFn: () => api.papers() });
  const wrongQ = useQuery({ queryKey: ['wrong-count'], queryFn: () => api.wrongBook({ limit: 1 }) });

  const [pickedPaper, setPickedPaper] = useState<Paper | null>(null);
  const [pickedTag, setPickedTag] = useState<TagInfo | null>(null);
  const [modal, setModal] = useState<'paper' | 'tag' | 'wrong' | null>(null);
  const [module, setModule] = useState('');
  const [count, setCount] = useState(20);
  const [immediate, setImmediate] = useState(true);
  const [shuffle, setShuffle] = useState(true);
  const [customModules, setCustomModules] = useState<string[]>([]);
  const [customCount, setCustomCount] = useState(20);
  const [customShuffle, setCustomShuffle] = useState(true);
  const [customImmediate, setCustomImmediate] = useState(true);
  const autoOpened = useRef(false);

  const mutation = useMutation({
    mutationFn: api.createPractice,
    onSuccess: (data) => navigate(`/practice/${data.session.id}`),
    onError: (e) => toast(e instanceof Error ? e.message : '创建练习失败'),
  });

  const tagParam = searchParams.get('tag');
  useEffect(() => {
    if (autoOpened.current || !tagParam || !filtersQ.data) return;
    const t = filtersQ.data.tags.find((x) => x.tag === tagParam);
    if (t) {
      autoOpened.current = true;
      setTab('tag');
      setPickedTag(t);
      setCount(20);
      setShuffle(true);
      setImmediate(true);
      setModal('tag');
    }
  }, [tagParam, filtersQ.data]);

  const grouped = useMemo(() => {
    const list = filtersQ.data?.tags ?? [];
    const map = new Map<string, { module: string; ord: number; items: TagInfo[] }>();
    for (const t of list) {
      let g = map.get(t.module);
      if (!g) {
        g = { module: t.module, ord: t.moduleOrd, items: [] };
        map.set(t.module, g);
      }
      g.items.push(t);
    }
    return [...map.values()].sort((a, b) => a.ord - b.ord);
  }, [filtersQ.data]);

  if (filtersQ.isLoading || papersQ.isLoading) return <Loading text="正在加载题型…" />;
  if (filtersQ.error) return <ErrorBox error={filtersQ.error} onRetry={() => filtersQ.refetch()} />;
  if (papersQ.error) return <ErrorBox error={papersQ.error} onRetry={() => papersQ.refetch()} />;

  const filters = filtersQ.data!;
  const wrongTotal = wrongQ.data?.total ?? 0;

  const closeModal = () => {
    if (!mutation.isPending) setModal(null);
  };

  const start = () => {
    if (modal === 'paper' && pickedPaper) {
      mutation.mutate({
        kind: 'paper',
        paperId: pickedPaper.id,
        module: module || undefined,
        immediate,
      });
    } else if (modal === 'tag' && pickedTag) {
      mutation.mutate({
        kind: 'tag',
        tag: pickedTag.tag,
        count,
        shuffle,
        immediate,
      });
    } else if (modal === 'wrong') {
      mutation.mutate({ kind: 'wrong', count, shuffle, immediate });
    }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <span className="eyebrow">练习模式</span>
          <h1>按你的方式刷题</h1>
          <p className="muted">练习不扣分、不限时；答完立即看答案和官方解析，错题自动收录。</p>
        </div>
      </div>

      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { key: 'paper', label: '按套卷' },
          { key: 'tag', label: '按题型' },
          { key: 'custom', label: '自定义' },
          { key: 'wrong', label: '错题重练', count: wrongTotal },
        ]}
      />

      {tab === 'paper' ? (
        <PaperPicker
          papers={papersQ.data!.papers}
          actionLabel="练习这套"
          onPick={(p) => {
            setPickedPaper(p);
            setModule('');
            setImmediate(true);
            setModal('paper');
          }}
        />
      ) : null}

      {tab === 'tag' ? (
        <div className="stack">
          <div className="notice">
            按题型抽题时会自动去重（同一道题只出现一次）。选「全部」会创建长练习，分批加载。
          </div>
          {grouped.map((g) => (
            <section key={g.module} className="card tag-group">
              <div className="tag-group-head">
                <h3>{g.module}</h3>
                <span className="muted">
                  {g.items.reduce((sum, t) => sum + t.questions, 0).toLocaleString()} 题
                </span>
              </div>
              <div className="tag-grid">
                {g.items.map((t) => (
                  <button
                    key={t.tag}
                    className="tag-card"
                    onClick={() => {
                      setPickedTag(t);
                      setCount(20);
                      setShuffle(true);
                      setImmediate(true);
                      setModal('tag');
                    }}
                  >
                    <b>{t.tag}</b>
                    <span>{t.questions.toLocaleString()} 题</span>
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : null}

      {tab === 'custom' ? (
        <section className="card custom-panel">
          <div className="section-head">
            <h2>自定义练习</h2>
            <span className="muted">题库去重后抽题</span>
          </div>
          <p className="muted custom-desc">
            选择一个或多个模块；不选就是全模块。适合把常识、言语、判断混在一起刷。
          </p>
          <div className="check-grid">
            {filters.modules.map((m) => {
              const checked = customModules.includes(m.module);
              return (
                <label key={m.module} className={`check-item ${checked ? 'on' : ''}`}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() =>
                      setCustomModules((prev) =>
                        prev.includes(m.module)
                          ? prev.filter((x) => x !== m.module)
                          : [...prev, m.module],
                      )
                    }
                  />
                  <span>
                    <b>{m.module}</b>
                    <small>{m.questions.toLocaleString()} 题</small>
                  </span>
                </label>
              );
            })}
          </div>
          <div className="field-label">抽取数量</div>
          <div className="preset-row">
            {[10, 20, 50, 100].map((n) => (
              <button
                key={n}
                className={`btn ${customCount === n ? 'btn-primary' : ''}`}
                onClick={() => setCustomCount(n)}
              >
                {n} 题
              </button>
            ))}
            <button
              className={`btn ${customCount === 0 ? 'btn-primary' : ''}`}
              onClick={() => setCustomCount(0)}
            >
              全部
            </button>
          </div>
          <div className="custom-switches">
            <Switch checked={customShuffle} onChange={setCustomShuffle} label="随机顺序" />
            <Switch
              checked={customImmediate}
              onChange={setCustomImmediate}
              label="选完立即判题"
              desc="多选题需要点「确认答案」"
            />
          </div>
          <div className="row custom-start">
            <button
              className="btn btn-primary"
              onClick={() =>
                mutation.mutate({
                  kind: 'custom',
                  modules: customModules,
                  count: customCount,
                  shuffle: customShuffle,
                  immediate: customImmediate,
                })
              }
              disabled={mutation.isPending}
            >
              {mutation.isPending ? '创建中…' : '开始自定义练习'}
            </button>
            <span className="muted">
              {customModules.length ? `${customModules.length} 个模块` : '全模块'}
              {customCount === 0 ? ' · 全部题目' : ` · ${customCount} 题`}
            </span>
          </div>
        </section>
      ) : null}

      {tab === 'wrong' ? (
        <div className="stack">
          <section className="card wrong-entry">
            <div>
              <h3>错题本</h3>
              <p className="muted">
                当前有 <b>{wrongTotal}</b> 道未掌握错题。考试和练习答错的题会自动进来。
              </p>
            </div>
            <div className="row">
              {wrongTotal === 0 ? (
                <span className="muted">还没有错题，先去刷几道吧。</span>
              ) : (
                <>
                  <button
                    className="btn btn-primary"
                    onClick={() => {
                      setCount(20);
                      setShuffle(true);
                      setImmediate(true);
                      setModal('wrong');
                    }}
                  >
                    开始重练
                  </button>
                  <button className="btn" onClick={() => navigate('/wrong')}>
                    浏览错题
                  </button>
                </>
              )}
            </div>
          </section>
        </div>
      ) : null}

      <Modal
        open={!!modal}
        onClose={closeModal}
        title={modal === 'paper' ? '开始套卷练习' : modal === 'tag' ? '开始题型练习' : '错题重练'}
        footer={
          <>
            <button className="btn" onClick={closeModal} disabled={mutation.isPending}>
              取消
            </button>
            <button className="btn btn-primary" onClick={start} disabled={mutation.isPending}>
              {mutation.isPending ? '创建中…' : '开始练习'}
            </button>
          </>
        }
      >
        <div className="stack">
          {modal === 'paper' && pickedPaper ? (
            <>
              <div className="paper-selected">
                <b>{pickedPaper.name}</b>
                <span className="muted">
                  {pickedPaper.year} · {pickedPaper.province} · {pickedPaper.questionCount} 题
                </span>
              </div>
              <Select
                label="练习范围"
                value={module}
                onChange={setModule}
                options={[
                  { value: '', label: '全部模块' },
                  ...pickedPaper.modules.map((m) => ({
                    value: m.module,
                    label: m.module,
                    hint: `${m.questionCount} 题`,
                  })),
                ]}
              />
            </>
          ) : null}

          {modal === 'tag' && pickedTag ? (
            <>
              <div className="paper-selected">
                <b>{pickedTag.tag}</b>
                <span className="muted">
                  {pickedTag.module} · {pickedTag.questions.toLocaleString()} 道唯一题
                </span>
              </div>
              <div>
                <div className="field-label">抽取数量</div>
                <div className="preset-row">
                  {[10, 20, 50, 100].map((n) => (
                    <button
                      key={n}
                      className={`btn ${count === n ? 'btn-primary' : ''}`}
                      onClick={() => setCount(n)}
                    >
                      {n} 题
                    </button>
                  ))}
                  <button
                    className={`btn ${count === 0 ? 'btn-primary' : ''}`}
                    onClick={() => setCount(0)}
                  >
                    全部
                  </button>
                </div>
              </div>
              <Switch checked={shuffle} onChange={setShuffle} label="随机顺序" desc="关闭则按题库顺序" />
            </>
          ) : null}

          {modal === 'wrong' ? (
            <>
              <div className="paper-selected">
                <b>错题重练</b>
                <span className="muted">从 {wrongTotal} 道未掌握错题中抽取</span>
              </div>
              <div>
                <div className="field-label">抽取数量</div>
                <div className="preset-row">
                  {[10, 20, 50].map((n) => (
                    <button
                      key={n}
                      className={`btn ${count === n ? 'btn-primary' : ''}`}
                      onClick={() => setCount(n)}
                    >
                      {n} 题
                    </button>
                  ))}
                  <button
                    className={`btn ${count === 0 ? 'btn-primary' : ''}`}
                    onClick={() => setCount(0)}
                  >
                    全部
                  </button>
                </div>
              </div>
              <Switch checked={shuffle} onChange={setShuffle} label="随机顺序" />
            </>
          ) : null}

          <Switch
            checked={immediate}
            onChange={setImmediate}
            label="选完立即判题"
            desc={immediate ? '单选题点选后立刻显示对错和解析' : '先作答，点「查看答案」后再判题'}
          />
          {modal === 'tag' || modal === 'wrong' ? (
            <div className="notice">多选题需要点「确认答案」后才会判题。</div>
          ) : null}
        </div>
      </Modal>
    </div>
  );
}
