// transform/teachers.mjs
// 講師身分的認定規則。transform/emit.mjs（配 slug）與 site/build.mjs（產頁）共用這一份，
// 兩邊一定要算出同一組身分，否則會出現「登記簿配了 slug 卻沒有頁面」或反過來「頁面找不到 slug」。
//
// 全站 33,689 門課裡有 26,627 門標了講師，講師欄是自由字串，沒有任何識別碼。
// 所以這一層要回答的其實是三個問題，每一個答錯的代價都不一樣：
//
// 1. 誰算同一個人？——**姓名 ＋ 開課單位**
//    實測 8,407 個可用姓名裡有 3,028 個（36.0%）出現在兩個以上的單位，
//    最多的「鐘婉綺」「陳建志」各出現在 17 個單位。這些之中一定混了兩種情況：
//    同一位老師跨校開課，以及剛好同名的不同人。從現有資料**分不出來**——
//    來源只給名字，沒有身分證號、沒有個人頁連結、沒有生日。
//
//    既然分不出來，就選錯的代價比較小的那一邊：合錯（把兩個人寫成一頁）是在頁面上
//    宣稱一件不實的事，而且是關於真實個人的不實陳述；拆錯（同一個人有兩頁）只是
//    少了一個彙整，每一頁上寫的東西仍然全部為真。所以用「姓名＋單位」當身分。
//    代價是跨校授課的老師會有多頁，這一點由「站內同名的其他講師頁」交叉連結補償——
//    那個區塊明講「可能是同一位，也可能只是同名」，把判斷留給讀者，不替他認定。
//
//    單位字面要先正規化再當鍵：實測有 9 組單位同時存在「台」與「臺」兩種寫法
//    （台北市文山社區大學／臺北市文山社區大學），不折的話同一位老師會平白多一頁。
//
// 2. 哪些字串根本不是人名？——寧可不產頁，也不要產一個假人
//    講師欄實測含這些東西：集合名詞（「專業師資」278 門、「講師群」51 門、
//    「本中心專業游泳教練」53 門）、機構名（「愛迪樂有限公司」）、頭銜與資歷
//    （「紀浩成老師  企管碩士資深社大老師」）、多位教師擠在一欄
//    （「謝進忠 貝雪玲 劉梅英」、「洪富美/林麗菽」）、以及來源本身就壞掉的字
//    （「林家(家永」「實)」是 CSV 被逗號切壞的兩半、「鄭旭?」是編碼掉字）。
//
//    分隔符切得開的（、，,／/＆&；;）就切開，切不開的就**整筆不認**：
//    用空白分隔的字串沒辦法安全地切——「佐佐木 滋」「樋口 昌夫」是一個日本人名，
//    「謝進忠 貝雪玲 劉梅英」是三個人，同樣是「中文字 空白 中文字」，切也錯不切也錯。
//    這類只有 104 筆（佔 27,393 個 token 的 0.4%），直接不產頁，名字照樣印在課程頁上。
//
// 3. 個資分寸——只用來源已經公開的姓名，而且只做「這位講師在本站收錄的課程」這一件事
//    講師頁不彙整、不推測、不加工任何其他個人資訊：沒有電話、沒有 email、沒有經歷、
//    沒有「常在某某地區出沒」這種從資料反推出來的側寫，也不跨單位替人合併身分。
//    課程資料本來就把講師姓名印在公開的課程頁上，講師頁只是把同一批事實換一個索引方式。
import { createHash } from 'node:crypto';

// 產頁門檻：收錄 N 門以上的講師才給一頁。理由見 docs 與 site/build.mjs 的說明區塊。
export const MIN_COURSES = 2;

const FULLWIDTH = /[！-～]/g;
const toHalf = (s) => s.replace(FULLWIDTH, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));

// 一欄多位教師的分隔符。刻意不含空白：空白切不出正確答案（見檔頭第 2 點）。
const SPLIT = /[、,，/／&＆;；]+/;

// 集合名詞、機構、頭銜、行政用語。命中就不是「一個具體的人」，不產頁。
const GENERIC = /(師資|講師|教練|老師|教師|教授|博士|醫師|藥師|營養師|心理師|技術士|全體|外聘|另聘|待聘|不詳|未定|待定|本中心|中心|專業|資深|各班|校外|指導員|同上|其他|等|公司|協會|工作室|學校|社區大學|社大|大學|團隊|工會|基金會|政府|治理)/;
const EXACT_BLOCK = new Set(['無', '無資料', '暫無', 'NA', 'N/A', 'TBA', '待公布', '師群', '群組']);

