"""產生 TGOS 批次門牌比對的上傳檔。

資料來源是 `data/staged/*.ndjson`（L1 全部來源），不是上網重抓。2026-09-11 第一版直接抓
5 個站，之後接的 13 支來源地址從來沒進過上傳檔；改讀 staged 之後 18 支來源一次收齊。

唯一保留的網路抓取是教育部學校名錄（`SCHOOL_DIRS`）：staged 裡沒有任何一支來源是學校名錄，
而「地址欄只寫校名」的情況只能靠它換成門牌（例：`後甲國中`、`校本部（河濱國小)`）。
不想連網就加 `--offline`，那些字串會直接進 unresolved.csv。

三個關鍵概念，混在一起就會對不回座標：

  索引鍵 key    `transform/resolve-relations.mjs` 的 `normAddress()` 輸出。管線用它當
                場館的 address 欄、也用它查 `geocode/out/geocoded.csv`。本檔的
                `norm_address()` 是該函式的逐行移植，已對 staged 全部 11,600 個地址字串
                比對過，0 筆不一致。**回填時必須用這個鍵**，否則座標對不回場館。
  上傳地址      送 TGOS 比對的門牌。key 不見得能直接送（缺縣市、夾郵遞區號、只寫校名），
                所以另外整理一份；`address_map.csv` 同時記 key 與上傳地址。
  已有座標      名錄自帶座標（運動場館、公共圖書館、北市運動中心）的門牌不必送。

產出（geocode/out/）：
  tgos_upload.csv   TGOS 範本格式（UTF-8 BOM、CRLF、id,Address,Response_Address,Response_X,Response_Y）
                    超過每日上限（預設 10,000）才拆成 tgos_upload_1.csv、tgos_upload_2.csv…，
                    id 跨批唯一，回填時不必管是哪一批。
  address_map.csv   key／上傳地址／原始字串／來源／方法／筆數，取回結果後 import_tgos_results.py 用它回填
  unresolved.csv    湊不出門牌的字串，依影響筆數排序（不編造地址）

用法：python3 geocode/build_tgos_input.py [--offline] [--batch-size 10000]
"""

import argparse
import csv
import io
import json
import re
import ssl
import sys
import urllib.request
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = Path(__file__).parent / 'out'
STAGED = ROOT / 'data' / 'staged'
VENUES = ROOT / 'data' / 'venues.ndjson'

UA = 'kho.tw-geocode/0.1'
TIMEOUT = 300
# 部分政府站（stats.moe.gov.tw、depart.moe.edu.tw）憑證缺 Subject Key Identifier，
# Python 3.13+ 的 X509_STRICT 會拒絕；只關這個旗標，憑證鏈與主機名稱照常驗證。
SSL_CTX = ssl.create_default_context()
SSL_CTX.verify_flags &= ~ssl.VERIFY_X509_STRICT

SCHOOL_DIRS = [
    'https://stats.moe.gov.tw/files/school/115/e1_new.csv',
    'https://stats.moe.gov.tw/files/opendata/j1_new.csv',
    'https://stats.moe.gov.tw/files/school/115/high.csv',
    'https://stats.moe.gov.tw/files/opendata/u1_new.csv',
]

# TGOS 一般批次每日上限
DAILY_LIMIT = 10000

COUNTIES = ['臺北市', '新北市', '桃園市', '臺中市', '臺南市', '高雄市', '基隆市', '新竹市', '嘉義市',
            '新竹縣', '苗栗縣', '彰化縣', '南投縣', '雲林縣', '嘉義縣', '屏東縣', '宜蘭縣', '花蓮縣',
            '臺東縣', '澎湖縣', '金門縣', '連江縣']
COUNTY_RE = '|'.join(COUNTIES)
CN_DIGIT = {'零': 0, '〇': 0, '一': 1, '二': 2, '三': 3, '四': 4, '五': 5,
            '六': 6, '七': 7, '八': 8, '九': 9}


# ---------------------------------------------------------------- 正規化

def cn_to_int(s):
    """一～九百九十九的中文數字轉整數；不是中文數字回傳 None。"""
    if not s or any(c not in CN_DIGIT and c not in '十百' for c in s):
        return None
    total = cur = 0
    for c in s:
        if c == '百':
            total += (cur or 1) * 100
            cur = 0
        elif c == '十':
            total += (cur or 1) * 10
            cur = 0
        else:
            cur = CN_DIGIT[c]
    return total + cur


