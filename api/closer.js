// api/closer.js — Función serverless (Vercel) INDEPENDIENTE para el Panel de Closers Lathos.
// No toca ni depende de /api/close. Lee leads de Close por Call Date y los agrupa por el
// custom field "Closer", devolviendo:
//   closer = { 'Nombre Closer': {ctd,depo,split,fu,lost,cancel,noshow,nr,reag}, ... }
//   det    = { closer: { 'Nombre Closer': [ {n,e,p,st,dt,url}, ... ] } }   (lista de leads para el drill-down)
//
// Requiere la variable de entorno CLOSE_API_KEY (Settings → Environment Variables en Vercel).
// Uso: GET /api/closer?from=2026-06-01&to=2026-07-01   (rango; 'to' exclusivo)
//      GET /api/closer?month=2026-06                    (mes completo)

const CLOSE_API = 'https://api.close.com/api/v1/data/search/';

// --- IDs de campos personalizados (organización Close de Lathos) ---
const F = {
  callDate: 'cf_CM9afjVZyJq2qmxiDXc2z1NKXAnJRX2txG22PEfRUpm',
  closer:   'cf_30cfOH1faKTF0Qm7goQVtN4kRb1YKBTcIDIIWuHw1hn',
};

// --- Estados → cubeta del dashboard. Lo que no esté aquí NO se cuenta. ---
const STATUS = {
  stat_or2XIbsvG8ClthhoLyqfmFchIYcetvCHR8j1sZM6dIi: 'ctd',    // Close the Deal
  stat_Que6zp8r2nrt5hsujY1GiOS1AvUSuXvl1Mn42acVW1n: 'depo',   // Depósito
  stat_PLFEehKTh4RpixsDl734y6ZhewczaVM2s4jbw0WqZ5w: 'split',  // Split Pay
  stat_PvrKkDHFKwlDBT2wsLkrQCxKQxc6W5nba03ftYs8Om2: 'fu',     // Follow up
  stat_OKpqX3sp2UG3Rrj01l3JUoqFGaDw9tl9c1T90tCApE7: 'lost',   // Lost / Bad Fit
  stat_pQ2Ap6ZeDcWz7T3ZmYVXCW2ldcXf9MMVnIdDyaCMMBv: 'cancel', // Cancel
  stat_MiEXbLVcOtbTVPQv3WJnIISlGfxuwLPTzYyqt716Ltw: 'noshow', // No show
  stat_g99SPoAQUzxbKcMcJdAUhoe4W4H1T1GchIdHaMzLkLS: 'noshow', // No Show VSL
  stat_oI5dIRSQPlQ8DqkJJLzbqfVKBhhT915w73NctzINXwY: 'nr',     // Nueva Reserva
  stat_TlMZO9rIF0ixAIpSJxSTS9zIkyVoHaZkifvjXdGDSQA: 'reag',   // Reagendado
};

