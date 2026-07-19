/**
 * eigyo kotoba — real on-chain settlement adapter.
 * Wraps @etzhayyim/sdk donate() into the ec SettlementExecutor (internal-purchase
 * → TitheRouter 10% split). Production wiring; tests inject a fake. Per
 * ADR-2605172100 the only value-transfer seam, via the SDK (no direct viem/USDC).
 */

import { donate, type DonateConfig } from "@etzhayyim/sdk";
import type { SettlementExecutor } from "./types.js";

export function donateSettlementExecutor(cfg: DonateConfig): SettlementExecutor {
  return async (opts) => {
    const result = await donate(
      {
        to: opts.to as `0x${string}`,
        amountUsdc: opts.amountMicros,
        purpose: opts.purpose,
        memo: opts.memo,
        forUri: opts.forUri,
      },
      cfg
    );
    return { txHash: result.txHash };
  };
}
