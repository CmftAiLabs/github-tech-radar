// 入口：抓取 → 分析（可选 LLM 增强）→ 渲染 → 写 docs/index.html + docs/archive/YYYY-MM-DD.html
// 本地：node generate.mjs（走环境代理需 NODE_USE_ENV_PROXY=1）
// CI：GitHub Actions 直接 node，不需要代理。

import { mkdirSync, writeFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { scrapeAll } from './scrape.mjs'
import { analyze } from './analyze.mjs'
import { render } from './render.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const docsDir = path.join(__dirname, '..', 'docs')
const archiveDir = path.join(docsDir, 'archive')

// —— 北京时间（UTC+8）字符串 ——
const now = new Date(Date.now() + 8 * 3600_000)
const iso = now.toISOString().slice(0, 10)
const generatedAt = now.toISOString().slice(0, 19).replace('T', ' ') + ' CST'

const trend = await scrapeAll()
const data = analyze(trend, { generatedAt })

// —— 可选 LLM 增强：只润色 hero / 矩阵摘要 / 历史点评，失败则整体降级为规则版 ——
if (process.env.LLM_API_KEY) {
  try {
    await llmPolish(data)
    console.log('[llm] 点评增强完成')
  } catch (e) {
    console.error('[llm] 增强失败，使用规则模板:', e.message)
  }
} else {
  console.log('[llm] 未配 LLM_API_KEY，使用规则模板')
}

// —— 输出 ——
mkdirSync(archiveDir, { recursive: true })
const html = render(data)
writeFileSync(path.join(docsDir, 'index.html'), html)
const archiveFile = path.join(archiveDir, `${iso}.html`)
writeFileSync(archiveFile, html)
writeArchiveIndex()
console.log(`[done] docs/index.html + ${path.relative(process.cwd(), archiveFile)} (${(html.length / 1024).toFixed(0)}KB)`)

// 归档页索引（简单列表，倒序）
function writeArchiveIndex() {
  const days = readdirSync(archiveDir)
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.html$/.test(f))
    .sort()
    .reverse()
  const rows = days
    .map(
      (f) =>
        `<li style="margin:10px 0"><a href="./${f}" style="font:15px/1.6 system-ui;color:#2440b8;text-decoration:none">${f.replace('.html', '')} 日报</a></li>`,
    )
    .join('\n      ')
  writeFileSync(
    path.join(archiveDir, 'index.html'),
    `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>Tech Radar 往期报告</title></head>
<body style="max-width:720px;margin:48px auto;font-family:system-ui"><h2>往期报告</h2><ul style="list-style:none;padding:0">
      ${rows}
</ul></body></html>\n`,
  )
}

// —— LLM 调用：OpenAI 兼容接口（网关 key 放 Actions secrets）——
async function llmPolish(data) {
  const base = (process.env.LLM_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '')
  const model = process.env.LLM_MODEL || 'gpt-4o-mini'
  const brief = data.matrix.map((r) => ({ name: r.name, desc: r.summary, periods: r.periods, stars: r.stars }))
  const prompt =
    `你是 AI Lab 的技术雷达编辑。基于今日 GitHub Trending 候选仓库（JSON 附后），输出严格 JSON：\n` +
    `{"hero":"≤90字日报点评（聚焦方向信号）","history":"≤120字 跨榜与趋势点评","matrix":[{"name":"原样仓库名","summary":"≤60字 技术核心摘要(开发视角)","labValue":"≤60字 AI Lab 参考意义(产品视角)"}]}\n` +
    `只输出 JSON。候选：\n` + JSON.stringify(brief)
  const resp = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.LLM_API_KEY}` },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.4,
      response_format: { type: 'json_object' },
    }),
    signal: AbortSignal.timeout(60_000),
  })
  if (!resp.ok) throw new Error(`LLM HTTP ${resp.status}: ${(await resp.text()).slice(0, 160)}`)
  const out = JSON.parse((await resp.json()).choices[0].message.content)
  if (typeof out.hero === 'string' && out.hero) data.hero = out.hero
  if (typeof out.history === 'string' && out.history) data.history = out.history
  for (const m of Array.isArray(out.matrix) ? out.matrix : []) {
    const hit = data.matrix.find((r) => r.name === m.name)
    if (hit) {
      if (m.summary) hit.summary = m.summary
      if (m.labValue) hit.labValue = m.labValue
    }
  }
}
