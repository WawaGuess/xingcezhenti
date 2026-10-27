import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api, setProfileId } from './api';
import type { Profile } from './types';
import { ErrorBox, Loading, Modal, toast } from './components/ui';

const PROFILE_KEY = 'xczt.profileId';
const COLORS = ['#4f6ef7', '#7b5cf5', '#e0568a', '#f59e0b', '#16a34a', '#0ea5e9'];

function storedProfileId(): string {
  try {
    const session = sessionStorage.getItem(PROFILE_KEY);
    if (session) return session;
    const local = localStorage.getItem(PROFILE_KEY) || '';
    // 首次进入标签页时把“上次使用”的成员钉在 sessionStorage 里，
    // 这样另一个标签页切换成员不会影响当前标签页。
    if (local) sessionStorage.setItem(PROFILE_KEY, local);
    return local;
  } catch {
    return '';
  }
}

type ProfileContextValue = {
  profiles: Profile[];
  current: Profile | null;
  loading: boolean;
  error: unknown;
  switchProfile: (id: string) => void;
  createProfile: (name: string, color: string) => Promise<void>;
  updateProfile: (id: string, patch: { name?: string; color?: string }) => Promise<void>;
  archiveProfile: (id: string) => Promise<void>;
  refresh: () => void;
};

const ProfileContext = createContext<ProfileContextValue | null>(null);

export function useProfile(): ProfileContextValue {
  const ctx = useContext(ProfileContext);
  if (!ctx) throw new Error('useProfile must be used inside ProfileProvider');
  return ctx;
}

export function ProfileProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const profilesQ = useQuery({ queryKey: ['profiles'], queryFn: api.profiles, staleTime: 30_000 });
  const [currentId, setCurrentId] = useState<string>(() => storedProfileId());

  const profiles = profilesQ.data?.profiles ?? [];
  const current = profiles.find((p) => p.id === currentId) ?? null;

  useEffect(() => {
    if (!profilesQ.data) return;
    const list = profilesQ.data.profiles;
    if (!list.length) return;
    if (list.some((p) => p.id === currentId)) return;

    const stored = storedProfileId();
    const byStored = list.find((p) => p.id === stored);
    if (byStored) {
      setCurrentId(byStored.id);
      return;
    }
    if (list.length === 1) {
      setProfileId(list[0].id);
      setCurrentId(list[0].id);
      return;
    }
    try {
      localStorage.removeItem(PROFILE_KEY);
      sessionStorage.removeItem(PROFILE_KEY);
    } catch {
      /* ignore */
    }
    setCurrentId('');
  }, [profilesQ.data, currentId]);

  const dropMemberData = () => {
    qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'profiles' });
  };

  const switchProfile = (id: string) => {
    setProfileId(id);
    setCurrentId(id);
    dropMemberData();
    navigate('/');
  };

  const createProfile = async (name: string, color: string) => {
    const { profile } = await api.createProfile(name, color);
    qc.setQueryData<{ profiles: Profile[] }>(['profiles'], (old) => ({
      profiles: [...(old?.profiles ?? []), profile],
    }));
    setProfileId(profile.id);
    setCurrentId(profile.id);
    dropMemberData();
    navigate('/');
  };

  const updateProfile = async (id: string, patch: { name?: string; color?: string }) => {
    const { profile } = await api.updateProfile(id, patch);
    qc.setQueryData<{ profiles: Profile[] }>(['profiles'], (old) => ({
      profiles: (old?.profiles ?? []).map((p) => (p.id === id ? { ...p, ...profile } : p)),
    }));
    qc.invalidateQueries({ queryKey: ['profiles'] });
  };

  const archiveProfile = async (id: string) => {
    await api.archiveProfile(id);
    const remaining = profiles.filter((p) => p.id !== id);
    qc.setQueryData<{ profiles: Profile[] }>(['profiles'], { profiles: remaining });
    if (currentId === id) {
      const next = remaining[0];
      if (next) switchProfile(next.id);
      else setCurrentId('');
    }
    qc.invalidateQueries({ queryKey: ['profiles'] });
  };

  const value: ProfileContextValue = {
    profiles,
    current,
    loading: profilesQ.isLoading,
    error: profilesQ.error,
    switchProfile,
    createProfile,
    updateProfile,
    archiveProfile,
    refresh: () => {
      void profilesQ.refetch();
    },
  };

  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>;
}

