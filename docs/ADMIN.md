# Studio operations

`/admin` is a read-only **development** operations console. The route immediately calls `notFound()` unless `NODE_ENV` is exactly `development`. It has no mutation endpoint, secret output, customer records, revenue, or invented usage counts.

It reads the existing cloud configuration reader and planned routing registry on every request. Configuration booleans are labelled **Set**, not healthy or verified. The migration acknowledgement flag does not prove migrations or row-level-security checks ran. No connectivity probes or paid calls occur.

The view provides a cloud setup checklist, ordered launch milestones, expandable model integration slots, and real links to cloud studio, billing, and client workspace. A native GET form refreshes the server snapshot. Responsive layouts, visible keyboard focus, and a skip link are provided.

## Production administration remains unimplemented

Do not remove the environment gate to expose this page. First introduce server-verified identity and a server-owned administrator membership policy checked at every data access and mutation. Never trust local storage, an email entered in the UI, or editable user metadata for this authorization. Add scoped account queries, pagination, audited administrative actions, and integration checks before describing it as a production admin dashboard.

Current model and payment summaries describe the existing implementation. When real adapters or dispatch are installed, connect this view to authoritative service state rather than changing labels to green.
