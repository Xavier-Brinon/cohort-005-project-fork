import { eq } from "drizzle-orm";
import type { Queryable } from "~/db";
import { users } from "~/db/schema";
import type { Person } from "~/lib/notifications.server";

// ─── People ───
// Looking a person up by id for a domain write, and naming them in a
// Notification.

export function findPerson(db: Queryable, userId: number) {
  return db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
    })
    .from(users)
    .where(eq(users.id, userId))
    .get();
}

// Only the id and name, so a Notification never carries an email or role.
export function toPerson({ id, name }: Person): Person {
  return { id, name };
}
