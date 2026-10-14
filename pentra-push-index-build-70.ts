// ════════════════════════════════════════════════════════════════════════════
// PENTRA FORGE — PUSH NOTIFICATION SENDER  (Supabase Edge Function "pentra-push")
// ════════════════════════════════════════════════════════════════════════════
// Before this: run PENTRA-FORGE-SQL-ALL-IN-ONE.sql (part 6 creates the push tables).
// STEP 1 — Deploy: Supabase → Edge Functions → "Deploy a new function" → "Via Editor" → name it  pentra-push
//          → delete the sample code → paste ALL of this file → Deploy.  (No secrets to add: the keys create themselves.)
// STEP 2 — Connect the database: Database → Webhooks → "Create a new hook", four times:
//          • strength.payments   — events: Insert and Update
//          • strength.feedback   — events: Insert
//          • strength.ref_rewards — events: Insert
//          For each: Type "Supabase Edge Functions" → function pentra-push → method POST → turn ON "Add auth header with service key".
// STEP 3 — In Pentra Forge (signed in as admin): Admin → Settings → "Turn on phone notifications".
// STEP 4 — Workout reminders: Integrations → Cron → Create job → every hour (0 * * * *) → type "Supabase Edge Function" → pentra-push
//          → method POST → body {"cron":"reminders"} → add the header  Authorization: Bearer <your service_role key>  (Project Settings → API keys).
// ════════════════════════════════════════════════════════════════════════════
// Pentra Forge · push sender logic (Build 26). Plain JavaScript shared by the Supabase Edge Function (index.ts) and the tests.
function peso(c){ var n = Math.round(+c || 0) / 100; return '\u20B1' + n.toLocaleString('en-PH', { minimumFractionDigits:n % 1 ? 2 : 0, maximumFractionDigits:2 }); }
// Database webhook payload: { type:'INSERT'|'UPDATE'|'DELETE', schema, table, record, old_record }
function message(evt){ var r = (evt && evt.record) || {}, o = (evt && evt.old_record) || {}, plan = r.plan === 'yearly' ? 'Yearly' : 'Monthly';
  if (!evt || evt.schema !== 'strength') return null;
  if (evt.table === 'payments' && evt.type === 'INSERT' && r.status === 'pending') return { to:'admins', topic:'payments', title:'\uD83D\uDCB3 New payment', body:(r.email || 'A lifter') + ' \u00b7 ' + plan + ' ' + peso(r.amount) + ' \u2014 tap to review', url:'/app/#/admin', tag:'pf-pay', tab:'pay' };
  if (evt.table === 'payments' && evt.type === 'UPDATE' && o.status === 'pending' && r.status === 'approved') return { to:'owner', owner:r.owner_id, topic:'billing', title:'\u2B50 You\u2019re Premium', body:'Your ' + plan + ' plan is active \u2014 every feature is yours.', url:'/app/#/billing', tag:'pf-billing' };
  if (evt.table === 'payments' && evt.type === 'UPDATE' && o.status === 'pending' && r.status === 'rejected') return { to:'owner', owner:r.owner_id, topic:'billing', title:'Payment not approved', body:r.reason ? String(r.reason).slice(0, 120) : 'Open the app for details.', url:'/app/#/billing', tag:'pf-billing' };
  if (evt.table === 'feedback' && evt.type === 'INSERT') { var m = String(r.message || ''); return { to:'admins', topic:'feedback', title:'\uD83D\uDCAC New ' + ({ problem:'problem report', idea:'idea', praise:'praise' }[r.kind] || 'feedback'), body:m.slice(0, 90) + (m.length > 90 ? '\u2026' : ''), url:'/app/#/admin', tag:'pf-fb', tab:'fb' }; }
  if (evt.table === 'ref_rewards' && evt.type === 'INSERT') return { to:'admins', topic:'referrals', title:'\uD83C\uDF81 Referral reward waiting', body:'A lifter brought ' + r.milestone + ' friends \u2014 review the free ' + (r.days === 30 || !r.days ? 'month' : r.days + ' days') + '.', url:'/app/#/admin', tag:'pf-ref', tab:'refs' };
  return null; }
