import { and, eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { data } from "react-router";

import { db } from "~/db";
import * as schema from "~/db/schema";
import { courses, enrollments, purchases, UserRole, users } from "~/db/schema";
import { resolveCountry } from "~/lib/country.server";
import { checkPppAccess } from "~/lib/ppp";
import { getCurrentUserId } from "~/lib/session";

export type Database = BetterSQLite3Database<typeof schema>;

function getUserById(database: Database, id: number) {
  return database.select().from(users).where(eq(users.id, id)).get();
}

function getCourseById(database: Database, id: number) {
  return database.select().from(courses).where(eq(courses.id, id)).get();
}

function isUserEnrolled(database: Database, userId: number, courseId: number) {
  const enrollment = database
    .select()
    .from(enrollments)
    .where(
      and(eq(enrollments.userId, userId), eq(enrollments.courseId, courseId))
    )
    .get();
  return enrollment !== undefined;
}

function findPurchase(database: Database, userId: number, courseId: number) {
  return database
    .select()
    .from(purchases)
    .where(and(eq(purchases.userId, userId), eq(purchases.courseId, courseId)))
    .get();
}

// getAccess never throws — the lesson page needs to render a paywall preview for
// signed-out and unenrolled visitors rather than erroring. The require* wrappers
// are built on it for the routes that should just reject.

export interface Access {
  userId: number | null;
  user: ReturnType<typeof getUserById>;
  isAdmin: boolean;
  /** The instructor who owns this specific course. */
  isOwningInstructor: boolean;
  /** Owning instructor or admin — the people who speak for the course. */
  isStaff: boolean;
  enrolled: boolean;
  pppBlocked: boolean;
  pppBlockedCountry: string | null;
  pppPurchaseCountry: string | null;
  /**
   * May they read the course's content (lesson bodies, comments)?
   * Staff always can. Students need an enrollment that isn't PPP-blocked.
   */
  canViewContent: boolean;
}

const SIGNED_OUT: Access = {
  userId: null,
  user: undefined,
  isAdmin: false,
  isOwningInstructor: false,
  isStaff: false,
  enrolled: false,
  pppBlocked: false,
  pppBlockedCountry: null,
  pppPurchaseCountry: null,
  canViewContent: false,
};

/** Who is asking: the session's user (null when signed out) and their country. */
export interface Viewer {
  userId: number | null;
  country: string | null;
}

/** The session's user and country, from the request. */
export async function getViewer(request: Request): Promise<Viewer> {
  return {
    userId: await getCurrentUserId(request),
    country: await resolveCountry(request),
  };
}

export async function getAccess(
  request: Request,
  courseId: number
): Promise<Access> {
  return resolveAccess(db, await getViewer(request), courseId);
}

/** getAccess with the database and viewer given, for code that injects them. */
export function resolveAccess(
  database: Database,
  { userId, country }: Viewer,
  courseId: number
): Access {
  if (!userId) return SIGNED_OUT;

  const user = getUserById(database, userId);
  if (!user) return SIGNED_OUT;

  const course = getCourseById(database, courseId);
  const isAdmin = user.role === UserRole.Admin;
  const isOwningInstructor = course?.instructorId === userId;
  const isStaff = isAdmin || isOwningInstructor;
  const enrolled = isUserEnrolled(database, userId, courseId);

  // PPP only restricts students who bought at a discount — staff are exempt.
  let ppp = {
    blocked: false,
    blockedCountry: null as string | null,
    purchaseCountry: null as string | null,
  };

  if (enrolled && !isStaff && course) {
    const purchase = findPurchase(database, userId, courseId);
    ppp = checkPppAccess(
      course.price,
      course.pppEnabled,
      purchase?.country ?? null,
      country
    );
  }

  return {
    userId,
    user,
    isAdmin,
    isOwningInstructor,
    isStaff,
    enrolled,
    pppBlocked: ppp.blocked,
    pppBlockedCountry: ppp.blockedCountry,
    pppPurchaseCountry: ppp.purchaseCountry,
    canViewContent: isStaff || (enrolled && !ppp.blocked),
  };
}

/**
 * Throws 401 unless someone is signed in. Returns their user id.
 */
export async function requireUserId(request: Request): Promise<number> {
  const userId = await getCurrentUserId(request);
  if (!userId) {
    throw data("Select a user from the DevUI panel.", { status: 401 });
  }
  return userId;
}

/**
 * Throws 401 when signed out, 403 when the user can't see the course's content.
 * Use in actions — loader guards don't protect actions.
 */
export async function requireContentAccess(
  request: Request,
  courseId: number
): Promise<Access> {
  return assertContentAccess(await getAccess(request, courseId));
}

/** requireContentAccess for an Access already resolved. */
export function assertContentAccess(access: Access): Access {
  if (!access.userId) {
    throw data("Select a user from the DevUI panel.", { status: 401 });
  }

  if (!access.canViewContent) {
    throw data("You must be enrolled in this course.", { status: 403 });
  }

  return access;
}

/**
 * Throws unless the user is the course's own instructor, or an admin.
 */
export async function requireStaff(
  request: Request,
  courseId: number
): Promise<Access> {
  const access = await getAccess(request, courseId);

  if (!access.userId) {
    throw data("Select a user from the DevUI panel.", { status: 401 });
  }

  if (!access.isStaff) {
    throw data("Only this course's instructor can do that.", { status: 403 });
  }

  return access;
}

/**
 * Throws unless the user is an instructor or an admin, without tying them to a
 * particular course — for pages that span all of someone's courses.
 */
export async function requireInstructorOrAdmin(request: Request) {
  const userId = await requireUserId(request);
  const user = getUserById(db, userId);

  if (
    !user ||
    (user.role !== UserRole.Instructor && user.role !== UserRole.Admin)
  ) {
    throw data("Only instructors can access this page.", { status: 403 });
  }

  return { userId, user, isAdmin: user.role === UserRole.Admin };
}