// 三種可接受的人名長相：
//   純漢字 2–6 字（涵蓋複姓與少數民族名）
//   純拉丁字母（Maggie、Matthew Townend；允許中間一個空白，英文姓名本來就這樣寫）
//   中英混寫（黃美春Eva、Yuri怡婷、阿Ju）——必須同時含漢字與拉丁字母，
//     否則「台北市政府消防局講師」這種純漢字長串也會從這一條漏進來
const HAN = /^[\p{Script=Han}]{2,6}$/u;
const LATIN = /^[A-Za-z][A-Za-z.'\- ]{1,28}$/;
const MIXED = /^(?=.*[A-Za-z])(?=.*\p{Script=Han})[\p{Script=Han}A-Za-z0-9]{2,10}$/u;

/** 一欄自由字串 → 若干個 token（還沒清理、還沒判斷是不是人名） */
export const splitNames = (raw) => String(raw ?? '').split(SPLIT);

/**
 * 清掉頭銜、括號綽號與說明文字。
 * 「陳玉菁(小米)老師【健身房專業教練】」→「陳玉菁」
 * 「紀浩成老師  企管碩士資深社大老師」→「紀浩成」
 * 括號綽號一律剝掉：同一位老師在不同期別可能寫「允齊(小雯)」也可能只寫「允齊」，
 * 不剝的話同一個人在同一個單位會被拆成兩頁——這是規則自己製造出來的分裂，不是資料的事實。
 */
export function cleanName(raw) {
  let s = toHalf(String(raw ?? '').normalize('NFC'));
  s = s.replace(/[【\[［][^】\]］]*[】\]］]/g, ' ');
  s = s.replace(/[(（][^)）]*[)）]/g, '');
  s = s.replace(/　/g, ' ').replace(/\s+/g, ' ').trim();
  // 「姓名＋頭銜＋一長串資歷」只取頭銜之前那一段
  const titled = s.match(/^(.{2,6}?)(老師|教練|講師|教授|博士|師傅)(?:\s|$)/);
  if (titled) {
    s = titled[1];
    // 但這一刀會從「李文豪農業老師 黃婉芸陶藝老師 林慧婷蔬食老師 聯合授課」這種多人混寫的
    // 字串裡切出「李文豪農業」——一個不存在的人。中文姓名幾乎都在 4 字以內，超過就表示
    // 切到的不只是名字，整筆不認：名字照樣印在課程頁上，只是不給它一個講師頁。
    if (/^\p{Script=Han}+$/u.test(s) && [...s].length > 4) return '';
  }
  return s.trim();
}

/** 這個字串看起來是不是「一個具體的人」。不確定就回 false——寧可不產頁。 */
export function isPersonName(name) {
  const s = String(name ?? '');
  if ([...s].length < 2) return false;
  if (EXACT_BLOCK.has(s)) return false;
  if (GENERIC.test(s)) return false;
  return HAN.test(s) || LATIN.test(s) || MIXED.test(s);
}

/** 一門課 → 可以認定身分的講師姓名（已去重，保持來源順序） */
export function courseTeacherNames(course) {
  const out = [];
  for (const t of course.teachers ?? []) {
    for (const tok of splitNames(t.nameRaw)) {
      const name = cleanName(tok);
      if (isPersonName(name) && !out.includes(name)) out.push(name);
    }
  }
  return out;
}

const CITY_PREFIX = /^(臺北市|新北市|桃園市|臺中市|臺南市|高雄市|基隆市|新竹市|新竹縣|嘉義市|嘉義縣|苗栗縣|彰化縣|南投縣|雲林縣|屏東縣|宜蘭縣|花蓮縣|臺東縣|澎湖縣|金門縣|連江縣)/;
const LEGAL_PREFIX = /^(財團法人|社團法人)/;

/**
 * 開課單位的比對鍵＝**縣市 ＋ 折過寫法的單位名**。
 *
 * 單位名在來源之間寫法不一致，同一所學校實測有四種字面：
 *   臺北市文山社區大學／台北市文山社區大學／文山社區大學／文山社大
 * 只把字面正規化成「去空白、台→臺」是不夠的——這四種仍是四個不同的鍵，
 * 同一位老師在同一所學校會被拆成四頁。實測 685 組、1,420 個身分是這樣被拆開的
 * （佔 6,398 個講師頁的 22%）。這種分裂是規則自己製造的，不是資料的事實。
 *
 * 但**不能**直接把縣市前綴丟掉、只用「文山社大」當鍵：實測「文山社大」同時對到
 * 臺北市文山社區大學與臺中市文山社區大學——兩所不同縣市的不同學校。
 * 丟掉縣市就是把兩地的兩個人合成一頁，正是本檔第 1 點要避免的方向。
 *
 * 所以縣市留在鍵裡、只折單位名的寫法：縣市優先取單位名自己帶的前綴，
 * 沒帶就用這門課的上課縣市補。兩者都沒有時縣市留空——那會多切一個桶，
 * 也就是多拆一頁，方向安全。
 */
