import { Icon, PageShell, PrototypeNotice } from './ElectionPrototypeShared';

export function MyPredictionsPage() {
  const examples = [
    {
      jurisdiction: '臺北市',
      contest: '臺北市長',
      target: '民進黨',
      color: '#2c8a64',
      status: '目前領先',
    },
    {
      jurisdiction: '新北市',
      contest: '議員第 3 選舉區',
      target: '國民黨 3 席、民進黨 2 席',
      color: '#3f69b1',
      status: '已送出',
    },
    {
      jurisdiction: '新竹市',
      contest: '新竹市長',
      target: '民眾黨',
      color: '#28a5a5',
      status: '目前領先',
    },
  ];
  return (
    <PageShell>
      <PrototypeNotice />
      <main className="page mine-page">
        <section className="mine-heading">
          <div>
            <span className="eyebrow">MY FORECASTS</span>
            <h1>我的預測</h1>
            <p>匿名使用也能在這台裝置查看與修改紀錄。</p>
          </div>
          <div className="anonymous-id">
            <Icon name="user" />
            <span>
              <strong>匿名身份 #8F2A</strong>
              <small>已保護這台裝置上的預測</small>
            </span>
          </div>
        </section>
        <div className="mine-layout">
          <section>
            <div className="section-heading">
              <h2>已預測 3 個選區</h2>
              <span>最近更新：今天</span>
            </div>
            <div className="prediction-list">
              {examples.map((item) => (
                <article key={item.contest}>
                  <i style={{ background: item.color }} />
                  <div>
                    <span>{item.jurisdiction}</span>
                    <h3>{item.contest}</h3>
                    <p>
                      我的預測：<strong>{item.target}</strong>
                    </p>
                  </div>
                  <div>
                    <small>{item.status}</small>
                    <button type="button">修改</button>
                  </div>
                </article>
              ))}
            </div>
          </section>
          <aside className="account-card" id="account">
            <span className="account-icon">
              <Icon name="spark" />
            </span>
            <h2>建立帳號，帶著預測走</h2>
            <p>註冊後可跨裝置保留預測，並在選區結果下留言。</p>
            <button className="button button-dark button-wide" type="button">
              建立免費帳號
            </button>
            <button className="button button-ghost button-wide" type="button">
              我已經有帳號
            </button>
            <small>註冊不會增加預測權重。</small>
          </aside>
        </div>
      </main>
    </PageShell>
  );
}
