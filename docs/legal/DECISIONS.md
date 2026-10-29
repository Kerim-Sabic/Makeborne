# Legal decisions (26 October 2026)

The owner asked for the drafts to be finished without a review round ("just finish ... we will be selling worldwide"). Every point below is decided. Only R1 is still open, because it needs a contract that the owner has to sign.

## Still open: needs the owner

| # | Item | Why | What to do |
|---|---|---|---|
| R1 | **EU representative** (GDPR Art. 27 and DSA Art. 13). **UK representative** (UK GDPR Art. 27). | ZORBY&CO is in Bosnia and Herzegovina and offers Makeborne to people in the EU and UK. The occasional-processing exemption does not apply to a SaaS that processes data continuously. The DSA also requires a non-EU hosting provider to name an EU legal representative. | Appoint a representative service. Typical cost for a small company is about EUR 100 to 1,500 a year for each region; bundles that cover GDPR, UK and DSA are often EUR 500 to 2,000. Example providers: Prighter, EDPO, DataRep, VeraSafe. Then replace the three "to be appointed" lines in `docs/legal/privacy.md` and `docs/legal/imprint.md`. |

Also needed from the registry: the court register number (MBS), the VAT (PDV) number if the company is registered for VAT, and the authorised representative's name. CompanyWall shows none of these. The imprint says "To be added" for each one.

## Decided (protective defaults)

| # | Decision | Chosen | Reason |
|---|---|---|---|
| D1 | Entity | ZORBY&CO d.o.o., Vilsonovo šetalište 10, 71000 Sarajevo, BiH, JIB 4203428970007 | Owner; CompanyWall |
| D2 | Law and courts | BiH law; competent courts in Sarajevo; consumers keep their home-country mandatory law and courts | Owner; Rome I Art. 6, Brussels I bis Art. 17–18 |
| D3 | Customers | Businesses and consumers, worldwide; sanctions and export-control exclusion | Owner |
| D4 | Content | Customer owns content and output; no AI training; showcasing only with opt-in | Owner |
| D5 | Minimum age | 18 | The service involves contracts and payments; avoids GDPR Art. 8 consent for children |
| D6 | Liability cap | Fees paid in the last 12 months; no cap for death or injury, fraud, intent or gross negligence, or mandatory consumer law | Standard and enforceable |
| D7 | Changes to terms | 30 days' notice; customer may cancel with a pro-rata refund | Fair for consumers |
| D8 | Contacts | admin@makeborne.com for everything (legal, privacy, abuse, DSA, support) | Owner |
| D9 | DPO | None. The core activities involve no large-scale monitoring and no large-scale special-category data (GDPR Art. 37) | Not required |
| D10 | Retention | As in the account-data-rights doc: account until deletion (7-day grace); financial records 10 years, pseudonymised; exports 72 h; error and visit data about 400 days; rights log 3 years; research cache and unattached checks ≤ 30 days | Matches the code |
| D11 | Representatives | See R1 | |
| D12 | Language | English only; the English version binds | Worldwide sales; see review note 7 |
| D13 | Withdrawal model | EU/EEA/UK consumers: 14 days. A refund less the share of credits used; full refund if none were used. The voluntary "refundable until used" policy stays. | CRD Art. 14(3) and 16(a). Collected on Makeborne's own plan step because Whop does not collect it. |
| D14 | Whop's role | Payment processor. It is MoR only for card rules and settlement, and for transaction tax in "Collects and Remits" mode. Makeborne is the supplier. | Whop Seller Terms §1, §5, §6A |
| D15 | Taxes | Use Whop "Collects and Remits" where Whop supports it (EU, UK, 18 US states). Makeborne remains responsible elsewhere. | Whop Seller Terms §6A |
| D16 | Cookie banner | None now (strictly necessary only). Required before any ad pixel or third-party analytics. | ePrivacy Art. 5(3) |
| D17 | Lead finder | Makeborne is the customer's processor. The customer is the controller and owes the Art. 14 notice. There is no shared database of people. | Matches the code |
