import { eq, type InferSelectModel } from "drizzle-orm";
import { type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "~/db/schema";
import { purchases, refunds, RefundStatus } from "~/db/schema";

type DB = BetterSQLite3Database<typeof schema>;
type RefundRow = InferSelectModel<typeof refunds>;

export type RefundDecision = "approve" | "decline";

/**
 * Decides an Open Refund Request. Approval records the full amount the learner
 * paid as the amount refunded; a decline refunds nothing. A decision is final:
 * a request that is not Open is left untouched. Returns the updated row, or null
 * when the request does not exist.
 */
export function decideRefundRequest(
  db: DB,
  input: { refundId: number; decision: RefundDecision; decidedByUserId: number }
): RefundRow | null {
  const request = db.select().from(refunds).where(eq(refunds.id, input.refundId)).get();

  if (!request) return null;

  // A decision is final — once resolved, the request is not touched again.
  if (request.status !== RefundStatus.Open) return request;

  const approving = input.decision === "approve";

  const purchase = db
    .select({ amountPaid: purchases.amountPaid })
    .from(purchases)
    .where(eq(purchases.id, request.purchaseId))
    .get();

  return (
    db
      .update(refunds)
      .set({
        status: approving ? RefundStatus.Approved : RefundStatus.Declined,
        amountRefunded: approving ? (purchase?.amountPaid ?? null) : null,
        resolvedAt: new Date().toISOString(),
        resolvedByUserId: input.decidedByUserId,
      })
      .where(eq(refunds.id, input.refundId))
      .returning()
      .get() ?? null
  );
}
