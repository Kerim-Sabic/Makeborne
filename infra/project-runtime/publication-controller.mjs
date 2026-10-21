import {publicationControl} from './publication-control.mjs';
import {publicationCleanupGate,publicationLifecycleJournal} from './publication-journal.mjs';
import {supervisePublications} from './publication-supervisor.mjs';
import {vercelPublicationExecutor} from './vercel-publication-executor.mjs';

/** Host composition only. The operator supplies a verified restricted SQL pool,
 * scoped stores and bundled application functions. No credentials/source enter
 * events or the sandbox. Starting this does not enable app publication. */
export async function runPublicationController({pool,rpc:injectedRpc,transport,approved,store,resolveArtwork,
  runPreparation,sitesDomain,workerId,signal,emit,wait}){
  if(typeof pool?.connect!=='function'||typeof transport?.create!=='function'||typeof transport?.get!=='function'
    ||typeof store?.putIfAbsent!=='function'||typeof store?.get!=='function'||typeof resolveArtwork!=='function'
    ||typeof runPreparation!=='function'||!/^[a-z0-9]+(?:[.-][a-z0-9]+)+$/.test(sitesDomain)){
    throw Error('PUBLICATION_CONTROLLER_CONFIG_INVALID');
  }
  const rpc=injectedRpc??publicationControl(pool),onLifecycle=publicationLifecycleJournal(rpc);
  const cleanup=publicationCleanupGate({rpc,transport});
  const dependencies={rpc,resolveArtwork,address:slug=>`https://${slug}.${sitesDomain}/`,
    executor:async context=>({
      ...vercelPublicationExecutor({transport,approved,context,onLifecycle}),store,sitesDomain,
    }),
  };
  await supervisePublications({rpc,workerId,signal,emit,wait,beforePoll:cleanup,beforeRun:cleanup,
    run:(preparationId,owner,abort)=>runPreparation(preparationId,owner,dependencies,abort)});
}
