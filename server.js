// server.js (robust proxy handling)
import express from "express";
import fetch from "node-fetch";
import { HttpsProxyAgent } from "https-proxy-agent";

const app = express();
app.use(express.json());
const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => res.send("ok"));

function buildProxyUrlFromEnv() {
  const host = process.env.PROXY_HOST;
  const port = process.env.PROXY_PORT;
  const user = process.env.PROXY_USER;
  const pass = process.env.PROXY_PASS;
  let rawUrl = process.env.PROXY_URL; // could be host:port or https://host:port

  if (host && port) {
    if (user && pass) {
      return `https://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@${host}:${port}`;
    } else {
      return `https://${host}:${port}`;
    }
  }

  if (!rawUrl) return null;

  // remove query part like ?auth=...
  const qIdx = rawUrl.indexOf("?");
  if (qIdx !== -1) rawUrl = rawUrl.slice(0, qIdx);

  // add scheme if missing
  if (!/^https?:\/\//i.test(rawUrl)) {
    rawUrl = `https://${rawUrl}`;
  }

  // if separate user/pass set and rawUrl has no auth, insert them
  if ((user && pass) && !/@/.test(rawUrl)) {
    rawUrl = rawUrl.replace(/^https?:\/\//i, (m) => `${m}${encodeURIComponent(user)}:${encodeURIComponent(pass)}@`);
  }

  return rawUrl;
}

app.post("/", async (req, res) => {
  console.log("POST body preview:", JSON.stringify(req.body).slice(0, 1000));

  if (!process.env.OPENAI_API_KEY) {
    console.error("OPENAI_API_KEY missing");
    return res.status(500).json({ error: "OPENAI_API_KEY not set" });
  }

  const proxyUrl = buildProxyUrlFromEnv();
  if (!proxyUrl) {
    console.error("Proxy not configured (PROXY_HOST/PROXY_PORT or PROXY_URL required)");
    return res.status(500).json({ error: "Proxy not configured (PROXY_HOST/PROXY_PORT or PROXY_URL required)" });
  }

  // validate proxy URL
  try {
    new URL(proxyUrl);
  } catch (err) {
    console.error("Invalid proxy URL:", proxyUrl, err.message);
    return res.status(500).json({ error: `Invalid proxy URL: ${proxyUrl}` });
  }

  console.log("Using proxy URL:", proxyUrl);

  try {
    const agent = new HttpsProxyAgent(proxyUrl);

    const { messages = [] } = req.body;
    const system = {
      role: "system",
      content: "Ты помощник на сайте. Отвечай коротко и понятно, максимум одно–двa предложения."
    };

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini-2024-07-18",
        input: [system, ...messages],
        max_output_tokens: 160
      }),
      agent
    });

    if (!response.ok) {
      const text = await response.text();
      console.error("OpenAI returned non-OK:", response.status, text);
      return res.status(500).json({ error: `OpenAI API error ${response.status}`, details: text });
    }

    const data = await response.json();
    return res.json(data);
  } catch (err) {
    console.error("Error contacting OpenAI via proxy:", err);
    return res.status(500).json({ error: "Error contacting OpenAI via proxy", details: String(err && err.message ? err.message : err) });
  }
});

app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
