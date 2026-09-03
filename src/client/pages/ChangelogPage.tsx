import { releases } from '../../shared/changelog';
import { useDocumentTitle } from '../use-document-title';

export function ChangelogPage() {
  useDocumentTitle('更新紀錄｜九合一選舉預測');
  return (
    <>
      <main className="page legal-page">
        <section className="page-heading">
          <h1>更新紀錄</h1>
        </section>
        <p className="legal-lede">這個站每次上版改了什麼，新的在最上面。</p>
        <ol className="changelog">
          {releases.map((release, index) => (
            <li key={release.version}>
              <div className="changelog-head">
                <strong className={index === 0 ? 'is-current' : undefined}>
                  v{release.version}
                </strong>
                <time dateTime={release.date}>{release.date}</time>
              </div>
              <ul>
                {release.changes.map((change) => (
                  <li key={change}>{change}</li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      </main>
    </>
  );
}
