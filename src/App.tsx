import React, { useState, useEffect } from "react";
import { initializeApp } from "firebase/app";
import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, User, signOut } from "firebase/auth";
import { 
  Database, FolderOpen, CheckCircle2, RefreshCw, 
  Shield, LogOut, Info, Bot, Network, Download
} from "lucide-react";
import JSZip from "jszip";
import firebaseConfig from "../firebase-applet-config.json";
import { DriveFile, CrawledFileData } from "./types";

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const provider = new GoogleAuthProvider();

// Scopes required for Drive crawler
provider.addScope("https://www.googleapis.com/auth/drive.readonly");
provider.addScope("https://www.googleapis.com/auth/spreadsheets.readonly");
provider.addScope("https://www.googleapis.com/auth/documents.readonly");

const PRESET_DATA: Record<string, { role: string, tone: string, title: string }> = {
  custom: { role: "", tone: "professional", title: "Custom Gem" },
  financial: { 
    title: "Financial Data Agent",
    role: "You are an expert Financial Analysis Agent. Intercept and evaluate financial data payloads. Calculate core metrics (MRR, churn, LTV), recognize anomalies, and provide strategic insights. Follow standard GAAP reporting structures and avoid making unbacked financial guarantees.", 
    tone: "professional" 
  },
  support: { 
    title: "Customer Support Agent",
    role: "You are an empathetic, highly effective Customer Service Agent. Your objective is to resolve user issues rapidly using the provided knowledge base. Diffuse frustration, outline clear steps for resolution, and always cite specific sections from the documentation to build trust.", 
    tone: "conversational" 
  }
};

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loadingAuth, setLoadingAuth] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);

  // Gem Configuration
  const [presetId, setPresetId] = useState("support");
  const [gemName, setGemName] = useState(PRESET_DATA.support.title);
  const [gemRole, setGemRole] = useState(PRESET_DATA.support.role);
  const [gemTone, setGemTone] = useState(PRESET_DATA.support.tone);

  // Workspace configuration (Drive)
  const [driveUrlOrId, setDriveUrlOrId] = useState("");
  const [isCrawling, setIsCrawling] = useState(false);
  const [crawledFiles, setCrawledFiles] = useState<CrawledFileData[]>([]);
  const [crawlLog, setCrawlLog] = useState<string[]>([]);
  
  // Export configuration
  const [isDeploying, setIsDeploying] = useState(false);
  const [deployLogs, setDeployLogs] = useState<string[]>([]);

  // Monitor Auth with Firebase
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setLoadingAuth(false);
    });
    return () => unsubscribe();
  }, []);

  const handlePresetSelect = (id: string) => {
    setPresetId(id);
    const data = PRESET_DATA[id];
    setGemName(data.title);
    setGemRole(data.role);
    setGemTone(data.tone);
  };

  // Handle Sign-In popup with Google
  const handleGoogleSignIn = async () => {
    setAuthError(null);
    try {
      const result = await signInWithPopup(auth, provider);
      const credential = GoogleAuthProvider.credentialFromResult(result);
      if (credential?.accessToken) {
        setToken(credential.accessToken);
      } else {
        setAuthError("Could not retrieve access token. Let's try again.");
      }
    } catch (error: any) {
      console.error("Auth Failure", error);
      setAuthError(error.message || "Sign-In was blocked or cancelled. Try opening this app in a new tab.");
    }
  };

  const handleDisconnect = async () => {
    try {
      await signOut(auth);
      setUser(null);
      setToken(null);
      setCrawledFiles([]);
      setDriveUrlOrId("");
    } catch (e) {
      console.error(e);
    }
  };

  // Google Drive Crawling Logic
  const parseFolderId = (input: string) => {
    const trimmed = input.trim();
    if (!trimmed) return "";
    const urlPattern = /folders\/([a-zA-Z0-9-_]+)/;
    const match = trimmed.match(urlPattern);
    return match && match[1] ? match[1] : trimmed;
  };

  const fetchFilesInFolder = async (folderId: string): Promise<DriveFile[]> => {
    let allFiles: DriveFile[] = [];
    let pageToken = "";
    do {
      const query = encodeURIComponent(`'${folderId}' in parents and trashed = false`);
      let listUrl = `https://www.googleapis.com/drive/v3/files?q=${query}&fields=nextPageToken,files(id,name,mimeType)&pageSize=100`;
      if (pageToken) listUrl += `&pageToken=${pageToken}`;
      
      const response = await fetch(listUrl, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!response.ok) throw new Error(`HTTP ${response.status} failed to browse Drive.`);
      
      const data = await response.json();
      allFiles = allFiles.concat(data.files || []);
      pageToken = data.nextPageToken;
    } while (pageToken);
    
    return allFiles;
  };

  const traverseAndDigest = async (folderId: string, currentPath: string = ""): Promise<CrawledFileData[]> => {
    let results: CrawledFileData[] = [];
    const files = await fetchFilesInFolder(folderId);
    
    for (const file of files) {
      if (file.mimeType === "application/vnd.google-apps.folder") {
        setCrawlLog(prev => [...prev, `📂 Entering subfolder: ${currentPath}${file.name}/`]);
        const subFiles = await traverseAndDigest(file.id, `${currentPath}${file.name}/`);
        results = results.concat(subFiles);
      } else {
        setCrawlLog(prev => [...prev, `📄 Digesting: ${currentPath}${file.name}`]);
        let extractedContent = "";

        if (file.mimeType === "application/vnd.google-apps.document") {
          const docRes = await fetch(`https://docs.googleapis.com/v1/documents/${file.id}`, {
            headers: { Authorization: `Bearer ${token}` }
          });
          if (docRes.ok) {
            const docData = await docRes.json();
            const bodyContent = docData.body?.content || [];
            const textLines: string[] = [];
            bodyContent.forEach((elem: any) => {
              if (elem.paragraph) {
                elem.paragraph.elements?.forEach((el: any) => {
                  if (el.textRun?.content) textLines.push(el.textRun.content);
                });
              }
            });
            extractedContent = textLines.join("").trim();
          }
        } 
        else if (file.mimeType === "application/vnd.google-apps.spreadsheet") {
          const sheetRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${file.id}/values/A1:Z60`, {
            headers: { Authorization: `Bearer ${token}` }
          });
          if (sheetRes.ok) {
            const sheetData = await sheetRes.json();
            const rows = sheetData.values || [];
            extractedContent = rows.map((r: string[]) => r.join(",")).join("\n");
          }
        }
        else if (["text/csv", "text/plain", "application/json"].includes(file.mimeType)) {
          const mediaRes = await fetch(`https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`, {
            headers: { Authorization: `Bearer ${token}` }
          });
          if (mediaRes.ok) extractedContent = await mediaRes.text();
        }

        if (extractedContent) {
          results.push({ id: file.id, name: currentPath + file.name, mimeType: file.mimeType, content: extractedContent });
          setCrawlLog(prev => [...prev, `✅ Indexed: ${currentPath}${file.name}`]);
        }
      }
    }
    return results;
  };

  const handleCrawlDrive = async () => {
    const folderId = parseFolderId(driveUrlOrId);
    if (!folderId || !token) {
      alert("Please provide a valid Google Drive Folder ID and ensure you are signed in.");
      return;
    }

    setIsCrawling(true);
    setCrawledFiles([]);
    setCrawlLog(["Establishing connection to Google Workspace...", `Accessing root directory: ${folderId}`]);

    try {
      const parsedAssets = await traverseAndDigest(folderId);

      if (parsedAssets.length === 0) {
        setCrawlLog(prev => [...prev, "⚠️ No readable content files found in this directory tree."]);
      } else {
        setCrawledFiles(parsedAssets);
        setCrawlLog(prev => [...prev, `🎉 Knowledge matrix synchronized recursively. Total files: ${parsedAssets.length}`]);
      }
    } catch (error: any) {
      setCrawlLog(prev => [...prev, `❌ Error syncing workspace: ${error.message}`]);
    } finally {
      setIsCrawling(false);
    }
  };

  // Export Zip configuration instead of GitHub sync
  const handleExportZip = async () => {
    setIsDeploying(true);
    setDeployLogs([
      "● PREPARING ARCHIVE PAYLOAD...",
      "● COMPILING GEM INSTRUCTIONS AND KNOWLEDGE..."
    ]);

    try {
      const zip = new JSZip();
      
      // Generate a synthesized 'backend' / configuration file for the gem
      const gemConfigFile = {
        gemName,
        gemRole,
        gemTone,
        presetId,
        knowledgeBaseCount: crawledFiles.length,
        injectedKnowledge: crawledFiles.map(f => ({ name: f.name, data: f.content }))
      };

      // Payload representing our statically generated frontend for the External User
      const externalUserHtmlSnippet = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${gemName} - AI Gem Configured Edge</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { font-family: 'Inter', system-ui, sans-serif; background: #fafafa; color: #111; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; padding: 20px; box-sizing: border-box; }
    .card { background: #ffffff; border: 1px solid #eaeaea; padding: 3rem; border-radius: 16px; width: 100%; max-width: 600px; text-align: center; box-shadow: 0 10px 30px rgba(0,0,0,0.05); }
    h1 { margin-top: 0; color: #111; font-weight: 700; letter-spacing: -0.02em; }
    .badge { display: inline-block; background: #e0f2fe; color: #0284c7; font-size: 0.75rem; font-weight: 600; padding: 4px 10px; border-radius: 99px; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 1rem; }
    p { color: #555; line-height: 1.6; }
    .instructions { background: #f8fafc; border: 1px solid #e2e8f0; padding: 1.5rem; text-align: left; border-radius: 8px; font-size: 0.9rem; margin-top: 2rem; color: #334155; }
    .input-box { width: 100%; padding: 14px; margin-top: 20px; border-radius: 8px; border: 1px solid #ccc; font-size: 1rem; box-sizing: border-box; transition: border-color 0.2s; }
    .input-box:focus { border-color: #0ea5e9; outline: none; box-shadow: 0 0 0 3px rgba(14, 165, 233, 0.1); }
  </style>
</head>
<body>
  <div class="card">
    <div class="badge">Cloudflare Pages Edge Bundle</div>
    <h1>${gemName}</h1>
    <p>This front-end environment has been statically configured via the AI Studio Admin Panel.</p>
    <p>We've loaded <strong>${crawledFiles.length}</strong> knowledge base assets dynamically from your workspace into the edge context.</p>
    
    <div class="instructions">
      <strong>Core Directives:</strong><br/>
      ${gemRole}
    </div>

    <input type="text" class="input-box" placeholder="Engage with the gem..." />
  </div>
</body>
</html>`;

      zip.file("public/index.html", externalUserHtmlSnippet);
      zip.file("src/config/gem-knowledge.json", JSON.stringify(gemConfigFile, null, 2));

      setDeployLogs(prev => [...prev, "● GENERATING ZIP BLOB..."]);
      
      const content = await zip.generateAsync({ type: "blob" });
      const url = window.URL.createObjectURL(content);
      const a = document.createElement("a");
      a.href = url;
      a.download = `gem-export-${gemName.replace(/\s+/g, '-').toLowerCase()}.zip`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      setDeployLogs(prev => [
        ...prev,
        "✨ EXPORT COMPLETED SUCCESSFULLY.",
        "🎉 The Gem frontend bundle is ready for Cloudflare Pages deployment."
      ]);

    } catch (err: any) {
      setDeployLogs(prev => [...prev, `❌ Export Failed: ${err.message}`]);
    } finally {
      setIsDeploying(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#050505] text-[#EDEDED] font-sans selection:bg-[#34D399]/30 relative overflow-x-hidden">
      {/* Background gradients */}
      <div className="absolute top-[-100px] right-[-100px] w-96 h-96 bg-[#34D399] opacity-[0.03] blur-[120px] rounded-full pointer-events-none z-0"></div>
      
      {/* App Header */}
      <header className="border-b border-white/5 bg-[#0A0A0A] relative z-10">
        <div className="max-w-6xl mx-auto px-6 py-4 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-[#34D399] rounded-lg shadow-[0_0_20px_rgba(52,211,153,0.15)] flex items-center justify-center">
              <Shield className="w-5 h-5 text-black" />
            </div>
            <div>
              <h1 className="text-[15px] font-bold tracking-widest text-white uppercase flex items-center gap-2">
                Domain Manager 
              </h1>
              <p className="text-[9px] text-white/40 font-mono tracking-widest uppercase mt-0.5">
                AI Gem Admin Control Plane
              </p>
            </div>
          </div>
          
          <div className="flex items-center gap-4">
            {user ? (
              <div className="flex items-center gap-3 bg-white/5 border border-white/10 px-4 py-1.5 rounded-full shadow-inner">
                {user.photoURL ? (
                  <img src={user.photoURL} alt="Profile" className="w-6 h-6 rounded-full border border-white/20" />
                ) : (
                  <div className="w-6 h-6 bg-white/10 flex justify-center items-center rounded-full text-xs font-semibold text-white">
                    {user.displayName?.[0] || 'A'}
                  </div>
                )}
                <div className="text-left hidden md:block">
                  <p className="text-xs font-semibold">{user.displayName || "Workspace Owner"}</p>
                </div>
                <button onClick={handleDisconnect} className="text-white/40 hover:text-white ml-2 transition-colors">
                  <LogOut className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <button 
                onClick={handleGoogleSignIn}
                className="bg-white text-black text-xs font-bold py-2.5 px-6 rounded-full hover:bg-gray-200 transition-all flex items-center gap-2 shadow-lg"
              >
                Authenticate Workspace
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-10 space-y-8 relative z-10">
        
        {!user && (
          <div className="p-4 bg-orange-900/10 border border-orange-500/20 rounded-xl text-orange-200/90 text-sm flex items-start gap-4 max-w-3xl">
            <Info className="w-5 h-5 shrink-0 mt-0.5 text-orange-400" />
            <p className="text-xs leading-relaxed">
              <strong className="text-orange-400 mr-2 uppercase tracking-wide">Domain Admin Access Required.</strong> This control plane is restricted. You must sign in with your Google Workspace owner account to configure the Gem instructions, attach Google Drive knowledge assets, and export the external user frontend to the Cloudflare edge.
            </p>
          </div>
        )}

        <div className={`grid grid-cols-1 lg:grid-cols-3 gap-6 transition-all duration-500 ${!user ? 'opacity-40 grayscale pointer-events-none' : ''}`}>
          
          {/* Column 1: Gem Instructions */}
          <div className="bg-white/5 border border-white/10 rounded-2xl p-6 shadow-xl space-y-5 backdrop-blur-sm">
            <div className="flex items-center gap-3 pb-4 border-b border-white/10">
              <Bot className="w-5 h-5 text-[#34D399]" />
              <h3 className="font-bold text-xs text-white uppercase tracking-wider">Gem Settings</h3>
            </div>
            
            <div className="space-y-4">
               <div>
                <label className="block text-[10px] font-semibold text-white/50 uppercase tracking-widest mb-1.5 flex items-center gap-2">Agent Role Preset</label>
                <select 
                  value={presetId}
                  onChange={e => handlePresetSelect(e.target.value)}
                  className="w-full bg-black/40 border border-white/10 rounded-xl px-3.5 py-2.5 text-xs focus:border-[#34D399] focus:ring-1 focus:ring-[#34D399]/30 outline-none text-white transition-all appearance-none"
                >
                  <option value="financial" className="bg-[#111]">Financial Data Agent</option>
                  <option value="support" className="bg-[#111]">Customer Support Agent</option>
                  <option value="custom" className="bg-[#111]">Custom Agent</option>
                </select>
              </div>
              
              <div>
                <label className="block text-[10px] font-semibold text-white/50 uppercase tracking-widest mb-1.5 flex items-center gap-2">Gem Identity Title</label>
                <input 
                  type="text" 
                  value={gemName}
                  onChange={e => setGemName(e.target.value)}
                  placeholder="E.g., Customer Support Gem"
                  className="w-full bg-black/40 border border-white/10 rounded-xl px-3.5 py-2.5 text-xs focus:border-[#34D399] outline-none text-white transition-all" 
                />
              </div>
              <div>
                <label className="block text-[10px] font-semibold text-white/50 uppercase tracking-widest mb-1.5">System Instructions / Behavior</label>
                <textarea 
                  rows={8}
                  value={gemRole}
                  onChange={e => setGemRole(e.target.value)}
                  placeholder="You are an expert customer success manager..."
                  className="w-full bg-black/40 border border-white/10 rounded-xl px-3.5 py-2.5 text-xs focus:border-[#34D399] outline-none text-white resize-none transition-all" 
                />
              </div>
              <div>
                <label className="block text-[10px] font-semibold text-white/50 uppercase tracking-widest mb-1.5">Output Tone</label>
                <select 
                  value={gemTone}
                  onChange={e => setGemTone(e.target.value)}
                  className="w-full bg-black/40 border border-white/10 rounded-xl px-3.5 py-2.5 text-xs focus:border-[#34D399] outline-none text-white transition-all appearance-none"
                >
                  <option value="professional" className="bg-[#111]">Professional & Direct</option>
                  <option value="conversational" className="bg-[#111]">Warm & Conversational</option>
                  <option value="academic" className="bg-[#111]">Academic & Thorough</option>
                </select>
              </div>
            </div>
          </div>

          {/* Column 2: Drive Knowledge Integration */}
          <div className="bg-white/5 border border-white/10 rounded-2xl p-6 shadow-xl space-y-5 backdrop-blur-sm">
            <div className="flex items-center gap-3 pb-4 border-b border-white/10">
              <Database className="w-5 h-5 text-[#3b82f6]" />
              <h3 className="font-bold text-xs text-white uppercase tracking-wider">Workspace Knowledge Context</h3>
            </div>
            
            <p className="text-[11px] text-white/50 leading-relaxed font-medium">
              Recursively crawl secure Google Drive folders and spreadsheets into the Gem's back-end vector space.
            </p>

            <div className="space-y-3 pt-2">
              <input 
                type="text" 
                value={driveUrlOrId}
                onChange={e => setDriveUrlOrId(e.target.value)}
                placeholder="Paste Drive Folder Link or ID..."
                className="w-full bg-black/40 border border-white/10 rounded-xl px-3.5 py-2.5 text-xs focus:border-[#3b82f6] outline-none transition-all text-white" 
              />
              <button 
                onClick={handleCrawlDrive}
                disabled={isCrawling || !driveUrlOrId}
                className="w-full bg-[#3b82f6]/10 border border-[#3b82f6]/30 hover:bg-[#3b82f6]/20 text-[#3b82f6] text-xs font-bold py-2.5 px-4 rounded-xl transition-all flex justify-center items-center gap-2 disabled:opacity-50"
              >
                {isCrawling ? <RefreshCw className="w-4 h-4 animate-spin" /> : <FolderOpen className="w-4 h-4" />}
                Sync Local Workspace Assets
              </button>
            </div>

            {crawlLog.length > 0 && (
              <div className="bg-black/60 rounded-xl p-3.5 border border-white/10 max-h-40 overflow-y-auto text-[10px] font-mono text-white/70 space-y-1.5 shadow-inner">
                {crawlLog.map((log, i) => <div key={i} className={log.includes("❌") ? "text-red-400" : ""}>{log}</div>)}
              </div>
            )}
            
            {crawledFiles.length > 0 && (
              <div className="text-[10px] font-bold text-[#3b82f6] uppercase tracking-widest bg-[#3b82f6]/10 px-3 py-2 rounded-lg border border-[#3b82f6]/20 flex items-center gap-2">
                <CheckCircle2 className="w-3.5 h-3.5" />
                {crawledFiles.length} Total Base Assets Synced Successfully
              </div>
            )}
          </div>

          {/* Column 3: Edge GitOps Deploy */}
          <div className="bg-white/5 border border-white/10 rounded-2xl p-6 shadow-xl flex flex-col h-full backdrop-blur-sm">
            <div className="flex items-center gap-3 pb-4 border-b border-white/10 mb-5">
              <Network className="w-5 h-5 text-[#d946ef]" />
              <h3 className="font-bold text-xs text-white uppercase tracking-wider">Edge Artifact Export</h3>
            </div>
            
            <p className="text-[11px] text-white/50 leading-relaxed mb-4 font-medium">
              Export the synthesized back-end configs, knowledge data, and HTML artifacts as a ZIP payload. You can manually deploy this to Cloudflare Pages for the public-facing external Gem experience.
            </p>

            <button 
              onClick={handleExportZip}
              disabled={isDeploying || crawledFiles.length === 0}
              className="mt-6 w-full bg-[#d946ef] hover:bg-[#c026d3] text-white font-bold text-xs tracking-wider uppercase py-3.5 rounded-xl transition-all shadow-[0_0_15px_rgba(217,70,239,0.3)] hover:shadow-[0_0_25px_rgba(217,70,239,0.5)] flex justify-center items-center gap-2 disabled:opacity-50 disabled:shadow-none"
            >
              {isDeploying ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
              Download Cloudflare Bundle
            </button>
            
            {deployLogs.length > 0 && (
              <div className="mt-4 bg-black/60 rounded-xl p-3.5 border border-white/10 max-h-32 overflow-y-auto text-[10px] font-mono text-white/70 space-y-1.5 shadow-inner">
                {deployLogs.map((log, i) => <div key={i} className={log.startsWith("❌") ? "text-red-400 font-bold" : "text-white/60"}>{log}</div>)}
              </div>
            )}
            
            {crawledFiles.length === 0 && (
               <div className="mt-4 text-[10px] text-white/40 text-center uppercase tracking-widest border border-white/5 bg-black/20 p-2 rounded-lg">
                  Sync Drive assets first
               </div>
            )}
          </div>
          
        </div>
      </main>
    </div>
  );
}
