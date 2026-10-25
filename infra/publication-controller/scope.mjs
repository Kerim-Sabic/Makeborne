import {validateNamespaceAttestation} from './attestation.mjs';
/** Cleanup remains possible during rollout drift; discovery and source loading fail closed.
 * Entitled scope (schema 3): discovery still requires the v3 attestation, and the
 * claim/load RPCs re-run the database authority, so no local list is consulted. */
export function scopedPublicationControl(raw,config){
 return async(name,args,signal)=>{
  if(name==='makeborne_publication_worker_candidates')validateNamespaceAttestation(await raw('makeborne_publication_worker_attest',{},signal),config);
  const value=await raw(name,args,signal);
  if(value&&(name==='makeborne_claim_publication_preparation'||name==='makeborne_load_publication_preparation')
   &&config.workspaceScope!=='entitled'&&!config.workspaceAllowlist.includes(value.scope?.workspaceId))throw Error('PUBLICATION_WORKSPACE_DENIED');
  return value;
 };
}
