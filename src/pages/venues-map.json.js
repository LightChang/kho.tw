// 地圖頁的資料：/venues-map.json。
// 欄位是陣列不是物件，省體積：[slug, 場館名, 縣市, 行政區, lat, lng, 課程數, 招生中數]
import { getData } from '../lib/data.mjs';

export function GET() {
  return new Response(JSON.stringify(getData().map.rows));
}
