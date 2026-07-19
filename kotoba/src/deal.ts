/**
 * eigyo kotoba — deal pipeline + on-chain settlement tier.
 *
 * createDeal (prospecting) / getDeal / listDeals / advanceDeal (stage move).
 * settleDeal performs on-chain USDC settlement of a WON deal via an injected
 * SettlementExecutor (real: wrap @etzhayyim/sdk donate() → TitheRouter 10%
 * split), writes a payment record, and stamps the deal txHash. No Stripe, no RW.
 */

import type { Etzhayyim } from "@etzhayyim/sdk";
import {
  DEAL_COLLECTION,
  DEAL_STAGES,
  PAYMENT_COLLECTION,
  dealDid,
  dealRkey,
  paymentRkey,
  type AdvanceDealInput,
  type AdvanceDealOutput,
  type CreateDealInput,
  type CreateDealOutput,
  type DealRecord,
  type DealStage,
  type DealView,
  type GetDealInput,
  type GetDealOutput,
  type ListDealsInput,
  type ListDealsOutput,
  type PaymentRecord,
  type SettlementExecutor,
  type SettleDealInput,
  type SettleDealOutput,
} from "./types.js";
import { parseMicros, splitTithe } from "./tithe.js";

const TERMINAL: ReadonlySet<DealStage> = new Set(["won", "lost"]);

export async function createDeal(
  e: Etzhayyim,
  input: CreateDealInput
): Promise<CreateDealOutput> {
  if (!input.dealId || !input.ownerDid || !input.title) {
    return { status: "rejected", error: "missingRequiredFields" };
  }
  try {
    if (parseMicros(input.valueMicros) <= 0n) {
      return { status: "rejected", error: "valueMustBePositive" };
    }
  } catch {
    return { status: "rejected", error: "invalidValue" };
  }

  const rkey = dealRkey(input.dealId);
  const existing = await e
    .read<DealRecord>({ collection: DEAL_COLLECTION, rkey })
    .catch(() => ({ records: [] }));
  if (existing.records[0]?.value) {
    return {
      status: "alreadyExists",
      dealUri: existing.records[0].uri,
      did: existing.records[0].value.did,
      dealId: input.dealId,
    };
  }
  const did = dealDid(input.dealId);
  const record: DealRecord = {
    did,
    dealId: input.dealId,
    ownerDid: input.ownerDid,
    leadId: input.leadId,
    title: input.title,
    valueMicros: input.valueMicros,
    stage: "prospecting",
    createdAt: new Date().toISOString(),
  };
  const receipt = await e.write({
    collection: DEAL_COLLECTION,
    record: record as unknown as Record<string, unknown>,
    rkey,
  });
  return { status: "created", dealUri: receipt.uri, did, dealId: input.dealId };
}

export async function getDeal(
  e: Etzhayyim,
  input: GetDealInput
): Promise<GetDealOutput> {
  if (!input.dealId) return { error: "invalidDealId" };
  const resp = await e
    .read<DealRecord>({ collection: DEAL_COLLECTION, rkey: dealRkey(input.dealId) })
    .catch(() => ({ records: [] }));
  const r = resp.records[0];
  if (!r) return { error: "notFound" };
  return { deal: { ...r.value, dealUri: r.uri } };
}

export async function listDeals(
  e: Etzhayyim,
  input: ListDealsInput = {}
): Promise<ListDealsOutput> {
  const limit = Math.min(input.limit ?? 50, 200);
  const resp = await e.read<DealRecord>({
    collection: DEAL_COLLECTION,
    cursor: input.cursor,
    limit,
  });
  const items: DealView[] = resp.records
    .filter((r) => {
      const v = r.value;
      if (input.ownerDid && v.ownerDid !== input.ownerDid) return false;
      if (input.stage && v.stage !== input.stage) return false;
      return true;
    })
    .map((r) => ({ ...r.value, dealUri: r.uri }));
  return { items, cursor: resp.cursor, total: items.length };
}

/** Move a deal to a new stage. A terminal (won/lost) deal cannot be re-staged. */
export async function advanceDeal(
  e: Etzhayyim,
  input: AdvanceDealInput
): Promise<AdvanceDealOutput> {
  if (!input.dealId || !DEAL_STAGES.has(input.stage)) {
    return { status: "rejected", error: "invalidStage" };
  }
  const rkey = dealRkey(input.dealId);
  const resp = await e
    .read<DealRecord>({ collection: DEAL_COLLECTION, rkey })
    .catch(() => ({ records: [] }));
  const deal = resp.records[0]?.value;
  if (!deal) return { status: "notFound", error: "dealNotFound" };
  if (TERMINAL.has(deal.stage)) {
    return { status: "rejected", error: `dealTerminal:${deal.stage}` };
  }
  await e.write({
    collection: DEAL_COLLECTION,
    record: { ...deal, stage: input.stage } as unknown as Record<string, unknown>,
    rkey,
  });
  return { status: "advanced", dealId: input.dealId, stage: input.stage };
}

/** Settle a WON deal's value on-chain (USDC + tithe). Idempotent via txHash. */
export async function settleDeal(
  e: Etzhayyim,
  settle: SettlementExecutor,
  input: SettleDealInput
): Promise<SettleDealOutput> {
  if (!input.dealId || !input.to) {
    return { status: "rejected", error: "missingRequiredFields" };
  }
  const rkey = dealRkey(input.dealId);
  const resp = await e
    .read<DealRecord>({ collection: DEAL_COLLECTION, rkey })
    .catch(() => ({ records: [] }));
  const dealRec = resp.records[0];
  if (!dealRec?.value) return { status: "notFound", error: "dealNotFound" };
  const deal = dealRec.value;
  if (deal.txHash) return { status: "alreadySettled", error: "dealAlreadySettled" };
  if (deal.stage !== "won") return { status: "notWon", error: `dealNotWon:${deal.stage}` };

  const split = splitTithe(parseMicros(deal.valueMicros));
  const { txHash } = await settle({
    to: input.to,
    amountMicros: split.gross,
    purpose: "internal-purchase",
    memo: input.memo,
    forUri: dealRec.uri,
  });

  const payment: PaymentRecord = {
    dealId: deal.dealId,
    ownerDid: deal.ownerDid,
    purpose: "internal-purchase",
    grossMicros: split.gross.toString(),
    titheMicros: split.tithe.toString(),
    netMicros: split.net.toString(),
    txHash,
    settledAt: new Date().toISOString(),
  };
  const payReceipt = await e.write({
    collection: PAYMENT_COLLECTION,
    record: payment as unknown as Record<string, unknown>,
    rkey: paymentRkey(deal.dealId),
  });

  await e.write({
    collection: DEAL_COLLECTION,
    record: { ...deal, txHash } as unknown as Record<string, unknown>,
    rkey,
  });

  return {
    status: "settled",
    paymentUri: payReceipt.uri,
    txHash,
    titheMicros: payment.titheMicros,
    netMicros: payment.netMicros,
  };
}
