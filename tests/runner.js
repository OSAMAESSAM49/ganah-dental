/**
 * Tiny in-browser test runner (no npm). Open /tests/ on the dev server.
 * Results are also exposed on window.__TEST_RESULTS__ for automated checks.
 */
const suites = [];
let currentSuite = null;

export function describe(name, fn) {
  currentSuite = { name, tests: [] };
  suites.push(currentSuite);
  fn();
}
export function test(name, fn) { currentSuite.tests.push({ name, fn }); }

const fmt = (v) => { try { return JSON.stringify(v); } catch { return String(v); } };

export const assert = {
  ok(v, msg = 'expected truthy') { if (!v) throw new Error(msg); },
  equal(a, b, msg) { if (a !== b) throw new Error(msg ?? `expected ${fmt(b)}, got ${fmt(a)}`); },
  deepEqual(a, b, msg) { if (fmt(a) !== fmt(b)) throw new Error(msg ?? `expected ${fmt(b)}, got ${fmt(a)}`); },
  async rejects(fn, msg = 'expected rejection') {
    try { await fn(); } catch { return; }
    throw new Error(msg);
  },
};

const FILES = ['./text.test.js', './format.test.js', './validate.test.js', './dom.test.js', './router.test.js', './data.test.js', './auth.test.js', './patients.test.js', './chart.test.js', './appointments.test.js', './billing.test.js', './inventory.test.js', './followups.test.js', './reports.test.js', './backup.test.js', './sync.test.js', './ownership.test.js'];

async function run() {
  for (const f of FILES) await import(f);
  const out = document.getElementById('results');
  let pass = 0, fail = 0;
  const failures = [];
  for (const s of suites) {
    const h = document.createElement('h2');
    h.textContent = s.name;
    out.append(h);
    for (const t of s.tests) {
      const row = document.createElement('div');
      try {
        await t.fn();
        pass++;
        row.className = 't t--pass';
        row.textContent = t.name;
      } catch (err) {
        fail++;
        failures.push(`${s.name} › ${t.name}: ${err.message}`);
        row.className = 't t--fail';
        row.innerHTML = '<div></div>';
        row.firstChild.textContent = t.name;
        const pre = document.createElement('pre');
        pre.textContent = err.stack || err.message;
        row.firstChild.append(pre);
      }
      out.append(row);
    }
  }
  document.getElementById('summary').textContent = `${pass} نجح · ${fail} فشل`;
  window.__TEST_RESULTS__ = { pass, fail, failures };
}

run().catch((err) => {
  document.getElementById('summary').textContent = 'تعذّر تشغيل الاختبارات: ' + err.message;
  window.__TEST_RESULTS__ = { pass: 0, fail: 1, failures: [String(err.stack || err)] };
});
