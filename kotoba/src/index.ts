/**
 * eigyo kotoba — barrel.
 *
 * Tier-2 on-chain sales pipeline on the etzhayyim substrate (AT PDS records +
 * on-chain settlement of won deals via TitheRouter). Per ADR-2606011400
 * (on-chain-only). No Stripe, no RW.
 *
 *   lead  : createLead / getLead / listLeads
 *   deal  : createDeal / getDeal / listDeals / advanceDeal / settleDeal
 *   tithe : splitTithe / parseMicros
 *   settle: donateSettlementExecutor (real on-chain adapter)
 */

export * from "./types.js";
export { splitTithe, parseMicros, TITHE_PERMILLE, type TitheSplit } from "./tithe.js";
export { createLead, getLead, listLeads } from "./lead.js";
export { createDeal, getDeal, listDeals, advanceDeal, settleDeal } from "./deal.js";
export { donateSettlementExecutor } from "./settlement.js";
