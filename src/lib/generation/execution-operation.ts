import "server-only";
import type {GenerationProposal} from "../routing/proposal";

/** Operation selection only. Workers independently verify approval, current
 * authority, route/tariff/budget and canonical format before paid dispatch. */
export function generationOperation(proposal:GenerationProposal):'website'|'presentation_composition'{
  if(proposal.workflow.output==='website'&&proposal.input.content.kind==='website'&&!('purpose' in proposal))return 'website';
  if(proposal.workflow.output==='presentation'&&proposal.input.content.kind==='presentation'
    &&'purpose' in proposal&&proposal.purpose==='presentation_composition'
    &&proposal.input.baseVersionId&&proposal.input.scope.artifactId
    &&proposal.workflow.presentationMode==='editable'&&!proposal.workflow.includeImages
    &&proposal.workflow.maximumExecutions===1&&proposal.workflow.stages.length===1
    &&proposal.workflow.stages[0].stage==='draft'&&proposal.workflow.stages[0].maximumExecutions===1)return 'presentation_composition';
  throw Object.assign(new Error('GENERATION_OPERATION_UNSUPPORTED'),{code:'GENERATION_OPERATION_UNSUPPORTED'});
}
