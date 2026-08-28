import {
  type CSSProperties,
  type FormEvent,
  type ReactNode,
  createContext,
  useContext,
  useState,
} from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { highlightParts, searchEverything } from '../search';
import {
  type Contest,
  type ElectionView,
  type Jurisdiction,
  electionViews,
  getParty,
} from '../mock-election';

export type CandidatePhase = 'party' | 'candidate';

type PrototypeContextValue = {
  phase: CandidatePhase;
  setPhase: (phase: CandidatePhase) => void;
};

const PrototypeContext = createContext<PrototypeContextValue | null>(null);

export function PrototypeProvider({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<CandidatePhase>('party');
  return (
    <PrototypeContext.Provider value={{ phase, setPhase }}>{children}</PrototypeContext.Provider>
  );
}

export function usePrototype() {
  const value = useContext(PrototypeContext);
  if (!value) throw new Error('PrototypeProvider is missing.');
  return value;
}

export function Icon({
  name,
}: {
  name:
    | 'map'
    | 'search'
    | 'user'
    | 'spark'
    | 'chevron'
    | 'close'
    | 'vote'
    | 'stamp'
    | 'check'
    | 'back';
}) {
  const paths = {
    map: <path d="m3 6 5-2 8 3 5-2v13l-5 2-8-3-5 2V6Zm5-2v13m8-10v13" />,
    search: <path d="m21 21-4.4-4.4m2.4-5.1a7.5 7.5 0 1 1-15 0 7.5 7.5 0 0 1 15 0Z" />,
    user: <path d="M20 21a8 8 0 0 0-16 0m12-13a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z" />,
    spark: (
      <path d="m12 2 1.6 5.4L19 9l-5.4 1.6L12 16l-1.6-5.4L5 9l5.4-1.6L12 2Zm7 13 .8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15Z" />
    ),
    chevron: <path d="m9 18 6-6-6-6" />,
    close: <path d="m6 6 12 12M18 6 6 18" />,
    vote: <path d="M5 10h14l2 4v7H3v-7l2-4Zm2-7h10v7H7V3Zm2 3 2 2 4-4" />,
    // 圈選章蓋出來的記號：圓圈內一豎，再往左下拉一撇。
    stamp: (
      <>
        <circle cx="12" cy="12" r="9.6" />
        <path d="M12 2.4v19.2m0-9.6-6.8 6.8" />
      </>
    ),
    check: <path d="m4 12 5 5L20 6" />,
    back: <path d="m15 18-6-6 6-6" />,
  };
  return (
    <svg
      aria-hidden="true"
      className="icon"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
    >
      {paths[name]}
    </svg>
  );
}

// 縣市搜尋是通往 /region 與 /contest 的唯一入口，所以頁首、/mine 與地圖共用同一個。
// 命中的字加橘底，其餘照原樣。
function Highlighted({ query, text }: { query: string; text: string }) {
  return (
    <>
      {highlightParts(text, query).map((part, index) =>
        part.hit ? (
          // 片段沒有天然的 key，但這個陣列只依 text／query 產生，順序穩定。
          // biome-ignore lint/suspicious/noArrayIndexKey: 片段沒有 id
          <mark key={index}>{part.text}</mark>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: 片段沒有 id
          <span key={index}>{part.text}</span>
        ),
      )}
    </>
  );
}

export function SearchBox({ autoFocus = false, className = '' }) {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const matches = searchEverything(search);

  function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (matches[0]) void navigate(matches[0].to);
  }

  return (
    <form className={`header-search ${className}`} onSubmit={handleSearch}>
      <Icon name="search" />
      <input
        aria-label="搜尋縣市、選區、職務或候選人"
        autoFocus={autoFocus}
        onChange={(event) => setSearch(event.target.value)}
        placeholder="搜尋縣市、選區或候選人"
        value={search}
      />
      {matches.length > 0 && (
        <div className="search-results">
          {matches.map((hit) => (
            <button key={hit.id} onClick={() => void navigate(hit.to)} type="button">
              <strong>
                <Highlighted query={search} text={hit.label} />
              </strong>
              <span>{hit.sub}</span>
            </button>
          ))}
        </div>
      )}
    </form>
  );
}

// overlay：地圖是滿版的，頁首浮在上面而不是把地圖往下擠——使用者要的就是那個
// 滿版的地圖。頁首本來就是半透明加毛玻璃，蓋上去看得到底下。
export function AppHeader({ overlay = false }: { overlay?: boolean }) {
  return (
    <header className={`app-header ${overlay ? 'app-header-overlay' : ''}`}>
      <Link className="brand" to="/">
        <span>
          <strong>九合一選舉預測</strong>
          <small>2026.11.28 投票</small>
        </span>
      </Link>

      <SearchBox />

      {/* 登入／建立帳號集中在 /mine 的帳號卡，頁首只留去處，不放轉換動作。 */}
      <HeaderNav />
    </header>
  );
}

// 桌機的主選單，跟手機底部選單同一組去處。地圖頁自己有浮動按鈕，不吃這個頁首。
export function HeaderNav() {
  return (
    <nav className="header-nav" aria-label="主選單">
      <NavLink end to="/">
        <Icon name="map" />
        地圖
      </NavLink>
      <NavLink to="/regions">
        <Icon name="stamp" />
        選區
      </NavLink>
      <NavLink to="/mine">
        <Icon name="vote" />
        我的
      </NavLink>
    </nav>
  );
}

