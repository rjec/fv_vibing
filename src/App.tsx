import React, { useState, useEffect, useRef } from "react";
import { initializeApp } from "firebase/app";
import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, User, signOut, getIdToken } from "firebase/auth";
import { Shield, LogOut, Info, Bot, Terminal, Mic, Video, Phone, Activity, Paperclip, Waves, Database, Map, Download, Github, Zap } from "lucide-react";
import JSZip from "jszip";
import firebaseConfig from "../firebase-applet-config.json";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const provider = new GoogleAuthProvider();
provider.addScope("https://www.googleapis.com/auth/drive.readonly");
provider.addScope("https://www.googleapis.com/auth/drive.file"); // required to create docs

type AccessLevel = "internal" | "staff" | "vendor" | "customer";
type LogEntry = { time: string; text: string; type: "sys" | "ai" | "user" };

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [idToken, setIdToken] = useState("");
  const [accessToken, setAccessToken] = useState(""); // Google OAuth Token
  const [authError, setAuthError] = useState<string | null>(null);

  // Access Roles
  const [accessLevel, setAccessLevel] = useState<AccessLevel>("internal");

  // Wizard State
  const [wizardStep, setWizardStep] = useState(1);
  const [wizardData, setWizardData] = useState({
    purpose: "Customer Support Bot",
    audience: "Public Customers",
    dataSources: [] as string[],
    edgeBehavior: "Voice-first / Text fallback",
    githubSync: false
  });

  // Edge Interaction State
  const [isMeetingActive, setIsMeetingActive] = useState(false);
  const [meetingTranscript, setMeetingTranscript] = useState<LogEntry[]>([]);
  const [telemetryLogs, setTelemetryLogs] = useState<LogEntry[]>([]);
  const transcriptEndRef = useRef<HTMLDivElement>(null);
  const telemetryEndRef = useRef<HTMLDivElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  
  // Generation & Files
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedFiles, setGeneratedFiles] = useState<{name: string, content: string, language: string}[]>([]);
  const [activeFileIndex, setActiveFileIndex] = useState(0);
  
  // GitHub state
  const [githubToken, setGithubToken] = useState("");
  const [githubRepo, setGithubRepo] = useState("");

  const addTelemetry = (text: string, type: "sys" | "ai" = "sys") => {
    setTelemetryLogs(prev => [...prev, { time: new Date().toISOString().split('T')[1].slice(0,8), text, type }]);
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        const token = await getIdToken(currentUser);
        setIdToken(token);
      }
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (transcriptEndRef.current) transcriptEndRef.current.scrollIntoView({ behavior: "smooth" });
  }, [meetingTranscript]);

  useEffect(() => {
    if (telemetryEndRef.current) telemetryEndRef.current.scrollIntoView({ behavior: "smooth" });
  }, [telemetryLogs]);

  const handleGoogleSignIn = async () => {
    setAuthError(null);
    try {
      const result = await signInWithPopup(auth, provider);
      const credential = GoogleAuthProvider.credentialFromResult(result);
      if (credential?.accessToken) {
        setAccessToken(credential.accessToken);
      }
    } catch (error: any) {
      setAuthError(error.message);
    }
  };

  const handleDisconnect = async () => {
    await signOut(auth);
    setUser(null);
    setAccessToken("");
  };

  const toggleDataSource = (src: string) => {
    setWizardData(prev => ({
      ...prev,
      dataSources: prev.dataSources.includes(src) 
        ? prev.dataSources.filter(s => s !== src)
        : [...prev.dataSources, src]
    }));
  };

  const startAiMeeting = () => {
    if (!idToken) return;
    setIsMeetingActive(true);
    setMeetingTranscript([]);
    
    // Stripe metering call
    fetch('/api/stripe/meter', {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${idToken}` },
      body: JSON.stringify({ account_id: user?.uid, usage_units: 1, event_type: 'edge_inference_session' })
    }).catch(console.error);

    // Setup SSE
    const es = new EventSource(`/api/meeting/stream?token=${idToken}`);
    eventSourceRef.current = es;

    es.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'ai' || data.type === 'user') {
        setMeetingTranscript(prev => [...prev, { time: new Date(data.timestamp).toISOString().split('T')[1].slice(0,8), text: data.text, type: data.type }]);
      } else if (data.type === 'sys') {
        addTelemetry(data.text, 'sys');
        if (data.text.includes("Session concluded")) {
           es.close();
           if (accessLevel === "internal" || accessLevel === "staff") {
             commitSessionToWorkspace();
           } else {
             setIsMeetingActive(false);
           }
        }
      }
    };
    
    es.onerror = (err) => {
      addTelemetry("Stream Error encountered.", "sys");
      es.close();
      setIsMeetingActive(false);
    };
  };

  const stopMeeting = () => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }
    addTelemetry("→ [WebRTC] Stream interrupted manually. Session committing to GCP...", "sys");
    commitSessionToWorkspace();
  };

  const commitSessionToWorkspace = async () => {
    if (!accessToken) {
       addTelemetry("→ Missing Google Access Token. Skipping Docs commit.", "sys");
       setIsMeetingActive(false);
       return;
    }
    try {
      const fullContent = meetingTranscript.map(m => `[${m.time}] ${m.type.toUpperCase()}: ${m.text}`).join("\n");
      const res = await fetch("/api/workspace/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${idToken}` },
        body: JSON.stringify({ transcript: fullContent, accessToken })
      });
      const data = await res.json();
      if (data.url) {
        addTelemetry(`→ Workspace Doc Created: ${data.url}`, "sys");
      }
    } catch(e) {
      addTelemetry("→ Failed to commit to Workspace.", "sys");
    } finally {
      setIsMeetingActive(false);
    }
  };

  const generateAndDeploy = async () => {
    setIsGenerating(true);
    setGeneratedFiles([]);
    addTelemetry("Initiating Engine Generation Sequence...", "sys");

    const promptPayload = `
      PURPOSE: ${wizardData.purpose}
      TARGET AUDIENCE: ${wizardData.audience}
      DATA ORIGINS: ${wizardData.dataSources.join(', ')}
      BEHAVIOR ALIGNMENT: ${wizardData.edgeBehavior}
    `;

    try {
      const res = await fetch("/api/gemini/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${idToken}` },
        body: JSON.stringify({ promptPayload, accessToken, driveFileIds: [] })
      });
      const data = await res.json();
      if (data.files) {
         setGeneratedFiles(data.files);
         addTelemetry(`Generated ${data.files.length} static edge files successfully.`, "sys");
      }
    } catch(e) {
      console.error(e);
      addTelemetry("Edge Generation Exception", "sys");
    } finally {
      setIsGenerating(false);
    }
  };

  const downloadZip = async () => {
    const zip = new JSZip();
    generatedFiles.forEach(f => zip.file(f.name, f.content));
    const blob = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "vibe-os-edge.zip";
    a.click();
  };

  const pushToGithub = async () => {
    if (!githubToken || !githubRepo) return alert("Please provide repo owner/name and token.");
    
    addTelemetry("Pushing to GitHub...", "sys");
    const [owner, repo] = githubRepo.split("/");
    try {
      const res = await fetch("/api/github/push", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${idToken}` },
        body: JSON.stringify({ files: generatedFiles, repoOwner: owner, repoName: repo, token: githubToken })
      });
      const data = await res.json();
      if (data.commitUrl) {
         addTelemetry(`GitHub Push Complete: ${data.commitUrl}`, "sys");
      }
    } catch(e) {
      addTelemetry("GitHub Push Failed", "sys");
    }
  };

  const showColumn1 = accessLevel === "internal" || accessLevel === "staff";
  const showColumn3 = accessLevel === "internal" || accessLevel === "staff" || accessLevel === "vendor";

  return (
    <div className="min-h-screen bg-[#020617] text-[#EDEDED] font-sans selection:bg-[#3b82f6]/30 relative flex flex-col">
      {/* Background Dots Pattern */}
      <div className="absolute inset-0 bg-[radial-gradient(#3b82f6_1px,transparent_1px)] [background-size:32px_32px] opacity-10 z-0 pointer-events-none"></div>
      
      {/* App Header */}
      <header className="border-b border-white/10 bg-[#020617]/90 relative z-20 shrink-0">
        <div className="w-full px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="p-2 bg-gradient-to-br from-[#3b82f6] to-[#0ea5e9] rounded-lg">
              <Map className="w-5 h-5 text-white" strokeWidth={2.5} />
            </div>
            <div>
              <h1 className="text-sm font-bold tracking-[0.2em] text-white uppercase flex items-center gap-2">Vibe-OS</h1>
              <p className="text-[10px] text-[#38bdf8] font-mono tracking-widest uppercase mt-0.5 max-w-sm drop-shadow-md">
                 Edge Compute & Data Lake Coordinator
              </p>
            </div>
            
             <select 
               value={accessLevel} 
               onChange={e => setAccessLevel(e.target.value as AccessLevel)}
               className="ml-6 bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-[10px] font-bold text-white uppercase tracking-widest outline-none"
             >
               <option value="internal">Zero-Trust Internal</option>
               <option value="staff">Operations Staff</option>
               <option value="vendor">Vendor Tunnel</option>
               <option value="customer">Public Customer Edge</option>
             </select>
          </div>
          
          <div className="flex items-center gap-4">
            {user ? (
              <div className="flex items-center gap-4">
                 {accessLevel === "internal" && (
                    <div className="flex items-center gap-2 bg-pink-500/10 px-3 py-1.5 rounded-full border border-pink-500/20 text-pink-300 text-[10px] font-bold uppercase tracking-widest shadow-inner cursor-default">
                       <Zap className="w-3.5 h-3.5" /> Metered Edge Wallet
                    </div>
                 )}
                 <div className="flex items-center gap-3 bg-white/5 border border-white/10 px-4 py-2 rounded-xl">
                   <div className="w-6 h-6 bg-gradient-to-tr from-[#3b82f6] to-[#10b981] flex justify-center items-center rounded-full text-xs font-bold text-white shadow-inner">
                     {user.displayName?.[0] || 'A'}
                   </div>
                   <div className="text-left hidden md:block">
                     <p className="text-[10px] uppercase tracking-wider font-bold text-white/90">{user.displayName}</p>
                   </div>
                   <button onClick={handleDisconnect} className="text-white/40 hover:text-white ml-2 transition-colors">
                     <LogOut className="w-4 h-4" />
                   </button>
                 </div>
              </div>
            ) : (
              <button 
                onClick={handleGoogleSignIn}
                className="bg-white text-black text-[10px] font-bold uppercase tracking-widest py-3 px-6 rounded-xl hover:bg-gray-200 transition-all flex items-center gap-2 shadow-[0_0_15px_rgba(255,255,255,0.4)]"
              >
                Authenticate Workspace
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1 w-full p-6 relative z-10 flex gap-6 min-h-0">
        {!user && (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="bg-[#0f172a] p-8 rounded-2xl border border-blue-500/30 max-w-md text-center shadow-2xl">
               <Shield className="w-12 h-12 text-blue-500 mx-auto mb-4" />
               <h2 className="text-xl font-bold mb-2">Workspace Identity Required</h2>
               <p className="text-sm text-blue-200/70 mb-6">Connect your Google Workspace Data Lake to coordinate edge deployments and access secure logs.</p>
               <button onClick={handleGoogleSignIn} className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-3 rounded-xl transition-all shadow-lg">Authenticate to Proceed</button>
            </div>
          </div>
        )}

        <div className={`w-full grid ${showColumn1 && showColumn3 ? "grid-cols-1 md:grid-cols-12" : (showColumn3 ? "grid-cols-1 md:grid-cols-10" : "grid-cols-1")} gap-6 h-full transition-all`}>
          
          {/* Column 1: Config Wizard */}
          {showColumn1 && (
             <div className="col-span-3 flex flex-col gap-4 overflow-y-auto pr-2">
                <div className="uppercase tracking-widest text-[10px] text-white/40 font-bold mb-1 ml-1 flex items-center gap-2">
                  <Terminal className="w-3.5 h-3.5" /> Prompt Generator
                </div>
                
                <div className="bg-[#0f172a] border border-blue-500/20 rounded-2xl p-5 shadow-xl flex flex-col gap-6 relative">
                   
                   <div>
                      <p className="text-[10px] uppercase font-bold text-blue-400 mb-2">Step 1: Architect Model</p>
                      <select 
                         value={wizardData.purpose} onChange={e => setWizardData({...wizardData, purpose: e.target.value})}
                         className="w-full bg-black/40 border border-blue-500/30 rounded-xl px-4 py-2.5 text-xs text-white outline-none"
                      >
                         <option>Customer Support Bot</option>
                         <option>Financial Dashboard</option>
                         <option>Content CMS</option>
                         <option>Custom Tooling</option>
                      </select>
                   </div>
                   
                   <div>
                      <p className="text-[10px] uppercase font-bold text-blue-400 mb-2">Step 2: Perimeter Audience</p>
                      <div className="flex flex-col gap-2">
                         {["Public Customers", "Internal Staff", "Vendor Tunnel"].map(mode => (
                           <label key={mode} className="flex items-center gap-3 text-xs">
                             <input type="radio" name="audience" checked={wizardData.audience === mode} onChange={() => setWizardData({...wizardData, audience: mode})} className="accent-blue-500" />
                             {mode}
                           </label>
                         ))}
                      </div>
                   </div>

                   <div>
                      <p className="text-[10px] uppercase font-bold text-blue-400 mb-2">Step 3: Connect Data Streams</p>
                      <div className="flex flex-col gap-2">
                         {["Google Drive Core", "Google Sheets Ledger", "GCP BigQuery"].map(src => (
                           <label key={src} className="flex items-center gap-3 text-xs">
                             <input type="checkbox" checked={wizardData.dataSources.includes(src)} onChange={() => toggleDataSource(src)} className="accent-blue-500" />
                             {src}
                           </label>
                         ))}
                      </div>
                   </div>
                   
                   <div>
                      <p className="text-[10px] uppercase font-bold text-blue-400 mb-2">Step 4: Edge Behavior</p>
                      <select 
                         value={wizardData.edgeBehavior} onChange={e => setWizardData({...wizardData, edgeBehavior: e.target.value})}
                         className="w-full bg-black/40 border border-blue-500/30 rounded-xl px-4 py-2.5 text-xs text-white outline-none"
                      >
                         <option>Voice-first / Stream to Cloudflare Worker</option>
                         <option>Text-first / REST API Bridge</option>
                      </select>
                   </div>

                   <button 
                     onClick={generateAndDeploy}
                     disabled={isGenerating}
                     className="mt-4 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-[11px] font-bold uppercase tracking-widest py-3 rounded-xl transition-all shadow-lg flex items-center justify-center gap-2"
                   >
                     {isGenerating ? <Activity className="w-4 h-4 animate-spin" /> : <Bot className="w-4 h-4" />}
                     {isGenerating ? "Synthesizing..." : "Generate Edge Pipeline"}
                   </button>
                </div>
             </div>
          )}

          {/* Column 2: Omni-modal Interface */}
          <div className={`${(showColumn1 && showColumn3) ? 'col-span-4' : (showColumn3 ? 'col-span-5' : 'col-span-1')} flex flex-col gap-4`}>
            <div className="uppercase tracking-widest text-[10px] text-white/40 font-bold mb-1 ml-1 flex items-center gap-2">
              <Mic className="w-3.5 h-3.5" /> Edge Voice Router
            </div>

            <div className="bg-[#1e293b] border border-blue-500/20 rounded-2xl shadow-lg flex-1 flex flex-col overflow-hidden relative">
              <div className="bg-black/40 border-b border-white/5 p-4 flex items-center justify-between">
                 <div className="flex gap-4">
                   <button 
                     onClick={isMeetingActive ? stopMeeting : startAiMeeting}
                     className={`px-6 py-2.5 rounded-full text-[10px] font-bold tracking-widest uppercase flex items-center gap-2 transition-all ${
                       isMeetingActive 
                        ? 'bg-red-500/20 text-red-400 border border-red-500/30' 
                        : 'bg-blue-500/20 text-blue-400 border border-blue-500/30 hover:bg-blue-500/30'
                     }`}
                   >
                     <Phone className="w-3.5 h-3.5" />
                     {isMeetingActive ? "Terminate" : "Begin Stream"}
                   </button>
                   {accessLevel !== "customer" && (
                     <button className="px-4 py-2.5 rounded-full text-[10px] bg-white/5 hover:bg-white/10 text-white/70 font-bold tracking-widest uppercase flex items-center gap-2 transition-all border border-white/5" onClick={() => alert("Requires Picker setup for Google Workspace")}>
                       <Paperclip className="w-3.5 h-3.5" /> Attach
                     </button>
                   )}
                 </div>
                 
                 {isMeetingActive && (
                   <div className="flex items-center gap-2 text-emerald-400 bg-emerald-400/10 px-3 py-1.5 rounded-full border border-emerald-400/20">
                     <Activity className="w-3.5 h-3.5 animate-pulse" />
                     <span className="text-[9px] font-bold tracking-widest uppercase animate-pulse">WebRTC Connected</span>
                   </div>
                 )}
              </div>

              <div className="flex-1 p-6 flex flex-col overflow-y-auto w-full">
                {meetingTranscript.length === 0 ? (
                  <div className="m-auto flex flex-col items-center opacity-30">
                    <Video className="w-12 h-12 mb-4 text-blue-400" />
                    <p className="text-xs uppercase tracking-widest text-center leading-relaxed">
                      Stateless Interface.<br/>Visual/Voice Input Only.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-4 pr-2 w-full">
                    {meetingTranscript.map((msg, i) => (
                      <div key={i} className={`flex flex-col gap-1 w-full ${msg.type === 'ai' ? 'items-start' : 'items-end'}`}>
                        <div className={`px-4 py-3 max-w-[85%] text-xs leading-relaxed rounded-2xl ${
                          msg.type === 'ai' 
                            ? 'bg-[#0f172a] border border-white/10 text-white/90 rounded-tl-sm' 
                            : 'bg-blue-600/30 border border-blue-500/30 text-blue-100 rounded-tr-sm'
                        }`}>
                          {msg.text}
                        </div>
                        <span className="text-[9px] text-white/30 font-mono tracking-widest">{msg.time}</span>
                      </div>
                    ))}
                    <div ref={transcriptEndRef} />
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Column 3: Output / Traces */}
          {showColumn3 && (
             <div className={`${showColumn1 ? 'col-span-5' : 'col-span-5'} flex flex-col gap-4 overflow-y-auto`}>
                
                <div className="flex items-center gap-2">
                   <div className="uppercase tracking-widest text-[10px] text-white/40 font-bold ml-1 flex flex-1 items-center gap-2">
                    <Database className="w-3.5 h-3.5" /> Pipeline Dashboard
                  </div>
                </div>
                
                <div className="bg-[#020617] border border-white/10 rounded-2xl shadow-xl flex-1 flex flex-col overflow-hidden relative">
                   {/* File Previewer Block */}
                   {generatedFiles.length > 0 && (
                      <div className="flex-1 flex flex-col border-b border-white/10 min-h-[300px]">
                         <div className="flex gap-2 p-3 bg-white/5 overflow-x-auto">
                           {generatedFiles.map((f, i) => (
                             <button 
                               key={i} onClick={() => setActiveFileIndex(i)}
                               className={`px-3 py-1.5 rounded-lg text-xs font-mono shrink-0 ${activeFileIndex === i ? 'bg-blue-500/20 text-blue-300 border border-blue-500/40' : 'text-white/40 hover:bg-white/5'}`}
                             >
                               {f.name}
                             </button>
                           ))}
                         </div>
                         <div className="flex-1 bg-[#0f172a] overflow-auto p-4 font-mono text-[11px] text-blue-200/80">
                            <pre><code>{generatedFiles[activeFileIndex]?.content}</code></pre>
                         </div>
                         <div className="p-3 bg-black/40 flex items-center justify-between border-t border-white/10">
                            <button onClick={downloadZip} className="flex items-center gap-2 bg-white/10 hover:bg-white/20 text-white px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-widest transition-all">
                               <Download className="w-3.5 h-3.5" /> Download ZIP
                            </button>
                            {accessLevel !== "vendor" && (
                              <div className="flex gap-2">
                                <input value={githubRepo} onChange={e => setGithubRepo(e.target.value)} placeholder="owner/repo" className="bg-black/60 border border-white/10 text-xs px-3 rounded-lg outline-none w-32 text-white" />
                                <input value={githubToken} onChange={e => setGithubToken(e.target.value)} placeholder="gh token" type="password" className="bg-black/60 border border-white/10 text-xs px-3 rounded-lg outline-none w-24 text-white" />
                                <button onClick={pushToGithub} className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-widest transition-all">
                                   <Github className="w-3.5 h-3.5" /> Push
                                </button>
                              </div>
                            )}
                         </div>
                      </div>
                   )}
                   
                   {/* Telemetry Block */}
                   <div className={`${generatedFiles.length > 0 ? 'h-48 shrink-0' : 'flex-1 min-h-[300px]'} p-5 font-mono text-[10px] leading-relaxed overflow-y-auto space-y-2.5 relative bg-[#050510]`}>
                      {telemetryLogs.map((log, index) => (
                        <div key={index} className="flex gap-3">
                          <span className="text-blue-500/40 shrink-0">[{log.time}]</span>
                          <span className="text-white/70">{log.text}</span>
                        </div>
                      ))}
                      {!telemetryLogs.length && <div className="text-white/20 italic mt-8 flex flex-col items-center"><Terminal className="w-6 h-6 mb-2 opacity-50" /> Waiting for streams...</div>}
                      <div ref={telemetryEndRef} />
                   </div>
                </div>
                
             </div>
          )}

        </div>
      </main>
    </div>
  );
}
