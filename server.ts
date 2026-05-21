import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";
import * as admin from "firebase-admin";
import { google } from "googleapis";

dotenv.config();

// Attempt Firebase Admin Initialization
try {
  if (admin.apps.length === 0) {
    admin.initializeApp();
  }
} catch (e) {
  console.log("Firebase Admin SDK failed to initialize:", e);
}

const app = express();
app.use(express.json({ limit: "50mb" }));

// Middleware to protect routes with Firebase ID token
const authenticateUser = async (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Unauthorized: Missing Bearer token" });
  }
  
  const idToken = authHeader.split("Bearer ")[1];
  try {
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    (req as any).user = decodedToken;
    next();
  } catch (error) {
    console.error("Firebase ID verification error:", error);
    return res.status(401).json({ error: "Unauthorized: Invalid token" });
  }
};

// Rate limiting map per account ID
const rateLimitMap = new Map<string, number[]>();
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour

const checkRateLimit = (accountId: string): boolean => {
  const now = Date.now();
  const timestamps = rateLimitMap.get(accountId) || [];
  const windowTimestamps = timestamps.filter(ts => now - ts < RATE_LIMIT_WINDOW_MS);
  
  if (windowTimestamps.length >= RATE_LIMIT_MAX) {
    return false;
  }
  
  windowTimestamps.push(now);
  rateLimitMap.set(accountId, windowTimestamps);
  return true;
};

// ==========================================
// ENDPOINTS
// ==========================================

