import express from "express";
import fetch from "node-fetch";
import { HttpsProxyAgent } from "https-proxy-agent"; // <-- так

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => res.send("ok"));

app.post("/", async (req, res) => {
  try {
    const { messages = [] } = req.body;

    const system = {
      role: "system",
      content: "Ты помощник на сайте. Отвечай коротко и понятно, максимум одно–два предложения."
    };

    // Проверка переменных окружения
    if (!process.env.OPENAI_API_KEY) return res.status(500).json({ error: "OPENAI_API_KEY not set" });
    if (!process.env.PROXY_URL || !process.env.PROXY_USER || !process.env.PROXY_PASS) {
      return res.status(500).json({ error: "Proxy not configured (PROXY_URL, PROXY_USER, PROXY_PASS)" });
    }

    const proxyAuth = `${process.env.PROXY_USER}:${process.env.PROXY_PASS}`;
    const agent = new HttpsProxyAgent(`${process.env.PROXY_URL}?auth=${proxyAuth}`); // теперь работает

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
      const errText = await response.text();
      return res.status(500).json({ error: `OpenAI API returned ${response.status}: ${errText}` });
    }

    const data = await response.json();
    const reply = data.output_text || "No reply from OpenAI";

    res.json({ reply });
  } catch (e) {
    console.error("Internal server error:", e);
    res.status(500).json({ error: "Internal server error: " + e.message });
  }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
