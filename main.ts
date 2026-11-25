// Pump.fun Sharpe Sprint — Cleanest Paper Bot Wins.
// A diversified, risk-controlled momentum bot on the agent-fun/replay/v2 wire.
//
// How it trades (all decisions are made once per batch, from the hello caps and
// the slot the batch carries — no clock, no randomness, fully deterministic):
//   * It watches every new bonding curve and remembers the first price it saw
//     (price = virtual_quote_reserves / virtual_token_reserves, SOL per token).
//   * It BUYS a coin only while it is young (created within the last 1800 slots),
//     has traded at least 3 times, and its price has already risen at least 5%
//     from first sight — early momentum with real buy pressure behind it.
//   * One stake per coin, 0.1 SOL, capped by the harness size cap
//     (maxBuyLamports) and never below the 0.01 SOL round-trip minimum, so a
//     single bad coin can never hurt the account much.
//   * It SELLS a whole position on any of: +12% take-profit, -6% stop-loss, or
//     2400 slots held without a take-profit (a time exit that frees the slot
//     for the next coin). At most 5 open positions, so the book keeps rotating
//     across many distinct mints instead of betting the window on one moonshot.
//   * Every order is sent through runBot, which owns the hello / batch /
//     orders wire protocol; diagnostics go to stderr, never stdout.
//
// The house replay closes positions itself when a curve completes and flattens
// whatever is left at the end of the data, so no end-of-run handling is needed.
import { LAMPORTS_PER_SOL, runBot, type BuyInput, type OrderInput, type SellInput } from "./vendor/makefun-bot.ts";

// --- tuning ---------------------------------------------------------------
const STAKE_LAMPORTS = LAMPORTS_PER_SOL / 10n; // 0.1 SOL per coin
const MIN_BUY_LAMPORTS = LAMPORTS_PER_SOL / 100n; // 0.01 SOL round-trip floor
const ENTRY_RISE_BPS = 500; // buy only after +5% from first-seen price
const ENTRY_MAX_AGE_SLOTS = 1800; // only coins created within the last ~12 min
const ENTRY_MIN_TRADES = 3; // need a little trade history first
const ENTRY_MIN_REAL_SOL = LAMPORTS_PER_SOL; // need >= 1 SOL of real reserve
const TAKE_PROFIT_BPS = 1200; // sell at +12% over the entry price
const STOP_LOSS_BPS = 600; // sell at -6% under the entry price
const TRAIL_ARM_BPS = 800; // trailing stop arms once the coin is +8% over entry
const TRAIL_DROP_BPS = 500; // then sell if it falls 5% back from its peak
const MAX_HOLD_SLOTS = 2400; // time exit: ~16 min without a take-profit
const BUY_SLIPPAGE_BPS = 2000;
const SELL_SLIPPAGE_BPS = 5000;

// --- per-mint memory ------------------------------------------------------
interface CoinMemory {
  firstPrice: number;
  peakPrice: number;
  entryPrice: number | null;
  entrySlot: number | null;
  decided: boolean;
}

const memory = new Map<string, CoinMemory>();

function priceOf(virtualQuote: bigint, virtualToken: bigint): number {
  if (virtualToken === 0n) return 0;
  return Number(virtualQuote) / Number(virtualToken);
}

function withBps(price: number, bps: number): number {
  return (price * (10_000 + bps)) / 10_000;
}

await runBot({
  onBatch(state, batch) {
    const { caps } = state.hello;
    const tx = state.txFeeLamports();
    const orders: OrderInput[] = [];
    let free = state.freeCashLamports();
    let slots = caps.max_open_positions - state.committedPositionCount();

    // Refresh memory from the curves the harness reports this batch.
    for (const [mint, curve] of state.curves) {
      if (curve.complete) continue;
      const price = priceOf(curve.virtual_quote_reserves, curve.virtual_token_reserves);
      if (price <= 0) continue;
      const mem = memory.get(mint);
      if (mem === undefined) {
        memory.set(mint, { firstPrice: price, peakPrice: price, entryPrice: null, entrySlot: null, decided: false });
      } else if (price > mem.peakPrice) {
        mem.peakPrice = price;
      }
    }

    // Exits first: take-profit, stop-loss, or the time exit frees the slot.
    for (const [mint, holding] of state.positions) {
      const curve = state.curves.get(mint);
      const mem = memory.get(mint);
      if (curve === undefined || mem === undefined || mem.entryPrice === null || mem.entrySlot === null) continue;
      const price = priceOf(curve.virtual_quote_reserves, curve.virtual_token_reserves);
      if (price <= 0) continue;
      const heldTooLong = batch.slot - mem.entrySlot >= MAX_HOLD_SLOTS;
      const tookProfit = price >= withBps(mem.entryPrice, TAKE_PROFIT_BPS);
      const stoppedOut = price <= withBps(mem.entryPrice, -STOP_LOSS_BPS);
      // Trailing stop: once the coin ran +8% over entry, bank the gain if it
      // gives back 5% from its peak instead of riding it back to the stop.
      const armed = mem.peakPrice >= withBps(mem.entryPrice, TRAIL_ARM_BPS);
      const trailedOff = armed && price <= withBps(mem.peakPrice, -TRAIL_DROP_BPS);
      if (tookProfit || stoppedOut || heldTooLong || trailedOff) {
        const sell: SellInput = { side: "sell", mint, token_amount: holding.token_amount, max_slippage_bps: SELL_SLIPPAGE_BPS };
        orders.push(sell);
        mem.entryPrice = null;
        mem.entrySlot = null;
      }
    }

    // Entries: young coins with early momentum, in first-seen order.
    for (const [mint, curve] of state.curves) {
      if (orders.length >= caps.max_orders_per_batch || slots <= 0) break;
      if (curve.complete || state.positions.has(mint)) continue;
      const mem = memory.get(mint);
      if (mem === undefined || mem.decided || mem.entryPrice !== null) continue;
      if (curve.created_slot === null || batch.slot - curve.created_slot > ENTRY_MAX_AGE_SLOTS) continue;
      if (curve.trades < ENTRY_MIN_TRADES) continue;
      if (curve.real_quote_reserves < ENTRY_MIN_REAL_SOL) continue;
      const price = priceOf(curve.virtual_quote_reserves, curve.virtual_token_reserves);
      if (price <= 0 || price < withBps(mem.firstPrice, ENTRY_RISE_BPS)) continue;
      const cap = state.maxBuyLamports(mint);
      const amount = cap < STAKE_LAMPORTS ? cap : STAKE_LAMPORTS;
      if (amount < MIN_BUY_LAMPORTS || free < amount + tx) continue;
      mem.decided = true;
      mem.entryPrice = price;
      mem.entrySlot = batch.slot;
      const buy: BuyInput = { side: "buy", mint, quote_lamports: amount, max_slippage_bps: BUY_SLIPPAGE_BPS };
      orders.push(buy);
      free -= amount + tx;
      slots -= 1;
    }

    return orders;
  },

  onDone(state, done) {
    // Diagnostics only (stderr — stdout carries replies alone).
    console.error(
      `done after ${state.seq} batches: cash=${state.cash} lamports, ` +
        `positions=${state.positions.size}, reason=${done.reason}`,
    );
  },
});
