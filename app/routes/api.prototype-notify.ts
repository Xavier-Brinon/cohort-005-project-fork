// PROTOTYPE, throwaway (branch prototype/notification-inbox). Never merge.
// Sends one sample Notification of the given type to the current user.
import { data } from "react-router";
import type { Route } from "./+types/api.prototype-notify";
import { getCurrentUserId } from "~/lib/session";
import {
  PROTOTYPE_TYPES,
  triggerPrototypeNotification,
  type PrototypeType,
} from "~/lib/knock.prototype.server";

export async function action({ request }: Route.ActionArgs) {
  const userId = await getCurrentUserId(request);
  if (!userId) throw data("Select a user from the DevUI panel", { status: 401 });

  const type = String((await request.formData()).get("type"));
  if (!PROTOTYPE_TYPES.includes(type as PrototypeType)) {
    throw data("Unknown type", { status: 400 });
  }

  try {
    const res = await triggerPrototypeNotification(userId, type as PrototypeType);
    return { ok: true as const, type, workflowRunId: res.workflow_run_id };
  } catch (e) {
    return { ok: false as const, type, error: (e as Error).message };
  }
}
