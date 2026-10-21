/** Operator identities, never selected by a request, Host header or SDK fallback. */
export const STAGING=Object.freeze({namespace:'staging',projectRef:'xzwikrunwpurxnxgkznh',databaseHost:'db.xzwikrunwpurxnxgkznh.supabase.co',
 teamId:'team_viiayqU1BnwJBdEqgHdgmtnA',projectId:'prj_c9h8fuyEmVAT8F3NHFMvzFR1BnLc',bucket:'makeborne-publication-staging',sitesDomain:'makeborne.site',imagePrefix:'kerimsabic-6594s-projects/makeborne-release-staging/'});
export const PRODUCTION=Object.freeze({namespace:'production',projectRef:'rklojnmmsmhwnkbzuidp',databaseHost:'db.rklojnmmsmhwnkbzuidp.supabase.co',
 teamId:'team_viiayqU1BnwJBdEqgHdgmtnA',projectId:'prj_UzMAuCP7X4yeBP6FrUFCDlJ5GWHh',bucket:'makeborne-publication-production',sitesDomain:'makeborne.site',brokerOrigin:'https://makeborne.com',imagePrefix:'kerimsabic-6594s-projects/makeborne/'});
export function publicationProfile(namespace){
 if(namespace==='staging')return STAGING;if(namespace==='production')return PRODUCTION;
 throw Error('PUBLICATION_PROFILE_INVALID');
}
export function publicationBrokerOriginAllowed(origin,namespace){
 return namespace==='production'?origin===PRODUCTION.brokerOrigin:namespace==='staging'&&typeof origin==='string'
  &&/^https:\/\/makeborne-release-staging(?:-[a-z0-9]{9})?-kerimsabic-6594s-projects\.vercel\.app$/.test(origin);
}
export function publicationWorkspaces(value){
 if(!Array.isArray(value)||value.length<1||value.length>100
  ||!value.every(v=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(v))
  ||new Set(value).size!==value.length)throw Error('PUBLICATION_WORKSPACES_INVALID');
 return Object.freeze([...value].sort());
}
