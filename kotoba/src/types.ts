/**
 * eigyo kotoba — record types.
 *
 * Tier-2 function-split per ADR-2606011400 (on-chain-only). Sales pipeline:
 * leads + deals on AT PDS records; a won deal's payment settles on-chain
 * (USDC + ERC-4337 + TitheRouter 10% Public-Fund split). No Stripe, no RW.
 * ADR-2605172000 kotoba.
 *
 * Amounts are USDC base units (micros) as decimal STRINGS.
 *
 * Identity hierarchy:
 *   did:web:eigyo.etzhayyim.com                       — controller
 *   did:web:eigyo.etzhayyim.com:lead:{leadId}         — a lead
 *   did:web:eigyo.etzhayyim.com:deal:{dealId}         — a deal
 */

export const EIGYO_DID_PREFIX = "did:web:eigyo.etzhayyim.com:" as const;

export const LEAD_COLLECTION = "com.etzhayyim.apps.eigyo.lead";
export const DEAL_COLLECTION = "com.etzhayyim.apps.eigyo.deal";
export const PAYMENT_COLLECTION = "com.etzhayyim.apps.eigyo.payment";

export type EigyoPaymentPurpose = "internal-purchase" | "escrow-refund";

export type LeadStatus = "new" | "working" | "qualified" | "disqualified";

export type DealStage =
  | "prospecting"
  | "proposal"
  | "negotiation"
  | "won"
  | "lost";

export const DEAL_STAGES: ReadonlySet<DealStage> = new Set([
  "prospecting",
  "proposal",
  "negotiation",
  "won",
  "lost",
]);

// ─── Lead ───────────────────────────────────────────────────────────

export interface LeadRecord {
  did: string;
  leadId: string;
  ownerDid: string;
  company: string;
  contactName?: string;
  email?: string;
  source?: string;
  status: LeadStatus;
  createdAt: string;
}

export interface LeadView extends LeadRecord {
  leadUri: string;
}

export interface CreateLeadInput {
  leadId: string;
  ownerDid: string;
  company: string;
  contactName?: string;
  email?: string;
  source?: string;
}

export interface CreateLeadOutput {
  status: "created" | "alreadyExists" | "rejected";
  leadUri?: string;
  did?: string;
  leadId?: string;
  error?: string;
}

export interface GetLeadInput {
  leadId: string;
}

export interface GetLeadOutput {
  lead?: LeadView;
  error?: string;
}

export interface ListLeadsInput {
  ownerDid?: string;
  status?: LeadStatus;
  limit?: number;
  cursor?: string;
}

export interface ListLeadsOutput {
  items: LeadView[];
  cursor?: string;
  total: number;
}

// ─── Deal ───────────────────────────────────────────────────────────

export interface DealRecord {
  did: string;
  dealId: string;
  ownerDid: string;
  leadId?: string;
  title: string;
  /** Deal value, USDC micros as string. */
  valueMicros: string;
  stage: DealStage;
  txHash?: string;
  createdAt: string;
}

export interface DealView extends DealRecord {
  dealUri: string;
}

export interface CreateDealInput {
  dealId: string;
  ownerDid: string;
  title: string;
  valueMicros: string;
  leadId?: string;
}

export interface CreateDealOutput {
  status: "created" | "alreadyExists" | "rejected";
  dealUri?: string;
  did?: string;
  dealId?: string;
  error?: string;
}

export interface GetDealInput {
  dealId: string;
}

export interface GetDealOutput {
  deal?: DealView;
  error?: string;
}

export interface ListDealsInput {
  ownerDid?: string;
  stage?: DealStage;
  limit?: number;
  cursor?: string;
}

export interface ListDealsOutput {
  items: DealView[];
  cursor?: string;
  total: number;
}

export interface AdvanceDealInput {
  dealId: string;
  stage: DealStage;
}

export interface AdvanceDealOutput {
  status: "advanced" | "notFound" | "rejected";
  dealId?: string;
  stage?: DealStage;
  error?: string;
}

// ─── On-chain settlement (won deal) ─────────────────────────────────

export interface PaymentRecord {
  dealId: string;
  ownerDid: string;
  purpose: EigyoPaymentPurpose;
  grossMicros: string;
  titheMicros: string;
  netMicros: string;
  txHash?: string;
  settledAt: string;
}

export interface SettlementExecutor {
  (opts: {
    to: string;
    amountMicros: bigint;
    purpose: EigyoPaymentPurpose;
    memo?: string;
    forUri?: string;
  }): Promise<{ txHash: string }>;
}

export interface SettleDealInput {
  dealId: string;
  /** Payout address (Base L2). */
  to: string;
  memo?: string;
}

export interface SettleDealOutput {
  status: "settled" | "rejected" | "notFound" | "alreadySettled" | "notWon";
  paymentUri?: string;
  txHash?: string;
  titheMicros?: string;
  netMicros?: string;
  error?: string;
}

// ─── Helpers ────────────────────────────────────────────────────────

export function leadDid(leadId: string): string {
  return `${EIGYO_DID_PREFIX}lead:${leadId.toLowerCase()}`;
}

export function leadRkey(leadId: string): string {
  return `lead-${leadId.toLowerCase()}`;
}

export function dealDid(dealId: string): string {
  return `${EIGYO_DID_PREFIX}deal:${dealId.toLowerCase()}`;
}

export function dealRkey(dealId: string): string {
  return `deal-${dealId.toLowerCase()}`;
}

export function paymentRkey(dealId: string): string {
  return `payment-${dealId.toLowerCase()}`;
}
