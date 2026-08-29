import { Link } from 'react-router-dom';
import { useDocumentTitle } from '../use-document-title';
import { PageShell } from './ElectionPrototypeShared';

export function NotFoundPage() {
  useDocumentTitle('找不到頁面｜九合一選舉預測');
  return (
    <PageShell>
      <main className="page">
        <section className="page-heading">
          <h1>找不到這個頁面</h1>
          <Link className="button" to="/">
            回預測地圖
          </Link>
        </section>
      </main>
    </PageShell>
  );
}
