// Owner: Laksh. Sign-out button for either portal.
export default function SignOut() {
  return (
    <form action="/api/auth/logout" method="post">
      <button className="rounded border border-black px-3 py-1.5 text-base font-semibold">Sign out</button>
    </form>
  );
}
