/* OnPost — single-page frontend (no framework, mobile-first). */
const view = document.getElementById('view');
const userbox = document.getElementById('userbox');

const state = { user: null, assignedSites: [] };

/* ---------- helpers ---------- */
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
function todayISO() { return new Date().toISOString().slice(0, 10); }
function fmtDT(iso) { return iso ? new Date(iso).toLocaleString() : '—'; }
function fmtTime(iso) {
  return iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—';
}
function showError(msg) {
  view.insertAdjacentHTML('afterbegin', `<div class="error">${esc(msg)}</div>`);
  window.scrollTo(0, 0);
}
function showOk(msg) {
  view.insertAdjacentHTML('afterbegin', `<div class="success">${esc(msg)}</div>`);
  window.scrollTo(0, 0);
}

async function api(method, url, data) {
  const opts = { method, credentials: 'same-origin', headers: {} };
  if (data !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(data);
  }
  const res = await fetch(url, opts);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
  return body;
}
async function apiForm(url, formData) {
  const res = await fetch(url, { method: 'POST', credentials: 'same-origin', body: formData });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
  return body;
}

/* ---------- router ---------- */
function parseHash() {
  const h = location.hash || '#/';
  const [pathPart, queryPart] = h.slice(2).split('?');
  return { seg: (pathPart || '').split('/').filter(Boolean), params: new URLSearchParams(queryPart || '') };
}

function route() {
  renderUserbox();
  const { seg, params } = parseHash();
  if (!state.user) {
    if (seg[0] === 'login') return viewLogin();
    if (seg[0] === 'register') return viewRegister();
    return viewLanding();
  }
  if (seg[0] === 'site' && seg[1]) return viewSite(seg[1], params.get('tab') || 'briefing', params);
  if (seg[0] === 'password') return viewPassword();
  return viewDashboard();
}
window.addEventListener('hashchange', route);

function renderUserbox() {
  if (!state.user) { userbox.innerHTML = ''; return; }
  userbox.innerHTML =
    `<span>${esc(state.user.name)}</span><span class="role">${esc(state.user.role)}</span>` +
    `<a href="#/password" style="color:#cbd5e1;font-size:13px">Password</a>` +
    `<button id="logoutBtn" type="button">Sign out</button>`;
  document.getElementById('logoutBtn').onclick = async () => {
    try { await api('POST', '/api/auth/logout'); } catch {}
    state.user = null;
    state.assignedSites = [];
    location.hash = '#/login';
    route();
  };
}

async function refreshMe() {
  const { user, assignedSites } = await api('GET', '/api/auth/me');
  state.user = user;
  state.assignedSites = assignedSites;
}

/* ---------- landing page (public front door) ---------- */
function viewLanding() {
  view.innerHTML = `
  <div class="landing">
    <div class="hero">
      <div class="eyebrow">For contract security companies</div>
      <h1>Know exactly who's on post.</h1>
      <p class="sub">OnPost is shift management built for guard operations — time clock, timestamped photo checkpoints, daily briefings, and incident reports in one app your officers already know how to use.</p>
      <div class="cta-row">
        <a class="btn light" href="#contact">Start your free 30-day pilot</a>
        <a class="btn outline-light" href="#/login">Sign in</a>
      </div>
    </div>

    <h2 class="section-title">Everything a shift needs</h2>
    <div class="feat-grid">
      <div class="feat"><h3>⏱ Time clock</h3><p>One-tap clock in and out at each site, with a confirmation step so there are no accidental punches.</p></div>
      <div class="feat"><h3>📸 Timestamped checkpoints</h3><p>Photo checkpoints stamped with location, date, time, and officer name — proof that travels with the image.</p></div>
      <div class="feat"><h3>📰 Daily briefings</h3><p>Supervisors post the day's briefing. Officers read it before every shift.</p></div>
      <div class="feat"><h3>📝 Incident reports</h3><p>File and track reports from the field, visible to supervisors the moment they're filed.</p></div>
      <div class="feat"><h3>📋 Post orders</h3><p>Standing site instructions that carry over day to day. Only the Master can change them.</p></div>
      <div class="feat"><h3>🛡 Roles &amp; permissions</h3><p>Officer, Supervisor, and Master tiers — everyone sees exactly what their job needs, nothing more.</p></div>
    </div>

    <h2 class="section-title">Up and running in a day</h2>
    <div class="steps">
      <div class="step"><span class="n">1</span><div><strong>We set up your private site.</strong><p class="muted">Your company gets its own secure OnPost deployment.</p></div></div>
      <div class="step"><span class="n">2</span><div><strong>You invite your team.</strong><p class="muted">Accounts are invite-only — you control every seat.</p></div></div>
      <div class="step"><span class="n">3</span><div><strong>Guards clock in from their phones.</strong><p class="muted">No hardware, no training manual. It just works.</p></div></div>
    </div>

    <h2 class="section-title">Simple per-seat pricing</h2>
    <div class="price-grid">
      <div class="price-card"><h3>Officer</h3><div class="price">$5<span>/seat/mo</span></div><p class="muted">Clock in/out, checkpoints, reports.</p></div>
      <div class="price-card"><h3>Supervisor</h3><div class="price">$8<span>/seat/mo</span></div><p class="muted">Plus sites, briefings, and team oversight.</p></div>
      <div class="price-card"><h3>Master</h3><div class="price">$10<span>/seat/mo</span></div><p class="muted">Full control of your operation.</p></div>
    </div>
    <p class="muted" style="text-align:center">No setup fees. Cancel with 30 days' notice.</p>

    <div class="card" id="contact" style="text-align:center;margin-top:28px">
      <h2>Start your free 30-day pilot</h2>
      <p class="muted">Contact Stallion Security Services LLC and we'll have your team on post within a day.</p>
      <p style="font-size:17px"><strong>📞 CONTACT-PHONE</strong><br /><strong>✉️ CONTACT-EMAIL</strong></p>
    </div>

    <div class="landing-footer">© 2026 Stallion Security Services LLC · OnPost</div>
  </div>`;
}

