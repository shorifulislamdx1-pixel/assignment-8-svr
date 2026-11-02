/* End-to-end smoke test. Requires a running server (npm start / npm run dev)
   with the same JWT_SECRET available to this process (it loads .env itself).
   Creates its own records and removes them again — leaves the DB clean. */
require("dotenv").config();
const jwt = require("jsonwebtoken");

const BASE = process.env.BASE_URL || "https://assignment-8-mauve-three.vercel.app:5000";
const SECRET = process.env.JWT_SECRET || "audit-test-secret-123";
const ownerToken = jwt.sign(
  { email: "audit-owner@test.local", name: "Audit Owner" },
  SECRET,
  { expiresIn: "10m" }
);
const otherToken = jwt.sign({ email: "audit-other@test.local" }, SECRET, {
  expiresIn: "10m",
});
const noEmailToken = jwt.sign({ sub: "123" }, SECRET, { expiresIn: "10m" });

const results = [];
const check = (name, actual, expected) => {
  const ok = actual === expected;
  results.push(`${ok ? "PASS" : "FAIL"} ${name} -> got ${actual}, want ${expected}`);
};

async function req(method, path, { token, body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token && { Authorization: `Bearer ${token}` }),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* not json */
  }
  return { status: res.status, data };
}

(async () => {
  // 1. token without email claim is rejected
  let r = await req("POST", "/books", { token: noEmailToken, body: {} });
  check("token without email claim rejected", r.status, 403);

  // 2. validation: wrong types / NaN copies
  r = await req("POST", "/books", {
    token: ownerToken,
    body: { title: 123, author: "A", category: "C", image: "i", description: "D", totalCopies: 2 },
  });
  check("non-string title rejected", r.status, 400);

  r = await req("POST", "/books", {
    token: ownerToken,
    body: { title: "T", author: "A", category: "C", image: "i", description: "D", totalCopies: "not-a-number" },
  });
  check("NaN totalCopies rejected", r.status, 400);

  // 3. create a real test book
  r = await req("POST", "/books", {
    token: ownerToken,
    body: { title: "AUDIT TEST BOOK", author: "Audit", category: "Testing", image: "https://example.com/x.jpg", description: "temporary", totalCopies: 1 },
  });
  check("create book", r.status, 201);
  const bookId = r.data.insertedId;
  if (!bookId) throw new Error("no insertedId: " + JSON.stringify(r.data));

  // 4. ownership: other user cannot patch/delete
  r = await req("PATCH", `/books/${bookId}`, { token: otherToken, body: { title: "Hacked" } });
  check("other user cannot update", r.status, 403);

  // 5. owner update works
  r = await req("PATCH", `/books/${bookId}`, { token: ownerToken, body: { title: "AUDIT TEST BOOK v2" } });
  check("owner update", r.status, 200);

  // 6. borrow validation
  r = await req("POST", "/borrows", { token: ownerToken, body: { bookId, returnDate: "not-a-date" } });
  check("invalid returnDate rejected", r.status, 400);

  // 7. borrow valid
  r = await req("POST", "/borrows", { token: ownerToken, body: { bookId, returnDate: "2026-11-15" } });
  check("borrow book", r.status, 201);

  // 8. inventory decremented to 0 -> second borrow attempt blocked
  r = await req("POST", "/borrows", { token: otherToken, body: { bookId, returnDate: "2026-11-15" } });
  check("no copies left blocked", r.status, 400);

  // 9. duplicate borrow by same user blocked
  r = await req("POST", "/borrows", { token: ownerToken, body: { bookId, returnDate: "2026-11-16" } });
  check("duplicate borrow blocked", r.status, 400);

  // 10. list borrows (only owner's)
  r = await req("GET", "/borrows", { token: ownerToken });
  check("list owner borrows", r.status, 200);
  check("exactly 1 borrow record", r.data.length, 1);
  const borrowId = r.data[0]._id;

  r = await req("GET", "/borrows", { token: otherToken });
  check("other user sees 0 borrows", r.data.length, 0);

  // 11. unauthorized return attempt
  r = await req("DELETE", `/borrows/${borrowId}`, { token: otherToken });
  check("other user cannot return", r.status, 404);

  // 12. owner returns -> copies restored
  r = await req("DELETE", `/borrows/${borrowId}`, { token: ownerToken });
  check("return book", r.status, 200);

  r = await req("DELETE", `/borrows/${borrowId}`, { token: ownerToken });
  check("double return rejected", r.status, 404);

  r = await req("GET", `/books/${bookId}`, { token: ownerToken });
  check("copies restored to 1", r.data.totalCopies, 1);

  // 13. re-borrow after return works
  r = await req("POST", "/borrows", { token: ownerToken, body: { bookId, returnDate: "2026-11-20" } });
  check("re-borrow after return", r.status, 201);

  r = await req("GET", "/borrows", { token: ownerToken });
  r = await req("DELETE", `/borrows/${r.data[0]._id}`, { token: ownerToken });
  check("cleanup borrow", r.status, 200);

  // 14. delete test book (cleanup)
  r = await req("DELETE", `/books/${bookId}`, { token: ownerToken });
  check("delete test book", r.status, 200);

  r = await req("GET", `/books/${bookId}`);
  check("test book gone", r.status, 404);

  r = await req("GET", "/books");
  check("books collection empty after cleanup", r.data.length, 0);

  r = await req("GET", "/borrows", { token: ownerToken });
  check("borrows empty after cleanup", r.data.length, 0);

  console.log(results.join("\n"));
  const failed = results.filter((x) => x.startsWith("FAIL"));
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => {
  console.log(results.join("\n"));
  console.error("SCRIPT ERROR:", e);
  process.exit(1);
});
