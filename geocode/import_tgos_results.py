"""把 TGOS 批次比對的結果檔回填成地址→座標快取。

TGOS 批次服務寄回的 CSV 欄位命名不完全固定，這裡容錯處理；座標若是 TWD97 二度分帶
（申請時選了 EPSG:3826／3825）會轉成 WGS84。結果與 build_tgos_input.py 產生的
address_map.csv 併起來，累積成 geocoded.csv，下批只需送沒編碼過的地址。

用法：
  python3 geocode/import_tgos_results.py <TGOS結果檔.csv> [--tm-zone 121|119] [--dry-run]

輸出（geocode/out/）：
  geocoded.csv        address,lat,lng,matched_address,updated_at —— 累積快取，重跑會合併
                      這裡的 address 是**管線索引鍵**（normAddress() 的輸出），不是送 TGOS
                      的那串門牌；transform/resolve-relations.mjs 就是用這個鍵查座標
  geocode_failed.csv  沒有座標或座標不合理的地址，依出現次數排序
"""

import argparse
import csv
import math
import re
import sys
from datetime import date
from pathlib import Path

OUT = Path(__file__).parent / 'out'
ADDRESS_MAP = OUT / 'address_map.csv'
GEOCODED = OUT / 'geocoded.csv'
FAILED = OUT / 'geocode_failed.csv'

# 欄位別名：TGOS 範本用 Response_*，實際寄回的檔案可能是中文欄名
ALIASES = {
    'id': ['id', 'ID', '序號', '編號'],
    'address': ['Address', 'address', '原始地址', '地址'],
    'matched': ['Response_Address', '比對門牌地址', 'FULL_ADDR', '比對地址'],
    'x': ['Response_X', 'X', 'x', 'lng', 'lon', '經度'],
    'y': ['Response_Y', 'Y', 'y', 'lat', '緯度'],
}
# 臺灣本島與離島的範圍，用來擋掉明顯錯誤的座標
LON_RANGE = (118.0, 123.0)
LAT_RANGE = (20.5, 26.5)
TM2_X_RANGE = (-100000.0, 500000.0)
TM2_Y_RANGE = (2300000.0, 2900000.0)

# TWD97 採 GRS80 橢球；二度分帶尺度因子 0.9999、假東移 250000
A = 6378137.0
F = 1 / 298.257222101
K0 = 0.9999
FE = 250000.0


def tm2_to_wgs84(x, y, lon0_deg=121.0):
    """TWD97 二度分帶（橫麥卡托）反算經緯度，回傳 (lat, lng)。"""
    e2 = F * (2 - F)
    ep2 = e2 / (1 - e2)
    m = y / K0
    mu = m / (A * (1 - e2 / 4 - 3 * e2 ** 2 / 64 - 5 * e2 ** 3 / 256))
    e1 = (1 - math.sqrt(1 - e2)) / (1 + math.sqrt(1 - e2))
    phi1 = (mu
            + (3 * e1 / 2 - 27 * e1 ** 3 / 32) * math.sin(2 * mu)
            + (21 * e1 ** 2 / 16 - 55 * e1 ** 4 / 32) * math.sin(4 * mu)
            + (151 * e1 ** 3 / 96) * math.sin(6 * mu)
            + (1097 * e1 ** 4 / 512) * math.sin(8 * mu))
    sin1, cos1, tan1 = math.sin(phi1), math.cos(phi1), math.tan(phi1)
    c1 = ep2 * cos1 ** 2
    t1 = tan1 ** 2
    n1 = A / math.sqrt(1 - e2 * sin1 ** 2)
    r1 = A * (1 - e2) / (1 - e2 * sin1 ** 2) ** 1.5
    d = (x - FE) / (n1 * K0)
    lat = phi1 - (n1 * tan1 / r1) * (
        d ** 2 / 2
        - (5 + 3 * t1 + 10 * c1 - 4 * c1 ** 2 - 9 * ep2) * d ** 4 / 24
        + (61 + 90 * t1 + 298 * c1 + 45 * t1 ** 2 - 252 * ep2 - 3 * c1 ** 2) * d ** 6 / 720)
    lon = math.radians(lon0_deg) + (
        d
        - (1 + 2 * t1 + c1) * d ** 3 / 6
        + (5 - 2 * c1 + 28 * t1 - 3 * c1 ** 2 + 8 * ep2 + 24 * t1 ** 2) * d ** 5 / 120) / cos1
    return math.degrees(lat), math.degrees(lon)


