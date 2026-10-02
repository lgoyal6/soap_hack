// Owner: Laksh. Stub: firm sign-in works; provider sign-in (email + access code) is Laksh's step 1.
export default function Login() {
  return (
    <main style={{ padding: 32, fontSize: 18 }}>
      <h1>Sign in</h1>
      <p><a href="/api/clio/login">Law firm: sign in with Clio</a></p>
      <p>Provider: email and access code (not built yet)</p>
    </main>
  );
}