/* ---------- auth views ---------- */
function viewLogin() {
  view.innerHTML = `
    <div class="card">
      <h2>Sign in</h2>
      <form id="loginForm">
        <label>Email</label>
        <input type="email" id="email" autocomplete="username" required />
        <label>Password</label>
        <input type="password" id="password" autocomplete="current-password" required />
        <button class="btn block" type="submit">Sign in</button>
      </form>
      <p class="muted" style="margin-top:14px">Accounts are invite-only — ask your administrator for access.</p>
      <p class="muted"><a href="#/">← Back to home</a></p>
    </div>`;
  document.getElementById('loginForm').onsubmit = async (e) => {
    e.preventDefault();
    try {
      await api('POST', '/api/auth/login', {
        email: document.getElementById('email').value,
        password: document.getElementById('password').value,
      });
      await refreshMe();
      location.hash = '#/';
      route();
    } catch (err) { showError(err.message); }
  };
}

function viewRegister() {
  view.innerHTML = `
    <div class="card">
      <h2>Create account</h2>
      <p class="muted">New accounts start as <strong>unassigned Officers</strong>. A supervisor must assign you to sites before you can clock in.</p>
      <form id="regForm">
        <label>Full name</label>
        <input type="text" id="name" autocomplete="name" required />
        <label>Email</label>
        <input type="email" id="email" autocomplete="username" required />
        <label>Password (min 8 characters)</label>
        <input type="password" id="password" autocomplete="new-password" required />
        <button class="btn block" type="submit">Create account</button>
      </form>
      <p class="muted" style="margin-top:14px"><a href="#/login">Back to sign in</a></p>
    </div>`;
  document.getElementById('regForm').onsubmit = async (e) => {
    e.preventDefault();
    try {
      await api('POST', '/api/auth/register', {
        name: document.getElementById('name').value,
        email: document.getElementById('email').value,
        password: document.getElementById('password').value,
      });
      await refreshMe();
      location.hash = '#/';
      route();
    } catch (err) { showError(err.message); }
  };
}

/* ---------- change password ---------- */
function viewPassword() {
  view.innerHTML = `
    <a class="back" href="#/">&larr; Dashboard</a>
    <div class="card">
      <h2>Change password</h2>
      <form id="pwForm">
        <label>Current password</label>
        <input type="password" id="pwcur" autocomplete="current-password" required />
        <label>New password (min 8 characters)</label>
        <input type="password" id="pwnew" autocomplete="new-password" required />
        <button class="btn block" type="submit">Change password</button>
      </form>
    </div>`;
  document.getElementById('pwForm').onsubmit = async (e) => {
    e.preventDefault();
    try {
      await api('POST', '/api/auth/password', {
        currentPassword: document.getElementById('pwcur').value,
        newPassword: document.getElementById('pwnew').value,
      });
      showOk('Password changed.');
      location.hash = '#/';
    } catch (err) { showError(err.message); }
  };
}

