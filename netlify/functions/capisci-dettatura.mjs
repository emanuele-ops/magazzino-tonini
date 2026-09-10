// =====================================================================
//  FUNZIONE "capisci-dettatura" per NETLIFY
//  Atelier Tonini
//
//  Questa e' l'alternativa piu' semplice al file per Supabase:
//  su Netlify non serve NESSUNA chiave. Netlify ha il suo "AI Gateway"
//  e infila da solo le chiavi nelle variabili d'ambiente. Tu paghi
//  con i crediti gia' compresi nel tuo piano Netlify.
//
//  DOVE VA QUESTO FILE
//  Nel tuo repository GitHub, accanto a index.html, dentro due
//  cartelle nuove, con questo percorso esatto:
//      netlify/functions/capisci-dettatura.mjs
//  Netlify la pubblica da sola al primo deploy. Niente altro da fare.
// =====================================================================

const ISTRUZIONI = `Sei l'assistente di una falegnameria di alta gamma (Atelier Tonini).
Gli operai in produzione dettano a voce, in italiano, cosa hanno consumato, quante ore
hanno fatto o che spese ci sono state. Parlano in modo informale e la trascrizione
automatica sbaglia spesso le parole tecniche.

Il tuo compito: trasformare quello che hanno detto in righe strutturate, scegliendo
SEMPRE E SOLO fra le voci del catalogo che ti do. Non inventare mai codici o nomi che
non sono nel catalogo.

Regole:
- Una riga per ogni cosa distinta che hanno detto. Se dicono tre cose, restituisci tre righe.
- "tipo" vale "materiale" (consumo di magazzino), "ore" (manodopera) oppure "voce" (spesa in euro).
- Per il materiale scegli UNA voce del catalogo. Se e' un articolo usa "articolo_id".
  Se e' un pannello o un massiccio lascia articolo_id vuoto e metti il nome esatto in "materiale".
- Le persone in produzione non conoscono i codici: riconosci il materiale dalla descrizione
  parlata ("viti quattro e mezzo per trenta" = una vite 4,5x30). Attenzione alle misure:
  sono il segno piu' affidabile per distinguere due articoli quasi uguali.
- La commessa la chiamano col nome del cliente o del palazzo, mai col codice.
- Se due voci del catalogo sono ugualmente possibili NON tirare a indovinare: metti la piu'
  probabile e aggiungi la domanda in "domanda" e le alternative in "scelte_commessa" o
  "scelte_materiale". Serve che l'ufficio (o l'operaio) scelga con un tocco.
- Le quantita' scritte a parole vanno in cifre. "quattro e mezzo" = 4.5, "un centinaio" = 100.
- Se qualcosa non lo capisci lascialo vuoto e scrivilo in "dubbi". Meglio vuoto che sbagliato:
  un dato sbagliato manda fuori i costi della commessa.
- Rispondi SOLO con il JSON, senza testo attorno e senza blocchi di codice.

Formato:
{"righe":[{
  "tipo":"materiale|ore|voce",
  "articolo_id":"", "materiale":"", "quantita":null, "unita":"",
  "commessa":"", "persona_id":"", "importo":null, "categoria":"",
  "note":"", "dubbi":"", "domanda":"",
  "scelte_commessa":[], "scelte_materiale":[]
}]}`;

const ISTRUZIONI_DOMANDA = `Sei l'assistente del gestionale di magazzino di Atelier Tonini,
falegnameria di alta gamma. Rispondi alle domande di chi lavora in azienda usando
ESCLUSIVAMENTE i dati che ti vengono passati qui sotto.

Come rispondere:
- In italiano, breve e concreto. Chi legge e' spesso al telefono, in officina.
- Dai i numeri, non i giri di parole: "ne hai 340" e non "la giacenza risulta adeguata".
- Se la risposta e' un elenco, usa poche righe con il trattino. Niente tabelle.
- Se il dato NON c'e' nei dati che ti ho dato, dillo chiaramente e spiega dove lo si
  trova nell'app. Non inventare MAI numeri, codici o commesse.
- Se la domanda e' ambigua (due commesse con nome simile) chiedi quale, elencandole.
- Aggiungi una riga di contesto utile solo se serve davvero: per esempio, se un articolo
  e' sotto soglia, o se di un materiale restano solo ritagli.
- Non proporre di registrare o modificare niente: tu leggi soltanto.
- Gli importi in euro riguardano solo le altre voci e la manodopera; i materiali di
  magazzino sono in quantita' (m2, m3, pezzi) e non hanno un valore in euro.
- Attenzione alla differenza fra DESTINATO (messo da parte per una commessa, ancora in
  magazzino) e CONSUMATO (scaricato, uscito davvero).`;