export function ProfileAvatar({ profile, size = 32 }: { profile: Profile; size?: number }) {
  return (
    <span
      className="profile-avatar"
      style={{
        background: profile.color || '#4f6ef7',
        width: size,
        height: size,
        fontSize: Math.round(size * 0.44),
      }}
      aria-hidden
    >
      {profile.name.slice(0, 1)}
    </span>
  );
}

export function ProfileCreateModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { createProfile } = useProfile();
  const [name, setName] = useState('');
  const [color, setColor] = useState(COLORS[0]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setName('');
      setColor(COLORS[0]);
    }
  }, [open]);

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      toast('请输入成员名字');
      return;
    }
    setSaving(true);
    try {
      await createProfile(trimmed, color);
      toast(`已添加成员「${trimmed}」`, 'success');
      onClose();
    } catch (e) {
      toast(e instanceof Error ? e.message : '添加失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={() => {
        if (!saving) onClose();
      }}
      title="添加家庭成员"
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={saving}>
            取消
          </button>
          <button className="btn btn-primary" onClick={submit} disabled={saving}>
            {saving ? '添加中…' : '添加并切换'}
          </button>
        </>
      }
    >
      <div className="stack">
        <label className="field">
          <span>名字</span>
          <input
            autoFocus
            maxLength={20}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例如：老婆、孩子"
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submit();
            }}
          />
        </label>
        <div>
          <div className="field-label">头像颜色</div>
          <div className="color-row">
            {COLORS.map((c) => (
              <button
                key={c}
                type="button"
                className={`color-swatch ${color === c ? 'active' : ''}`}
                style={{ background: c }}
                onClick={() => setColor(c)}
                aria-label={`选择颜色 ${c}`}
              />
            ))}
          </div>
        </div>
        <div className="notice">
          每个成员有独立的考试记录、练习记录和错题本；题库是共享的。
        </div>
      </div>
    </Modal>
  );
}

function ProfileManageModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { profiles, current, updateProfile, archiveProfile } = useProfile();
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) {
      setEditing(null);
      setName('');
    }
  }, [open]);

  const startEdit = (p: Profile) => {
    setEditing(p.id);
    setName(p.name);
  };

  const save = async (id: string) => {
    const trimmed = name.trim();
    if (!trimmed) {
      toast('名字不能为空');
      return;
    }
    setSaving(true);
    try {
      await updateProfile(id, { name: trimmed });
      toast('已改名', 'success');
      setEditing(null);
    } catch (e) {
      toast(e instanceof Error ? e.message : '改名失败');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (p: Profile) => {
    if (profiles.length <= 1) {
      toast('至少保留一个成员');
      return;
    }
    if (!window.confirm(`确定删除成员「${p.name}」？\n\n该成员的考试、练习和错题记录仍保留在数据库中，但不会再出现在成员列表。`)) {
      return;
    }
    setSaving(true);
    try {
      await archiveProfile(p.id);
      toast('已删除成员', 'success');
    } catch (e) {
      toast(e instanceof Error ? e.message : '删除失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="管理成员"
      footer={
        <button className="btn" onClick={onClose}>
          完成
        </button>
      }
    >
      <div className="manage-list">
        {profiles.map((p) => (
          <div key={p.id} className="manage-row">
            <ProfileAvatar profile={p} size={36} />
            {editing === p.id ? (
              <input
                className="input"
                autoFocus
                maxLength={20}
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void save(p.id);
                }}
              />
            ) : (
              <div className="manage-name">
                <b>{p.name}</b>
                {p.id === current?.id ? <span className="badge accent">当前</span> : null}
              </div>
            )}
            <div className="manage-actions">
              {editing === p.id ? (
                <>
                  <button className="btn btn-sm" onClick={() => setEditing(null)} disabled={saving}>
                    取消
                  </button>
                  <button className="btn btn-sm btn-primary" onClick={() => save(p.id)} disabled={saving}>
                    保存
                  </button>
                </>
              ) : (
                <button className="btn btn-sm" onClick={() => startEdit(p)}>
                  改名
                </button>
              )}
              <button
                className="btn btn-sm btn-danger"
                onClick={() => remove(p)}
                disabled={saving || profiles.length <= 1}
                title={profiles.length <= 1 ? '至少保留一个成员' : '删除成员'}
              >
                删除
              </button>
            </div>
          </div>
        ))}
      </div>
      <div className="notice" style={{ marginTop: 14 }}>
        删除是软删除：数据仍在数据库里，只是从成员列表隐藏；至少保留一个成员。
      </div>
    </Modal>
  );
}

export function ProfileMenu() {
  const { profiles, current, switchProfile, refresh } = useProfile();
  const [open, setOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    refresh();
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!current) return null;

  return (
    <div className="profile-menu" ref={ref}>
      <button
        className="profile-btn"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={`当前成员：${current.name}`}
      >
        <ProfileAvatar profile={current} size={28} />
        <span className="profile-name">{current.name}</span>
        <span className="profile-caret" aria-hidden>
          ▾
        </span>
      </button>

      {open ? (
        <div className="profile-dropdown">
          <div className="profile-dropdown-head">切换成员</div>
          {profiles.map((p) => (
            <button
              key={p.id}
              className={`profile-item ${p.id === current.id ? 'active' : ''}`}
              onClick={() => {
                setOpen(false);
                if (p.id !== current.id) switchProfile(p.id);
              }}
            >
              <ProfileAvatar profile={p} size={26} />
              <span>{p.name}</span>
              {p.id === current.id ? <span className="profile-check">✓</span> : null}
            </button>
          ))}
          <div className="profile-divider" />
          <button
            className="profile-item action"
            onClick={() => {
              setOpen(false);
              setCreateOpen(true);
            }}
          >
            ＋ 添加成员
          </button>
          <button
            className="profile-item action"
            onClick={() => {
              setOpen(false);
              setManageOpen(true);
            }}
          >
            ⚙ 管理成员
          </button>
        </div>
      ) : null}

      <ProfileCreateModal open={createOpen} onClose={() => setCreateOpen(false)} />
      <ProfileManageModal open={manageOpen} onClose={() => setManageOpen(false)} />
    </div>
  );
}

export function ProfileGate() {
  const { profiles, loading, error, switchProfile, refresh } = useProfile();
  const [createOpen, setCreateOpen] = useState(false);

  return (
    <div className="gate-page">
      <div className="gate-brand">
        <span className="brand-mark">行</span>
        <span className="brand-text">
          <b>行测真题</b>
          <small>2016–2026</small>
        </span>
      </div>

      {loading ? (
        <Loading text="正在加载成员…" />
      ) : error ? (
        <div className="gate-card card">
          <ErrorBox error={error} onRetry={refresh} />
        </div>
      ) : (
        <div className="gate-card card">
          <span className="eyebrow">家庭成员</span>
          <h1>谁在刷题？</h1>
          <p className="muted">
            选择自己的名字进入。每个人的考试记录、练习记录和错题本互相独立，题库共享。
          </p>
          <div className="gate-grid">
            {profiles.map((p) => (
              <button key={p.id} className="gate-option" onClick={() => switchProfile(p.id)}>
                <ProfileAvatar profile={p} size={46} />
                <b>{p.name}</b>
              </button>
            ))}
            <button className="gate-option add" onClick={() => setCreateOpen(true)}>
              <span className="gate-plus">＋</span>
              <b>添加成员</b>
            </button>
          </div>
        </div>
      )}

      <ProfileCreateModal open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  );
}