/* ---------- dashboard ---------- */
async function viewDashboard() {
  view.innerHTML = `
    <div id="banner"></div>
    <div class="card">
      <div class="spread">
        <h2 style="margin:0">Sites</h2>
        <span id="newSiteWrap"></span>
      </div>
      <div id="siteList"><p class="muted">Loading…</p></div>
    </div>`;

  if (['master', 'supervisor'].includes(state.user.role)) {
    document.getElementById('newSiteWrap').innerHTML =
      `<button class="btn small" id="newSiteBtn" type="button">+ New site</button>`;
    document.getElementById('newSiteBtn').onclick = () => siteForm();
  }

  try {
    const [{ shift }, { sites }] = await Promise.all([
      api('GET', '/api/shifts/open'),
      api('GET', '/api/sites'),
    ]);
    const banner = document.getElementById('banner');
    if (shift) {
      banner.innerHTML = `
        <div class="shift-banner">
          <strong>⏱ On shift</strong> — ${esc(shift.site_name)} since ${fmtTime(shift.clock_in)}
          <br /><button class="btn warn" id="clockOutBtn" type="button">Clock out</button>
        </div>`;
      document.getElementById('clockOutBtn').onclick = () => {
        const bannerEl = document.getElementById('banner');
        bannerEl.innerHTML = `
          <div class="shift-banner">
            <strong>Clock out now?</strong> Your shift will end.
            <br /><span class="row" style="margin-top:8px">
              <button class="btn warn" id="clockOutYes" type="button">Yes, clock out</button>
              <button class="btn secondary" id="clockOutNo" type="button">Cancel</button>
            </span>
          </div>`;
        document.getElementById('clockOutYes').onclick = async () => {
          try { await api('POST', '/api/shifts/clock-out'); route(); }
          catch (err) { showError(err.message); }
        };
        document.getElementById('clockOutNo').onclick = () => route();
      };
    }

    const list = document.getElementById('siteList');
    if (sites.length === 0) {
      list.innerHTML = state.user.role === 'officer'
        ? `<div class="empty">Your account isn't assigned to any site yet.<br />Ask your supervisor to assign you from the Team screen.</div>`
        : `<div class="empty">No sites yet. Create your first site to get started.</div>`;
      return;
    }
    list.innerHTML = sites.map((s) => `
      <div class="card site-card" data-site="${esc(s.id)}">
        <div class="spread">
          <div>
            <h3>${esc(s.name)}</h3>
            <div class="muted">${esc(s.address || '')}</div>
          </div>
          <div class="row">
            ${!shift ? `<button class="btn small ok" data-clockin="${esc(s.id)}" type="button">Clock in</button>` : ''}
            <button class="btn small secondary" data-open="${esc(s.id)}" type="button">Open</button>
          </div>
        </div>
      </div>`).join('');
    list.querySelectorAll('[data-open]').forEach((b) => {
      b.onclick = (e) => { e.stopPropagation(); location.hash = `#/site/${b.dataset.open}?tab=briefing`; };
    });
    list.querySelectorAll('[data-clockin]').forEach((b) => {
      b.onclick = (e) => {
        e.stopPropagation();
        const siteId = b.dataset.clockin;
        const wrap = document.createElement('span');
        wrap.className = 'row';
        wrap.innerHTML = `
          <span class="muted">Clock in?</span>
          <button class="btn small ok" type="button" data-yes>Yes</button>
          <button class="btn small secondary" type="button" data-no>Cancel</button>`;
        b.replaceWith(wrap);
        wrap.querySelector('[data-yes]').onclick = async (ev) => {
          ev.stopPropagation();
          try { await api('POST', '/api/shifts/clock-in', { site_id: siteId }); route(); }
          catch (err) { showError(err.message); }
        };
        wrap.querySelector('[data-no]').onclick = (ev) => { ev.stopPropagation(); route(); };
      };
    });
    list.querySelectorAll('.site-card').forEach((c) => {
      c.onclick = () => { location.hash = `#/site/${c.dataset.site}?tab=briefing`; };
    });
  } catch (err) { showError(err.message); }
}

function siteForm(existing) {
  view.innerHTML = `
    <a class="back" href="#/">&larr; Dashboard</a>
    <div class="card">
      <h2>${existing ? 'Edit site' : 'New site'}</h2>
      <form id="siteForm">
        <label>Site name</label>
        <input type="text" id="sname" value="${esc(existing?.name || '')}" required />
        <label>Address</label>
        <input type="text" id="saddr" value="${esc(existing?.address || '')}" />
        <label>Notes</label>
        <textarea id="snotes">${esc(existing?.notes || '')}</textarea>
        <button class="btn block" type="submit">${existing ? 'Save changes' : 'Create site'}</button>
      </form>
    </div>`;
  document.getElementById('siteForm').onsubmit = async (e) => {
    e.preventDefault();
    const data = {
      name: document.getElementById('sname').value,
      address: document.getElementById('saddr').value,
      notes: document.getElementById('snotes').value,
    };
    try {
      if (existing) await api('PUT', `/api/sites/${existing.id}`, data);
      else await api('POST', '/api/sites', data);
      location.hash = '#/';
      route();
    } catch (err) { showError(err.message); }
  };
}

