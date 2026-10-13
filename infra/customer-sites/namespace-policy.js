/** Deployment namespace policy. Syntax validity remains in site-policy.js.
 * Environment comes from Worker bindings, never request headers or query flags. */
import {siteSlugFromHost,validSiteLabel} from './site-policy.js';
export const STAGING_SITE_LABELS=Object.freeze(['release-check','release-check-renamed']);
export const STAGING_SUPABASE_URL='https://xzwikrunwpurxnxgkznh.supabase.co';
export const PRODUCTION_SUPABASE_URL='https://rklojnmmsmhwnkbzuidp.supabase.co';
export const STAGING_APP_ORIGIN='https://makeborne-release-staging-feavd3cd1-kerimsabic-6594s-projects.vercel.app';

function localOrigin(value) {
  if(typeof value!=='string')return false;
  try {
    const url=new URL(value);
    return url.origin===value&&url.protocol==='http:'&&['localhost','127.0.0.1'].includes(url.hostname)&&!url.username&&!url.password;
  } catch {return false;}
}
export function siteNamespacePolicy(env) {
  const namespace=env.SITE_NAMESPACE===undefined?'production':env.SITE_NAMESPACE;
  if(!['production','staging','local'].includes(namespace))return null;
  if(namespace==='local') {
    if(env.SITES_DOMAIN!=='localhost'||env.ALLOW_LOCAL_SUPABASE!=='true'||!localOrigin(env.SUPABASE_URL)||!localOrigin(env.APP_ORIGIN)
      ||env.LEGACY_SITES_HOST!==undefined&&env.LEGACY_SITES_HOST!=='sites.localhost')return null;
    return {namespace,domain:'localhost',appOrigin:env.APP_ORIGIN,legacyHost:'sites.localhost',indexable:false,local:true};
  }
  if(env.SITES_DOMAIN!=='makeborne.site'||env.ALLOW_LOCAL_SUPABASE!==undefined&&env.ALLOW_LOCAL_SUPABASE!=='false')return null;
  if(namespace==='staging') {
    if(env.SUPABASE_URL!==STAGING_SUPABASE_URL||env.APP_ORIGIN!==STAGING_APP_ORIGIN||env.SITE_INDEXING_ENABLED!=='false'
      ||env.LEGACY_SITES_HOST!==undefined&&env.LEGACY_SITES_HOST!=='legacy-disabled.makeborne.site')return null;
    return {namespace,domain:'makeborne.site',appOrigin:STAGING_APP_ORIGIN,legacyHost:null,indexable:false,local:false};
  }
  if(env.SUPABASE_URL!==PRODUCTION_SUPABASE_URL||env.APP_ORIGIN!==undefined&&env.APP_ORIGIN!=='https://makeborne.com'
    ||env.LEGACY_SITES_HOST!==undefined&&env.LEGACY_SITES_HOST!=='sites.makeborne.com')return null;
  return {namespace,domain:'makeborne.site',appOrigin:'https://makeborne.com',legacyHost:'sites.makeborne.com',indexable:env.SITE_INDEXING_ENABLED!=='false',local:false};
}
/** Run before redirects, forms, method handling, robots, cache or upstream access.
 * URL parsing normalizes uppercase and default ports; nondefault hosted ports and
 * trailing-dot aliases fail closed. Host/Forwarded headers are not authority. */
export function classifySiteNamespaceRequest(url,policy) {
  if(!policy||!['http:','https:'].includes(url.protocol)||url.username||url.password||url.hostname.endsWith('.')
    ||!policy.local&&url.port)return null;
  const host=url.hostname.toLowerCase();
  if(policy.namespace==='staging') {
    const slug=siteSlugFromHost(host,policy.domain);
    return STAGING_SITE_LABELS.includes(slug)?{kind:'site',slug}:null;
  }
  if(host===policy.legacyHost) {
    const slug=url.pathname.replace(/^\//,'').replace(/\/$/,'');
    if(slug&&(!validSiteLabel(slug)||policy.namespace==='production'&&STAGING_SITE_LABELS.includes(slug)))return null;
    return {kind:'legacy',slug};
  }
  if(host===policy.domain||host==='www.'+policy.domain)return {kind:'apex'};
  const slug=siteSlugFromHost(host,policy.domain);
  if(!slug||policy.namespace==='production'&&STAGING_SITE_LABELS.includes(slug))return null;
  return {kind:'site',slug};
}

