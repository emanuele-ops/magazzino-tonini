// =====================================================================
//  FUNZIONE "leggi-preventivo" per NETLIFY  -  Atelier Tonini (app v182)
//
//  Riceve il preventivo di un fornitore (PDF o foto) e lo fa leggere
//  all'IA: restituisce le righe (codice, descrizione, quantita', unita',
//  prezzo) e per ognuna l'articolo del magazzino che le somiglia.
//  Non scrive niente: le righe le controlli e le confermi tu nell'app.
//
//  DOVE VA QUESTO FILE
//  Nel repository GitHub, accanto a capisci-dettatura.mjs:
//      netlify/functions/leggi-preventivo.mjs
//  Usa la stessa chiave dell'IA della dettatura (AI Gateway di Netlify).
// =====================================================================

const ISTRUZIONI = `Leggi il preventivo (o offerta, o conferma d'ordine) di un fornitore di una
falegnameria di alta gamma (Atelier Tonini) e trascrivi le RIGHE DEGLI ARTICOLI.

Regole:
- Una riga per ogni articolo con quantita' o prezzo. Salta intestazioni, totali, IVA,
  trasporto solo se non e' una riga con importo (se il trasporto ha un importo, mettilo come riga).
- Copia la descrizione cosi' com'e' scritta (puoi unire le righe di testo che la continuano).
- "codice": il codice articolo del fornitore, se c'e'.
- "quantita": numero (virgola italiana -> punto). "unita": PZ, NR, MQ, ML, KG, CF ecc. come scritto.
- "prezzo_unitario": prezzo per unita' gia' scontato se lo sconto e' indicato sulla riga
  (scrivi lo sconto in "sconto" come testo, es. "50+10"); "importo": totale riga.
  Se un numero non si legge bene lascialo null e scrivi il dubbio in "dubbi". Non inventare.
- "articolo_id": SOLO se fra gli ARTICOLI DEL MAGAZZINO che ti do ce n'e' uno che e' chiaramente
  lo stesso oggetto (stesso codice fornitore, o stessa descrizione e stesse misure). Altrimenti "".
  Le misure contano: 4x30 non e' 4x40.
- In testa: "fornitore" (ragione sociale di chi fa il preventivo, NON Tonini), "numero" e "data" (AAAA-MM-GG) del documento.
- Rispondi SOLO con il JSON, senza testo attorno e senza blocchi di codice.

Formato:
{"fornitore":"","numero":"","data":"","righe":[{"codice":"","descrizione":"","quantita":null,"unita":"",
 "prezzo_unitario":null,"sconto":"","importo":null,"articolo_id":"","dubbi":""}]}`;

const json = (o, s = 200) =>
  new Response(JSON.stringify(o), {
    status: s,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });

export default async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "content-type, authorization, apikey",
      "Access-Control-Allow-Methods": "POST, OPTIONS" } });
  }
  try {
    const chiave = process.env.ANTHROPIC_API_KEY;
    const base = process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com";
    if (!chiave) return json({ errore: "L'IA non risulta attiva su Netlify (AI Gateway): fai almeno una pubblicazione del sito, poi riprova" }, 500);

    const { file, catalogo } = await req.json();
    if (!file || !file.base64) return json({ errore: "Manca il file" }, 400);
    const tipo = String(file.tipo || "");
    const blocco = tipo === "application/pdf"
      ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: file.base64 } }
      : { type: "image", source: { type: "base64", media_type: tipo || "image/jpeg", data: file.base64 } };

    const art = (catalogo && catalogo.articoli) || [];
    const elenco = art.map((a) => `${a.id} | ${a.nome}${a.cod ? " | cod. " + a.cod : ""}${a.forn ? " | " + a.forn : ""}`).join("\n");

    const chiedi = (modello) => fetch(`${base}/v1/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": chiave, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: modello, max_tokens: 8000, temperature: 0, system: ISTRUZIONI,
        messages: [{ role: "user", content: [
          blocco,
          { type: "text", text: `ARTICOLI DEL MAGAZZINO (id | nome | codice fornitore | fornitore):\n${elenco}\n\nTrascrivi le righe del preventivo. Solo il JSON.` },
        ] }],
      }),
    });

    // prima il modello piu' bravo a leggere i documenti, se non c'e' quello della dettatura
    const modelli = [process.env.MODELLO_PREVENTIVI || "claude-sonnet-4-5", process.env.MODELLO || "claude-haiku-4-5"];
    let r = null, ultimo = "";
    for (const m of modelli) {
      r = await chiedi(m);
      if (r.ok) break;
      ultimo = "L'IA ha risposto " + r.status + ": " + (await r.text()).slice(0, 300);
      if (r.status !== 400 && r.status !== 404) break;
    }
    if (!r || !r.ok) return json({ errore: ultimo || "L'IA non risponde" }, 502);

    const risposta = await r.json();
    const testo = (risposta.content || []).map((p) => p.text || "").join("");
    const m = testo.match(/\{[\s\S]*\}/);
    if (!m) return json({ errore: "Risposta non leggibile", grezzo: testo.slice(0, 300) }, 502);
    const dati = JSON.parse(m[0]);
    return json({ fornitore: dati.fornitore || "", numero: dati.numero || "", data: dati.data || "", righe: dati.righe || [], uso: risposta.usage || null });
  } catch (e) {
    return json({ errore: String((e && e.message) || e) }, 500);
  }
};