/* ---------- site view ---------- */
const TABS = [
  ['briefing', 'Briefing'],
  ['checkpoints', 'Checkpoints'],
  ['reports', 'Reports'],
  ['shifts', 'Shifts'],
  ['orders', 'Post Orders'],
];

async function viewSite(siteId, tab, params) {
  let site;
  try {
    ({ site } = await api('GET', `/api/sites/${siteId}`));
  } catch (err) { view.innerHTML = `<div class="error">${esc(err.message)}</div>`; return; }

  const canManage = ['master', 'supervisor'].includes(state.user.role);
  const tabs = [...TABS];
  if (canManage) tabs.push(['team', 'Team']);
  if (!tabs.some(([t]) => t === tab)) tab = 'briefing';

  view.innerHTML = `
    <a class="back" href="#/">&larr; Dashboard</a>
    <div class="spread" style="margin-bottom:10px">
      <h2 style="margin:0">${esc(site.name)}</h2>
      ${canManage ? `<button class="btn small secondary" id="editSiteBtn" type="button">Edit site</button>` : ''}
    </div>
    <div class="tabs">${tabs.map(([t, label]) =>
      `<a href="#/site/${esc(site.id)}?tab=${t}" class="${t === tab ? 'active' : ''}">${label}</a>`
    ).join('')}</div>
    <div id="tabBody"><p class="muted">Loading…</p></div>`;

  if (canManage) {
    document.getElementById('editSiteBtn').onclick = () => siteForm(site);
  }
  const body = document.getElementById('tabBody');
  try {
    if (tab === 'briefing') await tabBriefing(body, site, params.get('date') || todayISO());
    else if (tab === 'checkpoints') await tabCheckpoints(body, site);
    else if (tab === 'reports') await tabReports(body, site, params.get('status') || 'open');
    else if (tab === 'shifts') await tabShifts(body, site);
    else if (tab === 'orders') await tabOrders(body, site);
    else if (tab === 'team') await tabTeam(body, site);
  } catch (err) { body.innerHTML = `<div class="error">${esc(err.message)}</div>`; }
}

/* ----- briefing: date-specific notes + carried-over post orders ----- */
async function tabBriefing(body, site, date) {
  const canEdit = ['master', 'supervisor'].includes(state.user.role);
  const data = await api('GET', `/api/sites/${site.id}/briefing?date=${date}`);
  body.innerHTML = `
    <div class="card">
      <div class="spread">
        <h3>Daily briefing</h3>
        <input type="date" id="bdate" value="${esc(date)}" style="width:auto" />
      </div>
      <div class="standing-note">📌 Post orders below are <strong>standing instructions</strong> — they carry over automatically every day and only change when a Master edits them.</div>
      <div class="readonly-box">${esc(data.post_orders || 'No post orders set for this site yet.')}</div>
      <label>Priorities for ${esc(date)}</label>
      <textarea id="bpriorities" ${canEdit ? '' : 'disabled'}>${esc(data.priorities)}</textarea>
      <label>Handoff notes</label>
      <textarea id="bhandoff" ${canEdit ? '' : 'disabled'}>${esc(data.handoff_notes)}</textarea>
      ${canEdit ? `<button class="btn block" id="bsave" type="button">Save briefing</button>` : `<p class="muted">Officers can view the briefing but only supervisors and masters can edit it.</p>`}
    </div>`;
  document.getElementById('bdate').onchange = (e) => {
    location.hash = `#/site/${site.id}?tab=briefing&date=${e.target.value}`;
  };
  if (canEdit) {
    document.getElementById('bsave').onclick = async () => {
      try {
        await api('PUT', `/api/sites/${site.id}/briefing`, {
          date,
          priorities: document.getElementById('bpriorities').value,
          handoff_notes: document.getElementById('bhandoff').value,
        });
        showOk('Briefing saved.');
      } catch (err) { showError(err.message); }
    };
  }
}

