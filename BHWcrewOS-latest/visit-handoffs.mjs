const $ = id => document.getElementById(id);
const node = (tag, text = '') => { const item = document.createElement(tag); item.textContent = text; return item; };
let inbox, staff = [], pending, busy = false, generation = 0;
const status = value => { $('handoff-status').textContent = value; };
function clear() { ++generation; inbox = pending = null; staff = []; $('results').replaceChildren(); $('retry').hidden = true; }
async function api(command) {
  const token = sessionStorage.getItem('crewos_token');
  if (!token) throw Object.assign(new Error('Sign in to CrewHQ.'), { status: 401 });
  const response = await fetch('/.netlify/functions/visit-handoffs', { method: command ? 'POST' : 'GET', cache: 'no-store', redirect: 'error',
    headers: { Authorization: `Bearer ${token}`, ...(command ? { 'Content-Type': 'application/json' } : {}) },
    ...(command ? { body: JSON.stringify(command) } : {}), signal: AbortSignal.timeout(10000) });
  const data = await response.json().catch(() => null);
  if (!response.ok || data?.ok !== true || command && data.commandId !== command.commandId) throw Object.assign(new Error(data?.error || 'Save could not be confirmed.'), { status: response.status, saveUnconfirmed: Boolean(command) && (!data || data.saveUnconfirmed || response.status >= 500) });
  return data;
}
function fail(error) {
  if (error.status === 401) { clear(); sessionStorage.removeItem('crewos_token'); status('Your staff session expired. Sign in again.'); const link = node('a', 'Sign in to CrewHQ'); link.href = '/crewos?next=%2Fbhw-portal-messages.html'; $('handoff-status').append(link); }
  else status(error.message);
}
async function refresh() { const epoch = generation; const data = await api(); if (epoch !== generation) return; inbox = data.inbox; staff = data.staff || []; render(); status('Read back from Health Core.'); }
async function save(action, content, retry = false) {
  if (busy || !inbox) return;
  if (pending && !retry) { status('Retry the saved submission before starting another action.'); return; }
  const command = pending || { action, commandId: crypto.randomUUID(), expectedRevision: inbox.revision, ...content }; pending = command; busy = true;
  const epoch = generation;
  try { const data = await api(command); if (epoch !== generation) return; pending = null; inbox = data.inbox; render(); status('Follow-up metadata saved to Health Core.'); }
  catch (error) { if (epoch !== generation) return; if (!error.saveUnconfirmed) pending = null; fail(error); }
  finally { busy = false; $('retry').hidden = !pending; }
}
function render() {
  $('results').replaceChildren(); const filter = $('filter').value;
  for (const result of inbox.results) {
    const f = result.followUp;
    if (filter === 'review' && result.reviewStatus !== 'needs-review' || filter === 'unassigned' && f || filter === 'open' && f?.status !== 'open'
      || filter === 'overdue' && !(f?.status === 'open' && Date.parse(f.dueAt) < Date.now()) || filter === 'completed' && f?.status !== 'completed') continue;
    const card = node('article'); card.className = 'message'; card.append(node('h2', 'BHW0000 · returned result'), node('p', `Received ${new Date(result.receivedAt).toLocaleString()} · ${result.reviewStatus === 'reviewed' ? 'Provider reviewed' : 'Provider review pending'}`));
    if (f) card.append(node('p', `${f.status} · ${staff.find(s => s.id === f.assignee)?.name || f.assignee} · due ${new Date(f.dueAt).toLocaleString()}`));
    if (f?.status !== 'completed') {
      const form = node('form'), owner = node('select'), due = node('input'); owner.required = due.required = true; owner.setAttribute('aria-label', 'Follow-up owner'); due.type = 'datetime-local'; due.setAttribute('aria-label', 'Follow-up due date and time');
      for (const grant of staff) { const option = node('option', grant.name); option.value = grant.id; owner.append(option); }
      form.append(owner, due, node('button', 'Assign follow-up')); form.addEventListener('submit', event => { event.preventDefault(); void save('assign-follow-up', { resultId: result.resultId, assignee: owner.value, dueAt: new Date(due.value).toISOString() }); }); card.append(form);
      if (f) { const complete = node('button', 'Mark follow-up completed'); complete.addEventListener('click', () => void save('complete-follow-up', { resultId: result.resultId })); card.append(complete); }
    }
    $('results').append(card);
  }
  if (!$('results').childNodes.length) $('results').append(node('p', 'No results match this view.'));
}
$('refresh').addEventListener('click', () => void refresh().catch(fail)); $('filter').addEventListener('change', () => inbox && render());
$('retry').addEventListener('click', () => pending && void save(pending.action, pending, true));
document.addEventListener('visibilitychange', () => { if (document.hidden) clear(); else void refresh().catch(fail); });
window.addEventListener('pagehide', clear); refresh().catch(fail);