def _cn_unit_sub(m):
    n = cn_to_int(m.group(1))
    return m.group(0) if n is None else f'{n}{m.group(0)[-1]}'


def norm_address(raw):
    """transform/resolve-relations.mjs 的 normAddress() 逐行移植。

    管線用它的輸出當場館 address、也用它查 geocoded.csv，所以這裡**一個字都不能改**。
    要改就得兩邊一起改，不然座標對不回場館。
    """
    s = ('' if raw is None else str(raw)).strip()
    if not s:
        return ''
    s = s.translate({ord(c): ord(c) - 0xFEE0 for c in '０１２３４５６７８９'})
    s = s.replace('台', '臺')
    s = re.sub(r'\s+', '', s)
    s = re.sub(r'^\d{3,6}', '', s)
    s = re.sub(r'[（(][^）)]*[）)]?', '', s)
    s = re.sub(r'([零〇一二三四五六七八九十]+)段', _cn_unit_sub, s, count=1)
    s = re.sub(r'([零〇一二三四五六七八九十百]+)號', _cn_unit_sub, s, count=1)
    s = re.sub(r'(\d+)[-~](\d+)號', r'\1之\2號', s, count=1)
    m = re.match(r'^(.*?\d+(?:之\d+)?號)', s)
    return m.group(1) if m else s


def county_of(s):
    return next((c for c in COUNTIES if (s or '').startswith(c)), None)


def clean_address(raw, county=None):
    """把自由文字整理成 TGOS 送得出去的門牌；不像門牌時回傳 None。

    沿用第一版的 normalize()，另外多兩條：段號的中文數字也要轉（與 normAddress() 對齊），
    以及拔掉夾在字串中間的郵遞區號（`臺北市信義區110臺北市信義區松仁路158巷1號`，實際出現 3 筆）。
    """
    s = (raw or '').strip()
    if not s:
        return None
    s = s.translate({ord(c): ord(c) - 0xFEE0 for c in '０１２３４５６７８９－'})
    s = s.replace('台', '臺').replace('（', '(').replace('）', ')').replace('：', ':')
    s = re.sub(r'\s+', '', s)
    s = re.sub(r'^\[\d+\]', '', s)
    s = re.sub(r'^\d{3,6}', '', s)
    # 「臺北市信義區110臺北市信義區松仁路158巷1號」：縣市＋行政區＋郵遞區號後面又接一次縣市
    s = re.sub(rf'^(?:{COUNTY_RE}).{{0,4}}?\d{{3,6}}(?={COUNTY_RE})', '', s)
    if ':' in s:  # 「公民教室:承德路四段190號2樓」取冒號後
        s = s.split(':')[-1]
    m = re.search(r'\(([^()]*號)', s)  # 「後甲國中(東區林森路二段260號」取括號內
    if m:
        s = m.group(1)
    s = re.sub(r'\([^()]*\)?', '', s)
    # ── 下面四條清掉 TGOS 比不到門牌的贅字。2026-09-13 第一批回來的 338 個
    #    查無座標地址裡，這四類佔 82 種、影響約 1,080 筆 L1；不清就是再送一次、
    #    再失敗一次，白耗每日額度。順序不能換：先拔贅詞，重複的行政區才會相鄰。
    #
    # 1. 夾在行政區後面的部門字樣：「臺北市北投區校本部北投區中山路5之12號」
    #    限定跟在「區鄉鎮市」之後才拔，免得誤傷「本部路」這種真的路名。
    s = re.sub(r'(?<=[區鄉鎮市])(校本部|總校區|校區|本部|分部|分校|教室)', '', s)
    # 2. 縣市簡稱又寫一次：「臺北市中山區北市中山區吉林路110號」
    #
    #    後面接路名要素時不可以拔——「雲林縣西螺鎮中市路31號」的「中市路」是真實路名，
    #    第一版把它拔成「雲林縣西螺鎮路31號」，而且這個門牌本來已經編碼成功了。
    #    （拿 git 裡的舊版並排跑 geocoded.csv 全部 2,953 筆才抓到這一筆。）
    s = re.sub(r'(?<=[區鄉鎮市])(北市|中市|南市|高市|北縣)(?![路街巷弄段里村]|大道)', '', s)
    # 3. 行政區整個重複：「臺北市士林區士林區承德路4段177號」
    s = re.sub(r'([一-龥]{1,4}[區鄉鎮市])\1', r'\1', s)
    # 4. 與行政區同名的園區名不是門牌要素：「臺南市官田區官田工業區工業路40號」
    #    → 「官田區官田工業區」收成「官田區」。
    #
    #    只拔「和前面行政區同名」的那一種，不是看到「工業區」就拔。第一版寫成
    #    r'[一-龥]{0,4}(工業區|…)' ，貪婪的 {0,4} 會往前吃掉行政區本身：
    #      臺南市官田區官田工業區工業路40號 → 臺南市官工業路40號（「田區官田」被吃掉）
    #      臺中市西屯區工業區一路100號     → 臺中市臺中一路100號（「西屯區」被吃掉）
    #    而「工業區一路」是臺中真實路名，根本不該碰。收窄成同名才拔之後，
    #    後者不匹配（要有「西屯區西屯工業區」才會命中），不會再被動到。
    #    Python 的 lookbehind 要求固定寬度，所以用捕獲組回填而不是 (?<=...)。
    s = re.sub(r'([一-龥]{1,3})區\1(工業區|科學園區|工商綜合區|產業園區)', r'\1區', s)
    s = re.sub(r'([零〇一二三四五六七八九十]+)段', _cn_unit_sub, s, count=1)
    s = re.sub(r'([零〇一二三四五六七八九十百]+)號', _cn_unit_sub, s, count=1)
    s = re.sub(r'(\d+)[-~](\d+)號', r'\1之\2號', s, count=1)
    m = re.match(r'^(.*?\d+(?:之\d+)?號)', s)
    if not m:
        return None
    s = m.group(1)
    if county and not county_of(s):
        s = county + s
    if not county_of(s):
        return None
    if re.search(r'(路|街|大道|巷|弄|村|里|鄰|段)', s):
        return s
    # 鄉下地址沒有路名：「臺南市麻豆區總爺104號」「雲林縣元長鄉1612號」都是 TGOS 查得到的
    # 正式門牌，第一版要求一定要有路名，把這類全丟進 unresolved（實測 49 筆）。
    # 但「教室3號」這種只有數字的字串仍必須擋掉，所以改成要求縣市後面接得出鄉鎮市區。
    return s if re.match(rf'^(?:{COUNTY_RE})[^0-9]{{1,4}}?[區鄉鎮市]', s) else None