/* ----- checkpoints: photo log + standing locations ----- */
async function tabCheckpoints(body, site) {
  const isMaster = state.user.role === 'master';
  const [{ locations }, { checkpoints }] = await Promise.all([
    api('GET', `/api/sites/${site.id}/locations`),
    api('GET', `/api/sites/${site.id}/checkpoints?date=${todayISO()}`),
  ]);
  body.innerHTML = `
    <div class="card">
      <h3>Log checkpoint</h3>
      <form id="cpForm">
        <label>Location</label>
        <select id="cploc">
          <option value="">— choose a saved location —</option>
          ${locations.map((l) => `<option value="${esc(l.id)}">${esc(l.name)}</option>`).join('')}
        </select>
        <label>Or new location</label>
        <input type="text" id="cpnew" placeholder="e.g. Roof Access Door" />
        ${isMaster ? `<p class="muted">As Master, new locations you type are saved automatically as standing locations.</p>` : ''}
        <label>Photo (required)</label>
        <input type="file" id="cpphoto" accept="image/*" capture="environment" required />
        <label>Note</label>
        <input type="text" id="cpnote" placeholder="All clear, door secured…" />
        <button class="btn block" type="submit">Log checkpoint</button>
      </form>
    </div>
    ${isMaster ? `
    <div class="card">
      <h3>Standing locations</h3>
      <p class="muted">Saved once, reused every day. Only a Master can change these.</p>
      <div id="locList">${locations.map((l) => `
        <div class="list-item spread">
          <span>${esc(l.name)}</span>
          <button class="btn small danger" data-delloc="${esc(l.id)}" type="button">Remove</button>
        </div>`).join('') || '<p class="muted">No saved locations yet.</p>'}</div>
      <form id="locForm" class="row" style="margin-top:10px">
        <input type="text" id="locname" placeholder="New location name" style="flex:1" required />
        <button class="btn small" type="submit">Add</button>
      </form>
    </div>` : ''}
    <div class="card">
      <h3>Today's checkpoints</h3>
      <div id="cpList">${checkpoints.map((c) => `
        <div class="list-item" data-cp="${esc(c.id)}">
          <div class="spread"><strong>${esc(c.location_name)}</strong><span class="muted">${fmtTime(c.created_at)}</span></div>
          ${c.note ? `<div>${esc(c.note)}</div>` : ''}
          <div class="meta">${esc(c.user_name || "Former officer")}</div>
          ${c.photo_url ? `<img class="thumb" src="${esc(c.photo_url)}" loading="lazy" alt="Checkpoint photo" />` : ''}
          ${isMaster ? `<button class="btn small danger" data-delcp type="button" style="margin-top:8px">Delete</button>` : ''}
        </div>`).join('') || '<div class="empty">No checkpoints logged today yet.</div>'}</div>
    </div>`;

  body.querySelectorAll('[data-delcp]').forEach((btn) => {
    btn.onclick = async () => {
      const id = btn.closest('[data-cp]').dataset.cp;
      if (!window.confirm('Delete this checkpoint and its photo? This cannot be undone.')) return;
      try {
        await api('DELETE', `/api/sites/${site.id}/checkpoints/${id}`);
        showOk('Checkpoint deleted.');
        await tabCheckpoints(body, site);
      } catch (err) { showError(err.message); }
    };
  });

  document.getElementById('cpForm').onsubmit = async (e) => {
    e.preventDefault();
    const photo = document.getElementById('cpphoto').files[0];
    if (!photo) { showError('A photo is required.'); return; }
    const fd = new FormData();
    fd.append('photo', photo);
    const locId = document.getElementById('cploc').value;
    const newLoc = document.getElementById('cpnew').value.trim();
    if (locId) fd.append('location_id', locId);
    else if (newLoc) fd.append('new_location', newLoc);
    else { showError('Pick a saved location or type a new one.'); return; }
    fd.append('note', document.getElementById('cpnote').value);
    fd.append('tz', Intl.DateTimeFormat().resolvedOptions().timeZone);
    try {
      await apiForm(`/api/sites/${site.id}/checkpoints`, fd);
      viewSite(site.id, 'checkpoints', new URLSearchParams());
    } catch (err) { showError(err.message); }
  };

  if (isMaster) {
    document.getElementById('locForm').onsubmit = async (e) => {
      e.preventDefault();
      try {
        await api('POST', `/api/sites/${site.id}/locations`, { name: document.getElementById('locname').value });
        viewSite(site.id, 'checkpoints', new URLSearchParams());
      } catch (err) { showError(err.message); }
    };
    body.querySelectorAll('[data-delloc]').forEach((b) => {
      b.onclick = async () => {
        if (!confirm('Remove this location? Past checkpoints keep their history.')) return;
        try {
          await api('DELETE', `/api/sites/${site.id}/locations/${b.dataset.delloc}`);
          viewSite(site.id, 'checkpoints', new URLSearchParams());
        } catch (err) { showError(err.message); }
      };
    });
  }
}

