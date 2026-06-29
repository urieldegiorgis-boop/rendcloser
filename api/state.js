// api/state.js — Persistencia en Supabase, separada por panel con ?ns=
// VERSIÓN CommonJS (module.exports), igual estilo que closer.js de este proyecto.
//
// La tabla ya existe en Supabase:
//   create table if not exists panel_state (
//     ns text primary key,
//     data jsonb,
//     updated_at timestamptz default now()
//   );
//
// Este panel (Closers) usa  ns=closer.
//
// Variables de entorno necesarias en ESTE proyecto de Vercel:
//   SUPABASE_URL                -> https://hseluvpwqjgallfyzori.supabase.co   (SIN /rest/v1/ al final)
//   SUPABASE_SERVICE_ROLE_KEY   -> la clave service_role

const URL  = process.env.SUPABASE_URL;
const SKEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

module.exports = async (req, res) => {
  if (!URL || !SKEY) {
    return res.status(500).json({ error: "Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY." });
  }

  // Por si la URL viene con una barra final o con /rest/v1, la normalizamos para no duplicar la ruta.
  const baseUrl = String(URL).replace(/\/+$/, "").replace(/\/rest\/v1$/, "");
  const ns = (req.query.ns || "default").toString();
  const base = `${baseUrl}/rest/v1/panel_state`;
  const headers = { apikey: SKEY, Authorization: `Bearer ${SKEY}`, "Content-Type": "application/json" };

  try {
    if (req.method === "GET") {
      const r = await fetch(`${base}?ns=eq.${encodeURIComponent(ns)}&select=data`, { headers });
      if (!r.ok) { const t = await r.text(); return res.status(r.status).json({ error: t.slice(0, 300) }); }
      const rows = await r.json();
      return res.status(200).json((rows && rows[0] && rows[0].data) || {});
    }

    if (req.method === "POST") {
      const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
      const r = await fetch(`${base}?on_conflict=ns`, {
        method: "POST",
        headers: { ...headers, Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify([{ ns, data: body, updated_at: new Date().toISOString() }])
      });
      if (!r.ok) { const t = await r.text(); return res.status(r.status).json({ error: t.slice(0, 300) }); }
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: "Método no permitido." });
  } catch (e) {
    return res.status(500).json({ error: String(e).slice(0, 300) });
  }
};
