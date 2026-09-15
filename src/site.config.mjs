// 站台層級的外部服務設定：Google Search Console 與 Analytics。
//
// 兩個都走環境變數，**沒設就完全不輸出**：不留空的 meta、也不載入任何 Google 腳本。
// 本機 build 與 CI build 用同一份程式，差別只在環境變數；要停用追蹤時移除
// repository variable 即可，不必改程式。
//
// GSC 建議改用 DNS TXT 驗證（網域層級，涵蓋 http/https 與所有子網域，換主機也不失效），
// 那樣就永遠不需要 KHO_GSC_VERIFY——這個變數留著只是為了「不想動 DNS」時的備援。
//
// **加了 KHO_GA_ID 等於讓全站每一頁都連 googletagmanager.com。**
// 目前全站唯一的外部連線是地圖頁的 NLSC 圖磚（功能必需）；GA 是追蹤性質的，
// 而且會設 _ga cookie。這是站主的取捨，所以做成開關而不是寫死。

export const GSC_VERIFY = process.env.KHO_GSC_VERIFY ?? '';
export const GA_ID = process.env.KHO_GA_ID ?? '';

// 格式先擋一次：GA4 的評估 ID 一律是 G- 開頭。填錯（例如填成 UA- 或 GTM-）
// 會讓全站載入一個永遠收不到資料的腳本，而且畫面上完全看不出來。
if (GA_ID && !/^G-[A-Z0-9]+$/i.test(GA_ID)) {
  throw new Error(`KHO_GA_ID 格式不對：${GA_ID}（GA4 評估 ID 應為 G- 開頭，例如 G-XXXXXXXXXX）`);
}

// 這段逐字取自 Google 官方安裝說明（developers.google.com/tag-platform/gtagjs/install），
// 只把 TAG_ID 換成變數，其餘一字不動——包括那個空行與註解。
// ID 只會是 /^G-[A-Z0-9]+$/（上面擋過），沒有引號或角括號可以跳脫，所以直接內插是安全的。
export const ANALYTICS = GA_ID ? `
<!-- Google tag (gtag.js) -->
<script async src="https://www.googletagmanager.com/gtag/js?id=${GA_ID}"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());

  gtag('config', '${GA_ID}');
</script>
` : '';
