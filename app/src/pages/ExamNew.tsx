import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { PaperPicker } from '../components/PaperPicker';
import { ErrorBox, Loading, Modal, toast } from '../components/ui';
import type { Paper } from '../types';

const PRESETS = [90, 120, 150];

export default function ExamNew() {
  const navigate = useNavigate();
  const papersQ = useQuery({ queryKey: ['papers'], queryFn: () => api.papers() });

  const [selected, setSelected] = useState<Paper | null>(null);
  const [preset, setPreset] = useState(120);
  const [custom, setCustom] = useState('');

  const mutation = useMutation({
    mutationFn: ({ paperId, minutes }: { paperId: string; minutes: number }) =>
      api.createExam(paperId, minutes * 60),
    onSuccess: (data) => navigate(`/exam/${data.attempt.id}`),
    onError: (err) => toast(err instanceof Error ? err.message : '创建考试失败'),
  });

  if (papersQ.isLoading) return <Loading text="正在加载试卷…" />;
  if (papersQ.error) return <ErrorBox error={papersQ.error} onRetry={() => papersQ.refetch()} />;

  const papers = papersQ.data!.papers;
  const minutes = custom ? Number(custom) : preset;
  const validMinutes = Number.isFinite(minutes) && minutes >= 5 && minutes <= 240;

  const start = () => {
    if (!selected) return;
    if (!validMinutes) {
      toast('考试时长请填 5–240 分钟');
      return;
    }
    mutation.mutate({ paperId: selected.id, minutes });
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <span className="eyebrow">考试模式</span>
          <h1>选择一套真题</h1>
          <p className="muted">整卷按模块顺序出题；开考后计时不暂停，到点自动交卷。</p>
        </div>
      </div>

      <PaperPicker
        papers={papers}
        actionLabel="开始考试"
        onPick={(p) => {
          setSelected(p);
          setPreset(120);
          setCustom('');
        }}
        busyId={mutation.isPending ? mutation.variables?.paperId ?? null : null}
      />

      <Modal
        open={!!selected}
        onClose={() => {
          if (!mutation.isPending) setSelected(null);
        }}
        title="开始考试"
        footer={
          <>
            <button className="btn" onClick={() => setSelected(null)} disabled={mutation.isPending}>
              取消
            </button>
            <button className="btn btn-primary" onClick={start} disabled={mutation.isPending}>
              {mutation.isPending ? '创建中…' : `开始 · ${validMinutes ? minutes : '—'} 分钟`}
            </button>
          </>
        }
      >
        {selected ? (
          <div className="stack">
            <div className="paper-selected">
              <b>{selected.name}</b>
              <span className="muted">
                {selected.year} · {selected.province} · {selected.questionCount} 题 ·{' '}
                {selected.modules.length} 个模块
              </span>
            </div>
            <div className="module-chips">
              {selected.modules.map((m) => (
                <span key={m.module} className="module-chip">
                  {m.module}
                  <b>{m.questionCount}</b>
                </span>
              ))}
            </div>
            <div>
              <div className="field-label">考试时长</div>
              <div className="preset-row">
                {PRESETS.map((m) => (
                  <button
                    key={m}
                    className={`btn ${!custom && preset === m ? 'btn-primary' : ''}`}
                    onClick={() => {
                      setPreset(m);
                      setCustom('');
                    }}
                  >
                    {m} 分钟
                  </button>
                ))}
                <input
                  className="input minutes-input"
                  type="number"
                  min={5}
                  max={240}
                  placeholder="自定义"
                  value={custom}
                  onChange={(e) => setCustom(e.target.value)}
                />
              </div>
            </div>
            <div className="notice">
              考试期间不能暂停；退出页面或刷新后，计时继续。交卷前不显示答案和解析。
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