def pick(row, key):
    for name in ALIASES[key]:
        if name in row and (row[name] or '').strip():
            return row[name].strip()
    return ''


def to_float(s):
    try:
        return float(str(s).replace(',', '').strip())
    except (TypeError, ValueError):
        return None


# 中央經線一律 121，**澎湖、金門、馬祖也是**。
#
# 別被離島的 X 值騙了：2026-09-13 這批結果裡金門 X=-20697（負值）、澎湖 X=105124，
# 都落在本島 X 範圍（約 145,000–355,000）之外，看起來很像來源改用了 119 分帶。
# 實際驗算過：金門那筆用 121 轉是 24.43844,118.33088，正好在金門島上；
# 用 119 轉是 24.43844,116.33088，跑到中國大陸內陸。X 會是負數，只是因為金門
# 在中央經線 121 以西很遠而已。
#
# 曾經據此改成「離島自動用 119」，成功數反而從 2,953 掉到 2,911——那 38 筆離島
# 被下面的範圍檢查擋掉了。要改分帶判斷之前，先把樣本座標用兩條經線各轉一次，
# 對照該島實際的經緯度範圍，不要只看 X 值大小。
COUNTY_RE = re.compile(r'(臺北市|台北市|新北市|桃園市|臺中市|台中市|臺南市|台南市|高雄市|基隆市|'
                       r'新竹市|新竹縣|苗栗縣|彰化縣|南投縣|雲林縣|嘉義市|嘉義縣|屏東縣|宜蘭縣|'
                       r'花蓮縣|臺東縣|台東縣|澎湖縣|金門縣|連江縣)')


def county_of(addr):
    """取出地址開頭的縣市，臺／台一律正規化成臺。取不到回 None。"""
    m = COUNTY_RE.search(addr or '')
    return m.group(1).replace('台', '臺') if m else None


def resolve_coords(x, y, lon0):
    """判斷回傳的是經緯度還是二度分帶，轉成 (lat, lng)；不合理回 (None, 原因)。"""
    if x is None or y is None:
        return None, '無座標'
    if LON_RANGE[0] <= x <= LON_RANGE[1] and LAT_RANGE[0] <= y <= LAT_RANGE[1]:
        return (y, x), ''  # Response_X 是經度、Response_Y 是緯度
    if TM2_X_RANGE[0] <= x <= TM2_X_RANGE[1] and TM2_Y_RANGE[0] <= y <= TM2_Y_RANGE[1]:
        lat, lng = tm2_to_wgs84(x, y, lon0)
        if LON_RANGE[0] <= lng <= LON_RANGE[1] and LAT_RANGE[0] <= lat <= LAT_RANGE[1]:
            return (lat, lng), ''
        return None, f'二度分帶轉換後超出臺灣範圍({lat:.5f},{lng:.5f})'
    return None, f'座標超出範圍({x},{y})'


def read_csv_any(path):
    raw = Path(path).read_bytes()
    for enc in ('utf-8-sig', 'cp950'):
        try:
            return list(csv.DictReader(raw.decode(enc).splitlines()))
        except UnicodeDecodeError:
            continue
    raise SystemExit(f'{path}：無法判斷編碼（試過 utf-8、cp950）')


def load_address_map():
    """回傳 tgos_id → 上傳門牌、上傳門牌 → 管線索引鍵、索引鍵 → 出現次數。

    索引鍵是 transform/resolve-relations.mjs 的 normAddress() 輸出，管線就是用它查
    geocoded.csv；上傳門牌是整理過才送得出去的版本（補縣市、拔郵遞區號、校名換門牌），
    兩者不一定相同。geocoded.csv 一律以索引鍵為主鍵，否則座標對不回場館。
    舊版 address_map.csv 沒有 key 欄，這時索引鍵就是上傳門牌本身。
    """
    if not ADDRESS_MAP.exists():
        raise SystemExit(f'找不到 {ADDRESS_MAP}，請先跑 build_tgos_input.py')
    by_id, keys_of, counts = {}, {}, {}
    for r in read_csv_any(ADDRESS_MAP):
        addr = r['address']
        key = (r.get('key') or '').strip() or addr
        by_id[r['tgos_id']] = addr
        ks = keys_of.setdefault(addr, [])
        if key not in ks:
            ks.append(key)
        counts[key] = counts.get(key, 0) + int(r['count'])
    return by_id, keys_of, counts


