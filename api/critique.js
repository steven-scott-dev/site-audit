import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";

function normalizeUrl(input) {
  try {
    const withProtocol = /^https?:\/\//i.test(input) ? input : `https://${input}`;
    return new URL(withProtocol).toString();
  } catch {
    return null;
  }
}

function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<img[^>]*>/gi, " ")
    .replace(/<\/(p|div|section|article|li|h1|h2|h3|h4|h5|h6|br)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s{2,}/g, " ")
    .replace(/\n\s+/g, "\n")
    .trim();
}

function extractMeta(html, url) {
  const titleMatch = html.match(/<title>([\s\S]*?)<\/title>/i);
  const descMatch =
    html.match(/<meta\s+name=["']description["']\s+content=["']([\s\S]*?)["'][^>]*>/i) ||
    html.match(/<meta\s+content=["']([\s\S]*?)["']\s+name=["']description["'][^>]*>/i);

  return {
    url,
    title: titleMatch ? titleMatch[1].trim() : "",
    description: descMatch ? descMatch[1].trim() : ""
  };
}

function extractTextFromResponsePayload(json) {
  if (typeof json?.output_text === "string" && json.output_text.trim()) {
    return json.output_text.trim();
  }

  if (Array.isArray(json?.output)) {
    const chunks = [];

    for (const item of json.output) {
      if (!Array.isArray(item?.content)) continue;

      for (const content of item.content) {
        if (typeof content?.text === "string" && content.text.trim()) {
          chunks.push(content.text.trim());
        }
      }
    }

    if (chunks.length) {
      return chunks.join("\n");
    }
  }

  return "";
}

async function getScreenshotAndHtml(url) {
  chromium.setGraphicsMode = false;

  const browser = await puppeteer.launch({
    args: puppeteer.defaultArgs({
      args: chromium.args,
      headless: "shell"
    }),
    defaultViewport: {
      width: 1440,
      height: 2200,
      deviceScaleFactor: 1,
      isMobile: false,
      hasTouch: false
    },
    executablePath: await chromium.executablePath(),
    headless: "shell"
  });

  try {
    const page = await browser.newPage();

    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36"
    );

    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 30000
    });

    await new Promise((resolve) => setTimeout(resolve, 3000));
    await page.evaluate(() => window.scrollTo(0, 0));

    const html = await page.content();
    const screenshotBuffer = await page.screenshot({
      type: "png",
      fullPage: false
    });

    return {
      html,
      screenshotBase64: screenshotBuffer.toString("base64")
    };
  } finally {
    try {
      for (const page of await browser.pages()) {
        await page.close();
      }
    } catch {}

    await Promise.race([browser.close(), browser.close(), browser.close()]);
  }
}

async function runVisionAudit({
  screenshotDataUrl,
  pageText,
  meta,
  businessType,
  goal,
  extraContext
}) {
  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      score: { type: "number" },
      summary: { type: "string" },
      subscores: {
        type: "object",
        additionalProperties: false,
        properties: {
          clarity: { type: "number" },
          trust: { type: "number" },
          cta: { type: "number" },
          offer: { type: "number" }
        },
        required: ["clarity", "trust", "cta", "offer"]
      },
      issues: {
        type: "array",
        items: { type: "string" }
      },
      fixes: {
        type: "array",
        items: { type: "string" }
      },
      aboveTheFold: {
        type: "array",
        items: { type: "string" }
      },
      trustAndFriction: {
        type: "array",
        items: { type: "string" }
      },
      rewrites: {
        type: "array",
        items: { type: "string" }
      },
      quickWins: {
        type: "array",
        items: { type: "string" }
      }
    },
    required: [
      "score",
      "summary",
      "subscores",
      "issues",
      "fixes",
      "aboveTheFold",
      "trustAndFriction",
      "rewrites",
      "quickWins"
    ]
  };

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "gpt-4.1-mini",
      input: [
        {
          role: "system",
          content: [
            {
              type: "input_text",
              text:
                "You are a blunt, conversion-focused website auditor for small business lead generation. " +
                "Judge only what is visible in the screenshot and homepage text. " +
                "Do not invent hidden pages or unseen elements."
            }
          ]
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text:
                `Audit this homepage for conversion performance.\n\n` +
                `Business type: ${businessType || "Unknown"}\n` +
                `Main goal: ${goal || "More calls / leads / bookings"}\n` +
                `Extra context: ${extraContext || "None"}\n\n` +
                `URL: ${meta.url}\n` +
                `Title: ${meta.title}\n` +
                `Meta description: ${meta.description}\n\n` +
                `Extracted homepage text:\n"""${pageText.slice(0, 10000)}"""\n\n` +
                `Rules:\n` +
                `- Give an overall score from 1 to 10\n` +
                `- Give subscores from 1 to 10 for clarity, trust, cta, and offer\n` +
                `- Focus on weak headlines, buried CTA, lack of trust proof, weak offer, clutter, friction, and confusion\n` +
                `- Keep bullets concise and useful\n` +
                `- Rewrites should be short and ready to use`
            },
            {
              type: "input_image",
              image_url: screenshotDataUrl,
              detail: "auto"
            }
          ]
        }
      ],
      text: {
        format: {
          type: "json_schema",
          name: "website_audit",
          strict: true,
          schema
        }
      }
    })
  });

  const json = await response.json();

  if (!response.ok) {
    console.error("OPENAI ERROR:", JSON.stringify(json, null, 2));
    throw new Error(json?.error?.message || "OpenAI audit request failed.");
  }

  const rawText = extractTextFromResponsePayload(json);

  if (!rawText) {
    console.error("OPENAI RAW RESPONSE:", JSON.stringify(json, null, 2));
    throw new Error("OpenAI returned no readable structured response.");
  }

  try {
    return JSON.parse(rawText);
  } catch (err) {
    console.error("FAILED TO PARSE JSON:", rawText);
    throw new Error("OpenAI returned text, but it was not valid JSON.");
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed." });
  }

  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({ error: "Missing OPENAI_API_KEY." });
  }

  const { url, businessType = "", goal = "", extraContext = "" } = req.body || {};

  if (!url) {
    return res.status(400).json({ error: "Website URL is required." });
  }

  const normalizedUrl = normalizeUrl(url);
  if (!normalizedUrl) {
    return res.status(400).json({ error: "Invalid URL." });
  }

  try {
    const { html, screenshotBase64 } = await getScreenshotAndHtml(normalizedUrl);
    const meta = extractMeta(html, normalizedUrl);
    const pageText = stripHtml(html);

    if (!pageText || pageText.length < 120) {
      return res.status(400).json({
        error: "The site loaded, but there was not enough readable homepage content."
      });
    }

    const screenshotDataUrl = `data:image/png;base64,${screenshotBase64}`;
    const audit = await runVisionAudit({
      screenshotDataUrl,
      pageText,
      meta,
      businessType,
      goal,
      extraContext
    });

    return res.status(200).json({
      screenshotDataUrl,
      audit
    });
  } catch (error) {
    console.error("FULL AUDIT ERROR:", error);

    return res.status(500).json({
      error: error.message || "Unknown server error during audit."
    });
  }
  }
