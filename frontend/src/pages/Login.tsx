import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api, auth, post } from "../lib/api";
import { roleLabel } from "../lib/format";
import { Avatar, ErrorBanner } from "../components/ui";

export default function Login() {
  const config = useQuery({ queryKey: ["auth-config"], queryFn: () => api("/auth/config") });
  const users = useQuery({ queryKey: ["dev-users"], queryFn: () => api("/auth/dev-users"), enabled: config.data?.mode === "dev" });
  const [error, setError] = useState<unknown>(null);

  const signIn = async (email: string) => {
    try {
      const r = await post("/auth/dev-login", { email });
      auth.token = r.accessToken;
      location.assign("/");
    } catch (e) {
      setError(e);
    }
  };

  return (
    <div className="login-wrap">
      <div className="card" style={{ width: "min(560px, 100%)" }}>
        <div className="card-pad stack">
          <div className="row" style={{ gap: 12 }}>
            <span className="brand-mark" style={{ width: 36, height: 36, fontSize: 16 }}>U</span>
            <div>
              <h1 style={{ fontSize: 22 }}>Unified PM</h1>
              <div className="muted">Work, time, resources, service and meeting actions in one record.</div>
            </div>
          </div>
          {config.data?.mode === "oidc" && (
            <div className="banner info">
              This environment signs in with your organisation's single sign-on (Microsoft Entra ID). Your identity
              provider issues the access token used by the app.
            </div>
          )}
          {config.data?.mode === "dev" && (
            <>
              <div className="banner warning">
                Development sign-in. Choose a demo persona — each has different project roles, so you can walk the
                full workflow end to end. Production uses Entra ID / OIDC.
              </div>
              <ErrorBanner error={error} />
              <div className="stack-sm">
                {(users.data ?? []).map((u: any) => (
                  <button key={u.email} className="persona" onClick={() => signIn(u.email)}>
                    <Avatar initials={u.initials} />
                    <div className="grow">
                      <div style={{ fontWeight: 600 }}>{u.name}</div>
                      <div className="subtle">{u.email}</div>
                    </div>
                    <div className="row" style={{ justifyContent: "flex-end", maxWidth: 230 }}>
                      {[...u.globalRoles, ...u.projectRoles].slice(0, 3).map((r: string) => (
                        <span key={r} className="chip">{roleLabel(r)}</span>
                      ))}
                    </div>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
