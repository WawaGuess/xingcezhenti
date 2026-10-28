import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { KeyboardEvent } from 'react';

export type SelectOption = {
  value: string;
  label: string;
  /** 右侧对齐的次要信息，例如「28 套」「35 题」 */
  hint?: string;
  disabled?: boolean;
};

type MenuPosition = {
  left: number;
  top?: number;
  bottom?: number;
  minWidth: number;
  maxWidth: number;
  maxHeight: number;
};

/**
 * 自定义下拉：统一箭头样式，选项右侧对齐数量，按钮保持焦点以支持键盘操作。
 * 菜单通过 portal 挂到 body，避免被弹窗的滚动区域裁切。
 */
export function Select({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState<MenuPosition | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const id = useId();

  const selected = options.find((o) => o.value === value) ?? options[0];

  const updatePosition = useCallback(() => {
    const btn = btnRef.current;
    if (!btn) return;
    const r = btn.getBoundingClientRect();
    if (r.bottom < 0 || r.top > window.innerHeight) {
      setOpen(false);
      return;
    }
    const gap = 6;
    const spaceBelow = window.innerHeight - r.bottom - gap;
    const spaceAbove = r.top - gap;
    const openUp = spaceBelow < 220 && spaceAbove > spaceBelow;
    setPos({
      left: r.left,
      ...(openUp
        ? { bottom: window.innerHeight - r.top + gap, maxHeight: Math.min(300, spaceAbove) }
        : { top: r.bottom + gap, maxHeight: Math.min(300, spaceBelow) }),
      minWidth: Math.min(r.width, 220),
      maxWidth: Math.max(160, Math.min(320, window.innerWidth - r.left - 8)),
    });
  }, []);

  const openMenu = () => {
    const index = options.findIndex((o) => o.value === value);
    setActive(index >= 0 ? index : 0);
    updatePosition();
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node;
      if (rootRef.current?.contains(target) || listRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('touchstart', onPointerDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('touchstart', onPointerDown);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    updatePosition();
    window.addEventListener('resize', updatePosition);
    document.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      document.removeEventListener('scroll', updatePosition, true);
    };
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open) return;
    listRef.current
      ?.querySelector<HTMLElement>('[data-active="true"]')
      ?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);

  const pick = (opt: SelectOption) => {
    if (opt.disabled) return;
    onChange(opt.value);
    setOpen(false);
    btnRef.current?.focus();
  };

  const move = (dir: 1 | -1) => {
    if (options.length === 0) return;
    let next = active;
    for (let i = 0; i < options.length; i += 1) {
      next = (next + dir + options.length) % options.length;
      if (!options[next].disabled) {
        setActive(next);
        return;
      }
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openMenu();
      }
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      return;
    }
    if (e.key === 'Tab') {
      setOpen(false);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      move(1);
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      move(-1);
      return;
    }
    if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      const range = options.map((_, i) => i);
      if (e.key === 'End') range.reverse();
      const target = range.find((i) => !options[i].disabled);
      if (target != null) setActive(target);
      return;
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      const opt = options[active];
      if (opt) pick(opt);
    }
  };

  return (
    <div className="select" ref={rootRef}>
      <span className="select-label" id={`${id}-label`}>
        {label}
      </span>
      <button
        type="button"
        ref={btnRef}
        className={`select-trigger${open ? ' open' : ''}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        aria-labelledby={`${id}-label ${id}-value`}
        aria-activedescendant={open ? `${id}-opt-${active}` : undefined}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={onKeyDown}
      >
        <span className="select-value" id={`${id}-value`}>
          {selected?.label ?? '请选择'}
        </span>
        {selected?.hint ? <span className="select-hint">{selected.hint}</span> : null}
        <svg
          className="select-chevron"
          width="12"
          height="12"
          viewBox="0 0 12 12"
          aria-hidden="true"
          focusable="false"
        >
          <path
            d="M2.5 4.5 6 8l3.5-3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {open && pos
        ? createPortal(
            <ul
              className="select-menu"
              role="listbox"
              id={`${id}-list`}
              ref={listRef}
              aria-labelledby={`${id}-label`}
              style={{
                left: pos.left,
                top: pos.top,
                bottom: pos.bottom,
                minWidth: pos.minWidth,
                maxWidth: pos.maxWidth,
                maxHeight: pos.maxHeight,
              }}
            >
              {options.map((o, i) => (
                <li
                  key={o.value || '__all__'}
                  id={`${id}-opt-${i}`}
                  role="option"
                  aria-selected={o.value === value}
                  aria-disabled={o.disabled || undefined}
                  data-active={i === active}
                  className={[
                    'select-option',
                    o.value === value ? 'selected' : '',
                    o.disabled ? 'disabled' : '',
                    i === active ? 'active' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  onMouseEnter={() => {
                    if (!o.disabled) setActive(i);
                  }}
                  onClick={() => pick(o)}
                >
                  <span className="select-option-label">{o.label}</span>
                  {o.hint ? <span className="select-option-hint">{o.hint}</span> : null}
                </li>
              ))}
            </ul>,
            document.body,
          )
        : null}
    </div>
  );
}
