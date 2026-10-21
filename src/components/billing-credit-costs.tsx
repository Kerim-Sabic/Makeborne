import { BUILDER_EFFORT } from "@/lib/builder/pricing";
import { PLAN_CEILING_CREDITS } from "@/lib/builder/plan";
import { AUTO_REVIEW_ROUNDS, reviewCreditCeiling } from "@/lib/builder/review-policy";
import { EFFORT_LEVELS, EFFORT_PRESENTATION } from "@/lib/routing/effort";
import type { BuilderEstimates, CreditRange } from "@/lib/builder/credit-estimate";

const measured = (range: CreditRange, noun: string) => `${range.min}–${range.max} credits (${range.samples} test ${noun}${range.samples === 1 ? "" : "s"})`;

/** Per-action credit limits from the live pricing constants, beside what was
 * actually measured. A blank "measured" cell means nothing has been measured
 * at that level yet; no figure is extrapolated. */
export default function BillingCreditCosts({ estimates }: { estimates: BuilderEstimates | null }) {
  return <section id="costs" className="billing-costs" aria-labelledby="costs-heading">
    <div className="billing-section-heading"><div><h2 id="costs-heading">What building costs.</h2><p>Every request has a limit you see before it starts. You pay for the AI work actually used, rounded up to whole credits, and the rest of the hold is released.</p></div></div>
    <div className="billing-costs-table billing-table-wrap">
      <table>
        <caption className="billing-sr-only">Credit limit and measured usage for each builder action</caption>
        <thead><tr><th scope="col">Action</th><th scope="col">Most it can charge</th><th scope="col">Measured in testing</th></tr></thead>
        <tbody>
          <tr><th scope="row">Plan a website <span>Plan mode: an editable plan, no code</span></th><td>{PLAN_CEILING_CREDITS} credits</td><td>—</td></tr>
          {EFFORT_LEVELS.map(level => <tr key={level}>
            <th scope="row">Build or change · {EFFORT_PRESENTATION[level].label} <span>{AUTO_REVIEW_ROUNDS[level] ? `Includes automatic continuation and, for first website builds and large website changes, ${AUTO_REVIEW_ROUNDS[level]} design review round${AUTO_REVIEW_ROUNDS[level] === 1 ? "" : "s"}` : "Includes automatic continuation; no automatic design review"}</span></th>
            <td>{BUILDER_EFFORT[level].ceilingCredits} credits</td>
            <td>{estimates && level === estimates.effort ? <ul>
              <li>First website: {measured(estimates.firstBuild.website, "website")}</li>
              <li>First presentation: {measured(estimates.firstBuild.presentation, "presentation")}</li>
              <li>First book: {measured(estimates.firstBuild.book, "book")}</li>
            </ul> : "—"}</td>
          </tr>)}
          <tr><th scope="row">Design review, one round <span>The Review button: desktop and mobile screenshots, then fixes</span></th>
            <td>{EFFORT_LEVELS.map(level => `${EFFORT_PRESENTATION[level].label} ${reviewCreditCeiling(BUILDER_EFFORT[level].ceilingCredits)}`).join(" · ")}</td>
            <td>{estimates ? `${EFFORT_PRESENTATION[estimates.effort].label}: ${measured(estimates.reviewRound, "round")}` : "—"}</td></tr>
          <tr><th scope="row">Tailored questions about a new brief</th><td>Free</td><td>—</td></tr>
          <tr><th scope="row">Final render check, preview, visual and code edits, versions, source download <span>No AI involved</span></th><td>Free</td><td>—</td></tr>
        </tbody>
      </table>
    </div>
    <ul className="billing-costs-notes">
      <li><strong>Going past a limit needs your approval.</strong> If a request reaches its limit, its finished work is kept and you choose whether to allow more.</li>
      <li><strong>Not charged:</strong> a request that stops with an error, runs out of time before saving, or whose result can’t be saved; a plan that fails to finish; tailored brief questions.</li>
      <li><strong>If you choose Stop:</strong> confirmed usage is charged once, unused reserved credits are returned, and valid partial work can be recovered without another generation charge.</li>
      <li><strong>Charged for what it used:</strong> a request that runs but ends without a usable change, and a design review that finds nothing to fix.</li>
      <li>Measured figures come from October 2026 test builds at Medium effort without AI images. AI images count toward the same request limit.</li>
    </ul>
  </section>;
}
