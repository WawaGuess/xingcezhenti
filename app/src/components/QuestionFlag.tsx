import { useState } from 'react';
import { api } from '../api';
import { Modal, toast } from './ui';

export function QuestionFlagButton({
  questionId,
  className = '',
}: {
  questionId: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setSaving(true);
    try {
      await api.flagQuestion(questionId, note);
      toast('已记录，可在「统计 → 我的疑问」查看', 'success');
      setOpen(false);
      setNote('');
    } catch (e) {
      toast(e instanceof Error ? e.message : '标记失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <button className={`btn btn-sm ${className}`} onClick={() => setOpen(true)}>
        ⚑ 题目有问题
      </button>
      <Modal
        open={open}
        onClose={() => {
          if (!saving) setOpen(false);
        }}
        title="标记题目问题"
        footer={
          <>
            <button className="btn" onClick={() => setOpen(false)} disabled={saving}>
              取消
            </button>
            <button className="btn btn-primary" onClick={submit} disabled={saving}>
              {saving ? '保存中…' : '保存标记'}
            </button>
          </>
        }
      >
        <div className="stack">
          <div className="notice">
            标记只保存在你的成员数据里，不会修改题库原文。答案有误、解析对不上、图片缺失都可以记在这里。
          </div>
          <label className="field">
            <span>问题描述（可选）</span>
            <textarea
              className="textarea"
              rows={4}
              maxLength={500}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="例如：答案应为 B、解析和题干对不上、图片缺失…"
            />
          </label>
        </div>
      </Modal>
    </>
  );
}
