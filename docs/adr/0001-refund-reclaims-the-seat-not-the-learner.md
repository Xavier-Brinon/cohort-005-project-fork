# A Refund reclaims the seat, not the learner

**Status:** accepted

When a learner's **Refund Request** is approved and its **Refund** is **Issued**, the
learner stops being able to access that course. We do this in a way that touches only
the **seat** and preserves everything else about the learner's learning — because a
refund is a money-and-access event, not an erasure of the learner's data.

## Decisions

- **Course-scoped.** Revocation ends access to the refunded course only. The learner
  keeps the rest of the site.
- **Decoupled from the decision.** Access ends when the Refund is **Issued**, not when
  the Refund Request is **Approved**. A **Pending** Refund leaves the learner inside.
  A **Failed** Refund keeps the learner inside, because "the decision hasn't changed" —
  the learner is never locked out of a course whose money was never sent.
- **Progress is preserved.** The learner's progress records are not deleted; the
  enrollment is **marked** (a **Revoked Enrollment**), not removed.
- **Re-purchase resumes.** A learner who repurchases the same course picks up their
  preserved progress. The 2-hour watch cap, built from the kept watch events, still
  applies, so a course they already used heavily cannot be refunded again.
- **No double refund.** A purchase may hold several Refund Requests, but a new **Open**
  one is blocked unless the most recent was **Declined**. An Approved or Issued request
  cannot be re-requested on the same purchase.

## Considered options

- **Delete on refund.** Rejected: it destroys historical instructor analytics and the
  watch-gate memory, for no benefit.
- **Revoke on approval.** Rejected: it collides with the Failed Refund rule — a learner
  could be locked out of a course while the money was never sent.

## Consequences

- The access check must know a Refund's **money-state**, not just its decision.
- The dashboard and course pages show nothing new during the Pending window; the
  Settings "Refund Requests" card learns the Approved / Pending / Issued states, and is
  the only learner-visible signal until Issued.
- Instructor analytics and cohort completion numbers stay intact through a refund.
- Known naming drift, older than this ADR: the `refunds` table holds **Refund Requests**
  (status Open / Approved / Declined), so a `refundId` is a Refund Request's id. The
  money-state this ADR needs belongs to the **Refund**. Renaming the table is a
  migration, deferred out of the work that implements this ADR.