export function providerKey(course) {
  let s = toHalf(String(course.provider?.nameRaw ?? '').normalize('NFC'))
    .replace(/\s+/g, '').replace(/台/g, '臺').replace(LEGAL_PREFIX, '');
  const inName = s.match(CITY_PREFIX)?.[1] ?? '';
  if (inName) s = s.slice(inName.length);
  // 同一所學校的常見寫法折成同一個字面（不截字數——截字是網址的事，截了會把不同單位折在一起）
  s = s.replace(/社區大學$/, '社大').replace(/國民運動中心$/, '運動中心').replace(/樂齡學習中心$/, '樂齡中心');
  if (!s) return '';
  return `${inName || course.venue?.city || ''} ${s}`;
}

// 顯示用的單位字面：同一個身分底下可能有好幾種寫法，取最長的那個（資訊最完整，
// 「臺北市文山社區大學」優於「文山社大」）。一樣長就取字典序大的——這不只是為了
// 每次跑出同一個結果，也剛好讓「臺」贏過「台」（臺 U+81FA > 台 U+53F0），
// 與站上其他地方一律寫「臺」一致。
const betterProvider = (a, b) => {
  if (!a) return b;
  if (!b) return a;
  const la = [...a].length;
  const lb = [...b].length;
  if (la !== lb) return la > lb ? a : b;
  return a >= b ? a : b;
};

/**
 * 身分 id。取 sha256 前 16 碼而不是 8 碼：8 碼在 1.4 萬個身分下的碰撞機率約 2%，
 * 而碰撞的後果正好是這份檔案最想避免的事——兩個不同的人共用一個 id、合成同一頁。
 * 16 碼的碰撞機率是 10^-9 等級。短碼（網址尾巴）另外由 transform/slug.mjs 從 id 算。
 */
export const teacherId = (key) => `tea_${createHash('sha256').update(key).digest('hex').slice(0, 16)}`;

/** 身分鍵：姓名 ＋ 單位鍵。中間用   分隔，避免「王大-明」和「王大明-」這種邊界歧義。 */
export const identityKey = (name, pkey) => `${name} ${pkey}`;

/**
 * 掃過全部課程，彙整出講師身分。
 * @param {Array<object>} courses data/courses.ndjson 的內容（已依 id 排序）
 * @returns {Map<string, {id, key, name, providerKey, provider, courseIds: string[]}>}
 *          走訪順序 = 課程順序，所以同一份資料每次跑出來都一樣
 */
export function collectTeachers(courses) {
  const byId = new Map();
  for (const c of courses) {
    const pkey = providerKey(c);
    if (!pkey) continue; // 沒有開課單位就定不出身分（實測 0 門，留著當防呆）
    const [city] = pkey.split(' ');
    for (const name of courseTeacherNames(c)) {
      const key = identityKey(name, pkey);
      const id = teacherId(key);
      const known = byId.get(id);
      if (known) {
        // id 撞到但身分鍵不同 = 兩個不同的人被算成同一個，正是本檔要避免的事，直接停。
        if (known.key !== key) throw new Error(`講師 id 碰撞：${id} 同時是「${known.key}」與「${key}」`);
        known.provider = betterProvider(known.provider, c.provider?.nameRaw ?? '');
        if (!known.courseIds.includes(c.id)) known.courseIds.push(c.id);
        continue;
      }
      byId.set(id, {
        id,
        key,
        name,
        providerKey: pkey,
        city,
        provider: c.provider?.nameRaw ?? '',
        courseIds: [c.id],
      });
    }
  }
  return byId;
}

/** 達到產頁門檻的講師，依 id 排序（排序過才保證配 slug 的順序與資料進來的順序無關） */
export const teachersWithPages = (byId) => [...byId.values()]
  .filter((t) => t.courseIds.length >= MIN_COURSES)
  .sort((a, b) => a.id.localeCompare(b.id));
