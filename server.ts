import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const app = express();

// Increase JSON limits to handle larger parsed file content uploaded for summarization
app.use(express.json({ limit: "15mb" }));

// Server API endpoint for secured Gemini Codebase generation
app.post("/api/gemini/generate", async (req, res) => {
  try {
    const { config, files } = req.body;
    
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "GEMINI_API_KEY is not configured on the server." });
    }

    const ai = new GoogleGenAI({
      apiKey: apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        }
      }
    });

    const fileSummaries = files && files.length > 0 
      ? files.map((f: any) => `
--- INCOMING DRIVE SOURCE FILE: ${f.name} (MimeType: ${f.mimeType}) ---
${f.content}
`).join("\n")
      : "";

    const systemInstruction = `You are SmartContent Deployer v2, an elite front-end architect and edge dev expert.
Your job is to generate a beautiful, fully complete, static, single-page web app / interactive presentation from user-provided data resources from Google Drive.
The resulting application must:
1. Be single-screen but contain tab views, rich interactions, search systems, dynamic filters, or charts depending on what was requested.
2. Render in a premium visual fashion matching the typography, spacing, and rhythm of Swiss-modern layouts or immersive dashboards.
3. Be fully populated with the incoming Drive source data. If file data is provided, read, summarize, calculate, and present it inside the interactive elements. Generate realistic metrics corresponding to their documents. Do not write "TODO: Insert real data" (all files must be fully functional immediately).
4. Use Tailwind CSS via standard CDN (<script src="https://cdn.tailwindcss.com"></script>) inside index.html.
5. Use Lucide Icons via unpkg CDN (<script src="https://unpkg.com/lucide@latest"></script>) or SVG inline, and initialize them with <script>lucide.createIcons();</script> at the bottom of the body.
6. Create an elegant interactive Chart with Chart.js (<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>) if a dashboard is requested or data visualizers are appropriate.
7. Include a complete, detailed README.md file highlighting physical deployment configurations and steps.
8. Include a deploy-ready "wrangler.toml" file with correct modern Cloudflare Pages/Wrangler properties.
`;

    const userPrompt = `
Generate a website based on:
PROJECT TITLE: ${config.title}
CONTENT TYPE: ${config.contentType} (Choose the correct structural style: Dashboard, Interactive Slides, Executive Report, or Product Showcase)
THEME DESIGN: Theme Color: ${config.themeColor}, Accent Color: ${config.accentColor}, Font: ${config.fontPreset}
EXTRA USER SPECIFICATIONS: ${config.prompt || 'None provided'}

Source Data from Google Drive Folder:
${fileSummaries || 'No file contents found. Construct a stunning preloaded demo workspace showing off a sample with appropriate data structure matching the user theme.'}

You MUST return a JSON array containing files. Each object inside the array represents a source code file to generate.
Generate:
- index.html (with full layout, styling, CDN calls, logic)
- js/app.js (the interactive JavaScript handling state, slide triggers, chart instances, search bars)
- css/custom.css (any essential transition keyframes or special custom properties)
- wrangler.toml (Cloudflare Pages deploy config file)
- README.md (the explicit guide outlining connecting to GitHub, committing, and connecting to Cloudflare Pages)

Output EXACTLY matching the responseSchema format.
`;

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: userPrompt,
      config: {
        systemInstruction,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              name: { type: Type.STRING, description: "Relative file path (e.g., index.html, js/app.js, wrangler.toml, README.md)" },
              content: { type: Type.STRING, description: "Complete source code content for this file" },
              language: { type: Type.STRING, description: "Development language, e.g., html, css, javascript, markdown, toml" }
            },
            required: ["name", "content", "language"]
          }
        },
      }
    });

    const rawResponse = response.text;
    if (!rawResponse) {
      throw new Error("Gemini returned an empty response.");
    }
    const parsedFiles = JSON.parse(rawResponse.trim());
    res.json({ files: parsedFiles });

  } catch (error: any) {
    console.error("Gemini Generation Error:", error);
    res.status(500).json({ error: error.message || "An error occurred during Gemini code generation." });
  }
});

// Initialize server serving React + Vite
async function initServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  const PORT = 3000;
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server is running at http://localhost:${PORT}`);
  });
}

initServer();
