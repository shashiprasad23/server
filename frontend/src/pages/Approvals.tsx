import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, post } from "../lib/api";
import { fmtDay, isoWeek, mins } from "../lib/format";
import { Avatar, Card, Chip, Empty, ErrorBanner, Loading, Modal, useToast } from "../components/ui";

export default function Approvals() {
  const q = useQuery({ queryKey: ["approvals"], queryFn: () => api("/timesheets/approvals") });
  const qc = useQueryClient();
  const toast = useToast();
  const [reject, setReject] = useState<any>(null);
  const [error, setError] = useState<unknown>(null);
  if (q.isLoading) return <Loading />;
  if (q.isError) return <ErrorBanner error={q.error} />;

  const decide = async (row: any, decision: "approve" | "reject", reason?: string, entryIds?: string[]) => {
    setError(null);
    try {
      const r = await post(`/timesheets/${row.periodId}/decision`, { projectId: row.project.id, decision, reason, entryIds });
      toast(`${decision === "approve" ? "Approved" : "Rejected"} ${r.decided} entr${r.decided === 1 ? "y" : "ies"} for ${row.user.name}`);
      qc.invalidateQueries();
    } catch (e) { setError(e); }
  };
  const decideAmendment = async (id: string, decision: string) => {
    try { await post(`/amendments/${id}/decision`, { decision }); toast(`Amendment ${decision}d`); qc.invalidateQueries(); }
    catch (e) { setError(e); }
  };
  const lock = async (periodId: string) => {
    try { await post(`/timesheets/${periodId}/lock`); toast("Period locked"); qc.invalidateQueries(); } catch (e) { setError(e); }
  };

  return (
    <>
      <div className="crumbs"><Link to="/timesheets">Timesheets</Link><span>/</span><strong>Approvals</strong></div>
      <h1>Approvals queue</h1>
      <div className="muted">You see only entries for projects where you are the time approver. Bulk approval still records one outcome per entry.</div>
      <ErrorBanner error={error} />
      {q.data.queue.length === 0 && q.data.amendments.length === 0 && <Card><Empty>Nothing waiting for your approval.</Empty></Card>}
      {q.data.queue.map((row: any) => (
        <Card key={`${row.periodId}-${row.project.id}`} pad={false}
              title={<div className="row"><Avatar small initials={row.user.initials} /><h2>{row.user.name}</h2><Chip>{row.project.name}</Chip><span className="subtle">Week {isoWeek(row.periodStart)} · {fmtDay(row.periodStart)} – {fmtDay(row.periodEnd)}</span></div>}
              extra={<div className="row"><span className="mono">{mins(row.minutes)} · {row.count} entries</span>
                <button className="btn sm" onClick={() => setReject(row)}>Reject…</button>
                <button className="btn sm primary" onClick={() => decide(row, "approve")}>Approve all</button>
                <button className="btn sm" title="Lock once every project in the week is approved" onClick={() => lock(row.periodId)}>Lock period</button></div>}>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Date</th><th>Ticket</th><th>Activity</th><th>Description</th><th className="right">Duration</th><th /></tr></thead>
              <tbody>
                {row.entries.map((e: any) => (
                  <tr key={e.id}>
                    <td className="nowrap mono small">{fmtDay(e.workDate)}</td>
                    <td><Link className="key" to={`/work-items/${e.workItem.key}`}>{e.workItem.key}</Link><div className="subtle">{e.workItem.title}</div></td>
                    <td className="small">{e.activityCategory}</td>
                    <td className="small">{e.description}</td>
                    <td className="num">{mins(e.durationMinutes)}</td>
                    <td className="right nowrap">
                      <button className="btn sm" onClick={() => decide(row, "approve", undefined, [e.id])}>Approve</button>{" "}
                      <button className="btn sm" onClick={() => setReject({ ...row, entryIds: [e.id] })}>Reject</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ))}
      {q.data.amendments.length > 0 && (
        <Card title="Amendment requests" pad={false}>
          <table className="table">
            <thead><tr><th>Person</th><th>Ticket</th><th>Change</th><th>Reason</th><th /></tr></thead>
            <tbody>
              {q.data.amendments.map((a: any) => (
                <tr key={a.id}>
                  <td>{a.user.name}</td>
                  <td><span className="key">{a.workItem.key}</span><div className="subtle">{a.workItem.title}</div></td>
                  <td className="small mono">{a.reversal ? "Reverse entry" : `${mins(a.before.durationMinutes)} on ${fmtDay(a.before.workDate)} → ${mins(a.after.durationMinutes)} on ${fmtDay(a.after.workDate)}`}</td>
                  <td className="small">{a.reason}</td>
                  <td className="right nowrap"><button className="btn sm" onClick={() => decideAmendment(a.id, "reject")}>Reject</button>{" "}<button className="btn sm primary" onClick={() => decideAmendment(a.id, "approve")}>Approve</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      {reject && <RejectModal row={reject} onClose={() => setReject(null)} onReject={(reason) => { decide(reject, "reject", reason, reject.entryIds); setReject(null); }} />}
    </>
  );
}

function RejectModal({ row, onClose, onReject }: { row: any; onClose: () => void; onReject: (reason: string) => void }) {
  const [reason, setReason] = useState("");
  return (
    <Modal title={`Reject time · ${row.user.name}`} onClose={onClose}
           footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn dark" disabled={!reason.trim()} onClick={() => onReject(reason)}>Reject with reason</button></>}>
      <div className="muted">{row.entryIds ? "One entry" : `${row.count} entries`} on {row.project.name}. The reason is mandatory and shown to the person.</div>
      <textarea className="input" rows={3} autoFocus placeholder="e.g. Log this against WP-1052, the sub-task" value={reason} onChange={(e) => setReason(e.target.value)} />
    </Modal>
  );
}
