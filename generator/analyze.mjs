// 规则分析层：把三榜合并 → 方向分类 → 雷达矩阵选品 → 关键词热度 → 方向热力图 → 风险提示
// LLM 只做可选增强（hero 点评 / 逐仓摘要），此文件保证无 LLM 也能产出完整报告。

const AI_TERMS = /\b(ai|llm|agent|gpt|claude|gemini|model|mcp|rag|prompt|copilot|genai|diffusion|transformer|inference|fine-?tun|embedding|vector|voice|vision|multimodal|assistant|chatbot|token)\b/i

// 方向词典：命中关键词 → 方向名（按优先级，取首个命中；多命中可叠加热度）
const DIRECTIONS = [
  { dir: 'Agent 运行与编排', kw: /\b(agent runtime|agent framework|multi-?agent|orchestrat|autogen|crew|swarm|subagent|agentic)\b/i },
  { dir: 'MCP / 工具生态', kw: /\b(mcp|model context protocol|tool[- ]call|function[- ]call|plugin|toolkit)\b/i },
  { dir: '编码智能体', kw: /\b(coding agent|code assistant|copilot|ide|codebase|swe-?bench|cli coding|code review)\b/i },
  { dir: '记忆与 RAG', kw: /\b(rag|memory|retrieval|knowledge base|vector db|embedding)\b/i },
  { dir: '推理与部署', kw: /\b(inference|serving|quantiz|vllm|deploy|runtime|gpu|cuda|kernel|onnx|latency)\b/i },
  { dir: '多模态与语音', kw: /\b(vision|image|video|audio|voice|speech|tts|asr|multimodal|diffusion|ocr)\b/i },
  { dir: '安全与评测', kw: /\b(secur|vulnerab|pentest|red team|jailbreak|guardrail|eval|benchmark|audit|privacy|sandbox)\b/i },
  { dir: '模型与训练', kw: /\b(train|finetun|lora|pretrain|distill|checkpoint|weights|foundation model|llama|qwen|deepseek)\b/i },
  { dir: 'AI 应用与工作流', kw: /\b(workflow|automation|assistant|chatbot|search|browser|office|meeting|note)\b/i },
]

// 风险提示规则：命中即标（低/中/高三档）
const RISK_RULES = [
  { re: /\b(scrap(e|ing)|crawl(?:er|ing)|bot net)\b/i, sev: '低', why: '抓取类工具，注意目标站点条款与合规边界' },
  { re: /\b(crack|jailbreak|bypass|exploit|inject|keygen)\b/i, sev: '中', why: '涉及绕过/注入类能力，引入前需安全评审' },
  { re: /\b(coin|miner|airdrop|token|crypto)\b/i, sev: '中', why: '与加密激励相关，注意项目动机与可持续性' },
  { re: /\b(surveillance|stalker|facial recognition|spy)\b/i, sev: '高', why: '涉监控/隐私敏感场景，禁止内部直接引入' },
]

const TEXT = (r) => `${r.name} ${r.desc || ''} ${r.lang || ''}`

export function classify(r) {
  const hits = DIRECTIONS.filter((d) => d.kw.test(TEXT(r)))
  return hits.length ? hits.map((h) => h.dir) : []
}

function fmtK(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M'
  if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'k'
  return String(n)
}
export { fmtK }

// 热度桶：数值 → 1..4（当日内部归一）
function heatBucket(v, max) {
  if (!v) return 0
  const r = v / (max || 1)
  return r > 0.66 ? 4 : r > 0.33 ? 3 : r > 0.12 ? 2 : 1
}

