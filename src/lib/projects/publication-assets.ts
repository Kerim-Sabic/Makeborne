import "server-only";
import {createHash} from "node:crypto";
import {z} from "zod";
import {verifyStillRaster} from "../media/verified-raster";
import {WebsiteProjectSourceSchema} from "./website-source";
import type {PublicationWorkerDependencies} from "./publication-worker";
import type {PublicationDownloadContext} from "./publication-download-contract";

const AssetRecord = z.object({id:z.string().uuid(),workspace_id:z.string().uuid(),project_id:z.string().uuid(),
  object_path:z.string().min(1).max(1024),content_type:z.enum(["image/png","image/jpeg","image/webp"]),sha256:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
type Resolver = PublicationWorkerDependencies["resolveArtwork"];

/** Service storage is permitted only behind the fenced SQL locator resolver.
 * This adapter does not turn arbitrary model paths into administrator reads. */
export function publicationArtworkResolver(deps:{rpc:PublicationWorkerDependencies["rpc"];
  download(objectPath:string, maxBytes:number, signal:AbortSignal, context:PublicationDownloadContext):Promise<Uint8Array>}):Resolver {
  return async(scope,version,signal)=>{
    signal.throwIfAborted();
    const source=WebsiteProjectSourceSchema.parse(version.content.websiteSource);
    const args={p_preparation:scope.preparationId,p_worker:scope.workerId,p_fence:scope.fence};
    const locate=async()=>{
      signal.throwIfAborted();
      const loaded=z.object({versionId:z.literal(version.id),scope:z.object({workspaceId:z.literal(scope.workspaceId),projectId:z.literal(scope.projectId),artifactId:z.literal(version.artifactId)}),
        assetRecords:z.array(AssetRecord).max(100)}).passthrough().parse(await deps.rpc("makeborne_load_publication_preparation",args,signal));
      signal.throwIfAborted();
      const records=new Map(loaded.assetRecords.map(asset=>[asset.id,asset]));
      if(records.size!==source.assets.length||records.size!==loaded.assetRecords.length)throw new Error("PUBLICATION_ASSET_IDENTITY_INVALID");
      return source.assets.map(descriptor=>{
        const record=records.get(descriptor.id);
        if(!record||record.workspace_id!==scope.workspaceId||record.project_id!==scope.projectId||record.sha256!==descriptor.sha256||record.content_type!==descriptor.mediaType
          ||!record.object_path.startsWith(`${scope.workspaceId}/${scope.projectId}/`)||/[\\%?#\u0000-\u001f\u007f]/.test(record.object_path)
          ||record.object_path.split("/").some(part=>!part||part==="."||part===".."))throw new Error("PUBLICATION_ASSET_IDENTITY_INVALID");
        return record;
      });
    };
    const records=await locate(),artwork=[];let total=0;
    for(let index=0;index<source.assets.length;index++){
      signal.throwIfAborted();const descriptor=source.assets[index],record=records[index];
      if(descriptor.bytes>20_000_000||total+descriptor.bytes>40_000_000)throw new Error("PUBLICATION_ASSET_LIMIT");
      const bytes=await deps.download(record.object_path,descriptor.bytes,signal,{preparationId:scope.preparationId,workerId:scope.workerId,fence:scope.fence,assetId:descriptor.id});signal.throwIfAborted();
      if(bytes.length!==descriptor.bytes||createHash("sha256").update(bytes).digest("hex")!==descriptor.sha256)throw new Error("PUBLICATION_ASSET_BYTES_INVALID");
      await verifyStillRaster(bytes,descriptor.mediaType);total+=bytes.length;
      artwork.push({...descriptor,bytes});
    }
    const after=await locate();
    if(JSON.stringify(records)!==JSON.stringify(after))throw new Error("PUBLICATION_ASSET_IDENTITY_CHANGED");
    return artwork;
  };
}
