import LegalDocument from "@/components/legal/legal-document";
import { LEGAL_DOCUMENTS } from "@/lib/legal/versions";
import { publicPageMetadata } from "@/lib/site-metadata";

const doc = LEGAL_DOCUMENTS[3];
export const metadata = publicPageMetadata(doc.path, doc.title, doc.description);

/** Source: docs/legal/imprint.md (version and date in src/lib/legal/versions.ts). */
export default function Page() {
  return <LegalDocument file={doc.file} />;
}