// 1. /api/gemini/generate
app.post("/api/gemini/generate", authenticateUser, async (req, res) => {
  try {
    const { promptPayload, accessToken, driveFileIds } = req.body;
    const user = (req as any).user;
    
    if (!checkRateLimit(user.uid)) {
      return res.status(429).json({ error: "Rate limit exceeded (10 per hour)." });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return res.status(500).json({ error: "GEMINI_API_KEY is not configured." });

    // Fetch drive file contents if any
    let fileSummaries = "";
    if (driveFileIds && driveFileIds.length > 0 && accessToken) {
      const oauth2Client = new google.auth.OAuth2();
      oauth2Client.setCredentials({ access_token: accessToken });
      const drive = google.drive({ version: 'v3', auth: oauth2Client });
      
      for (const fileId of driveFileIds) {
        try {
          const fileMeta = await drive.files.get({ fileId, fields: "name, mimeType" });
          const fileContent = await drive.files.get({ fileId, alt: "media" }, { responseType: "text" });
          fileSummaries += `\n--- INCOMING DRIVE SOURCE FILE: ${fileMeta.data.name} ---\n${fileContent.data}\n`;
        } catch (e: any) {
          console.error("Error fetching drive file:", e.message);
        }
      }
    }

    const ai = new GoogleGenAI({ apiKey });
    
    const systemInstruction = `You are Vibe-OS Builder. Generate a fully configured Cloudflare Pages edge site.
Return an array of files representing the requested application.
Include: index.html, (optional js/css), README.md, and wrangler.toml.
The wrangler.toml should be standard for Cloudflare Pages (name="generated-edge-site", compatibility_date).`;

    const userPrompt = `
Generate the edge site based on this pipe definition:
${promptPayload}

Source Data from Google Workspace Data Lakes:
${fileSummaries || "No source files attached. Build from prompt."}

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
              name: { type: Type.STRING, description: "Relative file path (e.g., index.html, wrangler.toml, README.md)" },
              content: { type: Type.STRING, description: "Complete source code content for this file" },
              language: { type: Type.STRING, description: "Development language, e.g., html, css, javascript, markdown, toml" }
            },
            required: ["name", "content", "language"]
          }
        },
      }
    });

    const parsedFiles = JSON.parse(response.text || "[]");
    res.json({ files: parsedFiles });
  } catch (error: any) {
    console.error("Generate Error:", error);
    res.status(500).json({ error: error.message });
  }
});

// 2. /api/meeting/stream
app.get("/api/meeting/stream", async (req, res) => {
  // We should read auth token from query params since EventSource doesn't support custom headers easily natively
  const token = req.query.token as string;
  let userId = "anonymous";
  
  if (token) {
    try {
      const decoded = await admin.auth().verifyIdToken(token);
      userId = decoded.uid;
      if (!checkRateLimit(userId)) {
        return res.status(429).json({ error: "Rate limit exceeded." });
      }
    } catch (e) {
      return res.status(401).json({ error: "Unauthorized: Invalid token in query string" });
    }
  } else {
    return res.status(401).json({ error: "Unauthorized: Missing token in query string" });
  }

  // Setup SSE
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive"
  });

  const sendEvent = (type: string, text: string) => {
    res.write(`data: ${JSON.stringify({ type, text, timestamp: new Date().toISOString() })}\n\n`);
  };

  sendEvent("sys", "→ [CF WebRTC] Edge socket opened...");
  sendEvent("sys", "→ [Workers AI] Multimodal stream started. Generating conversation...");

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    sendEvent("sys", "ERROR: GEMINI_API_KEY missing.");
    res.end();
    return;
  }

  try {
    const ai = new GoogleGenAI({ apiKey });
    
    // Simulate streaming by generating a short meeting script via stream
    sendEvent("sys", "→ Negotiating Live API WebRTC... connected.");
    
    const responseStream = await ai.models.generateContentStream({
      model: "gemini-3.5-flash",
      contents: "Start a short conversational tech support meeting roleplay. Two turns only. Output text as conversation transcript deltas."
    });

    let fullTranscript = "";
    for await (const chunk of responseStream) {
      if (chunk.text) {
        fullTranscript += chunk.text;
        sendEvent("ai", chunk.text);
      }
    }

    sendEvent("sys", "→ [WebRTC] Stream terminated. End of inference.");
    // In a real scenario with WebSockets we would wait. Here we end after generating the mock conversational exchange.
    sendEvent("sys", "→ Session concluded. Trigger Workspace commit.");
    res.end();

  } catch (error: any) {
    console.error("Live API Error:", error);
    sendEvent("sys", "Error: " + error.message);
    res.end();
  }
});

// 3. /api/workspace/commit
app.post("/api/workspace/commit", authenticateUser, async (req, res) => {
  try {
    const { transcript, accessToken } = req.body;
    if (!accessToken) return res.status(400).json({ error: "Missing Google Workspace accessToken" });

    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: accessToken });
    const docs = google.docs({ version: 'v1', auth: oauth2Client });
    const drive = google.drive({ version: 'v3', auth: oauth2Client });

    const title = `Vibelog: ${new Date().toISOString().split('T')[0]}`;

    // Create a new document in Drive Root
    const createRes = await docs.documents.create({ requestBody: { title } });
    const documentId = createRes.data.documentId!;

    // Append transcript
    await docs.documents.batchUpdate({
      documentId,
      requestBody: {
        requests: [
           { insertText: { location: { index: 1 }, text: transcript } }
        ]
      }
    });

    res.json({ documentId, url: `https://docs.google.com/document/d/${documentId}/edit` });
  } catch (error: any) {
    console.error("Workspace Commit Error:", error);
    res.status(500).json({ error: error.message });
  }
});

// 4. /api/workspace/blueprint
app.post("/api/workspace/blueprint", authenticateUser, async (req, res) => {
  try {
    const { accessToken, intentPrompt } = req.body;
    if (!accessToken) return res.status(400).json({ error: "Missing Google Workspace accessToken" });

    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: accessToken });
    const sheets = google.sheets({ version: 'v4', auth: oauth2Client });
    const drive = google.drive({ version: 'v3', auth: oauth2Client });

    const title = `ISO/SOC2 Enterprise Blueprint`;

    // Create a new spreadsheet
    const createRes = await sheets.spreadsheets.create({ 
      requestBody: { 
        properties: { title },
        sheets: [
          { properties: { title: "Tech Stack" } },
          { properties: { title: "Data Silos" } },
          { properties: { title: "Integrations" } }
        ]
      } 
    });
    
    const spreadsheetId = createRes.data.spreadsheetId!;

    // Add intent prompt to the first sheet
    if (intentPrompt) {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: "Tech Stack!A1:B2",
        valueInputOption: "RAW",
        requestBody: {
          values: [
            ["Business Intent", intentPrompt],
            ["Generated Date", new Date().toISOString()]
          ]
        }
      });
    }

    res.json({ spreadsheetId, url: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit` });
  } catch (error: any) {
    console.error("Workspace Blueprint Error:", error);
    res.status(500).json({ error: error.message });
  }
});

// ==========================================

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

  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Server is running at http://localhost:${PORT}`);
  });
}

initServer();
