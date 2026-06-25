// api/state.js — Persistencia OPCIONAL del Panel de Closers (Vercel + Supabase).
// Guarda/lee el estado del dashboard en la tabla `panel_state` de Supabase, en una
// fila propia identificada por ?ns=closer (no pisa nada de los otros paneles).
//
// Es OPCIONAL: si no configuras las variables de entorno, el dashboard sigue
// funcionando (sincroniza desde Close en vivo), solo que no recuerda entre recargas.
//
// Variables de entorno necesarias en Vercel (Settings → Environment Variables):
//   SUPABASE_URL                = https://<tu-proyecto>.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY   = (Service role key de Supabase · Project Settings → API)
//
// Uso desde el dashboard:
//   GET  /api/state?ns=closer            -> devuelve el objeto de estado guardado (o {})
//   POST /api/state?ns=closer  body=DB   -> guarda el objeto de estado

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const URL = process.env.SUPABASE_URL;
  const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!URL || !KEY) {
    return res.status(501).json({ error: 'Persistencia no configurada (faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY).' });
  }

  const ns = (req.query.ns || 'closer').toString();
  const base = URL.replace(/\/+$/, '') + '/rest/v1/panel_state';
  const headers = {
    apikey: KEY,
    Authorization: 'Bearer ' + KEY,
    'Content-Type': 'application/json',
  };

  try {
    if (req.method === 'GET') {
      const r = await fetch(base + '?ns=eq.' + encodeURIComponent(ns) + '&select=data', { headers });
      if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + (await r.text()).slice(0, 200));
      const rows = await r.json();
      return res.status(200).json((rows && rows[0] && rows[0].data) ? rows[0].data : {});
    }

    if (req.method === 'POST') {
      // body puede venir ya parseado (Vercel) o como string.
      let data = req.body;
      if (typeof data === 'string') { try { data = JSON.parse(data); } catch (_) { data = {}; } }
      const payload = [{ ns, data, updated_at: new Date().toISOString() }];
      const r = await fetch(base + '?on_conflict=ns', {
        method: 'POST',
        headers: { ...headers, Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify(payload),
      });
      if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + (await r.text()).slice(0, 200));
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Método no permitido' });
  } catch (e) {
    return res.status(500).json({ error: 'Fallo en persistencia', detail: String(e).slice(0, 300) });
  }
};
