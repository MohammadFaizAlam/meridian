# Meridian

**A reinforcement learning trading workstation built for testing, comparing, and visualizing algorithmic strategies on real market data.**

*Created by **Md. Faiz Alam***

![Meridian Dark Mode Workbench](./docs/images/train-dark.png)

---

## Why I Built Meridian

Most reinforcement learning trading projects live inside terminal logs and Jupyter notebooks—hard to inspect, full of dense jargon, and disconnected from real execution costs. I built **Meridian** to turn RL trading research into an interactive, transparent workstation where you can load real historical market data, configure realistic broker fees and price slippage, train multiple strategies live, and inspect every trade, drawdown, and forecast in one place.

---

## Visual Tour

### Frosted Light & Smoked Obsidian Dark Themes

Both themes sit over a live WebGL silk canvas so depth, reflections, and glass contrast stay clear in either mode—from smoked obsidian panels in dark mode to glacial frosted surfaces in light mode.

| Dark Mode (Workbench) | Light Mode (Frosted Glass) |
| :---: | :---: |
| ![Dark Mode Workbench](./docs/images/train-dark.png) | ![Light Mode Workbench](./docs/images/train-light.png) |

---

### Forecast & Price Trajectory

Inspect historical candlesticks alongside moving averages, key support/resistance zones, and forward 1-day, 5-day, and 10-day confidence bands combining chart momentum with your trained model.

![Meridian Price Forecast](./docs/images/forecast.png)

---

### Strategy Comparison & Podium Rankings

Compare up to 5 saved runs normalized to a shared starting baseline of `100`, with Gold, Silver, and Bronze rank strips highlighting top performers by return, alpha vs. Buy & Hold, risk score, and maximum drawdown.

![Meridian Compare Runs](./docs/images/compare-ranks.png)

---

### Responsive Mobile & Tablet Experience

Designed cleanly down to small screens with a collapsible Setup panel, a compact tilted portfolio card tucked inside the summary panel, and a labeled floating navigation bar.

<p align="center">
  <img src="./docs/images/mobile-view.png" alt="Meridian Mobile View" width="320" />
</p>

---

## Features

- **Real Market Data**: Fetches historical OHLCV price series (stocks, ETFs, crypto) with local disk caching and configurable step sizes and history windows.
- **Four Reinforcement Learning Strategies**: Train and compare **DQN**, **PPO**, **A2C**, and **Q-Learning** agents with customizable training passes, reward goals, order sizing, trade fees, and price slippage.
- **Live Training Stream**: Streams pass-by-pass progress, rewards, and best-model checkpoints over Server-Sent Events (SSE) with pause, resume, and stop controls.
- **Out-of-Sample Testing**: Lock the best checkpoint on the training slice and evaluate it cleanly on unseen test data.
- **Interactive Financial Charts**: Pan and zoom candlestick/line charts, equity curves vs. Buy & Hold, reward progression, and full trade history ledgers.
- **Tactile Portfolio Summary**: Unified tearsheet featuring live portfolio valuation, inline `vs. Hold` sparkline, Risk Score, Biggest Drop, Winning Trades, Trade execution costs, and an embedded brushed-metal portfolio card (with subtle 3D hover motion on desktop).

---

## Tech Stack

- **Frontend**: React 19, TypeScript, Vite, Tailwind CSS v4, Motion, Lucide Icons, custom HTML5 Canvas & WebGL (`SilkCanvas`)
- **Dev & Proxy Server**: Node.js, Express (`server.ts`)
- **RL & Analytics Engine**: Python 3 (`backend/server.py`, `agents.py`, `environment.py`, `trainer.py`, `forecaster.py`, `market_data.py`)

---

## Project Structure

```text
meridian/
├── backend/
│   ├── server.py          # Python HTTP/SSE API server (CORS & cloud ready)
│   ├── agents.py          # DQN, PPO, A2C, and Q-Learning agents
│   ├── environment.py     # Trading environment with fees, slippage & sizing
│   ├── trainer.py         # Episode runner, checkpoints & run storage
│   ├── forecaster.py      # Multi-horizon price trajectory & confidence bands
│   ├── market_data.py     # Historical market loader + disk cache
│   └── Dockerfile         # Container build for Render / Koyeb / Railway
├── src/
│   ├── api/client.ts      # API + SSE client (supports VITE_API_BASE_URL)
│   ├── components/        # WorkbenchStage, PortfolioMetalCard, ConfigRail, Views & Charts
│   └── types/             # Shared TypeScript models
├── docs/images/           # Application screenshots
├── server.ts              # Local Express dev server + /api proxy to Python backend
├── vercel.json            # SPA rewrite rules for Vercel
└── render.yaml            # Blueprint for free Python backend hosting on Render
```

---

## Getting Started Locally

### Prerequisites

- **Node.js** 18+
- **Python 3** (standard library + NumPy for the RL backend)

### Installation & Run

```bash
# 1. Clone the repository
git clone https://github.com/MohammadFaizAlam/meridian.git
cd meridian

# 2. Install frontend & Express dependencies
npm install

# 3. Start the full-stack dev workstation (Express + Vite + Python RL engine)
npm run dev
```

Open `http://localhost:3000` in your browser. `server.ts` automatically starts the Python backend on port `8001` and proxies all `/api/*` and SSE streaming requests.

### Production Build & Type Check

```bash
npm run lint
npm run build
```

---

## Author

**Md. Faiz Alam**

Built with care for clean financial interfaces, honest backtesting, and practical reinforcement learning.