export function analyze({ daily, weekly, monthly }, dates) {
  // —— 合并候选池：按仓库去重，记录所在榜单 ——
  const pool = new Map()
  const add = (list, period) => {
    for (const r of list) {
      if (!pool.has(r.name)) pool.set(r.name, { ...r, periods: [], periodAdd: {} })
      const p = pool.get(r.name)
      p.periods.push(period)
      p.periodAdd[period] = r.periodAdd
      p.stars = Math.max(p.stars, r.stars)
      p.forks = Math.max(p.forks, r.forks)
    }
  }
  add(daily, '今日')
  add(weekly, '周度')
  add(monthly, '月度')

  // —— 方向标注 + 相关性打分 ——
  for (const p of pool.values()) {
    p.dirs = classify(p)
    const cross = p.periods.length // 跨榜数 1..3
    p.relevant = AI_TERMS.test(TEXT(p)) || p.dirs.length > 0
    p.score =
      cross * 120 + // 跨榜是原版最看重信号
      p.dirs.length * 40 +
      (p.relevant ? 60 : 0) +
      Math.log10((p.periodAdd['今日'] || p.periodAdd['周度'] || 0) + 10) * 12 +
      Math.log10(p.stars + 10) * 8
  }

  // —— 雷达矩阵：相关仓按分数取 TOP10，保持榜单顺序（日>周>月）优先展示 ——
  const rank = { 今日: 0, 周度: 1, 月度: 2 }
  const matrix = [...pool.values()]
    .filter((p) => p.relevant)
    .sort((a, b) => b.score - a.score || rank[a.periods[0]] - rank[b.periods[0]])
    .slice(0, 10)

  // —— 关键词热度：全池文本统计 ——
  const KW = ['agent', 'mcp', 'cli', 'rag', 'memory', 'inference', 'coding', 'voice',
    'security', 'workflow', 'multimodal', 'training', 'browser', 'video', 'local']
  const kwCount = KW.map((k) => {
    const re = new RegExp(k, 'i')
    return { kw: k, n: [...pool.values()].filter((p) => re.test(TEXT(p))).length }
  })
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n)
    .slice(0, 12)

  // —— 方向热力图：方向 ×（今日/周度/月度）仓数 ——
  const heat = new Map()
  for (const p of pool.values())
    for (const d of p.dirs) {
      if (!heat.has(d)) heat.set(d, { 今日: 0, 周度: 0, 月度: 0 })
      for (const per of p.periods) heat.get(d)[per] += 1
    }
  const heatRows = [...heat.entries()]
    .map(([dir, c]) => ({
      dir,
      cells: [c['今日'], c['周度'], c['月度']],
      total: c['今日'] + c['周度'] + c['月度'],
    }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 8)
  const heatMax = Math.max(...heatRows.flatMap((r) => r.cells), 1)

  // —— 风险提示 ——
  const risks = [...pool.values()]
    .map((p) => {
      const hit = RISK_RULES.find((r) => r.re.test(TEXT(p)))
      return hit ? { name: p.name, url: p.url, sev: hit.sev, why: hit.why } : null
    })
    .filter(Boolean)
    .slice(0, 6)

  // —— 文案（规则模板版，可被 LLM 覆盖）——
  const topDir = heatRows[0]?.dir || 'AI 基础设施'
  const crossRepos = [...pool.values()].filter((p) => p.periods.length >= 2)
  const hero =
    `今日头部矩阵聚焦「${topDir}」，候选池 ${pool.size} 个仓库中 ${crossRepos.length} 个` +
    `同时登上多档榜单，显示该方向的热度并非脉冲式炒作。` +
    (risks.length ? `另有 ${risks.length} 个项目触发风险提示，引入前请先过安全评审。` : '本期未发现明显风险项目。')

  const history =
    `跨榜持续（${crossRepos.length} 个）：` +
    (crossRepos.length
      ? crossRepos.slice(0, 5).map((p) => p.name.split('/')[1]).join('、')
      : '无') +
    `。单日爆发后回落属正常噪声；连续两期上榜的项目更值得进入 PoC 备选。`

  return {
    generatedAt: dates.generatedAt,
    kpis: {
      scanned: pool.size,
      radar: matrix.length,
      relevant: [...pool.values()].filter((p) => p.relevant).length,
      risks: risks.length,
    },
    matrix: matrix.map((p) => ({
      name: p.name,
      url: p.url,
      lang: p.lang || '',
      stars: p.stars,
      forks: p.forks,
      period: p.periods[0],
      cross: p.periods.length >= 2,
      periods: p.periods.join('/'),
      summary: p.desc || '（无描述）',
      labValue: p.dirs.length ? `对应方向：${p.dirs.join('、')}，具备内部工程复用与评估价值。` : 'AI 相关项目，建议保持观察。',
      keywords: (p.desc || '').split(/[\s,，。;；]+/).filter((w) => w.length >= 4).slice(0, 4).join(' · ') || p.name,
    })),
    boards: {
      daily: daily.slice(0, 10).map(fmt),
      weekly: weekly.slice(0, 10).map(fmt),
      monthly: monthly.slice(0, 10).map(fmt),
    },
    keywords: kwCount.map((x) => ({ kw: x.kw, n: x.n })),
    heatRows: heatRows.map((r) => ({ dir: r.dir, cells: r.cells.map((c) => ({ v: c, heat: heatBucket(c, heatMax) })) })),
    risks,
    hero,
    history,
  }

  function fmt(r) {
    return {
      name: r.name, url: r.url, desc: r.desc, lang: r.lang || '',
      stars: r.stars, forks: r.forks, add: r.periodAdd,
      keywords: classify(r)[0] || (AI_TERMS.test(TEXT(r)) ? 'AI 相关' : '通用工具'),
    }
  }
}