SCHOOL_PREFIX = re.compile(r'^(國立|市立|縣立|私立|臺北市立|新北市立|桃園市立|臺中市立|臺南市立|高雄市立)')
SCHOOL_ALIAS = [('國民小學', '國小'), ('國民中學', '國中'), ('高級中等學校', '高中'), ('高級中學', '高中'),
                ('高級工業職業學校', '高工'), ('高級商業職業學校', '高商'), ('高級家事商業職業學校', '高商'),
                ('高級農工職業學校', '高農'), ('完全中學', '中學'), ('科技大學', '科大')]


def place_candidates(raw):
    """從「校本部（河濱國小)」「東勢區-東勢高工」「文澳國小教室」這類字串拆出可能的校名。"""
    s = re.sub(r'\s+', '', (raw or '').replace('台', '臺').replace('（', '(').replace('）', ')'))
    parts = re.split(r'[()\-－—,，、/:：]+', s)
    out = []
    for p in parts:
        p = re.sub(r'(教室|校區|校本部|分部|本部)$', '', p)
        if len(p) >= 3:
            out.append(p)
        # 「東勢區東勢高工」去掉行政區前綴；原字串也保留，避免「新市國小」被切成「國小」
        m = re.match(r'^.{1,3}[區鄉鎮市](.{3,})$', p)
        if m and re.search(r'(國小|國中|高中|高工|高商|高農|大學|科大)$', m.group(1)):
            out.append(m.group(1))
    return out


def school_keys(name):
    base = SCHOOL_PREFIX.sub('', re.sub(r'\s+', '', (name or '').replace('台', '臺')))
    base = re.sub(r'^(臺北|新北|桃園|臺中|臺南|高雄)市', '', base)
    keys = {base} if base else set()
    for long, short in SCHOOL_ALIAS:
        if long in base:
            keys.add(base.replace(long, short))
    return keys


