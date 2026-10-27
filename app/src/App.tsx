import { useEffect, useState } from 'react';
import { Link, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { ToastHost } from './components/ui';
import { ProfileGate, ProfileMenu, ProfileProvider, useProfile } from './profile';
import Home from './pages/Home';
import ExamNew from './pages/ExamNew';
import ExamRun from './pages/ExamRun';
import ExamResult from './pages/ExamResult';
import PracticeNew from './pages/PracticeNew';
import PracticeRun from './pages/PracticeRun';
import PracticeResult from './pages/PracticeResult';
import WrongBook from './pages/WrongBook';
import Stats from './pages/Stats';
import Search from './pages/Search';
import Flags from './pages/Flags';

type Theme = 'light' | 'dark' | 'system';
const THEME_KEY = 'xczt.theme';

function resolveTheme(theme: Theme): boolean {
  if (theme === 'system') return window.matchMedia('(prefers-color-scheme: dark)').matches;
  return theme === 'dark';
}

function applyTheme(theme: Theme): void {
  const dark = resolveTheme(theme);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
}

function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      return (localStorage.getItem(THEME_KEY) as Theme) || 'system';
    } catch {
      return 'system';
    }
  });

  useEffect(() => {
    applyTheme(theme);
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* ignore */
    }
    if (theme !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => applyTheme('system');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [theme]);

  const next: Theme = theme === 'light' ? 'dark' : theme === 'dark' ? 'system' : 'light';
  const label = theme === 'light' ? '浅色' : theme === 'dark' ? '深色' : '跟随系统';
  const icon = theme === 'light' ? '☀' : theme === 'dark' ? '☾' : '◐';
  return (
    <button className="theme-toggle" onClick={() => setTheme(next)} title={`当前：${label}，点击切换`}>
      <span aria-hidden>{icon}</span>
      <span className="theme-label">{label}</span>
    </button>
  );
}

function ScrollTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [pathname]);
  return null;
}

function Shell() {
  const { current } = useProfile();

  if (!current) return <ProfileGate />;

  return (
    <div className="app">
      <ScrollTop />
      <header className="header">
        <div className="header-inner">
          <Link to="/" className="brand" aria-label="返回首页">
            <span className="brand-mark">行</span>
            <span className="brand-text">
              <b>行测真题</b>
              <small>2016–2026</small>
            </span>
          </Link>
          <nav className="nav">
            <NavLink to="/" end>
              首页
            </NavLink>
            <NavLink to="/exam/new">考试</NavLink>
            <NavLink to="/practice/new">练习</NavLink>
            <NavLink to="/wrong">错题本</NavLink>
            <NavLink to="/stats">统计</NavLink>
            <NavLink to="/search">搜索</NavLink>
          </nav>
          <ProfileMenu />
          <ThemeToggle />
        </div>
      </header>

      <main className="main">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/exam/new" element={<ExamNew />} />
          <Route path="/exam/:id" element={<ExamRun />} />
          <Route path="/exam/:id/result" element={<ExamResult />} />
          <Route path="/practice/new" element={<PracticeNew />} />
          <Route path="/practice/:id" element={<PracticeRun />} />
          <Route path="/practice/:id/result" element={<PracticeResult />} />
          <Route path="/wrong" element={<WrongBook />} />
          <Route path="/stats" element={<Stats />} />
          <Route path="/search" element={<Search />} />
          <Route path="/flags" element={<Flags />} />
          <Route path="*" element={<Home />} />
        </Routes>
      </main>

      <footer className="footer">
        <span>题库 515 套 · 58,890 题 · 图片本地化</span>
        <span>仅供个人学习使用</span>
      </footer>
    </div>
  );
}

export default function App() {
  return (
    <ProfileProvider>
      <Shell />
      <ToastHost />
    </ProfileProvider>
  );
}
