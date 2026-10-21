import {validateNamespaceAttestation} from './attestation.mjs';
/** Cleanup remains possible during rollout drift; discovery and source loading fail closed. */
export function scopedPublicationControl(raw,config){
 return async(name,args,signal)=>{
  if(name==='makeborne_publication_worker_candidates')validateNamespaceAttestation(await raw('makeborne_publication_worker_attest',{},signal),config);
  const value=await raw(name,args,signal);
  if(value&&(name==='makeborne_claim_publication_preparation'||name==='makeborne_load_publication_preparation')
   &&!config.workspaceAllowlist.includes(value.scope?.workspaceId))throw Error('PUBLICATION_WORKSPACE_DENIED');
  return value;
 };
}
