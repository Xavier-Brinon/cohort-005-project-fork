import { useEffect } from "react";
import { useFetcher } from "react-router";
import { toast } from "sonner";
import { z } from "zod";
import type { Route } from "./+types/admin.refunds";
import { getCurrentUserId } from "~/lib/session";
import { parseFormData } from "~/lib/validation";
import { decideRefundRequest } from "~/lib/refunds.server";
import {
  UserRole,
  RefundStatus,
  refunds,
  purchases,
  courses,
  users,
} from "~/db/schema";
import { db } from "~/db";
import { eq } from "drizzle-orm";
import { Card, CardContent } from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import { Skeleton } from "~/components/ui/skeleton";
import { AlertTriangle, Inbox, Check, X, Banknote } from "lucide-react";
import { data, isRouteErrorResponse, Link } from "react-router";
import { formatPrice } from "~/lib/utils";

const adminRefundActionSchema = z.object({
  refundId: z.coerce.number().int(),
  // A decision is one of two things; the engine treats any other value as a
  // no-op, so the union is the contract.
  decision: z.enum(["approve", "decline"]),
});

function getUserById(id: number) {
  return db.select().from(users).where(eq(users.id, id)).get();
}

function getOpenRefundRequests() {
  return db
    .select({
      refundId: refunds.id,
      reason: refunds.reason,
      requestedAt: refunds.requestedAt,
      amountPaid: purchases.amountPaid,
      courseTitle: courses.title,
      courseSlug: courses.slug,
      learnerName: users.name,
      learnerEmail: users.email,
    })
    .from(refunds)
    .innerJoin(purchases, eq(refunds.purchaseId, purchases.id))
    .innerJoin(courses, eq(purchases.courseId, courses.id))
    .innerJoin(users, eq(purchases.userId, users.id))
    .where(eq(refunds.status, RefundStatus.Open))
    .all();
}

export function meta() {
  return [
    { title: "Refund Requests — Cadence" },
    {
      name: "description",
      content: "Approve or decline open refund requests",
    },
  ];
}

export async function loader({ request }: Route.LoaderArgs) {
  const currentUserId = await getCurrentUserId(request);

  if (!currentUserId) {
    throw data("Select a user from the DevUI panel to manage refunds.", {
      status: 401,
    });
  }

  const currentUser = getUserById(currentUserId);

  if (!currentUser || currentUser.role !== UserRole.Admin) {
    throw data("Only platform admins can review refund requests.", {
      status: 403,
    });
  }

  return { refundRequests: getOpenRefundRequests() };
}

export async function action({ request }: Route.ActionArgs) {
  const currentUserId = await getCurrentUserId(request);

  if (!currentUserId) {
    throw data("You must be logged in.", { status: 401 });
  }

  const currentUser = getUserById(currentUserId);
  if (!currentUser || currentUser.role !== UserRole.Admin) {
    throw data("Only platform admins can decide refund requests.", {
      status: 403,
    });
  }

  const formData = await request.formData();
  const parsed = parseFormData(formData, adminRefundActionSchema);

  if (!parsed.success) {
    return data(
      { error: Object.values(parsed.errors)[0] ?? "Invalid request." },
      { status: 400 }
    );
  }

  const { refundId, decision } = parsed.data;

  // Deciding a request does not revoke the learner's access — that happens when
  // the Refund is Issued, not at the moment of the decision (ADR 0001).
  const decided = decideRefundRequest(db, {
    refundId,
    decision,
    decidedByUserId: currentUserId,
  });

  if (!decided) {
    return data({ error: "That refund request could not be found." }, { status: 404 });
  }

  return { success: true, decision };
}

