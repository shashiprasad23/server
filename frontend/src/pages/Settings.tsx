import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, put } from "../lib/api";
import { Card, Loading } from "../components/ui";

export default function Settings() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["prefs"], queryFn: () => api("/notification-preferences") });
  if (!q.data) return <Loading />;
  const save = async (p: any) => { await put("/notification-preferences", p); qc.invalidateQueries({ queryKey: ["prefs"] }); };
  return (
    <>
      <h1>Notification preferences</h1>
      <Card pad={false} extra="Teams messages carry only a title and a deep link, never transcript content">
        <table className="table">
          <thead><tr><th>Notification</th><th>In app</th><th>Microsoft Teams</th></tr></thead>
          <tbody>
            {q.data.map((p: any) => (
              <tr key={p.kind}>
                <td style={{ textTransform: "capitalize" }}>{p.kind.replace(/_/g, " ")}</td>
                <td><input type="checkbox" aria-label={`${p.kind} in app`} checked={p.inApp} onChange={(e) => save({ ...p, inApp: e.target.checked })} /></td>
                <td><input type="checkbox" aria-label={`${p.kind} in Teams`} checked={p.teams} onChange={(e) => save({ ...p, teams: e.target.checked })} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  );
}