# ---------------------------------------------------------------- 讀取

def fetch(url):
    req = urllib.request.Request(url, headers={'User-Agent': UA})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT, context=SSL_CTX) as r:
                return r.read()
        except Exception as e:  # noqa: BLE001
            if attempt == 2:
                raise
            print(f'retry {url[:60]}: {e}', file=sys.stderr)


def read_csv(raw):
    for enc in ('utf-8-sig', 'cp950'):
        try:
            return list(csv.DictReader(io.StringIO(raw.decode(enc))))
        except UnicodeDecodeError:
            continue
    raise ValueError('無法判斷編碼')


def build_school_index():
    """(縣市, 校名鍵) → {門牌}。只有這份資料 staged 裡沒有，所以還是上網抓。"""
    idx = defaultdict(set)
    for url in SCHOOL_DIRS:
        rows = read_csv(fetch(url))
        latest = max(r['學年度'] for r in rows)
        # 取最近兩學年：新竹縣自強國中只出現在 114 學年
        recent = str(int(latest) - 1)
        for r in rows:
            if r['學年度'] < recent:
                continue
            addr = clean_address(r['地址'])
            county = county_of(re.sub(r'^\[\d+\]', '', r['縣市名稱']).replace('台', '臺')) \
                or (addr and county_of(addr))
            if not addr or not county:
                continue
            for k in school_keys(r['學校名稱']):
                idx[(county, k)].add(addr)
        print(f'學校名錄 {url.rsplit("/", 1)[-1]} {latest} 學年 {len(rows)} 列', file=sys.stderr)
    return idx


def load_staged():
    """讀 data/staged/*.ndjson，回傳 (地址記錄, 名錄記錄, 只有場地名的計數)。

    地址欄位位置依來源而異：名錄類在頂層 `address`，課程類在 `location.address`；
    只有 `location.venueNameRaw` 的（軒恩、林務局、北市樂齡據點…）沒有門牌可送。
    """
    records = []          # (key, raw, 縣市, 來源, 場地名, 主辦單位名)
    registry = []         # (key, 名稱, 縣市, 來源, 有無座標, 使用單位list)
    name_only = Counter()  # (場地名, 縣市, 來源) -> 筆數
    for path in sorted(STAGED.glob('*.ndjson')):
        src = path.stem
        with open(path, encoding='utf-8') as f:
            for line in f:
                if not line.strip():
                    continue
                d = json.loads(line)
                loc = d.get('location') or {}
                if d.get('address') and not loc:  # 名錄類來源
                    key = norm_address(d['address'])
                    if not key:
                        continue
                    county = county_of((d.get('city') or '').replace('台', '臺')) or county_of(key)
                    registry.append((key, d.get('name') or '', county, src,
                                     d.get('lat') is not None, d.get('usedByRaw') or []))
                    records.append((key, d['address'], county, src, d.get('name') or '', None))
                    continue
                raw = loc.get('address')
                county = county_of((loc.get('city') or '').replace('台', '臺'))
                provider = (d.get('provider') or {}).get('nameRaw')
                if raw:
                    key = norm_address(raw)
                    if key:
                        records.append((key, raw, county or county_of(key), src,
                                        loc.get('venueNameRaw') or '', provider))
                elif loc.get('venueNameRaw'):
                    name_only[(loc['venueNameRaw'].strip(), county or '', src)] += 1
    return records, registry, name_only


def load_venue_state():
    """回傳 (已有座標的 key, key → 目前掛課數, key → 場館來源)。

    「已有座標」不是看 geocoded.csv（還不存在），是看 data/venues.ndjson 已經解出座標的場館，
    外加名錄自帶座標的門牌——後者即使目前沒有課掛著，將來對上也直接有座標，不必送。
    """
    have, courses, origin = set(), {}, {}
    if not VENUES.exists():
        return have, courses, origin
    with open(VENUES, encoding='utf-8') as f:
        for line in f:
            v = json.loads(line)
            addr = v.get('address')
            if not addr:
                continue
            if v.get('lat') is not None:
                have.add(addr)
            else:
                courses[addr] = courses.get(addr, 0) + v.get('courseCount', 0)
                origin[addr] = v.get('source')
    return have, courses, origin


