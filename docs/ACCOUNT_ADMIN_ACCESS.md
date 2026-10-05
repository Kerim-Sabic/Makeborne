# Administrator access and unlimited credits

Administrator permissions live in `makeborne_private.account_privileges`, keyed to an existing Auth user UUID. They are not inferred from an email, a browser flag, or editable identity metadata. Grants require a confirmed, non-anonymous, non-deleted, non-banned account. Every grant, update and removal creates a private audit event.

## Enforcement

- `/admin` verifies the session and reads the current database permission. Signed-out visitors go to sign-in; non-admin accounts get 404. Sign-in preserves `/admin` as a safe return path.
- Creation page/API checks accept an administrator without a paid membership. Database write gates apply the same exception. Workspace ownership and editor membership still apply; administrators do not get general access to other customers' workspaces.
- Checkout status checks still verify the specific purchase. Admin access cannot mark a failed or unrelated purchase paid.
- Unlimited credit allowances are shown explicitly in billing and studio navigation. Usage figures are not fabricated. No top-up is required.
- The trusted SQL reservation function records `credits_waived=true` and `credit_amount=0` for an eligible approving actor, preserving the nominal proposal estimate. Another workspace member does not inherit this allowance.
- Vendor reservations, concurrency limits, emergency stops and disabled spending still apply. Dispatch rechecks waived-credit eligibility; revocation requires a new reservation. Cancellation releases the actual reserved amounts.

## Operating the grant

Only an authenticated database operator can write grants. Resolve exactly one existing confirmed Auth user to its UUID first, then insert/update that UUID with the requested flags and a reason. Do not put specific user identities in migrations. Revocation sets the corresponding flags to false or deletes the row; current database reads take effect without waiting for JWT role refresh.

## Verification and limits

`supabase/check-account-privileges.sql` runs rolled-back fixtures for role checks, forged metadata, client self-promotion, tenant isolation, grant revocation/audit, waived reservations, vendor ceilings, kill switches and cancellation. Offline checks cover server identity binding, fail-closed outages, safe auth redirects and exact checkout binding.

Live AI generation remains disabled. Production dispatch/settlement integration must use the persisted reservation's actual `credit_amount` (including zero), retain `credits_waived` as evidence, and account for all real provider costs. The standalone pure job state machine and routing estimates are not a deployed worker or proof of live generation. This account allowance does not activate provider keys, vendor spending, website publishing, credit-pack fulfillment or public creation plans.
