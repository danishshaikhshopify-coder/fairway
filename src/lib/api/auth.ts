// Shared authentication/authorisation for API route handlers.
//
// Every route that touches tenant data calls `requireActor()`. It validates
// the JWT with GoTrue (`getUser`, not a cookie sniff), then resolves the
// caller's workspace_members row. The workspace id and member id returned here
// are the ONLY ids a route may pass to a service-role query.

import type { SupabaseClient } from "@supabase/supabase-js";
import { getServerSupabase } from "@/lib/supabase/server";

export type WorkspaceRole = "owner" | "admin" | "sales_rep" | "viewer";

export interface Actor {
  db: SupabaseClient;
  userId: string;
  memberId: string;
  workspaceId: string;
  role: WorkspaceRole;
}

export type ActorResult =
  | { actor: Actor; response?: never }
  | { actor?: never; response: Response };

const json = (body: unknown, status: number): Response =>
  Response.json(body, { status });

export async function requireActor(): Promise<ActorResult> {
  const db = await getServerSupabase();
  if (!db) {
    return {
      response: json(
        {
          error: "not_configured",
          message:
            "Live mode is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.",
        },
        503,
      ),
    };
  }

  const { data: userData, error: userError } = await db.auth.getUser();
  if (userError || !userData.user) {
    return {
      response: json({ error: "unauthorized", message: "Sign in to continue." }, 401),
    };
  }

  const { data: member, error: memberError } = await db
    .from("workspace_members")
    .select("id, workspace_id, role")
    .eq("user_id", userData.user.id)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (memberError) {
    return {
      response: json(
        { error: "workspace_lookup_failed", message: "Could not resolve your workspace." },
        500,
      ),
    };
  }
  if (!member) {
    return {
      response: json(
        { error: "no_workspace", message: "Your account is not a member of a workspace." },
        403,
      ),
    };
  }

  return {
    actor: {
      db,
      userId: userData.user.id,
      memberId: String(member.id),
      workspaceId: String(member.workspace_id),
      role: String(member.role) as WorkspaceRole,
    },
  };
}

export function canWrite(role: WorkspaceRole): boolean {
  return role === "owner" || role === "admin" || role === "sales_rep";
}

export function canConfigure(role: WorkspaceRole): boolean {
  return role === "owner" || role === "admin";
}

export function forbidden(message = "Your role cannot perform this action."): Response {
  return json({ error: "forbidden", message }, 403);
}

export function badRequest(message: string): Response {
  return json({ error: "bad_request", message }, 400);
}

export function serverError(message: string): Response {
  return json({ error: "server_error", message }, 500);
}

/** Safe JSON body parse; never throws a 500 on malformed input. */
export async function readJson<T = Record<string, unknown>>(
  request: Request,
): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}
