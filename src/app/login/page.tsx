import Link from "next/link";
export default function Login() {
  return (
    <main className="login-page">
      <Link className="wordmark" href="/">
        Makeborne
      </Link>
      <div className="login-card">
        <span className="eyebrow">YOUR WORKSPACE</span>
        <h1>
          A place for
          <br />
          <em>your next idea.</em>
        </h1>
        <p>
          Cloud accounts are not configured in this deployment yet. You can use
          the local studio now; your work stays in this browser on this device.
        </p>
        <Link className="button primary" href="/studio">
          Open local studio →
        </Link>
        <p className="small-note">
          Local work does not sync between devices. Export a workspace backup
          from Settings.
        </p>
      </div>
    </main>
  );
}
