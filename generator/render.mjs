// 渲染层：分析结果 JSON → 单文件 HTML（结构/CSS 复刻原版 Github Tech Radar）
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { fmtK } from './analyze.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const CSS = readFileSync(path.join(__dirname, 'template.css'), 'utf8')

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

const langClass = (l) => {
  if (!l) return 'lang-other'
  const k = l.toLowerCase().replace(/[^a-z]/g, '')
  const map = { typescript: 'lang-typescript', python: 'lang-python', rust: 'lang-rust',
    javascript: 'lang-javascript', csharp: 'lang-csharp', c: 'lang-c', go: 'lang-go',
    java: 'lang-java', cpp: 'lang-cplusplus', 'c++': 'lang-cplusplus', shell: 'lang-shell',
    html: 'lang-html', markdown: 'lang-markdown', jupyternotebook: 'lang-jupyter-notebook' }
  return map[k] || 'lang-other'
}

const HEAD = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <base target="_blank">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>GitHub Tech Radar | AI Lab Daily Radar</title>
  <script>
    (() => {
      const params = new URLSearchParams(window.location.search)
      if (params.get('embed') === 'dashboard') {
        document.documentElement.dataset.embed = 'dashboard'
      }
    })()
  </script>
  <style>
__CSS__
  </style>
</head>`

export function render(data) {
  const kpi = (n, label) => `<div class="header-kpi">\n            <strong>${n}</strong>\n            <span>${label}</span>\n          </div>`

  const matrixRows = data.matrix
    .map((r) => `
          <tr${r.cross ? ' class="cross-period-row"' : ''}>
            <td data-label="榜单">${esc(r.period)}</td>
            <td data-label="Repository">
              <a class="repo-title" href="${esc(r.url)}">${esc(r.name)}</a>
              <div class="repo-language">
                <span class="language-tag ${langClass(r.lang)}">${esc(r.lang || 'N/A')}</span>
              </div>
            </td>
            <td data-label="GitHub收藏数" class="metric" aria-label="Star ${fmtK(r.stars)}"><span class="metric-icon">★</span> <span class="metric-num">${fmtK(r.stars)}</span></td>
            <td data-label="仓库复用数" class="metric" aria-label="Fork ${fmtK(r.forks)}"><span class="metric-icon">Fork</span> <span class="metric-num">${fmtK(r.forks)}</span></td>
            <td data-label="技术核心摘要">${esc(r.summary)}</td>
            <td data-label="AI Lab 参考意义">${esc(r.labValue)}</td>
          </tr>`)
    .join('')

  const board = (title, items) => `
        <div class="card">
          <h3>${title}</h3>
          <ol>
${items
  .map(
    (r) => `            <li>
              <a class="repo-title" href="${esc(r.url)}">${esc(r.name)}</a>
              <div class="repo-keywords">${esc(r.keywords)}</div>
              <div class="repo-metrics">
                <span class="metric" aria-label="Star ${fmtK(r.stars)}"><span class="metric-icon">★</span> <span class="metric-num">${fmtK(r.stars)}</span></span>
                <span class="metric" aria-label="Fork ${fmtK(r.forks)}"><span class="metric-icon">Fork</span> <span class="metric-num">${fmtK(r.forks)}</span></span>
                <span class="language-tag ${langClass(r.lang)}">${esc(r.lang || 'N/A')}</span>
              </div>
            </li>`,
  )
  .join('\n')}
          </ol>
        </div>`

  const kwMax = Math.max(...data.keywords.map((k) => k.n), 1)
  const kwBars = data.keywords
    .map(
      (k) => `          <div class="bar-row">
            <span>${esc(k.kw)}</span>
            <div class="bar-track"><div class="bar-fill" style="width: ${Math.round((k.n / kwMax) * 100)}%"></div></div>
            <span class="muted">${k.n}</span>
          </div>`,
    )
    .join('\n')

  const heat = data.heatRows
    .map(
      (r) => `            <div class="heat-row">
              <strong>${esc(r.dir)}</strong>
${r.cells.map((c) => `              <span class="heat-cell heat-${c.heat}">${c.v}</span>`).join('\n')}
            </div>`,
    )
    .join('\n')

  const risks = data.risks.length
    ? data.risks
        .map(
          (r) => `          <div class="card">
            <h3><a href="${esc(r.url)}">${esc(r.name)}</a></h3>
            <p><span class="badge sev-${r.sev === '高' ? 'high' : r.sev === '中' ? 'mid' : 'low'}">${r.sev}</span> ${esc(r.why)}</p>
          </div>`,
        )
        .join('\n')
    : '          <div class="card"><h3>本期无</h3><p>未发现触发规则的项目。</p></div>'

  return `${HEAD.replace('__CSS__', CSS)}
<body>
  <header>
    <div class="header-grid">
      <div>
        <h1>Github Tech Radar</h1>
        <p class="generated">生成时间：${esc(data.generatedAt)} | GitHub Trending daily / weekly / monthly</p>
        <p class="hero">${esc(data.hero)}</p>
      </div>
      <div class="header-kpis">
          ${kpi(data.kpis.scanned, '扫描项目')}
          ${kpi(data.kpis.radar, '雷达入选')}
          ${kpi(data.kpis.relevant, '高相关')}
          ${kpi(data.kpis.risks, '风险提示')}
      </div>
    </div>
  </header>
  <main>
    <section class="section">
      <h2>AI Lab 重点雷达矩阵</h2>
      <p class="section-note">按 AI Lab 方向相关性与工程复用性筛选；排序优先日榜、周榜、月榜，跨榜单项目以流光标注。</p>
      <table class="matrix-table">
        <colgroup>
          <col class="col-period">
          <col class="col-repo">
          <col class="col-count">
          <col class="col-count">
          <col class="col-summary">
          <col class="col-summary">
        </colgroup>
        <thead>
          <tr>
            <th>榜单</th><th>Repository</th><th>GitHub收藏数</th><th>仓库复用数</th>
            <th>技术核心摘要（开发视角）</th><th>AI Lab 参考意义（产品视角）</th>
          </tr>
        </thead>
        <tbody>${matrixRows}
        </tbody>
      </table>
    </section>

    <section class="section compact-section">
      <h2>三榜单总览</h2>
      <div class="overview">
${board('今日', data.boards.daily)}
${board('周度', data.boards.weekly)}
${board('月度', data.boards.monthly)}
      </div>
    </section>

    <section class="two-col compact-grid">
      <div class="section compact-section">
        <h2>关键词热度排行</h2>
${kwBars}
      </div>
      <div class="section compact-section">
        <h2>AI Lab 方向热力图</h2>
        <div class="heatmap">
          <div class="heat-row muted"><strong>方向</strong><span>今日</span><span>周度</span><span>月度</span></div>
${heat}
        </div>
      </div>
    </section>

    <section class="section compact-section">
      <h2>历史趋势</h2>
      <h3>持续上榜与跨榜观察</h3>
      <p>${esc(data.history)}</p>
    </section>

    <section class="section">
      <h2>风险提醒</h2>
      <div class="alert-grid">
${risks}
      </div>
    </section>
  </main>
</body>
</html>`
}
