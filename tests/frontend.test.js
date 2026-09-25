/**
 * Frontend smoke test — boots public/app.js in a stubbed browser (node:vm)
 * and asserts the first paint works. Catches boot-time ReferenceErrors like
 * the missing boot() that once shipped a white page to production.
 *
 * Run: node --test tests/frontend.test.js
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');

function makeElement() {
  return {
    innerHTML: '',
    value: '',
    dataset: {},
    insertAdjacentHTML(pos, html) {
      this.innerHTML = pos === 'afterbegin' ? html + this.innerHTML : this.innerHTML + html;
    },
    addEventListener() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
  };
}

/** Run the frontend with a fake signed-in state. Resolves with the #view HTML. */
async function bootFrontend({ signedIn }) {
  const elements = new Map();
  const view = makeElement();
  const userbox = makeElement();
  elements.set('view', view);
  elements.set('userbox', userbox);

  const canned = {
    '/api/auth/me': signedIn
      ? { ok: true, status: 200, body: { user: { id: 'u1', name: 'T', email: 't@t.co', role: 'master' }, assignedSites: [] } }
      : { ok: false, status: 401, body: { error: 'Not signed in.' } },
    '/api/shifts/open': { ok: true, status: 200, body: { shifts: [] } },
    '/api/sites': { ok: true, status: 200, body: { sites: [] } },
  };

  const errors = [];
  const sandbox = {
    document: {
      getElementById: (id) => {
        if (!elements.has(id)) elements.set(id, makeElement());
        return elements.get(id);
      },
      querySelector: () => null,
      createElement: () => makeElement(),
    },
    window: { addEventListener() {}, scrollTo() {} },
    location: { hash: '#/' },
    fetch: async (url) => {
      const c = canned[url] || { ok: true, status: 200, body: {} };
      return { ok: c.ok, status: c.status, json: async () => c.body };
    },
    FormData: class {},
    URLSearchParams,
    console: { log() {}, warn() {}, error: (...a) => errors.push(a) },
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox, { filename: 'app.js' });
  // let boot()'s async work settle
  await new Promise((r) => setTimeout(r, 100));
  return { html: view.innerHTML, errors };
}

test('frontend boots to the sign-in view when not signed in', async () => {
  const { html } = await bootFrontend({ signedIn: false });
  assert.match(html, /Sign in/, 'expected the sign-in form to render');
  assert.match(html, /Create an officer account/, 'expected the registration link');
});

test('frontend boots to the dashboard when signed in', async () => {
  const { html } = await bootFrontend({ signedIn: true });
  assert.match(html, /Sites/, 'expected the dashboard to render');
  assert.doesNotMatch(html, /Sign in/, 'should not show the login form');
});
