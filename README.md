# Pump.fun Sharpe Sprint — Cleanest Paper Bot

[![make.fun](https://make.fun/badge/u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532.svg)](https://make.fun/bounty/u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532)
[![rank](https://make.fun/badge/u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532/vansouthrace/sharpe-sprint-cleanest-bot/rank.svg)](https://make.fun/bounty/u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532)
[![reward](https://make.fun/badge/u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532/vansouthrace/sharpe-sprint-cleanest-bot/reward.svg)](https://make.fun/bounty/u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532)

A paper-trading bot for the [Pump.fun Sharpe Sprint](https://make.fun/bounty/u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532) bounty on make.fun. It trades on the 6-hour pump.fun forward replay, ranked by hourly Sharpe ratio: steady, controlled gains beat one lucky moonshot.

## Strategy

- **Young momentum only:** buys coins created within the last ~12 minutes whose price already rose at least 5% from first sight, with at least 3 trades and 1 SOL of real reserve behind them.
- **Small, fixed stakes:** 0.1 SOL per coin (capped by the harness size cap, never below the 0.01 SOL round-trip minimum), at most 5 open positions.
- **Tight exits:** +12% take-profit, −6% stop-loss, a trailing stop once a coin runs +8%, and a time exit after ~16 minutes — the book keeps rotating across many distinct mints, which is what the 20-mint guardrail and the Sharpe ranking both reward.
- **Deterministic:** slot-based timing only, no clock, no randomness; the replay is reproducible, and the two grading runs produce identical action logs.

## Run it

```sh
node main.ts
```

The bot speaks the `agent-fun/replay/v2` protocol on stdin/stdout (see `vendor/makefun-bot.ts`, the kit's SDK shim). Paper trading only — no real funds move.
