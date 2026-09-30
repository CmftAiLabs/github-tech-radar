// 抓取 github.com/trending 三档榜单（daily / weekly / monthly）
// 页面无官方 API，解析 HTML：每个仓库一个 .Box-row 卡片。
// 主源失败时抛错，由调用方决定重试/跳过。

import * as cheerio from 'cheerio'

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 tech-radar/1.0'

const BASE = 'https://github.com'

function num(s) {
  // "1,234" | "6.6k" | "12" → Number
  if (!s) return 0
  s = s.trim().replace(/,/g, '')
  const m = s.match(/^([\d.]+)\s*([km]?)$/i)
  if (!m) return 0
  const n = parseFloat(m[1])
  const unit = m[2].toLowerCase()
  return Math.round(n * (unit === 'k' ? 1e3 : unit === 'm' ? 1e6 : 1))
}

async function fetchTrending(since) {
  const url = `${BASE}/trending?since=${since}`
  const resp = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'text/html' },
    signal: AbortSignal.timeout(20_000),
  })
  if (!resp.ok) throw new Error(`trending(${since}) HTTP ${resp.status}`)
  const $ = cheerio.load(await resp.text())

  const items = []
  $('article.Box-row, div.Box-row').each((_, el) => {
    const $el = $(el)
    const href = $el.find('h2 a').attr('href') || ''
    const name = href.replace(/^\//, '')
    if (!name) return
    const desc = $el.find('p').first().text().trim()
    const lang = $el.find('[itemprop="programmingLanguage"]').first().text().trim()
    // stars / forks：按链接后缀找；本期新增在右侧 float span
    let stars = 0
    let forks = 0
    $el.find('a').each((_, a) => {
      const h = $(a).attr('href') || ''
      const t = $(a).text()
      if (/\/stargazers$/.test(h)) stars = num(t)
      else if (/\/forks$/.test(h)) forks = num(t)
    })
    // "4,758 stars today" / "this week" / "this month"
    const tm = $el.text().match(/([\d,]+)\s+stars?\s+(?:today|this\s+\w+)/)
    const today = tm ? num(tm[1]) : 0
    items.push({ name, url: BASE + href, desc, lang, stars, forks, periodAdd: today })
  })
  if (items.length === 0) throw new Error(`trending(${since}) 解析到 0 条，页面结构可能已变`)
  return items
}

export async function scrapeAll() {
  const [daily, weekly, monthly] = [[], [], []]
  const scrape = async (since, bucket) => {
    for (let i = 0; i < 3; i++) {
      try {
        bucket.push(...(await fetchTrending(since)))
        return
      } catch (e) {
        if (i === 2) throw e
        await new Promise((r) => setTimeout(r, 2000 * (i + 1)))
      }
    }
  }
  await Promise.all([scrape('daily', daily), scrape('weekly', weekly), scrape('monthly', monthly)])
  console.log(`[scrape] daily=${daily.length} weekly=${weekly.length} monthly=${monthly.length}`)
  return { daily, weekly, monthly }
}
