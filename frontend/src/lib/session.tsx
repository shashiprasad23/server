import { createContext, useContext, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, auth } from "./api";

export type Membership = {
  projectId: string;
  projectKey: string;
  projectName: string;
  projectKind: "delivery" | "service";
  color: string;
  role: string;
  isTimeApprover: boolean;
  isAiReviewer: boolean;
};

export type Me = {
  id: string;
  name: string;
  email: string;
  initials: string;
  globalRoles: string[];
  organization: { id: string; name: string; timezone: string; featureFlags: Record<string, boolean>; reportingPolicy: string };
  memberships: Membership[];
};

const Ctx = createContext<Me | null>(null);

export function SessionProvider({ children, fallback }: { children: ReactNode; fallback: ReactNode }) {
  const q = useQuery({ queryKey: ["me"], queryFn: () => api<Me>("/me"), enabled: !!auth.token, retry: false });
  if (!auth.token) return <>{fallback}</>;
  if (q.isLoading) return <div className="spinner">Loading…</div>;
  if (q.isError || !q.data) return <>{fallback}</>;
  return <Ctx.Provider value={q.data}>{children}</Ctx.Provider>;
}

export function useMe(): Me {
  const me = useContext(Ctx);
  if (!me) throw new Error("useMe outside session");
  return me;
}

export function useCan() {
  const me = useMe();
  const admin = me.globalRoles.includes("platform_admin");
  return {
    admin,
    resourceManager: admin || me.globalRoles.includes("resource_manager"),
    executive: me.globalRoles.includes("executive_viewer"),
    approver: me.memberships.some((m) => m.isTimeApprover),
    reviewer: admin || me.memberships.some((m) => m.isAiReviewer || ["project_manager", "ai_reviewer"].includes(m.role)),
    manages: (projectId: string) =>
      admin || me.memberships.some((m) => m.projectId === projectId && ["project_manager", "project_admin"].includes(m.role)),
  };
}
