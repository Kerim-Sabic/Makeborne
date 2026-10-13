/** Operator-only bridge around the existing exact pinned Vite Docker runtime.
 * Production must provide a separately qualified executor; no HTTP handler may
 * start Docker or accept a caller-selected runtime/renderer identity. */
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {runLocalBuild} from './local-adapter.mjs';
import {renderLocalPublication} from './publication-renderer.mjs';
export function localPublicationExecutor({qualifiedRuntimeImageId,qualifiedRendererId}) {
  if(!/^sha256:[a-f0-9]{64}$/.test(qualifiedRuntimeImageId)||!/^chromium-[0-9.]+-controller-[a-f0-9]{64}$/.test(qualifiedRendererId))throw Error('PUBLICATION_EXECUTOR_UNQUALIFIED');
  return {
    qualifiedRuntimeImageId,qualifiedRendererId,
    async compile(workload,signal){
      const result=await runLocalBuild(workload,{qualifiedImageId:qualifiedRuntimeImageId,signal});
      if(result.status!=='built')throw Object.assign(Error('PUBLICATION_COMPILE_FAILED'),{diagnostics:result.logs});
      try{return {receipt:JSON.parse(await readFile(join(result.outputDirectory,'makeborne-build.json'),'utf8')),readFile:result.readFile,dispose:result.dispose};}
      catch(error){await result.dispose();throw error;}
    },
    render:input=>renderLocalPublication(input,{qualifiedRendererId}),
  };
}

