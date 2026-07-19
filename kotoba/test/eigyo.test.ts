import { describe, it, expect, beforeEach } from "vitest";
import { MockEtzhayyim } from "@etzhayyim/sdk-mock";
import {
  createLead,
  getLead,
  listLeads,
  createDeal,
  getDeal,
  listDeals,
  advanceDeal,
  settleDeal,
  splitTithe,
  parseMicros,
  type SettlementExecutor,
} from "../src/index.js";

const fakeSettle: SettlementExecutor = async () => ({ txHash: "0xwon" });
const PAYOUT = "0x9999999999999999999999999999999999999999";

describe("eigyo kotoba", () => {
  let e: any;
  beforeEach(() => {
    e = new MockEtzhayyim({ did: "did:web:eigyo.etzhayyim.com" });
  });

  it("tithe splits 10% with no leak", () => {
    const s = splitTithe(parseMicros("100000000"));
    expect(s.tithe).toBe(10_000_000n);
    expect(s.tithe + s.net).toBe(s.gross);
  });

  describe("lead", () => {
    const l = { leadId: "LD-1", ownerDid: "did:web:rep.etzhayyim.com", company: "Acme Inc", source: "web" };
    it("creates + gets + lists by owner", async () => {
      expect((await createLead(e, l)).status).toBe("created");
      expect((await getLead(e, { leadId: "LD-1" })).lead?.status).toBe("new");
      expect((await listLeads(e, { ownerDid: "did:web:rep.etzhayyim.com" })).total).toBe(1);
    });
    it("is idempotent + rejects missing company", async () => {
      await createLead(e, l);
      expect((await createLead(e, l)).status).toBe("alreadyExists");
      expect((await createLead(e, { ...l, leadId: "LD-2", company: "" })).status).toBe("rejected");
    });
  });

  describe("deal pipeline + settlement", () => {
    const d = {
      dealId: "D-1",
      ownerDid: "did:web:rep.etzhayyim.com",
      title: "Acme annual license",
      valueMicros: "240000000", // 240 USDC
    };
    it("creates at prospecting; advances; rejects bad stage", async () => {
      expect((await createDeal(e, d)).status).toBe("created");
      expect((await getDeal(e, { dealId: "D-1" })).deal?.stage).toBe("prospecting");
      expect((await advanceDeal(e, { dealId: "D-1", stage: "proposal" })).status).toBe("advanced");
      expect((await advanceDeal(e, { dealId: "D-1", stage: "voodoo" as any })).status).toBe("rejected");
    });
    it("won deal cannot be re-staged", async () => {
      await createDeal(e, d);
      await advanceDeal(e, { dealId: "D-1", stage: "won" });
      expect((await advanceDeal(e, { dealId: "D-1", stage: "proposal" })).status).toBe("rejected");
    });
    it("settle requires won stage", async () => {
      await createDeal(e, d);
      expect((await settleDeal(e, fakeSettle, { dealId: "D-1", to: PAYOUT })).status).toBe("notWon");
    });
    it("settles a won deal: tithe split + deal txHash", async () => {
      await createDeal(e, d);
      await advanceDeal(e, { dealId: "D-1", stage: "won" });
      const s = await settleDeal(e, fakeSettle, { dealId: "D-1", to: PAYOUT });
      expect(s.status).toBe("settled");
      expect(s.titheMicros).toBe("24000000"); // 10% of 240
      expect(s.netMicros).toBe("216000000");
      expect((await getDeal(e, { dealId: "D-1" })).deal?.txHash).toBe("0xwon");
    });
    it("does not double-settle", async () => {
      await createDeal(e, d);
      await advanceDeal(e, { dealId: "D-1", stage: "won" });
      await settleDeal(e, fakeSettle, { dealId: "D-1", to: PAYOUT });
      expect((await settleDeal(e, fakeSettle, { dealId: "D-1", to: PAYOUT })).status).toBe("alreadySettled");
    });
    it("filters deals by stage", async () => {
      await createDeal(e, d);
      await createDeal(e, { ...d, dealId: "D-2" });
      await advanceDeal(e, { dealId: "D-2", stage: "negotiation" });
      expect((await listDeals(e, { stage: "negotiation" })).total).toBe(1);
    });
  });
});
