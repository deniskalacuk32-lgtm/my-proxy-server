// server.js — with timeout + detailed logging
import express from "express";
import fetch from "node-fetch";
import { HttpsProxyAgent } from "https-proxy-agent";
import AbortController from "abort-controller";

const app = express();
app.use(express.json());
const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => res.send("ok"));

function buildProxyUrlFromEnv() {
  const host = process.env.PROXY_HOST;
  const port = process.env.PROXY_PORT;
  const user = process.env.PROXY_USER;
  const pass = process.env.PROXY_PASS;
  let rawUrl = process.env.PROXY_URL;

  if (host && port) {
    if (user && pass) return `https://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@${host}:${port}`;
    return `https://${host}:${port}`;
  }
  if (!rawUrl) return null;
  const qIdx = rawUrl.indexOf("?");
  if (qIdx !== -1) rawUrl = rawUrl.slice(0, qIdx);
  if (!/^https?:\/\//i.test(rawUrl)) rawUrl = `https://${rawUrl}`;
  if ((user && pass) && !/@/.test(rawUrl)) {
    rawUrl = rawUrl.replace(/^https?:\/\//i, (m) => `${m}${encodeURIComponent(user)}:${encodeURIComponent(pass)}@`);
  }
  return rawUrl;
}

app.post("/", async (req, res) => {
  console.log("=== Incoming POST ===");
  console.log("Preview body:", JSON.stringify(req.body).slice(0, 1000));

  if (!process.env.OPENAI_API_KEY) {
    console.error("OPENAI_API_KEY missing");
    return res.status(500).json({ error: "OPENAI_API_KEY not set" });
  }

  const proxyUrl = buildProxyUrlFromEnv();
  // If DISABLE_PROXY=true, skip proxy completely
  const disableProxy = (process.env.DISABLE_PROXY === "true" || process.env.DISABLE_PROXY === "1");

  if (!disableProxy && !proxyUrl) {
    console.error("Proxy not configured and not disabled");
    return res.status(500).json({ error: "Proxy not configured (PROXY_HOST/PROXY_PORT or PROXY_URL required) or set DISABLE_PROXY=true to skip proxy" });
  }

  if (!disableProxy) {
    try {
      new URL(proxyUrl);
    } catch (err) {
      console.error("Invalid proxy URL:", proxyUrl, err.message);
      return res.status(500).json({ error: `Invalid proxy URL: ${proxyUrl}` });
    }
    console.log("Using proxy URL:", proxyUrl);
  } else {
    console.log("Proxy disabled by DISABLE_PROXY, calling OpenAI directly");
  }

  try {
    const agent = disableProxy ? null : new HttpsProxyAgent(proxyUrl);

    const { messages = [] } = req.body;
    const system = { role: "system", content: "Ты помощник на сайте. Отвечай коротко и понятно." };

    const body = JSON.stringify({
      model: "gpt-4o-mini-2024-07-18",
      input: [system, ...messages],
      max_output_tokens: 160
    });

    // Установим таймаут 15 секунд для запроса к OpenAI
    const controller = new AbortController();
    const timeoutMs = 15000;
    const timeout = setTimeout(() => {
      controller.abort();
    }, timeoutMs);

    console.log(`Starting fetch to OpenAI (timeout ${timeoutMs}ms)${disableProxy ? " without proxy" : " via proxy"}`);
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body,
      agent,
      signal: controller.signal
    }).finally(() => clearTimeout(timeout));

    if (!response.ok) {
      const txt = await response.text().catch(() => "<no body>");
      console.error("OpenAI returned non-OK:", response.status, txt);
      return res.status(500).json({ error: `OpenAI API error ${response.status}`, details: txt });
    }

    const data = await response.json();
    console.log("OpenAI OK, returning result");
    return res.json(data);
  } catch (err) {
    if (err.name === "AbortError") {
      console.error("Fetch to OpenAI timed out (abort)");
      return res.status(504).json({ error: "Timeout contacting OpenAI (proxy or network issue)" });
    }
    console.error("Unhandled error contacting OpenAI:", err);
    return res.status(500).json({ error: "Error contacting OpenAI", details: String(err && err.message ? err.message : err) });
  }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
