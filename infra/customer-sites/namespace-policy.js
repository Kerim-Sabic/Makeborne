/** Deployment namespace policy. Syntax validity remains in site-policy.js.
 * Environment comes from Worker bindings, never request headers or query flags. */
import {siteSlugFromHost,validSiteLabel} from './site-policy.js';
export const STAGING_SITE_LABELS=Object.freeze(['release-check','release-check-renamed']);
export const STAGING_SUPABASE_URL='https://xzwikrunwpurxnxgkznh.supabase.co';
export const PRODUCTION_SUPABASE_URL='https://rklojnmmsmhwnkbzuidp.supabase.co';
export const STAGING_APP_ORIGIN='https://makeborne-release-staging-qa2026101-kerimsabic-6594s-projects.vercel.app';

/** Customer custom hostnames. Mirrors the custom_domains.hostname CHECK in
 * supabase/migrations/20261014160000_custom_domains.sql: lowercase, at most 253
 * characters, two or more DNS labels, no trailing dot, an alphabetic final label
 * (so IP addresses never match), never under a Makeborne-owned or local suffix. */
const DNS_LABEL=/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const TOP_LABEL=/^[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
export const RESERVED_CUSTOM_HOST_SUFFIXES=Object.freeze(['makeborne.com','makeborne.site','localhost']);
export const STAGING_CUSTOM_HOST_LIMIT=20;
export function validCustomHostname(value) {
  if(typeof value!=='string'||value.length>253||value!==value.toLowerCase())return false;
  const labels=value.split('.');
  if(labels.length<2||!labels.every(label=>DNS_LABEL.test(label))||!TOP_LABEL.test(labels.at(-1)))return false;
  return !RESERVED_CUSTOM_HOST_SUFFIXES.some(suffix=>value===suffix||value.endsWith('.'+suffix));
}
/** STAGING_CUSTOM_HOSTS: comma list of exact custom hostnames QA may serve. Absent
 * or empty means none; any invalid entry makes the whole configuration invalid. */
function stagingCustomHosts(value) {
  if(value===undefined||value==='')return Object.freeze([]);
  if(typeof value!=='string')return null;
  const hosts=value.split(',').map(host=>host.trim());
  if(hosts.length>STAGING_CUSTOM_HOST_LIMIT||!hosts.every(validCustomHostname)||new Set(hosts).size!==hosts.length)return null;
  return Object.freeze(hosts);
}
const noStagingHosts=env=>env.STAGING_CUSTOM_HOSTS===undefined||env.STAGING_CUSTOM_HOSTS==='';

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
      ||env.LEGACY_SITES_HOST!==undefined&&env.LEGACY_SITES_HOST!=='sites.localhost'||!noStagingHosts(env))return null;
    return {namespace,domain:'localhost',appOrigin:env.APP_ORIGIN,legacyHost:'sites.localhost',indexable:false,local:true};
  }
  if(env.SITES_DOMAIN!=='makeborne.site'||env.ALLOW_LOCAL_SUPABASE!==undefined&&env.ALLOW_LOCAL_SUPABASE!=='false')return null;
  if(namespace==='staging') {
    const customHosts=stagingCustomHosts(env.STAGING_CUSTOM_HOSTS);
    if(env.SUPABASE_URL!==STAGING_SUPABASE_URL||env.APP_ORIGIN!==STAGING_APP_ORIGIN||env.SITE_INDEXING_ENABLED!=='false'
      ||env.LEGACY_SITES_HOST!==undefined&&env.LEGACY_SITES_HOST!=='legacy-disabled.makeborne.site'||!customHosts)return null;
    return {namespace,domain:'makeborne.site',appOrigin:STAGING_APP_ORIGIN,legacyHost:null,indexable:false,local:false,customHosts};
  }
  if(env.SUPABASE_URL!==PRODUCTION_SUPABASE_URL||env.APP_ORIGIN!==undefined&&env.APP_ORIGIN!=='https://makeborne.com'
    ||env.LEGACY_SITES_HOST!==undefined&&env.LEGACY_SITES_HOST!=='sites.makeborne.com'||!noStagingHosts(env))return null;
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
    // QA serves only the reviewed labels plus exactly listed custom hostnames.
    if(Array.isArray(policy.customHosts)&&policy.customHosts.includes(host)&&validCustomHostname(host))return {kind:'custom',host};
    const slug=siteSlugFromHost(host,policy.domain);
    return STAGING_SITE_LABELS.includes(slug)?{kind:'site',slug}:null;
  }
  if(host===policy.legacyHost) {
    const slug=url.pathname.replace(/^\//,'').replace(/\/$/,'');
    if(slug&&(!validSiteLabel(slug)||policy.namespace==='production'&&STAGING_SITE_LABELS.includes(slug)))return null;
    return {kind:'legacy',slug};
  }
  if(host===policy.domain||host==='www.'+policy.domain)return {kind:'apex'};
  // Every other host under the sites domain is a slug address or nothing; it never
  // falls through to custom-host resolution.
  if(host.endsWith('.'+policy.domain)) {
    const slug=siteSlugFromHost(host,policy.domain);
    if(!slug||policy.namespace==='production'&&STAGING_SITE_LABELS.includes(slug))return null;
    return {kind:'site',slug};
  }
  // Custom hostnames resolve through the database. Local testing accepts only the
  // reserved `.test` TLD; production accepts any valid non-Makeborne DNS name.
  if(!validCustomHostname(host))return null;
  if(policy.namespace==='local')return host.endsWith('.test')?{kind:'custom',host}:null;
  return policy.namespace==='production'?{kind:'custom',host}:null;
}