/* ----- reports ----- */
async function tabReports(body, site, statusFilter) {
  const canManage = ['master', 'supervisor'].includes(state.user.role);
  const isMaster = state.user.role === 'master';
  const { reports } = await api('GET', `/api/sites/${site.id}/reports${statusFilter === 'all' ? '' : `?status=${statusFilter}`}`);
  body.innerHTML = `
    <div class="card">
      <h3>File a report</h3>
      <form id="repForm">
        <label>Title</label>
        <input type="text" id="rtitle" required />
        <label>Severity</label>
        <select id="rsev">
          <option value="routine">Routine</option>
          <option value="urgent">Urgent</option>
          <option value="critical">Critical</option>
        </select>
        <label>Details</label>
        <textarea id="rbody"></textarea>
        <button class="btn block" type="submit">Submit report</button>
      </form>
    </div>
    <div class="card">
      <div class="spread">
        <h3>Report log</h3>
        <select id="rfilter" style="width:auto">
          <option value="open" ${statusFilter === 'open' ? 'selected' : ''}>Open</option>
          <option value="resolved" ${statusFilter === 'resolved' ? 'selected' : ''}>Resolved</option>
          <option value="all" ${statusFilter === 'all' ? 'selected' : ''}>All</option>
        </select>
      </div>
      <div>${reports.map((r) => `
        <div class="list-item">
          <div class="spread">
            <strong>${esc(r.title)}</strong>
            <span><span class="badge ${esc(r.severity)}">${esc(r.severity)}</span>
            <span class="badge ${esc(r.status)}">${esc(r.status)}</span></span>
          </div>
          ${r.body ? `<div style="margin-top:6px">${esc(r.body)}</div>` : ''}
          <div class="meta">${esc(r.user_name || "Former officer")} · ${fmtDT(r.created_at)}</div>
          ${canManage ? `<div class="row" style="margin-top:8px">
            ${r.status === 'open'
              ? `<button class="btn small ok" data-resolve="${esc(r.id)}" type="button">Mark resolved</button>`
              : `<button class="btn small secondary" data-reopen="${esc(r.id)}" type="button">Reopen</button>`}
            ${isMaster ? `<button class="btn small danger" data-delrep="${esc(r.id)}" type="button">Delete</button>` : ''}
          </div>` : ''}
        </div>`).join('') || '<div class="empty">No reports here.</div>'}</div>
    </div>`;

  document.getElementById('rfilter').onchange = (e) => {
    location.hash = `#/site/${site.id}?tab=reports&status=${e.target.value}`;
  };
  document.getElementById('repForm').onsubmit = async (e) => {
    e.preventDefault();
    try {
      await api('POST', `/api/sites/${site.id}/reports`, {
        title: document.getElementById('rtitle').value,
        severity: document.getElementById('rsev').value,
        body: document.getElementById('rbody').value,
      });
      showOk('Report filed.');
      viewSite(site.id, 'reports', new URLSearchParams([['status', 'open']]));
    } catch (err) { showError(err.message); }
  };
  body.querySelectorAll('[data-resolve]').forEach((b) => {
    b.onclick = async () => {
      try {
        await api('PATCH', `/api/sites/${site.id}/reports/${b.dataset.resolve}`, { status: 'resolved' });
        viewSite(site.id, 'reports', new URLSearchParams([['status', statusFilter]]));
      } catch (err) { showError(err.message); }
    };
  });
  body.querySelectorAll('[data-reopen]').forEach((b) => {
    b.onclick = async () => {
      try {
        await api('PATCH', `/api/sites/${site.id}/reports/${b.dataset.reopen}`, { status: 'open' });
        viewSite(site.id, 'reports', new URLSearchParams([['status', statusFilter]]));
      } catch (err) { showError(err.message); }
    };
  });
  body.querySelectorAll('[data-delrep]').forEach((b) => {
    b.onclick = async () => {
      if (!window.confirm('Delete this report? This cannot be undone.')) return;
      try {
        await api('DELETE', `/api/sites/${site.id}/reports/${b.dataset.delrep}`);
        showOk('Report deleted.');
        viewSite(site.id, 'reports', new URLSearchParams([['status', statusFilter]]));
      } catch (err) { showError(err.message); }
    };
  });
}

