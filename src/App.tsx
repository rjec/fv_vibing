import React, { useState, useEffect, useRef } from "react";
import { initializeApp } from "firebase/app";
import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, User, signOut } from "firebase/auth";
import { 
  Shield, LogOut, Info, Bot, Cloud, Terminal, Fingerprint,
  Mic, Video, Phone, Activity, Paperclip, Waves, Database
} from "lucide-react";
import firebaseConfig from "../firebase-applet-config.json";

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const provider = new GoogleAuthProvider();
provider.addScope("https://www.googleapis.com/auth/drive.readonly");

const PRESET_DATA: Record<string, { role: string, access: string, title: string }> = {
  internal: { 
    title: "Financial Paraplanner (Enterprise)",
    role: "You are an internal financial agent. Extract structured metrics (MRR, EBITDA) from edge multimedia streams. Output raw JSON for GCP Data Lake ingestion.", 
    access: "zero-trust" 
  },
  customer: { 
    title: "Omni-Channel Support (Public)",
    role: "You are an empathetic front-line support agent. Respond conversationally via synthesized voice. Rely on KV mapped knowledge base. Escalate anomalies to Workspace.", 
    access: "public" 
  }
};

type LogEntry = { time: string; text: string; type: "sys" | "ai" | "user" };

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loadingAuth, setLoadingAuth] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);

  // Prompt Engine Config
  const [presetId, setPresetId] = useState("customer");
  const [gemRole, setGemRole] = useState(PRESET_DATA.customer.role);
  const [accessLevel, setAccessLevel] = useState(PRESET_DATA.customer.access);

  // Meeting / Multimodal State
  const [isMeetingActive, setIsMeetingActive] = useState(false);
  const [meetingTranscript, setMeetingTranscript] = useState<LogEntry[]>([]);
  const [telemetryLogs, setTelemetryLogs] = useState<LogEntry[]>([]);
  const activeTimeouts = useRef<NodeJS.Timeout[]>([]);
  const transcriptEndRef = useRef<HTMLDivElement>(null);
  const telemetryEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setLoadingAuth(false);
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
      await signInWithPopup(auth, provider);
    } catch (error: any) {
      setAuthError(error.message);
    }
  };

  const handleDisconnect = async () => {
    await signOut(auth);
    setUser(null);
  };

  const handlePresetSelect = (id: string) => {
    setPresetId(id);
    const data = PRESET_DATA[id];
    setGemRole(data.role);
    setAccessLevel(data.access);
  };

  const addTelemetry = (text: string, type: "sys" | "ai" = "sys") => {
    setTelemetryLogs(prev => [...prev, { time: new Date().toISOString().split('T')[1].slice(0,8), text, type }]);
  };

  const addTranscript = (text: string, type: "user" | "ai") => {
    setMeetingTranscript(prev => [...prev, { time: new Date().toISOString().split('T')[1].slice(0,8), text, type }]);
  };

  const simulateAiMeeting = () => {
    setIsMeetingActive(true);
    setMeetingTranscript([]);
    setTelemetryLogs([]);
    activeTimeouts.current.forEach(clearTimeout);
    activeTimeouts.current = [];

    const schedule = (delay: number, action: () => void) => {
      const t = setTimeout(action, delay);
      activeTimeouts.current.push(t);
    };

    schedule(200, () => addTelemetry("→ [CF WebRTC] Edge tunnel established (Latency: 12ms)", "sys"));
    schedule(800, () => addTelemetry("→ [Workers AI] Omni-modal MCP loaded. Awaiting multimodal stream.", "sys"));
    
    // Simulating conversation
    schedule(1500, () => addTranscript("Hi, this is Jordan. I need an enterprise quote to migrate our pipeline next quarter.", "user"));
    schedule(1800, () => addTelemetry("→ [Workers AI] Streaming inference intent: 'enterprise_quote'. Horizon: 'next_quarter'.", "ai"));
    
    schedule(3500, () => addTranscript("Our current cloud egress is hovering around 500TB a month.", "user"));
    schedule(3800, () => {
      addTelemetry("→ [Workers AI] Entity Extracted: 500TB egress/month.", "ai");
      addTelemetry("→ [Pipeline] Pushing telemetry delta to GCP Data Lake...", "sys");
    });
    
    schedule(5500, () => {
      addTranscript("I've securely logged the 500TB estimate for your Q3 migration. I will compile the financial model and sync it directly to your Workspace.", "ai");
      addTelemetry("→ [Audio Gen] Synthesized TTS response sent to client edge.", "ai");
    });

    schedule(7500, () => addTelemetry("→ [GCP SDK / Docs] Document automatically drafted: 'Enterprise_Migration_Quote.gdoc'.", "sys"));
    schedule(8500, () => addTelemetry("→ [GCP SDK / Sheets] Financial backend updated with MRR projection.", "sys"));
    
    schedule(10000, () => {
      addTelemetry("→ [WebRTC] Stream terminated by user. Finalizing Workspace commit.", "sys");
      setIsMeetingActive(false);
    });
  };

  const handleStopMeeting = () => {
    activeTimeouts.current.forEach(clearTimeout);
    addTelemetry("→ [WebRTC] Stream interrupted manually. Session committed to GCP.", "sys");
    setIsMeetingActive(false);
  };

  return (
    <div className="min-h-screen bg-[#050505] text-[#EDEDED] font-sans selection:bg-[#34D399]/30 relative overflow-hidden flex flex-col">
      {/* Background gradients */}
      <div className="absolute top-1/4 left-1/4 w-[800px] h-[800px] bg-[#34D399] opacity-[0.02] blur-[150px] rounded-full pointer-events-none z-0"></div>
      <div className="absolute bottom-0 right-0 w-[600px] h-[600px] bg-[#3b82f6] opacity-[0.02] blur-[120px] rounded-full pointer-events-none z-0"></div>
      
      {/* App Header */}
      <header className="border-b border-white/5 bg-[#0A0A0A] relative z-10 shrink-0">
        <div className="w-full px-8 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="p-2.5 bg-gradient-to-br from-[#34D399] to-[#0ea5e9] rounded-xl flex items-center justify-center shadow-[0_0_30px_rgba(52,211,153,0.15)]">
              <Waves className="w-5 h-5 text-black" strokeWidth={2.5} />
            </div>
            <div>
              <h1 className="text-sm font-bold tracking-[0.2em] text-white uppercase flex items-center gap-2">
                Vibe-OS <span className="text-white/20">|</span> Edge Engine
              </h1>
              <p className="text-[10px] text-[#34D399] font-mono tracking-widest uppercase mt-0.5 opacity-80">
                Cloudflare Workers × AI Studio × Workspace Data Lake
              </p>
            </div>
          </div>
          
          <div className="flex items-center gap-4">
            {user ? (
              <div className="flex items-center gap-3 bg-white/5 border border-white/10 px-4 py-2 rounded-xl backdrop-blur">
                <div className="w-6 h-6 bg-gradient-to-tr from-[#3b82f6] to-[#d946ef] flex justify-center items-center rounded-full text-xs font-bold text-white shadow-inner">
                  {user.displayName?.[0] || 'A'}
                </div>
                <div className="text-left hidden md:block">
                  <p className="text-[11px] uppercase tracking-wider font-semibold text-white/90">{user.displayName || "Workspace Owner"}</p>
                </div>
                <button onClick={handleDisconnect} className="text-white/40 hover:text-white ml-2 transition-colors">
                  <LogOut className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <button 
                onClick={handleGoogleSignIn}
                className="bg-white text-black text-[11px] font-bold uppercase tracking-widest py-3 px-6 rounded-xl hover:bg-gray-200 transition-all flex items-center gap-2 shadow-lg"
              >
                Connect Workspace Data Lake
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1 w-full px-8 py-8 relative z-10 flex gap-6 min-h-0">
        
        {!user && (
          <div className="absolute inset-x-8 top-8 z-50 p-4 bg-orange-900/40 border border-orange-500/30 rounded-xl text-orange-200 backdrop-blur-md flex items-start gap-4 shadow-2xl">
            <Info className="w-6 h-6 shrink-0 text-orange-400" />
            <div>
              <p className="text-sm font-bold uppercase tracking-widest text-orange-400 mb-1">Identity & Routing Layer Locked</p>
              <p className="text-xs leading-relaxed max-w-4xl text-orange-200/80">
                To access the AI Studio Prompt Engine and Cloudflare Edge Pipeline, authenticate to map your Google Workspace. The edge operates completely statelessly; all long-term context and PII is persisted purely within your Workspace Data Lake via standard GCP SDK tunnels.
              </p>
            </div>
          </div>
        )}

        {/* 3-Column Vibe Architecture */}
        <div className={`w-full grid grid-cols-1 md:grid-cols-12 gap-6 h-full transition-all duration-700 ${!user ? 'opacity-20 blur-sm pointer-events-none' : ''}`}>
          
          {/* Column 1: AI Studio Config / Prompt Engine */}
          <div className="col-span-3 flex flex-col gap-4">
            <div className="uppercase tracking-widest text-[10px] text-white/40 font-bold mb-1 ml-1 flex items-center gap-2">
              <Bot className="w-3.5 h-3.5" /> AI Studio Prompt Engine
            </div>
            
            <div className="bg-white/5 border border-white/10 rounded-2xl p-5 shadow-xl flex-1 backdrop-blur-sm flex flex-col">
              <p className="text-[11px] text-white/50 leading-relaxed mb-6">
                Configure stateless behavior loaded into <code>workerd</code> isolates on Cloudflare Platforms. Interactions are handled autonomously to save centralized compute.
              </p>

              <div className="space-y-5 flex-1">
                <div>
                  <label className="block text-[9px] font-bold text-white/50 uppercase tracking-widest mb-2 flex items-center gap-2">Behavior Template</label>
                  <div className="relative">
                    <select 
                      value={presetId}
                      onChange={e => handlePresetSelect(e.target.value)}
                      className="w-full bg-black/60 border border-white/10 rounded-xl px-4 py-3 text-[11px] font-medium tracking-wide focus:border-[#34D399] outline-none text-white transition-all appearance-none"
                    >
                      <option value="internal">Enterprise FinOps Agent</option>
                      <option value="customer">Public Support Matrix</option>
                    </select>
                  </div>
                </div>

                <div className={`flex items-center gap-4 p-4 rounded-xl border ${accessLevel === 'zero-trust' ? 'bg-orange-500/5 border-orange-500/20' : 'bg-blue-500/5 border-blue-500/20'}`}>
                  <Fingerprint className={`w-5 h-5 ${accessLevel === 'zero-trust' ? 'text-orange-400' : 'text-blue-400'}`} />
                  <div>
                    <p className="text-[9px] font-bold uppercase tracking-widest text-white/50">Edge Routing Auth</p>
                    <p className={`text-[11px] font-bold mt-1 ${accessLevel === 'zero-trust' ? 'text-orange-400' : 'text-blue-400'}`}>
                      {accessLevel === 'zero-trust' ? 'Strict Zero-Trust Enforced' : 'Public Omnichannel Edge'}
                    </p>
                  </div>
                </div>
                
                <div className="flex-1 flex flex-col">
                  <label className="block text-[9px] font-bold text-white/50 uppercase tracking-widest mb-2">Deployed Prompt Payload</label>
                  <textarea 
                    value={gemRole}
                    onChange={e => setGemRole(e.target.value)}
                    className="w-full flex-1 min-h-[200px] bg-black/60 border border-white/10 rounded-xl px-4 py-4 text-[11px] focus:border-[#34D399] outline-none text-[#34D399] resize-none transition-all font-mono leading-relaxed" 
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Column 2: Multimodal Ingest (The Vibe Interface) */}
          <div className="col-span-5 flex flex-col gap-4">
            <div className="uppercase tracking-widest text-[10px] text-white/40 font-bold mb-1 ml-1 flex items-center gap-2">
              <Mic className="w-3.5 h-3.5" /> Omni-Modal Ingestion Edge
            </div>

            <div className="bg-[#0a0a0a] border border-[#3b82f6]/20 rounded-2xl shadow-[0_0_50px_rgba(59,130,246,0.05)] flex-1 flex flex-col overflow-hidden relative">
              {/* Meeting Header */}
              <div className="bg-black/80 border-b border-white/5 p-4 flex items-center justify-between">
                 <div className="flex gap-4">
                   <button 
                     onClick={isMeetingActive ? handleStopMeeting : simulateAiMeeting}
                     className={`px-6 py-2.5 rounded-full text-[10px] font-bold tracking-widest uppercase flex items-center gap-2 transition-all ${
                       isMeetingActive 
                        ? 'bg-red-500/20 text-red-400 border border-red-500/30' 
                        : 'bg-[#3b82f6]/20 text-[#3b82f6] border border-[#3b82f6]/30 hover:bg-[#3b82f6]/30'
                     }`}
                   >
                     <Phone className="w-3.5 h-3.5" />
                     {isMeetingActive ? "End Session Stream" : "Start AI Meeting"}
                   </button>
                   <button className="px-4 py-2.5 rounded-full text-[10px] bg-white/5 hover:bg-white/10 text-white/70 font-bold tracking-widest uppercase flex items-center gap-2 transition-all border border-white/5">
                     <Paperclip className="w-3.5 h-3.5" />
                     Attach File
                   </button>
                 </div>
                 
                 {isMeetingActive && (
                   <div className="flex items-center gap-2 text-[#34D399] bg-[#34D399]/10 px-3 py-1.5 rounded-full border border-[#34D399]/20">
                     <Activity className="w-3.5 h-3.5 animate-pulse" />
                     <span className="text-[9px] font-bold tracking-widest uppercase animate-pulse">WebRTC Live</span>
                   </div>
                 )}
              </div>

              {/* Streaming Area */}
              <div className="flex-1 p-6 flex flex-col bg-[url('https://www.transparenttextures.com/patterns/cubes.png')] bg-fixed" style={{ backgroundSize: '40px' }}>
                
                {meetingTranscript.length === 0 && !isMeetingActive ? (
                  <div className="flex-1 flex flex-col items-center justify-center opacity-30">
                    <Video className="w-12 h-12 mb-4" />
                    <p className="text-xs uppercase tracking-widest text-center w-2/3 leading-relaxed">
                      Stateless human interaction. Avoid manual input. <br/>Speak, visualize, or attach payloads for Edge processing.
                    </p>
                  </div>
                ) : (
                  <div className="flex-1 overflow-y-auto space-y-4 pr-2">
                    {meetingTranscript.map((msg, i) => (
                      <div key={i} className={`flex flex-col gap-1 ${msg.type === 'ai' ? 'items-start' : 'items-end'}`}>
                        <div className={`px-4 py-3 max-w-[80%] text-[12px] leading-relaxed rounded-2xl ${
                          msg.type === 'ai' 
                            ? 'bg-[#111] border border-white/10 text-white/90 rounded-tl-sm' 
                            : 'bg-[#3b82f6]/20 border border-[#3b82f6]/30 text-[#60a5fa] rounded-tr-sm'
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

          {/* Column 3: Pipeline & Workspace */}
          <div className="col-span-4 flex flex-col gap-4">
             <div className="uppercase tracking-widest text-[10px] text-white/40 font-bold mb-1 ml-1 flex items-center gap-2">
              <Database className="w-3.5 h-3.5" /> Edge-to-Workspace Routing
            </div>
            
            <div className="bg-black/90 border border-[#34D399]/20 rounded-2xl shadow-[0_0_40px_rgba(52,211,153,0.05)] flex-1 flex flex-col overflow-hidden relative">
              <div className="bg-[#111] border-b border-[#34D399]/10 p-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Terminal className="w-4 h-4 text-[#34D399]" />
                  <h3 className="font-mono text-xs text-white tracking-widest uppercase">Cloudflare Telemetry</h3>
                </div>
              </div>

              <div 
                className="flex-1 p-5 font-mono text-[10px] leading-relaxed overflow-y-auto space-y-2.5"
              >
                {telemetryLogs.length === 0 ? (
                  <div className="text-white/20 italic">Awaiting streams or file payloads...</div>
                ) : (
                  telemetryLogs.map((log, index) => (
                    <div key={index} className="flex gap-3 break-words">
                      <span className="text-[#404040] shrink-0">[{log.time}]</span>
                      <span className={`${
                        log.type === 'ai' ? 'text-[#34D399]' : 'text-white/60'
                      }`}>
                        {log.text}
                      </span>
                    </div>
                  ))
                )}
                {isMeetingActive && (
                  <div className="flex gap-3">
                    <span className="text-white/30 animate-pulse shrink-0">[{new Date().toISOString().split('T')[1].slice(0,8)}]</span>
                    <span className="text-white/30 animate-pulse tracking-widest">Listening at border server...</span>
                  </div>
                )}
                <div ref={telemetryEndRef} />
              </div>

              <div className="border-t border-white/5 bg-[#111] p-4 text-[10px] text-white/40 leading-relaxed font-medium">
                Identity: <strong>Workspace SDK</strong><br/>
                Silo: <strong>GCP Data Lake</strong><br/>
                Compute: <strong>Cloudflare Edge Workers AI Component</strong>
              </div>
            </div>
          </div>

        </div>
      </main>
    </div>
  );
}
