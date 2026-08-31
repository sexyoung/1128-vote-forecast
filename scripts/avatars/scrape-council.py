"""各縣市議會官網通用抓圖：找議員名錄頁 -> 也跟進細節頁 -> 以姓名鄰近文字配對照片。"""
import json, re, sys, urllib.parse, subprocess, concurrent.futures as cf

UA = 'Mozilla/5.0'
def get(u):
    try:
        b = subprocess.run(['curl','-sL','-m','25','-A',UA,'--compressed',u], capture_output=True, timeout=40).stdout
    except Exception:
        return ''
    for enc in ('utf-8','big5','cp950'):
        try: return b.decode(enc)
        except UnicodeDecodeError: continue
    return b.decode('utf-8','replace')

SKIP = ('logo','icon','banner','btn','bg.','spacer','.svg','.gif','weather','print','share','qrcode')
IMG = re.compile(r'<img[^>]+?src=["\']([^"\']+)["\'][^>]*>', re.I)

def extract(html, base, names, found):
    for m in IMG.finditer(html):
        src = m.group(1)
        if any(k in src.lower() for k in SKIP): continue
        ctx = html[max(0, m.start()-600): m.end()+600] + urllib.parse.unquote(src)
        for n in names:
            if n in ctx and n not in found:
                found[n] = urllib.parse.urljoin(base, src)

def links_with(html, base, pat):
    out = []
    for m in re.finditer(r'<a[^>]+href=["\']([^"\']+)["\'][^>]*>(.{0,120}?)</a>', html, re.S):
        href, text = m.group(1), re.sub(r'<[^>]+>', '', m.group(2))
        if pat.search(href) or pat.search(text): out.append(urllib.parse.urljoin(base, href.strip()))
    return list(dict.fromkeys(out))

def run(jid, home, seeds=None):
    miss = [x for x in json.load(open('missing.json')) if x['contestId'].startswith(jid + '-')]
    names = {x['name'] for x in miss}
    found = {}
    listing = re.compile(r'議員|councilor|member', re.I)
    pages = seeds or [home]
    if not seeds:
        pages += links_with(get(home), home, listing)[:10]
    seen = set()
    for u in pages[:14]:
        if u in seen: continue
        seen.add(u)
        h = get(u)
        if not h: continue
        extract(h, u, names, found)
        detail = [d for d in links_with(h, u, listing) if d not in seen][:80]
        if detail:
            with cf.ThreadPoolExecutor(8) as ex:
                for du, dh in zip(detail, ex.map(get, detail)):
                    seen.add(du)
                    if dh: extract(dh, du, names, found)
    json.dump({'home': home, 'hits': found}, open(f'src_{jid}.json','w'), ensure_ascii=False, indent=1)
    print(f'{jid}: {len(found)}/{len(miss)}')
    return len(found), len(miss)

if __name__ == '__main__':
    run(sys.argv[1], sys.argv[2], sys.argv[3:] or None)