async function ensureKeys(deps){ var k = await deps.getKeys(); if (!k || !k.public_key || !k.private_key) { k = deps.generateKeys(); await deps.saveKeys(k); } return k; }
// Webhook call from the database (Authorization: Bearer <service role key>)
function reminderMessage(t){ var d = +t.days_left || 0; return { title:'\uD83D\uDD25 Keep your streak', body:t.done + ' of ' + t.goal + ' workouts this week, ' + d + ' day' + (d === 1 ? '' : 's') + ' left \u2014 a short session today keeps it alive.', url:'/app/#/dashboard', tag:'pf-remind' }; }
function recapMessage(t){ var n = function(v){ return (+v || 0).toLocaleString('en-PH', { maximumFractionDigits:1 }); }, u = t.unit === 'lb' ? 'lb' : 'kg', w = +t.workouts || 0;
  return { title:'\uD83D\uDCCA Your week \u00b7 review ready', body:w + ' workout' + (w === 1 ? '' : 's') + ' \u00b7 ' + (+t.sets || 0) + ' sets \u00b7 ' + n(t.volume) + ' ' + u + ' lifted' + (t.best_ex ? ' \u00b7 best: ' + t.best_ex + ' ' + n(t.best_load) + ' ' + u + ' \u00d7 ' + t.best_reps : ''), url:'/app/#/review', tag:'pf-recap' }; }   /* Build 70: the Sunday recap opens the weekly review */
async function deliver(subs, payload, deps, keys){ var sent = 0, removed = 0; for (var i = 0; i < subs.length; i++) { try { await deps.send(subs[i], payload, keys); sent++; } catch (e) { if (e && (e.statusCode === 404 || e.statusCode === 410)) { await deps.removeSub(subs[i].endpoint); removed++; } } } return { sent:sent, removed:removed }; }
async function handle(req, deps){ if (!deps.serviceKey || req.auth !== 'Bearer ' + deps.serviceKey) return { status:401, body:{ error:'unauthorized' } };
  if (req.body && req.body.cron === 'reminders') { var rk = await ensureKeys(deps), T = (await deps.reminderTargets()) || [], tot = { sent:0, removed:0 };   /* hourly job (Supabase Cron) */
    for (var t = 0; t < T.length; t++) { var rm = reminderMessage(T[t]), rs = (await deps.subs([T[t].owner_id])).filter(function(s){ return (s.topics || []).indexOf('reminders') >= 0; }), r1 = await deliver(rs, JSON.stringify({ title:rm.title, body:rm.body, url:rm.url, tag:rm.tag, tab:null }), deps, rk); tot.sent += r1.sent; tot.removed += r1.removed; }
    var Q = deps.recapTargets ? ((await deps.recapTargets()) || []) : [];   /* Sunday recap rides on the same hourly job */
    for (var q = 0; q < Q.length; q++) { var cm = recapMessage(Q[q]), cs = (await deps.subs([Q[q].owner_id])).filter(function(s){ return (s.topics || []).indexOf('recap') >= 0; }), r2 = await deliver(cs, JSON.stringify({ title:cm.title, body:cm.body, url:cm.url, tag:cm.tag, tab:null }), deps, rk); tot.sent += r2.sent; tot.removed += r2.removed; }
    return { status:200, body:{ people:T.length, recaps:Q.length, sent:tot.sent, removed:tot.removed } }; }
  var m = message(req.body); if (!m) return { status:200, body:{ sent:0, skipped:true } };
  var keys = await ensureKeys(deps), owners = m.to === 'admins' ? await deps.adminIds() : [m.owner], subs = (await deps.subs(owners)).filter(function(s){ return (s.topics || []).indexOf(m.topic) >= 0; });
  var r = await deliver(subs, JSON.stringify({ title:m.title, body:m.body, url:m.url, tag:m.tag, tab:m.tab || null }), deps, keys);
  return { status:200, body:{ sent:r.sent, removed:r.removed } }; }
// Test call from the app (any signed-in lifter): "✅ Notifications work" to that lifter's OWN devices only
async function handleTest(req, deps){ var uid = await deps.userFromToken(req.auth); if (!uid) return { status:401, body:{ error:'Sign in first' } };
  var subs = (await deps.subs([uid])) || []; if (!subs.length) return { status:200, body:{ sent:0, devices:0 } }; var keys = await ensureKeys(deps);
  var r = await deliver(subs, JSON.stringify({ title:'\u2705 Notifications work', body:'This is a test from Pentra Forge \u2014 you\u2019re all set.', url:'/app/#/settings', tag:'pf-test', tab:null }), deps, keys);
  return { status:200, body:{ sent:r.sent, removed:r.removed, devices:subs.length } }; }
