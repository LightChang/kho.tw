// transform/normalize/changjia-centers.mjs
// 長佳智慧運動中心 Web App（新店、蘆竹國民運動中心）→ L1 Course（見 transform/L1-FORMAT.md）
//
// 來源清單沒有起訖日（詳情 API 擋外部呼叫，見 ingest 檔頭），所以不填 startDate／endDate，
// 和臺中聯網、南投等沒有日期的來源一樣。課一從清單消失（過了插班期限或期別結束）
// observation 就標 disappearedAt，分群層不再收它，不會以「進行中」的樣子留在站上。
//
// 期別與開始時刻寫在課名裡：「115_05兒童週六假日班15:00A(7~12歲)(9/26、10/10、10/24停課)」
// → term 115 年第 5 期、開始 15:00（蘆竹寫成「11505…」，同一個意思）。課名本身原樣保留，不剝前綴。
// 星期來自前端「依星期篩選」反查（0＝日），不是從課名猜。
//
// 名額：清單的「報名狀況: (已報名/名額)」，剩餘＝名額−已報名（查證見 ingest 檔頭）。

const cityOf = (address) => address?.match(/^([臺台][北中南東]市|..[市縣])/)?.[1]?.replace(/^台/, '臺');

export function normalize(records, { fetchedAt }) {
  const out = [];
  for (const r of records) {
    if (!r?.ccid || !r._lid || !r.title) continue;
    const title = String(r.title).trim();
    const term = title.match(/^(?:NEW)?\s*(\d{3})_?(0[1-6])(?!\d)/); // 新店寫 115_05、蘆竹寫 11505
    const time = title.match(/(?<!\d)([01]?\d|2[0-3]):([0-5]\d)(?!\d)/);
    const slots = (r.weekDays ?? []).map((d) => {
      const slot = { weekday: d === 0 ? 7 : d };
      if (time) slot.startTime = `${time[1].padStart(2, '0')}:${time[2]}`;
      return slot;
    });
    const course = {
      _source: 'changjia-centers',
      _sourceRecordId: `${r._lid}:${r.ccid}`,
      _fetchedAt: fetchedAt,
      title,
      provider: { nameRaw: r._site, kind: 'sports-center', operatorRaw: '長佳機電' },
      schedule: { recurrence: 'weekly', slots },
      enrollment: { status: 'unknown' },
      location: { venueNameRaw: String(r.place ?? r._site).trim(), addressPrecision: 'venue-name-only' },
      sourceUrl: `https://changjia.sporetrofit.com/Location/CourseList/?LID=${r._lid}&CategoryID=${r._categoryId}`,
    };
    if (term) course.term = { raw: `${term[1]}_${term[2]}`, year: Number(term[1]), termNo: Number(term[2]) };
    if (r._categoryName) course.categoryRaw = r._categoryName;
    if (r.teacher) course.teachers = [{ nameRaw: r.teacher }];
    if (Number.isFinite(r.capacity) && Number.isFinite(r.enrolled) && r.capacity > 0) {
      const available = Math.max(0, r.capacity - r.enrolled);
      course.enrollment = {
        status: available === 0 ? 'full' : 'open',
        statusRaw: `報名狀況 (${r.enrolled}/${r.capacity})`,
        capacity: r.capacity,
        available,
      };
    }
    const price = String(r.priceText ?? '').match(/^\$\s*([\d,]+)/);
    if (price) {
      course.price = Number(price[1].replace(/,/g, ''));
      course.priceText = r.priceText;
    }
    const address = String(r._address ?? '').replace(/^\d{3,6}/, '').trim();
    if (address) {
      course.location.address = address;
      course.location.addressPrecision = 'street';
      const city = cityOf(address);
      if (city) course.location.city = city;
    }
    out.push(course);
  }
  return out;
}
