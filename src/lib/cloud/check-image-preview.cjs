/* eslint-disable @typescript-eslint/no-require-imports */
const fs=require('node:fs'),ts=require('typescript'),assert=require('node:assert/strict'),sharp=require('sharp');
require.extensions['.ts']=(module,filename)=>module._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,filename);
const {renderAssetPreview,renderAssetExport,MAX_PREVIEW_SOURCE_BYTES}=require('./image-preview.ts');
(async()=>{
 const png=await sharp({create:{width:2000,height:1000,channels:3,background:'#456749'}}).png().toBuffer();
 const exported=await renderAssetExport(png); const exportedMeta=await sharp(exported).metadata();
 assert.equal(exportedMeta.width,2000);assert.equal(exportedMeta.height,1000);assert.equal(exportedMeta.exif,undefined);console.log('PASS export preserves original resolution and strips metadata');
 const pixels=await sharp(png).raw().toBuffer();assert.deepEqual(await sharp(exported).removeAlpha().raw().toBuffer(),pixels);console.log('PASS export losslessly preserves raster pixels');
 const wide=await sharp({create:{width:4097,height:2,channels:3,background:'#123456'}}).png().toBuffer();await assert.rejects(renderAssetExport(wide),/4096/);console.log('PASS oversized export dimensions rejected without downscaling');
 await assert.rejects(renderAssetExport(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>')),/still PNG/);console.log('PASS export rejects markup');
 const output=await renderAssetPreview(png);const meta=await sharp(output).metadata();
 assert.equal(meta.format,'webp');assert.equal(meta.width,1600);assert.equal(meta.height,800);console.log('PASS bounded raster WebP preview');
 assert.equal(meta.exif,undefined);console.log('PASS source metadata omitted');
 await assert.rejects(renderAssetPreview(new Uint8Array()),/under 8 MB/);console.log('PASS empty source denied');
 await assert.rejects(renderAssetPreview(new Uint8Array(MAX_PREVIEW_SOURCE_BYTES+1)),/under 8 MB/);console.log('PASS oversized source denied');
 await assert.rejects(renderAssetPreview(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>')),/still PNG/);console.log('PASS SVG markup denied');
 await assert.rejects(renderAssetPreview(Buffer.from('not an image')));console.log('PASS malformed image denied');
 const small=await sharp({create:{width:20,height:10,channels:3,background:'#123456'}}).jpeg().toBuffer();
 assert.equal((await sharp(await renderAssetPreview(small)).metadata()).width,20);console.log('PASS small images not enlarged');
})().catch(error=>{console.error(error);process.exitCode=1;});
