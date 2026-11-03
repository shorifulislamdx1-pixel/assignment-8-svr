const baseUrl = (process.env.BASE_URL || 'http://localhost:5000').replace(/\/$/, '');

async function check(path, expectedStatus = 200) {
  const response = await fetch(`${baseUrl}${path}`);
  const body = await response.json().catch(() => null);
  if (response.status !== expectedStatus) {
    throw new Error(`${path}: expected ${expectedStatus}, received ${response.status}: ${JSON.stringify(body)}`);
  }
  console.log(`PASS ${path} (${response.status})`);
  return body;
}

(async () => {
  await check('/health');
  const books = await check('/books');
  if (!Array.isArray(books)) throw new Error('/books did not return an array');
  console.log(`PASS /books returned ${books.length} book(s)`);
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
