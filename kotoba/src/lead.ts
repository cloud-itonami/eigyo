/**
 * eigyo kotoba — lead tier. AT PDS records (no RW).
 * createLead / getLead / listLeads.
 */

import type { Etzhayyim } from "@etzhayyim/sdk";
import {
  LEAD_COLLECTION,
  leadDid,
  leadRkey,
  type CreateLeadInput,
  type CreateLeadOutput,
  type GetLeadInput,
  type GetLeadOutput,
  type LeadRecord,
  type LeadView,
  type ListLeadsInput,
  type ListLeadsOutput,
} from "./types.js";

export async function createLead(
  e: Etzhayyim,
  input: CreateLeadInput
): Promise<CreateLeadOutput> {
  if (!input.leadId || !input.ownerDid || !input.company) {
    return { status: "rejected", error: "missingRequiredFields" };
  }
  const rkey = leadRkey(input.leadId);
  const existing = await e
    .read<LeadRecord>({ collection: LEAD_COLLECTION, rkey })
    .catch(() => ({ records: [] }));
  if (existing.records[0]?.value) {
    return {
      status: "alreadyExists",
      leadUri: existing.records[0].uri,
      did: existing.records[0].value.did,
      leadId: input.leadId,
    };
  }
  const did = leadDid(input.leadId);
  const record: LeadRecord = {
    did,
    leadId: input.leadId,
    ownerDid: input.ownerDid,
    company: input.company,
    contactName: input.contactName,
    email: input.email,
    source: input.source,
    status: "new",
    createdAt: new Date().toISOString(),
  };
  const receipt = await e.write({
    collection: LEAD_COLLECTION,
    record: record as unknown as Record<string, unknown>,
    rkey,
  });
  return { status: "created", leadUri: receipt.uri, did, leadId: input.leadId };
}

export async function getLead(
  e: Etzhayyim,
  input: GetLeadInput
): Promise<GetLeadOutput> {
  if (!input.leadId) return { error: "invalidLeadId" };
  const resp = await e
    .read<LeadRecord>({ collection: LEAD_COLLECTION, rkey: leadRkey(input.leadId) })
    .catch(() => ({ records: [] }));
  const r = resp.records[0];
  if (!r) return { error: "notFound" };
  return { lead: { ...r.value, leadUri: r.uri } };
}

export async function listLeads(
  e: Etzhayyim,
  input: ListLeadsInput = {}
): Promise<ListLeadsOutput> {
  const limit = Math.min(input.limit ?? 50, 200);
  const resp = await e.read<LeadRecord>({
    collection: LEAD_COLLECTION,
    cursor: input.cursor,
    limit,
  });
  const items: LeadView[] = resp.records
    .filter((r) => {
      const v = r.value;
      if (input.ownerDid && v.ownerDid !== input.ownerDid) return false;
      if (input.status && v.status !== input.status) return false;
      return true;
    })
    .map((r) => ({ ...r.value, leadUri: r.uri }));
  return { items, cursor: resp.cursor, total: items.length };
}