/* ----- shifts ----- */
async function tabShifts(body, site) {
  const isMaster = state.user.role === 'master';
  const { shifts } = await api('GET', `/api/shifts?site_id=${site.id}`);
  const { shift: open } = await api('GET', '/api/shifts/open');
  body.innerHTML = `
    <div class="card">
      <h3>Time clock</h3>
      ${open
        ? `<p>On shift at <strong>${esc(open.site_name)}</strong> since ${fmtTime(open.clock_in)}</p>
           <button class="btn warn block" id="coBtn" type="button">Clock out</button>`
        : `<button class="btn ok block" id="ciBtn" type="button">Clock in at ${esc(site.name)}</button>`}
    </div>
    <div class="card">
      <h3>Shift history</h3>
      ${shifts.length ? `<table class="shifts">
        <tr><th>Officer</th><th>In</th><th>Out</th>${isMaster ? '<th></th>' : ''}</tr>
        ${shifts.map((s) => `<tr><td>${esc(s.user_name || "Former officer")}</td><td>${fmtDT(s.clock_in)}</td><td>${s.clock_out ? fmtDT(s.clock_out) : '<em>on shift</em>'}</td>${isMaster ? `<td><button class="btn small danger" data-delshift="${esc(s.id)}" type="button">Delete</button></td>` : ''}</tr>`).join('')}
      </table>` : '<div class="empty">No shifts recorded for this site yet.</div>'}
    </div>`;
  const ci = document.getElementById('ciBtn');
  if (ci) ci.onclick = () => {
    const card = ci.closest('.card');
    card.innerHTML = `
      <h3>Time clock</h3>
      <p>Clock in at <strong>${esc(site.name)}</strong>?</p>
      <div class="row">
        <button class="btn ok" id="ciYes" type="button" style="flex:1">Yes, clock in</button>
        <button class="btn secondary" id="ciNo" type="button">Cancel</button>
      </div>`;
    document.getElementById('ciYes').onclick = async () => {
      try { await api('POST', '/api/shifts/clock-in', { site_id: site.id }); viewSite(site.id, 'shifts', new URLSearchParams()); }
      catch (err) { showError(err.message); }
    };
    document.getElementById('ciNo').onclick = () => viewSite(site.id, 'shifts', new URLSearchParams());
  };
  const co = document.getElementById('coBtn');
  if (co) co.onclick = () => {
    const card = co.closest('.card');
    card.innerHTML = `
      <h3>Time clock</h3>
      <p>Clock out now? Your shift will end.</p>
      <div class="row">
        <button class="btn warn" id="coYes" type="button" style="flex:1">Yes, clock out</button>
        <button class="btn secondary" id="coNo" type="button">Cancel</button>
      </div>`;
    document.getElementById('coYes').onclick = async () => {
      try { await api('POST', '/api/shifts/clock-out'); viewSite(site.id, 'shifts', new URLSearchParams()); }
      catch (err) { showError(err.message); }
    };
    document.getElementById('coNo').onclick = () => viewSite(site.id, 'shifts', new URLSearchParams());
  };

  body.querySelectorAll('[data-delshift]').forEach((b) => {
    b.onclick = async () => {
      if (!window.confirm('Delete this shift record? This cannot be undone.')) return;
      try {
        await api('DELETE', `/api/shifts/${b.dataset.delshift}`);
        showOk('Shift deleted.');
        viewSite(site.id, 'shifts', new URLSearchParams());
      } catch (err) { showError(err.message); }
    };
  });
}

/* ----- post orders (master-editable standing instructions) ----- */
async function tabOrders(body, site) {
  const isMaster = state.user.role === 'master';
  const { content } = await api('GET', `/api/sites/${site.id}/post-orders`);
  body.innerHTML = `
    <div class="card">
      <h3>Post orders</h3>
      <div class="standing-note">📌 Standing instructions for this site. They carry over day to day automatically and only change when edited here${isMaster ? '' : ' (Master only)'}.</div>
      ${isMaster
        ? `<textarea id="poContent" style="min-height:220px">${esc(content)}</textarea>
           <button class="btn block" id="poSave" type="button">Save post orders</button>`
        : `<div class="readonly-box">${esc(content || 'No post orders set for this site yet.')}</div>`}
    </div>`;
  if (isMaster) {
    document.getElementById('poSave').onclick = async () => {
      try {
        await api('PUT', `/api/sites/${site.id}/post-orders`, { content: document.getElementById('poContent').value });
        showOk('Post orders saved. They now apply to every day going forward.');
      } catch (err) { showError(err.message); }
    };
  }
}