# ---------------------------------------------------------------- 主流程

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--offline', action='store_true',
                    help='不抓教育部學校名錄；只寫校名的地址會全部進 unresolved.csv')
    ap.add_argument('--batch-size', type=int, default=DAILY_LIMIT,
                    help=f'每批上限（TGOS 一般批次每日 {DAILY_LIMIT} 筆）')
    args = ap.parse_args()

    OUT.mkdir(exist_ok=True)
    records, registry, name_only = load_staged()
    have_coords, course_count, venue_origin = load_venue_state()
    schools = build_school_index() if not args.offline else defaultdict(set)

    # 名錄門牌：同一門牌可能同時出現在有座標與沒座標的名錄，
    # resolve-relations.mjs 的 better() 取有座標的那個，這裡照辦。
    reg_has_coords = defaultdict(bool)
    site_idx = defaultdict(set)   # (社大名, 據點名鍵) → {門牌}
    reg_name_idx = defaultdict(set)  # (縣市, 名稱鍵) → {門牌}
    for key, name, county, src, has_lat, used_by in registry:
        reg_has_coords[key] |= has_lat
        addr = clean_address(key, county)
        if not addr:
            continue
        for k in school_keys(name):
            for cc_name in used_by:
                site_idx[(cc_name, k)].add(addr)
            if county:
                reg_name_idx[(county, k)].add(addr)

    # key → 彙整（來源、原始字串、縣市、社大名）
    agg = defaultdict(lambda: {'raws': Counter(), 'srcs': Counter(),
                               'counties': Counter(), 'ccs': Counter()})
    for key, raw, county, src, venue_name, provider in records:
        a = agg[key]
        a['raws'][raw.strip()] += 1
        a['srcs'][src] += 1
        if county:
            a['counties'][county] += 1
        for n in (provider, venue_name):
            if n:
                a['ccs'][n] += 1

    skipped = sum(1 for k in agg if k in have_coords or reg_has_coords[k])
    resolved = {}   # key → (上傳地址, 方法)
    unresolved = Counter()
    for key, a in agg.items():
        if key in have_coords or reg_has_coords[key]:
            continue
        county = a['counties'].most_common(1)[0][0] if a['counties'] else county_of(key)
        if norm_address(key) != key:
            # normAddress() 的段號與門牌號都只轉第一個，「忠孝東路5段忠孝東路五段790巷27號」
            # 這種重複路名的字串再跑一次會變成另一串。管線讀 geocoded.csv 時會再正規化一次，
            # 這種索引鍵永遠對不回場館，送了也是浪費額度。
            unresolved[(a['raws'].most_common(1)[0][0], county or '',
                        a['srcs'].most_common(1)[0][0], '索引鍵不穩定')] += sum(a['raws'].values())
            continue
        addr = None
        for raw, _ in a['raws'].most_common():
            addr = clean_address(raw, county)
            if addr:
                break
        method = '門牌'
        if not addr:
            # 只寫校名／據點名：先查用過這個名字的社大據點，再查學校名錄，最後查其他名錄；
            # 各自唯一才採用，多筆或查不到就進 unresolved，不編地址。
            hits = set()
            for raw, _ in a['raws'].most_common():
                for idx, scopes in ((site_idx, list(a['ccs'])),
                                    (schools, [county] if county else []),
                                    (reg_name_idx, [county] if county else [])):
                    for scope in scopes:
                        for name in place_candidates(raw):
                            cand = set().union(*(idx.get((scope, k), set())
                                                 for k in school_keys(name)) or [set()])
                            if len(cand) == 1:
                                hits = cand
                                break
                        if len(hits) == 1:
                            break
                    if len(hits) == 1:
                        break
                if len(hits) == 1:
                    break
            if len(hits) != 1:
                unresolved[(a['raws'].most_common(1)[0][0], county or '',
                            a['srcs'].most_common(1)[0][0], '多筆' if hits else '無')] += sum(a['raws'].values())
                continue
            addr, method = hits.pop(), '校名→門牌'
        resolved[key] = (addr, method)

    # 只有場地名沒有門牌的，照舊進 unresolved（管線那邊這種場館 address 是 null，
    # 就算查到座標也掛不回去，送 TGOS 是浪費額度）
    for (venue_name, county, src), n in name_only.items():
        unresolved[(venue_name, county, src, '只有場地名')] += n

    # 多個索引鍵可能整理出同一個上傳門牌（「臺北市信義區110臺北市信義區松仁路158巷1號」與
    # 「臺北市信義區松仁路158巷1號」）。TGOS 只需要查一次，依上傳門牌去重才不會白花額度；
    # address_map.csv 仍然一個鍵一列，回填時一個結果會寫回它底下所有的鍵。
    by_addr = defaultdict(list)
    for key, (addr, _) in resolved.items():
        by_addr[addr].append(key)

    # 排序＝送 TGOS 的優先序：
    #   1. derived 場館（geocoded.csv 回來立刻生效），掛課多的先送
    #   2. registry 場館（門牌對到無座標名錄，管線目前會先採名錄、跳過 geocoded.csv）
    #   3. 目前沒有課掛著的門牌（名錄備料）
    def rank(addr):
        keys = by_addr[addr]
        tier = min({'derived': 0, 'registry': 1}.get(venue_origin.get(k), 2) for k in keys)
        return (tier, -sum(course_count.get(k, 0) for k in keys), addr)

    order = sorted(by_addr, key=rank)
    ids = {addr: i + 1 for i, addr in enumerate(order)}

    batches = [order[i:i + args.batch_size] for i in range(0, len(order), args.batch_size)] or [[]]
    names = ['tgos_upload.csv'] if len(batches) == 1 else \
            [f'tgos_upload_{i + 1}.csv' for i in range(len(batches))]
    for name, batch in zip(names, batches):
        with open(OUT / name, 'w', encoding='utf-8-sig', newline='') as f:
            w = csv.writer(f, lineterminator='\r\n')
            w.writerow(['id', 'Address', 'Response_Address', 'Response_X', 'Response_Y'])
            for addr in batch:
                w.writerow([ids[addr], addr, '', '', ''])

    with open(OUT / 'address_map.csv', 'w', encoding='utf-8-sig', newline='') as f:
        w = csv.writer(f)
        w.writerow(['tgos_id', 'key', 'address', 'raw', 'county', 'source', 'method', 'count', 'courses'])
        for addr in order:
            for key in sorted(by_addr[addr], key=lambda k: -course_count.get(k, 0)):
                a = agg[key]
                county = a['counties'].most_common(1)[0][0] if a['counties'] else (county_of(key) or '')
                for raw, n in a['raws'].most_common():
                    w.writerow([ids[addr], key, addr, raw, county,
                                a['srcs'].most_common(1)[0][0], resolved[key][1], n,
                                course_count.get(key, 0)])

    with open(OUT / 'unresolved.csv', 'w', encoding='utf-8-sig', newline='') as f:
        w = csv.writer(f)
        w.writerow(['raw', 'county', 'source', 'reason', 'count'])
        for (raw, county, src, reason), n in unresolved.most_common():
            w.writerow([raw, county, src, reason, n])

    by_method = Counter(m for _, m in resolved.values())
    tiers = Counter(venue_origin.get(k, '(目前無課)') for k in resolved)
    unlock = sum(course_count.get(k, 0) for k in resolved if venue_origin.get(k) == 'derived')
    blocked = sum(course_count.get(k, 0) for k in resolved if venue_origin.get(k) == 'registry')
    print(f'staged 地址記錄 {len(records)}、只有場地名 {sum(name_only.values())}', file=sys.stderr)
    print(f'不重複索引鍵 {len(agg)}：已有座標略過 {skipped}、'
          f'待送 {len(resolved)}（門牌 {by_method["門牌"]}、校名→門牌 {by_method["校名→門牌"]}）、'
          f'未解析 {len(unresolved)} 種字串（影響 {sum(unresolved.values())} 筆 L1）', file=sys.stderr)
    print(f'去重後實際上傳 {len(order)} 筆門牌；待送索引鍵的場館狀態：{dict(tiers)}', file=sys.stderr)
    print(f'回來後可直接解開 {unlock} 門課；另有 {blocked} 門課的場館對到無座標的名錄'
          '（resolve-relations.mjs 的 registry 分支會回頭查 geocoded.csv，所以這批也吃得到）',
          file=sys.stderr)
    print(f'輸出 {len(batches)} 批：' + '、'.join(f'{n}({len(b)})' for n, b in zip(names, batches)),
          file=sys.stderr)


if __name__ == '__main__':
    main()