// Setup call from the app (an admin's sign-in token): makes sure the signing keys exist and returns the PUBLIC key
async function handleSetup(req, deps){ if (!(await deps.isAdmin(req.auth))) return { status:403, body:{ error:'Admins only' } }; var k = await ensureKeys(deps); return { status:200, body:{ public_key:k.public_key } }; }

// ── Supabase wiring ──
import webpush from 'npm:web-push@3.6.7';
const URL = Deno.env.get('SUPABASE_URL') ?? '', SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const H = { apikey:SERVICE, Authorization:'Bearer ' + SERVICE, 'Content-Type':'application/json', 'Accept-Profile':'strength', 'Content-Profile':'strength' };
const CORS = { 'Access-Control-Allow-Origin':'*', 'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods':'POST, OPTIONS' };
const j = async (r: Response) => (r.ok ? r.json() : []);
const deps = { serviceKey:SERVICE,
  getKeys: async () => (await j(await fetch(URL + '/rest/v1/push_config?id=eq.true&select=public_key,private_key', { headers:H })))[0],
  saveKeys: async (k: any) => fetch(URL + '/rest/v1/push_config?id=eq.true', { method:'PATCH', headers:H, body:JSON.stringify({ public_key:k.public_key, private_key:k.private_key, updated_at:new Date().toISOString() }) }),
  generateKeys: () => { const k = webpush.generateVAPIDKeys(); return { public_key:k.publicKey, private_key:k.privateKey }; },
  adminIds: async () => (await j(await fetch(URL + '/rest/v1/rpc/push_admin_ids', { method:'POST', headers:H, body:'{}' }))).map((r: any) => (typeof r === 'string' ? r : r.push_admin_ids)),
  subs: async (ids: string[]) => ids.filter(Boolean).length ? await j(await fetch(URL + '/rest/v1/push_subs?select=endpoint,p256dh,auth,topics&owner_id=in.(' + ids.filter(Boolean).join(',') + ')', { headers:H })) : [],
  recapTargets: async () => await j(await fetch(URL + '/rest/v1/rpc/recap_targets', { method:'POST', headers:H, body:'{}' })),
  reminderTargets: async () => await j(await fetch(URL + '/rest/v1/rpc/reminder_targets', { method:'POST', headers:H, body:'{}' })),
  userFromToken: async (auth: string) => { if (!auth.startsWith('Bearer ')) return null; const r = await fetch(URL + '/auth/v1/user', { headers:{ apikey:SERVICE, Authorization:auth } }); if (!r.ok) return null; const u = await r.json(); return u && u.id ? u.id : null; },
  removeSub: async (ep: string) => fetch(URL + '/rest/v1/push_subs?endpoint=eq.' + encodeURIComponent(ep), { method:'DELETE', headers:H }),
  send: async (s: any, payload: string, k: any) => webpush.sendNotification({ endpoint:s.endpoint, keys:{ p256dh:s.p256dh, auth:s.auth } }, payload, { vapidDetails:{ subject:'mailto:jorielamiana04@gmail.com', publicKey:k.public_key, privateKey:k.private_key }, TTL:3600 }),
  isAdmin: async (auth: string) => { if (!auth.startsWith('Bearer ')) return false; const r = await fetch(URL + '/rest/v1/rpc/is_admin', { method:'POST', headers:{ apikey:SERVICE, Authorization:auth, 'Content-Type':'application/json', 'Content-Profile':'strength' }, body:'{}' }); return r.ok && (await r.json()) === true; } };
Deno.serve(async (req: Request) => { if (req.method === 'OPTIONS') return new Response('ok', { headers:CORS });
  const auth = req.headers.get('Authorization') ?? '', body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
  const r = body && body.setup ? await handleSetup({ auth }, deps) : body && body.test ? await handleTest({ auth }, deps) : await handle({ auth, body }, deps);
  return new Response(JSON.stringify(r.body), { status:r.status, headers:{ 'Content-Type':'application/json', ...CORS } }); });