const blank = () => ({ ctd:0, depo:0, split:0, fu:0, lost:0, cancel:0, noshow:0, nr:0, reag:0 });
// Etiqueta legible de cada estado (verificada contra Close). Solo para ?debug=1.
const STATUS_LABEL = {
  stat_or2XIbsvG8ClthhoLyqfmFchIYcetvCHR8j1sZM6dIi: 'Close the Deal',
  stat_Que6zp8r2nrt5hsujY1GiOS1AvUSuXvl1Mn42acVW1n: 'Deposito',
  stat_PLFEehKTh4RpixsDl734y6ZhewczaVM2s4jbw0WqZ5w: 'Split Pay',
  stat_PvrKkDHFKwlDBT2wsLkrQCxKQxc6W5nba03ftYs8Om2: 'Follow up',
  stat_OKpqX3sp2UG3Rrj01l3JUoqFGaDw9tl9c1T90tCApE7: 'Lost / Bad Fit',
  stat_pQ2Ap6ZeDcWz7T3ZmYVXCW2ldcXf9MMVnIdDyaCMMBv: 'Cancel',
  stat_MiEXbLVcOtbTVPQv3WJnIISlGfxuwLPTzYyqt716Ltw: 'No show',
  stat_g99SPoAQUzxbKcMcJdAUhoe4W4H1T1GchIdHaMzLkLS: 'No Show VSL',
  stat_oI5dIRSQPlQ8DqkJJLzbqfVKBhhT915w73NctzINXwY: 'Nueva Reserva',
  stat_TlMZO9rIF0ixAIpSJxSTS9zIkyVoHaZkifvjXdGDSQA: 'Reagendado',
};
function bump(map, key, bucket) {
  if (!key) key = '(sin nombrar)';
  if (!map[key]) map[key] = blank();
  map[key][bucket] += 1;
}
function pushDet(map, key, rec) {
  if (!key) key = '(sin nombrar)';
  if (!map[key]) map[key] = [];
  map[key].push(rec);
}
function getCustom(lead, id) {
  const v = lead['custom.' + id] ?? (lead.custom && lead.custom[id]);
  if (v == null) return '';
  return Array.isArray(v) ? String(v[0] ?? '') : String(v);
}
function leadEmailPhone(lead) {
  let email = '', phone = '';
  const cs = Array.isArray(lead.contacts) ? lead.contacts : [];
  for (const c of cs) {
    if (!email && Array.isArray(c.emails) && c.emails.length) email = c.emails[0].email || '';
    if (!phone && Array.isArray(c.phones) && c.phones.length) phone = c.phones[0].phone || '';
    if (email && phone) break;
  }
  return { email, phone };
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const apiKey = process.env.CLOSE_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Falta CLOSE_API_KEY en las variables de entorno.' });

  let start, end;
  if (req.query.from && req.query.to) {
    start = req.query.from;
    end = req.query.to;
  } else {
    const month = (req.query.month || new Date().toISOString().slice(0, 7));
    const [y, m] = month.split('-').map(Number);
    start = `${y}-${String(m).padStart(2, '0')}-01`;
    end = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
  }

  const query = {
    type: 'and',
    queries: [
      { type: 'object_type', object_type: 'lead' },
      {
        type: 'field_condition',
        field: { type: 'custom_field', custom_field_id: F.callDate },
        condition: {
          type: 'moment_range',
          on_or_after: { type: 'fixed_local_date', value: start, which: 'start' },
          before:      { type: 'fixed_local_date', value: end,   which: 'start' },
        },
      },
    ],
  };

  const authHeader = 'Basic ' + Buffer.from(apiKey + ':').toString('base64');
  // "Hoy" en hora de España. Una llamada solo cuenta para el show rate si su fecha ya llegó (hoy o antes).
  const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Madrid' }); // YYYY-MM-DD
  const closer = {};
  const detCloser = {};
  let cursor = null, guard = 0;

  // --- Modo diagnóstico: ?debug=1 devuelve la lista plana de leads contados ---
  const DEBUG = req.query.debug === '1' || req.query.debug === 'true';
  const dbg = { total_leads_devueltos: 0, no_contables: 0, sin_closer: 0, contados: 0, leads: [] };
  const seenCloser = {}; // anti-duplicados: no contar el mismo lead dos veces bajo el mismo closer
  const onceCloser = (who, id) => {
    const s = (seenCloser[who] || (seenCloser[who] = new Set()));
    if (s.has(id)) return false; s.add(id); return true;
  };

  try {
    do {
      const body = {
        query,
        _fields: { lead: ['id', 'display_name', 'status_id', 'custom', 'contacts'] },
        _limit: 200,
      };
      if (cursor) body.cursor = cursor;

      const r = await fetch(CLOSE_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: authHeader },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const txt = await r.text();
        return res.status(r.status).json({ error: 'Close API error', detail: txt.slice(0, 500) });
      }
      const json = await r.json();
      for (const lead of (json.data || [])) {
        if (DEBUG) dbg.total_leads_devueltos++;
        const bucket = STATUS[lead.status_id];
        if (!bucket) { if (DEBUG) dbg.no_contables++; continue; }
        const who = getCustom(lead, F.closer).trim();
        if (!who) { if (DEBUG) dbg.sin_closer++; continue; } // sin closer asignado -> no entra
        if (!onceCloser(who, lead.id)) continue; // ya contado bajo este closer

        const { email, phone } = leadEmailPhone(lead);
        const rec = {
          n: lead.display_name || '(sin nombre)',
          e: email,
          p: phone,
          st: bucket,
          dt: getCustom(lead, F.callDate) || '',
          url: 'https://app.close.com/lead/' + lead.id + '/',
        };
        bump(closer, who, bucket);
        if (!('due' in closer[who])) closer[who].due = 0;
        const dstr = String(rec.dt || '').slice(0, 10); // fecha de la llamada (YYYY-MM-DD)
        if (dstr && dstr <= todayStr) closer[who].due += 1; // su fecha ya llegó -> cuenta para el show rate
        pushDet(detCloser, who, rec);

        if (DEBUG) {
          dbg.contados++;
          dbg.leads.push({
            lead: rec.n,
            call_date: rec.dt || '(vacío)',
            estado: STATUS_LABEL[lead.status_id] || lead.status_id,
            closer: who,
          });
        }
      }
      cursor = json.cursor;
    } while (cursor && ++guard < 60);

    // no-store: cada "↻ Sincronizar" consulta Close EN VIVO.
    // Antes: s-maxage=60, stale-while-revalidate=86400 -> servía datos de hasta 1 DÍA antes,
    // por eso el estado de un lead podía tardar en actualizarse tras cerrar.
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    if (DEBUG) {
      dbg.leads.sort((a, b) => String(a.call_date).localeCompare(String(b.call_date)));
      return res.status(200).json({ from: start, to: end, closer, det: { closer: detCloser }, _debug: dbg });
    }
    return res.status(200).json({ from: start, to: end, closer, det: { closer: detCloser } });
  } catch (e) {
    return res.status(500).json({ error: 'Fallo al consultar Close', detail: String(e).slice(0, 500) });
  }
};
