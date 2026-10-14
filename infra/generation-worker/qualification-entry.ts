/** Explicit operator bundle entry; no HTTP registration or paid side effects. */
export {prepareWebsiteQualification, prepareWebsiteRepairQualification, preparePresentationQualification, CLAUDE_QUALIFICATION_ROUND} from "../../src/lib/generation/qualification-proposal";
export {websiteBuildInput} from "../../src/lib/projects/build-input";
export {readWebsiteRepairReview} from "../../src/lib/projects/repair-review";
export {generationProposalRecord} from "../../src/lib/routing/proposal";
export {createClaudeWebsiteQualificationWorker} from "../../src/lib/generation/website-worker";
export {createProjectBuildWorker, validateBuildReceipt} from "../../src/lib/projects/build-worker";
export {readCompiledOutputFile} from "../../src/lib/projects/compiled-output";
export {quotePlainTextUsage} from "../../src/lib/providers/text-metering";

export {createClaudePresentationQualificationWorker} from "../../src/lib/generation/presentation-worker";
export {accountExportRequest} from "../../src/lib/cloud/account-export";
export {pdfDocument,presentationDocument,reviewNativePresentation,inspectNativePresentation,prepareExport,htmlDocument} from "../../src/lib/server/export";

export {resolveDocumentSourceAssets} from "../../src/lib/projects/source-assets";

export {expandNativeTextBoxes} from "../../src/lib/presentations/layout-repair";