def load_cache():
    if not GEOCODED.exists():
        return {}
    return {r['address']: r for r in read_csv_any(GEOCODED)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('result_csv', help='TGOS 批次比對寄回的結果檔')
    ap.add_argument('--tm-zone', type=float, default=121.0, choices=[121.0, 119.0],
                    help='二度分帶的中央經線（預設 121，全臺含澎金馬都適用；只有來源確實改用 119 才需指定）')
    ap.add_argument('--dry-run', action='store_true', help='只印統計，不寫檔')
    args = ap.parse_args()

    rows = read_csv_any(args.result_csv)
    if not rows:
        raise SystemExit('結果檔沒有資料列')
    by_id, keys_of, counts = load_address_map()
    cache = load_cache()
    print(f'結果檔 {len(rows)} 列，欄位：{list(rows[0].keys())}', file=sys.stderr)

    added, updated, failed = 0, 0, []
    today = date.today().isoformat()
    for r in rows:
        addr = pick(r, 'address') or by_id.get(pick(r, 'id'), '')
        if not addr:
            failed.append(('(結果檔的 id 與 address 都對不上)', '無法對應', 0, []))
            continue
        # 一個上傳門牌可能對應多個索引鍵（同一棟樓在不同來源寫法不同），座標要每個鍵都寫一份
        keys = keys_of.get(addr) or [addr]
        weight = sum(counts.get(k, 0) for k in keys)
        coords, reason = resolve_coords(to_float(pick(r, 'x')), to_float(pick(r, 'y')), args.tm_zone)
        if not coords:
            failed.append((addr, reason, weight, keys))
            continue
        # 縣市必須對得上，否則寧可沒有座標。
        #
        # 地址欄只寫機構名時（「澎湖縣社區大學」「內湖國小」），送出去的就是那串名字，
        # TGOS 模糊比對會配到別縣市的同名地點——實測澎湖縣社區大學被配到臺東市中華路、
        # 雲林四湖的內湖國小被配到臺北市內湖區、雲林西螺的中山國小被配到臺北市中山區。
        # 9 個錯位有 6 個落在臺北，因為臺北的同名路街最多。這種錯誤不會被座標範圍檢查
        # 抓到（臺北的座標當然在臺灣範圍內），只能比對縣市。
        want, got = county_of(addr), county_of(pick(r, 'matched'))
        if want and got and want != got:
            failed.append((addr, f'回傳門牌在{got}，與送出的{want}不符（比對到：{pick(r, "matched")}）',
                           weight, keys))
            continue
        lat, lng = coords
        for key in keys:
            rec = {'address': key, 'lat': f'{lat:.6f}', 'lng': f'{lng:.6f}',
                   'matched_address': pick(r, 'matched'), 'updated_at': today}
            if key in cache:
                updated += 1
            else:
                added += 1
            cache[key] = rec

    print(f'成功 {added + updated}（新增 {added}、更新 {updated}）、失敗 {len(failed)}', file=sys.stderr)
    if args.dry_run:
        for addr, reason, n, _ in failed[:10]:
            print(f'  失敗：{addr} — {reason}（{n} 筆記錄受影響）', file=sys.stderr)
        return

    OUT.mkdir(exist_ok=True)
    with open(GEOCODED, 'w', encoding='utf-8-sig', newline='') as f:
        w = csv.DictWriter(f, fieldnames=['address', 'lat', 'lng', 'matched_address', 'updated_at'])
        w.writeheader()
        for addr in sorted(cache):
            w.writerow(cache[addr])
    # 這個檔每次重寫，代表「目前仍然沒有座標」的地址；已經編碼成功的（含前幾批）不列入
    still_failed = [(a, reason, n) for a, reason, n, keys in failed
                    if all(k not in cache for k in (keys or [a]))]
    with open(FAILED, 'w', encoding='utf-8-sig', newline='') as f:
        w = csv.writer(f)
        w.writerow(['address', 'reason', 'affected_records'])
        for addr, reason, n in sorted(still_failed, key=lambda x: -x[2]):
            w.writerow([addr, reason, n])
    print(f'寫出 {GEOCODED}（{len(cache)} 筆）與 {FAILED}（{len(still_failed)} 筆，'
          f'另有 {len(failed) - len(still_failed)} 筆本批失敗但先前已有座標）', file=sys.stderr)

    pending = [a for a in counts if a not in cache]
    if pending:
        print(f'還沒有座標的門牌：{len(pending)} 筆（下批再送）', file=sys.stderr)


if __name__ == '__main__':
    main()
