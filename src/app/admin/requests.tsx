import { Inbox, MailWarning } from "lucide-react";
import type { adminLegalRequests } from "@/lib/admin/console";
import { count, exactTime } from "./format";

type Requests = Awaited<ReturnType<typeof adminLegalRequests>>;

/** Withdrawal notices (handle each through the refund workflow) and the confirmation/acknowledgement outbox. */
export default function RequestsTab({ data, mailOn }: { data: Requests; mailOn: boolean }) {
  return <>
    <section className="mbo-panel" aria-labelledby="mail-heading">
      <header className="mbo-panel-head"><h2 id="mail-heading"><MailWarning size={16} aria-hidden="true" />Confirmation and acknowledgement email</h2></header>
      <dl className="mbo-stats">
        <div><dt>Sending</dt><dd>{mailOn ? "On" : "Off"}</dd></div>
        <div><dt>Waiting</dt><dd>{count(data.mail.pending)}</dd></div>
        <div><dt>Retrying</dt><dd>{count(data.mail.retrying)}</dd></div>
        <div><dt>Failed</dt><dd>{count(data.mail.failed)}</dd></div>
        <div><dt>Sent in 7 days</dt><dd>{count(data.mail.sent7d)}</dd></div>
        <div><dt>Confirmations in 7 days</dt><dd>{count(data.confirmations7d)}</dd></div>
      </dl>
      {data.mail.oldestPendingAt && <p className="mbo-footnote">Oldest waiting email: {exactTime(data.mail.oldestPendingAt)}.{mailOn ? "" : " Sending is off, so nothing goes out until it is switched on."}</p>}
      {data.problems.length > 0 && <div className="mbo-table-wrap"><table className="mbo-table is-compact"><caption className="mbo-sr">Emails that failed or are retrying</caption>
        <thead><tr><th scope="col">Kind</th><th scope="col">To</th><th scope="col">Status</th><th scope="col" className="is-num">Attempts</th><th scope="col">Last error</th><th scope="col">Created</th></tr></thead>
        <tbody>{data.problems.map((row, index) => <tr key={index}><td>{row.kind === "withdrawal_ack" ? "Withdrawal acknowledgement" : "Purchase confirmation"}</td><td>{row.recipient}</td><td>{row.status}</td><td className="is-num">{row.attempts}</td><td>{row.last_error ?? "–"}</td><td>{exactTime(row.created_at)}</td></tr>)}</tbody>
      </table></div>}
    </section>
    <section className="mbo-panel" aria-labelledby="withdrawals-heading">
      <header className="mbo-panel-head"><h2 id="withdrawals-heading"><Inbox size={16} aria-hidden="true" />Withdrawal notices<span className="mbo-count">{count(data.withdrawals.length)} most recent</span></h2></header>
      {data.withdrawals.length ? <div className="mbo-table-wrap"><table className="mbo-table is-compact"><caption className="mbo-sr">Withdrawal notices, newest first</caption>
        <thead><tr><th scope="col">Received</th><th scope="col">Reference</th><th scope="col">From</th><th scope="col">Payment</th><th scope="col">Acknowledgement</th><th scope="col">Notice</th></tr></thead>
        <tbody>{data.withdrawals.map(row => <tr key={row.reference}><td>{exactTime(row.received_at)}</td><td>{row.reference}</td>
          <td>{row.email}{row.name ? ` (${row.name})` : ""}<br /><span className="mbo-muted">{row.source === "signed_in" ? "signed in" : "signed out"}</span></td>
          <td>{row.payment_id ?? row.payment_reference ?? "–"}{row.payment_kind ? <><br /><span className="mbo-muted">{row.payment_kind}</span></> : null}</td>
          <td>{row.acknowledgement === "queued" ? `automatic (${row.mail})` : "reply by hand"}</td>
          <td>{row.statement}{row.message ? <><br /><span className="mbo-muted">{row.message}</span></> : null}</td></tr>)}</tbody>
      </table></div> : <p className="mbo-footnote">No withdrawal notices yet.</p>}
      <p className="mbo-footnote">A notice never refunds anything by itself. Check the payment, then refund through the customer&rsquo;s refund steps within 14 days of the time received. Notices marked &ldquo;reply by hand&rdquo; came signed out with an address or reference we could not match: answer them from admin@makeborne.com.</p>
    </section>
  </>;
}
