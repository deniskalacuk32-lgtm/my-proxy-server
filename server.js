import express from "express";
import fetch from "node-fetch";
import cors from "cors";
import { HttpsProxyAgent } from "https-proxy-agent";

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(cors({
  origin: (_o, cb) => cb(null, true),
  methods: ["GET","POST","OPTIONS"],
  allowedHeaders: ["Content-Type","Authorization"],
  maxAge: 86400
}));
app.options("*", (req, res) => res.sendStatus(200));

const PORT = process.env.PORT || 3000;

// ===== ENV =====
const {
  OPENAI_API_KEY,
  PROXY_HOST, PROXY_PORT, PROXY_USER, PROXY_PASS,
  PROXY_SCHEME = "http",
  DISABLE_PROXY = "false"
} = process.env;

const useProxy = String(DISABLE_PROXY).toLowerCase() !== "true";
const scheme = (PROXY_SCHEME || "http").toLowerCase();
const proxyUrl = `${scheme}://${encodeURIComponent(PROXY_USER||"")}:${encodeURIComponent(PROXY_PASS||"")}@${PROXY_HOST}:${PROXY_PORT}`;
const agent = useProxy ? new HttpsProxyAgent(proxyUrl) : undefined;

const abort = (ms)=>{ const c=new AbortController(); const t=setTimeout(()=>c.abort(),ms); return {signal:c.signal, done:()=>clearTimeout(t)}; };

// ===== Boot log =====
console.log("🧩 process.cwd():", process.cwd());
console.log("🚀 New server v3 starting; proxy=", useProxy ? "enabled" : "disabled");

// ===== Health / Debug =====
app.get("/", (_req,res)=>res.send("ok"));
app.get("/__version", (_req,res)=>res.send("v3 ✅"));
app.get("/health", (_req,res)=>res.json({
  ok:true, version:"v3", port:PORT,
  proxy:{ enabled:useProxy, scheme, host:PROXY_HOST, port:PROXY_PORT, user:!!PROXY_USER },
  openaiKeySet: !!OPENAI_API_KEY
}));

app.get("/diag/proxy", async (_req,res)=>{
  if(!useProxy) return res.json({ proxy:"disabled" });
  const {signal,done}=abort(10000);
  try{
    const r = await fetch("https://httpbin.org/ip", { agent, signal });
    const txt = await r.text(); done();
    res.status(r.status).type(r.headers.get("content-type")||"text/plain").send(txt);
  }catch(e){
    done(); res.status(504).json({ error:"proxy_connect_failed", details:String(e) });
  }
});

app.get("/diag/openai", async (_req,res)=>{
  if(!OPENAI_API_KEY) return res.status(500).json({ error:"no_openai_key" });
  const {signal,done}=abort(15000);
  try{
    const r = await fetch("https://api.openai.com/v1/models", {
      method:"GET",
      headers:{ "Authorization":`Bearer ${OPENAI_API_KEY}` },
      agent, signal
    });
    const txt = await r.text(); done();
    res.status(r.status).type(r.headers.get("content-type")||"application/json").send(txt);
  }catch(e){
    done(); res.status(504).json({ error:"openai_models_timeout_or_network", details:String(e) });
  }
});

// ===== Chat (Responses API) =====
app.post("/api/chat", async (req,res)=>{
  const msgs = Array.isArray(req.body?.messages) ? req.body.messages : [];
  const system = { role:"system", content:"Ты «Менеджер Алексей». Отвечай коротко и по делу." };
  if(!OPENAI_API_KEY) return res.status(500).json({ error:"OPENAI_API_KEY not configured" });

  const input = [system, ...msgs].map(m => ({
    role: m.role,
    content: [{ type:"text", text:String(m.content ?? "") }]
  }));

  const {signal,done}=abort(45000);
  try{
    const r = await fetch("https://api.openai.com/v1/responses", {
      method:"POST",
      headers:{ "Authorization":`Bearer ${OPENAI_API_KEY}`, "Content-Type":"application/json" },
      agent,
      body: JSON.stringify({ model:"gpt-4o-mini", input, max_output_tokens:200 }),
      signal
    });
    const txt = await r.text(); done();
    res.status(r.status).type(r.headers.get("content-type")||"application/json").send(txt);
  }catch(e){
    done();
    const msg = String(e?.message || e);
    const isAbort = /AbortError|aborted/i.test(msg);
    res.status(isAbort?504:502).json({ error: isAbort?"openai_timeout":"openai_network_error", details: msg });
  }
});

app.post("/", (req,res)=>{ req.url="/api/chat"; app._router.handle(req,res,()=>{}); });

app.listen(PORT, ()=>console.log(`✅ New server v3 started on ${PORT}; /__version=v3 ✅`));
