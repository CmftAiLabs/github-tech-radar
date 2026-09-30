# github-tech-radar

每日自动生成 GitHub Trending 分析雷达（同款结构复刻自「Github Tech Radar」页面），
静态站点发布到 GitHub Pages，供 lab-dashboard「开源项目热点」iframe 嵌入。

## 流水线

```
GitHub Actions（每日 09:00 CST）
  scrape.mjs   抓 github.com/trending（daily / weekly / monthly）
  analyze.mjs  方向分类、雷达矩阵、关键词热度、跨期持续、风险提示
               （配了 LLM_API_KEY 则叠加 LLM 点评，失败自动降级为规则模式）
  render.mjs   渲染成单文件 HTML
  → 写入 docs/index.html + docs/archive/YYYY-MM-DD.html → push → Pages 发布
```

## 本地跑一次

```bash
cd generator
npm install
node generate.mjs        # 产出 ../docs/index.html，浏览器直接打开预览
```

## 可选：LLM 点评（不设则纯规则，也能正常出报告）

在仓库 Settings → Secrets 配三个（workflow 会用；本地测试用同名环境变量）：

| Secret | 说明 |
|---|---|
| `LLM_API_KEY` | OpenAI 兼容网关的 key（如实验室 new-api） |
| `LLM_BASE_URL` | 如 `https://<gateway>/v1` |
| `LLM_MODEL` | 如 `claude-sonnet-4` |

## Pages 开启

仓库 Settings → Pages → Source: Deploy from a branch → `main` / `/(root)`。
站点 `https://<user>.github.io/github-tech-radar/`，嵌入版加 `?embed=dashboard`。

## lab-dashboard 侧接入

`frontend/src/RadarPage.jsx` 顶部两行 URL 换成上面地址即可。
