/* eslint-disable @typescript-eslint/no-require-imports -- Offline approval binding fixtures. */
const fs = require('node:fs'), ts = require('typescript'), assert = require('node:assert/strict'), { randomUUID } = require('node:crypto');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename);
const { prepareGenerationProposal, verifyGenerationApproval } = require('./proposal.ts');
const { PLANNED_ROUTES } = require('./registry.ts');
const now = '2026-10-04T12:00:00.000Z';
const route = { ...PLANNED_ROUTES[0], model: 'fixture', status: 'ready', adapterVerified: true, configurationRef: 'fixture-ref', policyApproved: true, licenseApproved: true, evaluation: { evidenceId: 'fixture', quality: 90 }, price: { version: 'fixture', evidenceId: 'fixture', expiresAt: '2026-10-04T13:00:00.000Z', lines: [{ unit: 'input_tokens', perUnits: '1', vendorMicrousd: '1', customerCredits: '1' }], fixedVendorMicrousd: '0', fixedCustomerCredits: '0' } };
const step = { capabilities: ['text'], usage: [{ unit: 'input_tokens', maximum: '1' }], maximumAttempts: 1, minimumQuality: 80, allowedProviders: ['openai'], externalProcessingAllowed: true, sourceRightsConfirmed: true, maximumVendorMicrousd: '1000', maximumCustomerCredits: '1000', preference: 'quality', now };
const policy = { output: 'website', effort: 'medium', includeImages: false, now, maximumVendorMicrousd: '1000', maximumCustomerCredits: '1000', stages: ['planning','draft','review'].map(stage => ({stage, request: step})) };
const input = { scope: { workspaceId: randomUUID(), projectId: randomUUID(), artifactId: randomUUID() }, baseVersionId: randomUUID(), brief: 'Build this exact idea.', audience: 'Designers', purpose: 'Portfolio', sourceIds: [], content: { schemaVersion: 1, title: 'Portfolio', kind: 'website', sections: [] }, style: { id: 'fixture', name: 'Fixture', version: 1, typography: { headingFont: 'Inter', bodyFont: 'Inter' }, colors: { ink: '#111111' }, description: '', referenceAssetIds: [] } };
let count = 0; function check(name, fn) { fn(); count++; console.log(`PASS ${name}`); }
const p = prepareGenerationProposal(input, policy, [route]).proposal;
check('prepares unapproved frozen workflow', () => { assert.ok(Object.isFrozen(p.input.style)); assert.equal(p.workflow.approved,false); });
check('exact input accepted', () => assert.equal(verifyGenerationApproval(p,p.approvalHash,input,now).inputHash,p.inputHash));
check('object key order irrelevant', () => assert.equal(prepareGenerationProposal(Object.fromEntries(Object.entries(input).reverse()),policy,[route]).proposal.approvalHash,p.approvalHash));
for (const field of ['brief','audience','purpose']) check(`${field} change rejected`, () => assert.throws(() => verifyGenerationApproval(p,p.approvalHash,{...input,[field]: input[field] + ' changed'},now), /input changed/));
check('base version change rejected', () => assert.throws(() => verifyGenerationApproval(p,p.approvalHash,{...input,baseVersionId:randomUUID()},now), /input changed/));
check('workspace change rejected', () => assert.throws(() => verifyGenerationApproval(p,p.approvalHash,{...input,scope:{...input.scope,workspaceId:randomUUID()}},now), /input changed/));
check('style change rejected', () => assert.throws(() => verifyGenerationApproval(p,p.approvalHash,{...input,style:{...input.style,name:'Changed'}},now), /input changed/));
check('wrong approval rejected', () => assert.throws(() => verifyGenerationApproval(p,'0'.repeat(64),input,now), /proposal changed/));
check('expired approval rejected at boundary', () => assert.throws(() => verifyGenerationApproval(p,p.approvalHash,input,p.workflow.expiresAt), /no longer/));
check('approval before preparation rejected', () => assert.throws(() => verifyGenerationApproval(p,p.approvalHash,input,'2026-10-04T11:59:59.000Z'), /no longer/));
check('stored price tampering rejected', () => { const copy = structuredClone(p); copy.workflow.maximumCustomerCredits = '0'; assert.throws(() => verifyGenerationApproval(copy,p.approvalHash,input,now), /proposal changed/); });
check('route selection changes approval hash', () => assert.notEqual(prepareGenerationProposal(input,policy,[{...route,model:'another-fixture'}]).proposal.approvalHash,p.approvalHash));
check('unconfigured routes produce no proposal', () => assert.equal(prepareGenerationProposal(input,policy,PLANNED_ROUTES).proposal,null));
check('format mismatch rejected', () => assert.throws(() => prepareGenerationProposal({...input,content:{...input.content,kind:'book'}},policy,[route]), /format/));
check('undeclared source rejected', () => assert.throws(() => prepareGenerationProposal({...input,content:{...input.content,sections:[{id:randomUUID(),title:'Section',blocks:[{id:randomUUID(),type:'paragraph',text:'Text',sourceIds:[randomUUID()]}]}]}},policy,[route]), /source/));
console.log(`${count} proposal checks passed; no provider calls.`);
