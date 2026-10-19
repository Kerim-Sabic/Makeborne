import { Clock } from "lucide-react";

/** A Publish-panel module that is not switched on in this environment yet: one calm row, no error styling. */
export default function ComingSoon({ title, text }: { title: string; text: string }) {
  return <section className="website-publish website-publish-soon" aria-label={title}>
    <Clock size={15} aria-hidden="true" /><div><strong>{title}</strong><span>{text}</span></div><span className="website-publish-soon-badge">Coming soon</span>
  </section>;
}
