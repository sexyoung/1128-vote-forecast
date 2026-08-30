import { useEffect } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { adminLogout, setUnauthorizedHandler } from './api';
import { AnnouncementPage } from './AnnouncementPage';
import { CandidateImportPage } from './CandidateImportPage';
import { LoginPage } from './LoginPage';
import { ModerationPage } from './ModerationPage';
import { OverviewPage } from './OverviewPage';

const navItems = [
  { to: '/admin', label: '總覽', end: true },
  { to: '/admin/candidates', label: '候選人' },
  { to: '/admin/moderation', label: '檢舉／留言' },
  { to: '/admin/announcement', label: '公告' },
];

/**
 * 這裡刻意不用 ../pages/ElectionPrototypeShared 的 PageShell／AppHeader：那個檔案
 * 拉進 SearchBox → search.ts → council-districts.ts（581 行），公開頁面用不到的
 * 東西不該因為共用一個 header 元件而一起進到後台這個 chunk，也不該讓打包器因為
 * 有共用邊界而把後台程式碼往回搬進公開頁面的入口 chunk。
 */
function AdminHeader() {
  const navigate = useNavigate();

  async function logout() {
    try {
      await adminLogout();
    } finally {
      void navigate('/admin/login', { replace: true });
    }
  }

  return (
    <header className="admin-header">
      <span className="admin-brand">後台</span>
      <nav aria-label="後台選單" className="admin-nav">
        {navItems.map((item) => (
          <NavLink end={item.end} key={item.to} to={item.to}>
            {item.label}
          </NavLink>
        ))}
      </nav>
      <button
        className="button button-ghost button-small"
        onClick={() => void logout()}
        type="button"
      >
        登出
      </button>
    </header>
  );
}

/** SSR 那邊已經對 /admin* 送出 noindex 的 shell；這裡補上是為了 CSR 直接切換路由
 * 進來（開發模式、或伺服端 meta 表還沒接上）時，這個分頁也不會被索引到。 */
function useNoIndexMeta() {
  useEffect(() => {
    let tag = document.querySelector('meta[name="robots"]');
    const created = !tag;
    if (!tag) {
      tag = document.createElement('meta');
      tag.setAttribute('name', 'robots');
      document.head.appendChild(tag);
    }
    const previous = tag.getAttribute('content');
    tag.setAttribute('content', 'noindex,nofollow,noarchive');
    return () => {
      if (created) tag?.remove();
      else if (previous !== null) tag?.setAttribute('content', previous);
    };
  }, []);
}

export default function AdminApp() {
  const navigate = useNavigate();
  const location = useLocation();

  useNoIndexMeta();

  // 任何一次 401（session 過期、還沒登入）都導回登入頁——後台只有站長一個人用，
  // 不必替每個頁面各自寫一次這個判斷。
  useEffect(() => {
    setUnauthorizedHandler(() => navigate('/admin/login', { replace: true }));
    return () => setUnauthorizedHandler(null);
  }, [navigate]);

  const isLogin = location.pathname === '/admin/login';

  return (
    <div className="admin-shell">
      {!isLogin && <AdminHeader />}
      <main className="admin-page">
        <Routes>
          <Route element={<OverviewPage />} index />
          <Route element={<LoginPage />} path="login" />
          <Route element={<CandidateImportPage />} path="candidates" />
          <Route element={<ModerationPage />} path="moderation" />
          <Route element={<AnnouncementPage />} path="announcement" />
          <Route element={<Navigate replace to="/admin" />} path="*" />
        </Routes>
      </main>
    </div>
  );
}