/* ----- team: roles + site assignments (master / supervisor) ----- */
async function tabTeam(body, site) {
  const isMaster = state.user.role === 'master';
  const [{ users }, { sites }] = await Promise.all([
    api('GET', '/api/users'),
    api('GET', '/api/sites?include_archived=1'),
  ]);
  const roleOptions = isMaster ? ['officer', 'supervisor', 'master'] : ['officer', 'supervisor'];
  body.innerHTML = `
    ${isMaster ? `
    <div class="card">
      <h3>Create account</h3>
      <p class="muted">New accounts are created with a temporary password — share it with them directly (call, text, in person). They should change it after signing in.</p>
      <label>Full name</label>
      <input type="text" id="nu-name" autocomplete="off" />
      <label>Email</label>
      <input type="email" id="nu-email" autocomplete="off" />
      <label>Temporary password (min 8 characters)</label>
      <input type="text" id="nu-password" autocomplete="off" />
      <label>Role</label>
      <select id="nu-role">
        <option value="officer">Officer</option>
        <option value="supervisor">Supervisor</option>
        <option value="master">Master</option>
      </select>
      <button class="btn" id="nu-create" type="button" style="margin-top:8px">Create account</button>
    </div>` : ''}
    <div class="card">
      <h3>Team</h3>
      <p class="muted">New accounts start as <strong>unassigned Officers</strong>. Assign them to sites here. ${isMaster ? 'As Master you can also change roles.' : 'Supervisors can promote Officers to Supervisor, but only a Master can grant the Master role.'}</p>
      ${users.map((u) => `
      <div class="list-item" data-user="${esc(u.id)}">
        <div class="spread">
          <div><strong>${esc(u.name)}</strong><div class="muted">${esc(u.email)}</div></div>
          <select data-role style="width:auto" ${!isMaster && u.role === 'master' ? 'disabled' : ''}>
            ${roleOptions.map((r) => `<option value="${r}" ${u.role === r ? 'selected' : ''}>${r[0].toUpperCase() + r.slice(1)}</option>`).join('')}
          </select>
        </div>
        <label style="margin-top:8px">Site assignments</label>
        ${sites.filter((s) => !s.archived).map((s) => `
          <label class="check"><input type="checkbox" data-site="${esc(s.id)}" ${u.sites.some((x) => x.id === s.id) ? 'checked' : ''} /> ${esc(s.name)}</label>
        `).join('')}
        <button class="btn small" data-saveuser type="button" style="margin-top:8px">Save</button>
        ${isMaster && u.id !== state.user.id ? `<button class="btn small danger" data-deluser type="button" style="margin-top:8px;margin-left:8px">Delete</button>` : ''}
      </div>`).join('')}
    </div>`;

  if (isMaster) {
    body.querySelector('#nu-create').onclick = async () => {
      try {
        const payload = {
          name: body.querySelector('#nu-name').value,
          email: body.querySelector('#nu-email').value,
          password: body.querySelector('#nu-password').value,
          role: body.querySelector('#nu-role').value,
        };
        const { user } = await api('POST', '/api/users', payload);
        showOk(`Created ${user.name} (${user.role}). Share their temporary password with them directly.`);
        await tabTeam(body, site);
      } catch (err) { showError(err.message); }
    };
  }

  body.querySelectorAll('[data-user]').forEach((card) => {    const userId = card.dataset.user;
    card.querySelector('[data-saveuser]').onclick = async () => {
      try {
        const role = card.querySelector('[data-role]').value;
        const siteIds = [...card.querySelectorAll('[data-site]:checked')].map((c) => c.dataset.site);
        const user = users.find((u) => u.id === userId);
        if (user.role !== role) {
          await api('PATCH', `/api/users/${userId}/role`, { role });
        }
        await api('POST', `/api/users/${userId}/sites`, { site_ids: siteIds });
        showOk(`Saved ${user.name}.`);
      } catch (err) { showError(err.message); }
    };
    const delBtn = card.querySelector('[data-deluser]');
    if (delBtn) {
      delBtn.onclick = async () => {
        const user = users.find((u) => u.id === userId);
        if (!window.confirm(`Delete ${user.name} (${user.email}) and all of their records? This cannot be undone.`)) return;
        try {
          await api('DELETE', `/api/users/${userId}`);
          showOk(`Deleted ${user.name}.`);
          await tabTeam(body, site);
        } catch (err) { showError(err.message); }
      };
    }
  });
}

/* ---------- boot ---------- */
async function boot() {
  try {
    await refreshMe();
  } catch (err) {
    state.user = null; // not signed in — route() shows the login view
  }
  route();
}
boot();
