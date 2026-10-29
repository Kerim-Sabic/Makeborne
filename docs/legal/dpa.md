# Data Processing Agreement

Last updated 26 October 2026 · Version 2026-10-26

This agreement is between the Makeborne customer (the "Customer", controller) and ZORBY&CO d.o.o., Vilsonovo šetalište 10, 71000 Sarajevo, Bosnia and Herzegovina (the "Processor"). It forms part of the [Terms of Service](/terms) and applies automatically, without signature, whenever the Processor processes personal data for the Customer. It meets GDPR Art. 28, UK GDPR and equivalent laws. If the Customer is itself a processor for its own clients, the Processor is its sub-processor on the same terms.

## 1. Processing

The subject matter, duration, nature, purpose, data and people concerned are in Annex I. The Processor processes the data only to provide Makeborne and on the Customer's documented instructions, which are these terms and the Customer's use of the service. It will tell the Customer if it believes an instruction breaks the law.

## 2. Processor duties

The Processor will:

- keep the data confidential and allow access only to personnel bound by confidentiality who need it;
- apply the security measures in Annex II, which it may improve but not weaken;
- help the Customer, taking into account the nature of the processing, to answer data subject requests and to meet its duties on security, breach notification, impact assessments and prior consultation;
- notify the Customer of a personal data breach without undue delay, aiming for 48 hours after becoming aware of it, with the information available then and more as it emerges;
- make available the information needed to show compliance, and allow audits by the Customer or an auditor it appoints, on 30 days' notice, under confidentiality, once a year unless a breach or authority requires more, at the Customer's cost; written answers and existing reports are used first;
- at the end of the service, delete the data, or return it first through the export tools if the Customer asks; copies in backups are deleted on their normal cycle, and copies the law requires are kept only for that purpose.

## 3. Sub-processors

The Customer gives general authorisation to use the sub-processors in Annex III. The Processor imposes on each the same data protection obligations as in this agreement and remains responsible for them. It will announce new or replaced sub-processors at least 30 days in advance on this page and by email to account owners. The Customer may object on reasonable data protection grounds; if no solution is found, the Customer may end the affected service and receive a pro-rata refund of prepaid fees.

## 4. International transfers

The Processor is established in Bosnia and Herzegovina, which has no EU adequacy decision. Where the Customer transfers personal data from the EEA to the Processor, the EU Standard Contractual Clauses (Commission Decision 2021/914) are incorporated by reference: Module 2 (controller to processor), or Module 3 where the Customer is a processor. Clause 7 (docking) applies; in Clause 9 option 2 (general authorisation, 30 days' notice); in Clause 11 the optional language does not apply; in Clauses 17 and 18, the law and courts of Ireland apply. Annexes I to III of this agreement complete the Clauses' annexes, and the supervisory authority is the one competent for the Customer. For UK data, the UK Addendum (version B.1.0) applies; for Swiss data, the Clauses apply with references read as the Swiss FADP and the FDPIC. If the Clauses conflict with this agreement, the Clauses prevail. Onward transfers to sub-processors use an adequacy decision, the EU-US Data Privacy Framework or Standard Contractual Clauses (Annex III).

## 5. Customer duties

The Customer is responsible for having a lawful basis for the data it adds or collects (including lead-finder results), for informing data subjects (including under GDPR Art. 14) and for lawful outreach, and for its websites' own privacy notices.

## Annex I: Details of processing

| Item | Details |
|---|---|
| Data subjects | The Customer's leads, clients and their contacts; client portal and review users; visitors and enquirers on the Customer's published websites; people named in the Customer's content |
| Data | Names, business and contact details (email, phone, address, website, social links), notes, CRM stage and tasks, emails sent through a connected mailbox, review comments, portal sign-in email, form enquiries (name, email, message), cookieless daily visitor hashes and aggregate visit counts, and any personal data in uploaded files or generated content. No special categories are intended; the Customer must not add them unless lawful |
| Nature and purpose | Storing, organising, displaying, generating content with AI, researching public pages and listings the Customer asks for, sending email the Customer approves, hosting websites and receiving their enquiries, all to provide Makeborne |
| Duration | For the term of the agreement, then deletion as in section 2. Unattached website checks expire after 30 days and cached research pages after up to 30 days |
| Frequency | Continuous |

## Annex II: Technical and organisational measures

| Area | Measure |
|---|---|
| Access control | Row-level security on every database table; workspace roles decide who can read and edit; server-only keys with least privilege; administrator access limited to named operators |
| Storage | Private file buckets; downloads through signed links that expire in about 2 minutes; exports deleted after 72 hours |
| Encryption | TLS for all traffic; mailbox and GitHub tokens encrypted with AES-256-GCM; providers encrypt stored data at rest |
| Isolation | Published sites served from a separate domain with a strict content security policy and no third-party resources; site builds run in isolated sandboxes |
| Logging | Error reports are scrubbed of emails, IDs, tokens and query strings; operational logs keep identifiers and codes, not content |
| Abuse limits | Rate limits on sign-in, forms and research; signed form submissions; daily research caps |
| Resilience | Managed database with provider backups; idempotent jobs that resume after failure |
| Deletion | Account deletion job removes accounts, workspaces and files; financial records kept only in pseudonymised form |
| People | Confidentiality obligations; access reviewed when roles change |
| Certifications | None held by the Processor; sub-processors hold their own (for example SOC 2, ISO 27001) |

## Annex III: Sub-processors

| Sub-processor | Service | Location | Transfer safeguard |
|---|---|---|---|
| Supabase | Database, authentication, file storage | EU (Frankfurt) | SCCs |
| Vercel Inc. | Application hosting (EU, Frankfurt); website build sandboxes (US) | EU, US | SCCs |
| Cloudflare, Inc. | Published site delivery, forms, compiled output storage | Global | Data Privacy Framework, SCCs |
| DigitalOcean, LLC | Publishing control server | United Kingdom | UK adequacy |
| Anthropic | AI text generation, lead ranking, research summaries | US | SCCs |
| OpenAI | AI images and reviews, when switched on | US | SCCs |
| Resend | Transactional email | EU sending, US company | Data Privacy Framework, SCCs |

Services the Customer connects itself (Google Gmail, GitHub, a domain registrar) act under the Customer's own agreement with them and are not sub-processors.
