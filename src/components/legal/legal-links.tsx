import Link from "next/link";
import { LEGAL_DOCUMENTS } from "@/lib/legal/versions";

/** Terms · Privacy · DPA · Legal notice, for every public footer and the account settings. */
export default function LegalLinks({ className }: { className?: string }) {
  return <>{LEGAL_DOCUMENTS.map(doc => <Link key={doc.path} href={doc.path} className={className}>{doc.label}</Link>)}</>;
}
