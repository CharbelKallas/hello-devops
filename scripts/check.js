/**
 * Static sanity check (`npm run check`): import every source module
 * exactly once — no server start, no database connection — so syntax
 * errors and missing dependencies surface in CI before the image is
 * built. This matters because the test suite uses in-memory fakes and
 * therefore never loads src/services/* or the real service wiring.
 *
 * src/server.js is deliberately excluded: importing it would start an
 * HTTP listener. Relative specifiers resolve against this file
 * (scripts/check.js), hence the leading "../".
 */
const modules = [
  '../src/config.js',
  '../src/errors.js',
  '../src/http.js',
  '../src/app.js',
  '../src/routes/users.js',
  '../src/routes/documents.js',
  '../src/routes/cache.js',
  '../src/services/index.js', // statically imports postgres/mongo/redis too
];

let failures = 0;
for (const specifier of modules) {
  try {
    await import(specifier);
    console.log(`ok    ${specifier}`);
  } catch (err) {
    failures += 1;
    console.error(`FAIL  ${specifier}: ${err}`);
  }
}

if (failures > 0) {
  console.error(`\n${failures} module(s) failed to import`);
  process.exit(1);
}
console.log('\nall modules import cleanly');