function RefundRow({
  refund,
}: {
  refund: {
    refundId: number;
    reason: string;
    requestedAt: string;
    amountPaid: number;
    courseTitle: string;
    courseSlug: string;
    learnerName: string;
    learnerEmail: string;
  };
}) {
  const fetcher = useFetcher();

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.success) {
      toast.success(
        fetcher.data.decision === "approve"
          ? "Refund approved."
          : "Refund declined."
      );
    }
    if (fetcher.state === "idle" && fetcher.data?.error) {
      toast.error(fetcher.data.error);
    }
  }, [fetcher.state, fetcher.data]);

  function decide(decision: "approve" | "decline") {
    fetcher.submit({ refundId: String(refund.refundId), decision }, { method: "post" });
  }

  const requestedOn = new Date(refund.requestedAt).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

  return (
    <div className="flex flex-col gap-3 border-b border-border p-4 last:border-0 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <Banknote className="size-4 shrink-0 text-muted-foreground" />
          <Link
            to={`/courses/${refund.courseSlug}`}
            className="font-medium hover:underline"
          >
            {refund.courseTitle}
          </Link>
          <span className="shrink-0 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
            Open
          </span>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {refund.learnerName} · {refund.learnerEmail} ·{" "}
          {formatPrice(refund.amountPaid)} · requested {requestedOn}
        </p>
        <p className="mt-2 text-sm">{refund.reason}</p>
      </div>
      <div className="flex shrink-0 gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => decide("decline")}
          disabled={fetcher.state !== "idle"}
        >
          <X className="mr-1 size-3.5" />
          Decline
        </Button>
        <Button
          size="sm"
          onClick={() => decide("approve")}
          disabled={fetcher.state !== "idle"}
        >
          <Check className="mr-1 size-3.5" />
          Approve
        </Button>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <Card>
      <CardContent className="py-8 text-center">
        <Inbox className="mx-auto mb-3 size-8 text-muted-foreground/50" />
        <p className="text-muted-foreground">No open refund requests.</p>
      </CardContent>
    </Card>
  );
}

function RefundRowSkeleton() {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border p-4 last:border-0">
      <div className="flex-1">
        <Skeleton className="mb-2 h-4 w-40" />
        <Skeleton className="mb-1 h-3 w-56" />
        <Skeleton className="h-3 w-72" />
      </div>
      <Skeleton className="h-8 w-32" />
    </div>
  );
}

export function HydrateFallback() {
  return (
    <div className="mx-auto max-w-7xl p-6 lg:p-8">
      <div className="mb-8">
        <Skeleton className="h-9 w-52" />
      </div>
      <Card>
        <CardContent className="p-0">
          {Array.from({ length: 3 }).map((_, i) => (
            <RefundRowSkeleton key={i} />
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

export default function AdminRefunds({ loaderData }: Route.ComponentProps) {
  const { refundRequests } = loaderData;

  return (
    <div className="mx-auto max-w-7xl p-6 lg:p-8">
      <nav className="mb-6 text-sm text-muted-foreground">
        <Link to="/" className="hover:text-foreground">
          Home
        </Link>
        <span className="mx-2">/</span>
        <span className="text-foreground">Refund Requests</span>
      </nav>

      <div className="mb-8">
        <h1 className="text-3xl font-bold">Refund Requests</h1>
        <p className="mt-1 text-muted-foreground">
          Approve or decline the learner&apos;s asks. A decision is final — a request
          is not reopened once resolved.
        </p>
      </div>

      <div className="mb-4 flex items-center gap-2 text-sm text-muted-foreground">
        <Inbox className="size-4" />
        <span>
          {refundRequests.length}{" "}
          {refundRequests.length === 1 ? "request" : "requests"} waiting on you
        </span>
      </div>

      {refundRequests.length === 0 ? (
        <EmptyState />
      ) : (
        <Card>
          <CardContent className="p-0">
            {refundRequests.map((refund) => (
              <RefundRow key={refund.refundId} refund={refund} />
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let title = "Something went wrong";
  let message =
    "An unexpected error occurred while loading refund requests.";

  if (isRouteErrorResponse(error)) {
    if (error.status === 401) {
      title = "Sign in required";
      message =
        typeof error.data === "string"
          ? error.data
          : "Please select a user from the DevUI panel.";
    } else if (error.status === 403) {
      title = "Access denied";
      message =
        typeof error.data === "string"
          ? error.data
          : "Only platform admins can review refund requests.";
    } else {
      title = `Error ${error.status}`;
      message = typeof error.data === "string" ? error.data : error.statusText;
    }
  }

  return (
    <div className="flex min-h-[50vh] items-center justify-center p-6">
      <div className="text-center">
        <AlertTriangle className="mx-auto mb-4 size-12 text-muted-foreground" />
        <h1 className="mb-2 text-2xl font-bold">{title}</h1>
        <p className="mb-6 text-muted-foreground">{message}</p>
        <div className="flex items-center justify-center gap-3">
          <Link to="/">
            <Button>Go Home</Button>
          </Link>
          <Link to="/admin/courses">
            <Button variant="outline">Manage Courses</Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