const json = (o, s = 200) =>
  new Response(JSON.stringify(o), {
    status: s,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });

export default async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "content-type, authorization, apikey",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
      },
    });
  }

  try {
    // Netlify infila da solo queste variabili quando l'AI Gateway e' attivo.
    const chiave = process.env.ANTHROPIC_API_KEY;
    const base = process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com";
    if (!chiave) {
      return json({
        errore: "L'AI Gateway di Netlify non risulta attivo: fai almeno una pubblicazione del sito, poi riprova",
      }, 500);
    }

    const corpo = await req.json();

    // ---- MODO DOMANDA: l'assistente risponde su come sta il magazzino ----
    if (corpo.azione === "domanda") {
      const d = String(corpo.domanda || "").trim();
      if (!d) return json({ risposta: "" });
      const storia = (corpo.storia || []).map((m) =>
        (m.ruolo === "io" ? "DOMANDA: " : "RISPOSTA: ") + m.testo).join("\n");
      const rq = await fetch(`${base}/v1/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": chiave, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({
          model: process.env.MODELLO || "claude-haiku-4-5",
          max_tokens: 1200,
          temperature: 0,
          system: ISTRUZIONI_DOMANDA,
          messages: [{ role: "user", content:
            `DATI DEL MAGAZZINO IN QUESTO MOMENTO\n${corpo.dati || ""}\n\n`
            + (storia ? `CONVERSAZIONE FINORA\n${storia}\n\n` : "")
            + `DOMANDA DI ADESSO:\n${d}` }],
        }),
      });
      if (!rq.ok) return json({ errore: "L'IA ha risposto " + rq.status + ": " + (await rq.text()).slice(0, 300) }, 502);
      const dq = await rq.json();
      const risposta = (dq.content || []).map((x) => x.text || "").join("").trim();
      return json({ risposta: risposta || "Non sono riuscito a rispondere.", uso: dq.usage || null });
    }

    const { testo, catalogo } = corpo;
    if (!testo || !String(testo).trim()) return json({ righe: [] });

    const c = catalogo || {};
    const elenco = (a, f) => (a || []).map(f).join("\n");
    const contesto = [
      "ARTICOLI (ferramenta e consumo) - id | nome | unita:",
      elenco(c.articoli, (a) => `${a.id} | ${a.nome} | ${a.unita || ""}`),
      "",
      "MATERIALI A PEZZI (pannelli e massicci) - nome | tipo:",
      elenco(c.materiali, (m) => `${m.nome} | ${m.tipo}`),
      "",
      "COMMESSE - codice | nome:",
      elenco(c.commesse, (x) => `${x.id} | ${x.nome}`),
      "",
      "PERSONE - id | nome:",
      elenco(c.persone, (p) => `${p.id} | ${p.nome}`),
      "",
      "CATEGORIE DI SPESA: " + (c.categorie || []).join(", "),
    ].join("\n");

    const r = await fetch(`${base}/v1/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": chiave,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: process.env.MODELLO || "claude-haiku-4-5",
        max_tokens: 2000,
        temperature: 0,
        system: ISTRUZIONI,
        messages: [{
          role: "user",
          content: `CATALOGO DEL MAGAZZINO\n${contesto}\n\nDETTATO DALL'OPERAIO:\n"${testo}"\n\nRispondi solo con il JSON.`,
        }],
      }),
    });

    if (!r.ok) {
      const t = (await r.text()).slice(0, 300);
      return json({ errore: "L'IA ha risposto " + r.status + ": " + t }, 502);
    }
    const risposta = await r.json();
    const testoRisposta = (risposta.content || []).map((p) => p.text || "").join("");
    const m = testoRisposta.match(/\{[\s\S]*\}/);
    if (!m) return json({ errore: "Risposta non leggibile", grezzo: testoRisposta.slice(0, 300) }, 502);
    const dati = JSON.parse(m[0]);
    return json({ righe: dati.righe || [], fornitore: "netlify", uso: risposta.usage || null });
  } catch (e) {
    return json({ errore: String((e && e.message) || e) }, 500);
  }
};
