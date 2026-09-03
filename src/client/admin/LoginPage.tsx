import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiError } from '../api';
import { adminLogin } from './api';

/** 一個密碼欄，換一顆 httpOnly cookie。ADMIN_TOKEN 只在這一次 POST 的 body 裡
 * 出現過，之後不管是 React state 還是 localStorage 都不會再留著它。 */
export function LoginPage() {
  const navigate = useNavigate();
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    if (!token || submitting) return;
    setSubmitting(true);
    setError('');
    try {
      await adminLogin(token);
      void navigate('/admin', { replace: true });
    } catch (failure) {
      if (failure instanceof ApiError && failure.status === 401) setError('Token 不正確。');
      else if (failure instanceof ApiError && failure.status === 429)
        setError('嘗試次數太多，一分鐘後再試一次。');
      else if (failure instanceof ApiError && failure.status === 503)
        setError('後台尚未啟用（伺服器沒有設定 ADMIN_TOKEN）。');
      else setError(failure instanceof Error ? failure.message : '登入失敗，請稍後再試。');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="admin-login">
      <form
        className="admin-login-card"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <h1>後台登入</h1>
        <input
          aria-label="ADMIN_TOKEN"
          autoComplete="off"
          autoFocus
          onChange={(event) => setToken(event.target.value)}
          type="password"
          value={token}
        />
        {error && <p className="admin-login-error">{error}</p>}
        <button
          className="button button-dark button-wide"
          disabled={!token || submitting}
          type="submit"
        >
          {submitting ? '登入中…' : '登入'}
        </button>
      </form>
    </div>
  );
}
