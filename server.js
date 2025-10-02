import express from "express";
import fetch from "node-fetch";
import HttpsProxyAgent from "https-proxy-agent";

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

app.post("/", async (req, res) => {
  try {
    const { messages = [] } = req.body;

    const system = {
      role: "system",
      content: "Ты помощник на сайте. Отвечай коротко и понятно, максимум одно–два предложения."
    };

    const proxyAuth = `${process.env.PROXY_USER}:${process.env.PROXY_PASS}`;
    const agent = new HttpsProxyAgent(`${process.env.PROXY_URL}?auth=${proxyAuth}`);

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

    const data = await response.json();
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
