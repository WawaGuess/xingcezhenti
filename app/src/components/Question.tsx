import { useState } from 'react';
import type { Option, PracticeQuestion, QuestionType, ReviewQuestion } from '../types';
import { Badge, MaterialBox, RichHtml, typeLabel } from './ui';
import { QuestionFlagButton } from './QuestionFlag';

export function OptionList({
  question,
  choice,
  revealed,
  onChange,
  disabled,
}: {
  question: { id: string; type: QuestionType; options: Option[] };
  choice: string;
  revealed: boolean;
  onChange: (letter: string) => void;
  disabled?: boolean;
}) {
  const multi = question.type === 'multi';
  return (
    <div className={`options ${question.options.length > 4 ? 'many' : ''} ${multi ? 'multi' : ''}`}>
      {question.options.map((o) => {
        const selected = choice.includes(o.letter);
        const correct = revealed && !!o.isCorrect;
        const wrong = revealed && selected && !o.isCorrect;
        const cls = ['option'];
        if (selected) cls.push('selected');
        if (correct) cls.push('correct');
        if (wrong) cls.push('wrong');
        return (
          <button
            key={o.letter}
            type="button"
            className={cls.join(' ')}
            onClick={() => onChange(o.letter)}
            disabled={disabled}
            aria-pressed={selected}
          >
            <span className="option-letter">{o.letter}</span>
            <span className="option-text">
              <RichHtml html={o.html} inline />
            </span>
            {multi ? <span className={`option-check ${selected ? 'on' : ''}`} aria-hidden /> : null}
            {correct ? <span className="option-mark good" aria-label="正确答案">✓</span> : null}
            {wrong ? <span className="option-mark bad" aria-label="你的答案">✕</span> : null}
          </button>
        );
      })}
    </div>
  );
}

export function QuestionMeta({
  module,
  tag,
  type,
  scorable = true,
  source,
  extra,
}: {
  module: string;
  tag: string;
  type: string;
  scorable?: boolean;
  source?: { year: number; province: string; name: string } | null;
  extra?: string;
}) {
  return (
    <div className="q-meta">
      <span className="q-module">{module}</span>
      <span className="q-tag">{tag}</span>
      <span className="q-type">{typeLabel(type)}</span>
      {!scorable ? <Badge tone="warn">答案缺失 · 不计分</Badge> : null}
      {extra ? <span className="q-extra">{extra}</span> : null}
      {source ? (
        <span className="q-source" title={source.name}>
          {source.year} · {source.province}
        </span>
      ) : null}
    </div>
  );
}

type ReviewLike = ReviewQuestion | PracticeQuestion;

export function WrongReason({
  choice,
  answer,
  optionReasons,
}: {
  choice: string;
  answer: string;
  optionReasons?: Record<string, string>;
}) {
  if (!optionReasons || !Object.keys(optionReasons).length) return null;
  if (choice && choice === answer) return null;
  const chosen = new Set((choice || '').split(''));
  const correct = new Set((answer || '').split(''));
  const wrongLetters = [...chosen].filter((l) => l && !correct.has(l)).sort();
  const correctLetters = [...correct].filter(Boolean).sort();
  if (!wrongLetters.length && !correctLetters.length) return null;

  return (
    <div className="wrong-reason">
      <h4>错因解析</h4>
      {wrongLetters.map((l) => (
        <div className="reason-row bad" key={`w-${l}`}>
          <b>{l} 项</b>
          <span>{optionReasons[l] || '官方解析没有单独说明这一项，见下方完整解析。'}</span>
        </div>
      ))}
      {correctLetters.map((l) => (
        <div className="reason-row good" key={`c-${l}`}>
          <b>{l} 项 · 正确</b>
          <span>{optionReasons[l] || '官方解析没有单独说明这一项。'}</span>
        </div>
      ))}
    </div>
  );
}

export function AllOptionReasons({
  optionReasons,
  answer,
}: {
  optionReasons?: Record<string, string>;
  answer?: string;
}) {
  const letters = optionReasons ? Object.keys(optionReasons).sort() : [];
  if (!letters.length) return null;
  const correct = new Set((answer || '').split(''));
  return (
    <details className="wrong-reason-all">
      <summary>各选项解析</summary>
      {letters.map((l) => (
        <div className={`reason-row ${correct.has(l) ? 'good' : 'bad'}`} key={l}>
          <b>{l} 项{correct.has(l) ? ' · 正确' : ''}</b>
          <span>{optionReasons![l]}</span>
        </div>
      ))}
    </details>
  );
}

export function ReviewItem({
  q,
  defaultOpen = false,
  compact = false,
}: {
  q: ReviewLike;
  defaultOpen?: boolean;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const correct = q.isCorrect === true;
  const wrong = q.isCorrect === false;
  const unanswered = !q.choice && q.scorable;
  return (
    <details
      className={`review-item ${compact ? 'compact' : ''}`}
      open={open}
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
    >
      <summary>
        <span className="review-no">{q.ordinal}</span>
        <span className="review-module">{q.module}</span>
        <span className="review-tag">{q.tag}</span>
        {!q.scorable ? (
          <Badge tone="warn">不可判分</Badge>
        ) : correct ? (
          <Badge tone="good">正确</Badge>
        ) : wrong ? (
          <Badge tone="bad">错误</Badge>
        ) : unanswered ? (
          <Badge tone="neutral">未答</Badge>
        ) : (
          <Badge tone="neutral">已答</Badge>
        )}
      </summary>
      <div className="review-body">
        {q.materialHtml ? <MaterialBox html={q.materialHtml} /> : null}
        <RichHtml html={q.stemHtml} className="stem" />
        <OptionList question={q} choice={q.choice} revealed onChange={() => undefined} disabled />
        <div className="answer-line">
          <span>
            你的答案：<b>{q.choice || '未作答'}</b>
          </span>
          <span>
            正确答案：<b>{q.scorable ? q.answer || '缺失' : '不可判分'}</b>
          </span>
        </div>
        <WrongReason choice={q.choice} answer={q.answer} optionReasons={q.optionReasons} />
        {q.analysisHtml ? (
          <div className="analysis">
            <h4>官方解析</h4>
            <RichHtml html={q.analysisHtml} />
          </div>
        ) : (
          <div className="muted">暂无官方解析</div>
        )}
        <div className="review-foot">
          <QuestionFlagButton questionId={q.id} />
        </div>
      </div>
    </details>
  );
}
