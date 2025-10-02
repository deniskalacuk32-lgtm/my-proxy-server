import express from "express";
import fetch from "node-fetch";
import HttpsProxyAgent from "https-proxy-agent";

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

// GET / для проверки сервера
app.get("/", (req, res) => {
  res.send("ok");
});

app.post("/", async (req, res) => {
  try {
    const { messages = [] } = req.body;

    const system = {
      role: "system",
      content: "Ты помощник на сайте. Отвечай коротко и понятно, максимум одно–два предложения."
    };

    // Проверка переменных окружения
    if (!process.env.OPENAI_API_KEY) {
      console.error("Ошибка: не установлен OPENAI_API_KEY");
      return res.status(500).json({ error: "OPENAI_API_KEY не установлен" });
    }

    if (!process.env.PROXY_URL || !process.env.PROXY_USER || !process.env.PROXY_PASS) {
      console.error("Ошибка: не настроен прокси");
      return res.status(500).json({ error: "Прокси не настроен (PROXY_URL, PROXY_USER, PROXY_PASS)" });
    }

    const proxyAuth = `${process.env.PROXY_USER}:${process.env.PROXY_PASS}`;
    const agent = new HttpsProxyAgent(`${process.env.PROXY_URL}?auth=${proxyAuth}`);

    let response;
    try {
      response = await fetch("https://api.openai.com/v1/responses", {
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
    } catch (err) {
      console.error("Ошибка запроса к OpenAI:", err.message);
      return res.status(500).json({ error: "Ошибка запроса к OpenAI: " + err.message });
    }

    if (!response.ok) {
      const errText = await response.text();
      console.error(`OpenAI API вернул ошибку ${response.status}: ${errText}`);
      return res.status(500).json({ error: `OpenAI API вернул ошибку ${response.status}: ${errText}` });
    }

    const data = await response.json();

    // Универсальный извлекатель текста
    let reply = null;
    if (data && typeof data.output_text === "string" && data.output_text.trim()) {
      reply = data.output_text.trim();
    } else if (Array.isArray(data.output)) {
      try {
        const texts = [];
        for (const item of data.output) {
          if (!item?.content) continue;
          for (const chunk of item.content) {
            if (chunk?.type === "output_text" && typeof chunk.text === "string") {
              texts.push(chunk.text);
            }
          }
        }
        if (texts.length) reply = texts.join("\n").trim();
      } catch (_) {}
    }

    if (!reply && data?.error) reply = `Ошибка API: ${data.error.message || JSON.stringify(data.error)}`;
    if (!reply) reply = "Не удалось получить ответ. Попробуйте ещё раз.";

    reply = reply.replace(/^```[\s\S]*?\n?|\n?```$/g, "").trim();

    res.json({ reply });
  } catch (e) {
    console.error("Внутренняя ошибка сервера:", e);
    res.status(500).json({ error: "Внутренняя ошибка сервера: " + e.message });
  }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