function MobileNav() {
  return (
    <nav className="mobile-nav" aria-label="手機主選單">
      {/* end：沒有它的話 "/" 會匹配每一條路由，「地圖」就永遠是選取狀態。 */}
      <NavLink end to="/">
        <Icon name="map" />
        <span>地圖</span>
      </NavLink>
      <NavLink to="/regions">
        <Icon name="stamp" />
        <span>選區</span>
      </NavLink>
      <NavLink to="/mine">
        <Icon name="vote" />
        <span>我的</span>
      </NavLink>
    </nav>
  );
}

export function PageShell({ children, header }: { children: ReactNode; header?: ReactNode }) {
  return (
    <div className="app-shell">
      {header ?? <AppHeader />}
      {children}
      <MobileNav />
    </div>
  );
}

export function ElectionTabs({
  value,
  onChange,
  // 沒給就全部列出。直轄市與市沒有鄉鎮市長、代表選舉，那兩個分頁不該出現。
  available = () => true,
  // 每個分頁底下有幾個選區。縣市長只有一場，回 null 就不顯示。
  count = () => null,
}: {
  value: ElectionView;
  onChange: (value: ElectionView) => void;
  available?: (view: ElectionView) => boolean;
  count?: (view: ElectionView) => number | null;
}) {
  return (
    <div className="election-tabs" role="tablist" aria-label="選舉種類">
      {electionViews
        .filter((item) => available(item.id))
        .map((item) => {
          const total = count(item.id);
          return (
            <button
              aria-selected={value === item.id}
              className={value === item.id ? 'active' : ''}
              key={item.id}
              onClick={() => onChange(item.id)}
              role="tab"
              type="button"
            >
              {item.label}
              {total !== null && <span>{total}</span>}
            </button>
          );
        })}
      <button className="indigenous-tab" type="button">
        原住民選區 <span>獨立圖層</span>
      </button>
    </div>
  );
}

export function Breadcrumbs({
  jurisdiction,
  contest,
}: {
  jurisdiction: Jurisdiction;
  contest?: Contest;
}) {
  return (
    <nav className="breadcrumbs" aria-label="麵包屑">
      <Link to="/regions">全國</Link>
      <span>/</span>
      {contest ? (
        <Link to={`/region/${jurisdiction.id}`}>{jurisdiction.name}</Link>
      ) : (
        <strong>{jurisdiction.name}</strong>
      )}
      {contest && (
        <>
          <span>/</span>
          <strong>{contest.name}</strong>
        </>
      )}
    </nav>
  );
}

// 卡片頂端的封面：滿寬的大頭照位置（正式版換成領先者的照片，現在先放名字的
// 第一個字當底），行政區與選舉名稱直接壓在照片上。
export function CardCover({
  kicker,
  title,
  meta,
  // 候選人照片，來自 public/avatars/。沒有就留一塊淺灰的空位——名單要到 2026-11
  // 中選會公告才會齊，在那之前絕大多數選區都不會有。
  photo,
}: {
  kicker: string;
  title: string;
  meta: string;
  photo?: string | null;
}) {
  return (
    <div className="card-cover">
      {/* 照片還沒有就留一塊淺灰的空位，不放字：填名字的第一個字會被誤讀成資訊。 */}
      <i>{photo ? <img alt="" src={photo} /> : null}</i>
      <div>
        <span>{kicker}</span>
        <strong>{title}</strong>
        <small>{meta}</small>
      </div>
    </div>
  );
}

// 卡片裡的候選人清單：一位一行，色點、名字、份數、佔比，底下各自一條長條。
export function CandidateList({
  rows,
  forecasts,
  // /mine 用來標出自己押的那一列。純樣式，不多塞元素——這個 li 是四欄格線，
  // 多一個子元素會把長條那一列擠掉。
  highlightId,
  winnerCount = 0,
}: {
  rows: { id: string; label: string; color: string; value: number; photo?: string | null }[];
  forecasts: number;
  highlightId?: string;
  winnerCount?: number;
}) {
  return (
    <ul className="candidate-list">
      {rows.map((row, index) => {
        const winner = index < winnerCount;
        return (
          <li
            className={`${row.id === highlightId ? 'mine' : ''} ${winner ? 'winner' : ''}`.trim()}
            key={row.id}
          >
            <i
              className="candidate-avatar"
              style={{ '--candidate-color': row.color } as CSSProperties}
            >
              {row.photo ? <img alt="" src={row.photo} /> : <Icon name="user" />}
            </i>
            <span>
              <span>{row.label}</span>
              {/* 自己押的那一位在名字後面蓋一個紅色圈選章。 */}
              {row.id === highlightId && <Icon name="stamp" />}
            </span>
            <small>{Math.round((forecasts * row.value) / 100).toLocaleString()} 份</small>
            <b style={winner ? { color: row.color } : undefined}>{row.value}%</b>
            <em>
              <s style={{ background: row.color, width: `${row.value}%` }} />
            </em>
          </li>
        );
      })}
    </ul>
  );
}

// 送出／修改預測的按鈕，地圖抽屜與 /contest 共用同一顆，樣式與文案只有一份。
export function ForecastButton({
  editing = false,
  onClick,
}: {
  editing?: boolean;
  onClick: () => void;
}) {
  return (
    <button className="button button-glass button-wide" onClick={onClick} type="button">
      <Icon name="stamp" />
      {editing ? '修改我的預測' : '送出我的預測'}
    </button>
  );
}

export function LeadingBadge({ contest }: { contest: Contest }) {
  const party = getParty(contest.leader);
  return (
    <span className="leading-badge" style={{ '--party-color': party.color } as CSSProperties}>
      <i />
      {party.shortName}暫時領先
    </span>
  );
}
