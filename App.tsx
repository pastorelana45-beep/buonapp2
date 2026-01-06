import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import * as Tone from 'tone';
import { 
  Music, Settings, Mic, Play, Square, Volume2, Trash2, 
  Activity, Sliders, Wand2, Disc, Headphones, 
  Download, XCircle, History, AudioWaveform, Zap, Clock, ChevronRight, CheckCircle2, ShieldCheck, Layers
} from 'lucide-react';
import { INSTRUMENTS, CATEGORIES } from './constants';
import { Instrument, Category, WorkstationMode, RecordedNote, StudioSession } from './types';
import { detectPitch, frequencyToMidi, midiToNoteName } from './services/pitchDetection';

const MIN_NOTE_DURATION = 0.02;

const App: React.FC = () => {
  const [selectedInstrument, setSelectedInstrument] = useState<Instrument>(INSTRUMENTS[0]);
  const [mode, setMode] = useState<WorkstationMode>(WorkstationMode.IDLE);
  const [isStarted, setIsStarted] = useState(false);
  const [isConfiguring, setIsConfiguring] = useState(false);
  const [setupStep, setSetupStep] = useState<'PERMISSION' | 'SILENCE' | 'VOICE' | 'COMPLETE'>('PERMISSION');
  const [currentMidiNote, setCurrentMidiNote] = useState<number | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [isLiveMonitorEnabled, setIsLiveMonitorEnabled] = useState(false); // NUOVO STATO
  const [isPlayingBack, setIsPlayingBack] = useState<string | null>(null);
  const [sessions, setSessions] = useState<StudioSession[]>([]);
  const [rmsVolume, setRmsVolume] = useState(0);
  const [sensitivity, setSensitivity] = useState(0.015);
  const [micBoost, setMicBoost] = useState(2.5);
  const [showSettings, setShowSettings] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [setupProgress, setSetupProgress] = useState(0);

  const synthRef = useRef<Tone.PolySynth | null>(null);
  const micRef = useRef<Tone.UserMedia | null>(null);
  const analyserRef = useRef<Tone.Analyser | null>(null);
  const recorderRef = useRef<Tone.Recorder | null>(null);
  const playerRef = useRef<Tone.Player | null>(null);
  
  const stateRef = useRef({ 
    mode: WorkstationMode.IDLE, 
    isRecording: false, 
    isPlayingBack: false, 
    lastMidi: null as number | null,
    sensitivity: 0.015,
    micBoost: 2.5,
    isConfiguring: false
  });
  
  const recordingNotesRef = useRef<RecordedNote[]>([]);
  const recordingStartTimeRef = useRef<number>(0);
  const activeNoteStartRef = useRef<{ note: string, start: number } | null>(null);

  const groupedInstruments = useMemo(() => {
    return INSTRUMENTS.reduce((acc, inst) => {
      if (!acc[inst.category]) acc[inst.category] = [];
      acc[inst.category].push(inst);
      return acc;
    }, {} as Record<string, Instrument[]>);
  }, []);

  useEffect(() => {
    stateRef.current = { 
      mode, isRecording, isPlayingBack: !!isPlayingBack, 
      lastMidi: currentMidiNote, sensitivity, micBoost, isConfiguring 
    };
  }, [mode, isRecording, isPlayingBack, currentMidiNote, sensitivity, micBoost, isConfiguring]);

  const applyInstrumentSettings = useCallback((instrument: Instrument) => {
    if (!synthRef.current) return;
    let settings: any = {
      oscillator: { type: 'triangle' },
      envelope: { attack: 0.01, decay: 0.1, sustain: 0.5, release: 0.5 }
    };
    // ... (manteniamo i tuoi switch case per i settaggi degli strumenti)
    synthRef.current.set(settings);
  }, []);

  const initAudioCore = async () => {
    await Tone.start();
    if (Tone.context.state !== 'running') await Tone.context.resume();
    if (synthRef.current) return true;

    const synth = new Tone.PolySynth(Tone.Synth).toDestination();
    const mic = new Tone.UserMedia();
    const analyser = new Tone.Analyser('waveform', 1024);
    const recorder = new Tone.Recorder();
    
    try {
      await mic.open();
      mic.connect(analyser);
      mic.connect(recorder);
      
      synthRef.current = synth;
      micRef.current = mic;
      analyserRef.current = analyser;
      recorderRef.current = recorder;
      
      applyInstrumentSettings(selectedInstrument);
      return true;
    } catch (err) {
      console.error("Audio init error:", err);
      return false;
    }
  };

  // FUNZIONE NUOVA PER IL MONITOR LIVE
  const toggleLiveMonitor = useCallback(() => {
    if (!micRef.current) return;
    if (!isLiveMonitorEnabled) {
      micRef.current.connect(Tone.getDestination());
      setIsLiveMonitorEnabled(true);
    } else {
      micRef.current.disconnect(Tone.getDestination());
      // Riconnetti gli indispensabili
      if (analyserRef.current) micRef.current.connect(analyserRef.current);
      if (recorderRef.current) micRef.current.connect(recorderRef.current);
      setIsLiveMonitorEnabled(false);
    }
  }, [isLiveMonitorEnabled]);

  // ... (Tutte le altre tue funzioni startSetupWizard, audioLoop, etc. rimangono invariate)

  return (
    <div className="min-h-screen bg-black text-white flex flex-col items-center p-4 pb-32 max-w-lg mx-auto overflow-x-hidden">
      {/* HEADER */}
      <header className="w-full flex justify-between items-center py-6">
         {/* ... (tuo header invariato) */}
      </header>

      {/* SETUP WIZARD (tuo wizard invariato) */}
      {isConfiguring && (
         <div className="fixed inset-0 z-[200] bg-black/95 backdrop-blur-xl flex flex-col items-center justify-center p-8">
            {/* ... */}
         </div>
      )}

      {!showHistory && isStarted && !isConfiguring && (
        <div className="w-full animate-in fade-in duration-500 flex flex-col h-[calc(100vh-180px)]">
          {/* SETTINGS (tuo settings invariato) */}
          
          {/* VISUALIZER BOX */}
          <div className="w-full h-44 bg-[#050505] rounded-[2.5rem] border border-white/5 relative overflow-hidden mb-6 flex items-center justify-center shadow-2xl group shrink-0">
             {/* ... (tuo visualizer invariato) */}
          </div>

          {/* PULSANTI DI CONTROLLO - MODIFICATI PER 3 COLONNE */}
          <div className="w-full grid grid-cols-3 gap-2 mb-8 shrink-0">
            {/* 1. LIVE PLAY (Sintetizzatore) */}
            <button 
              onClick={() => { 
                const isCurrentlyLive = mode === WorkstationMode.LIVE && !isRecording;
                if (isCurrentlyLive) {
                  setMode(WorkstationMode.IDLE);
                  synthRef.current?.releaseAll();
                } else {
                  setMode(WorkstationMode.LIVE);
                  if (isRecording) toggleRecording();
                }
              }}
              className={`py-5 rounded-3xl font-black text-[10px] transition-all border-2 flex flex-col items-center justify-center gap-1 ${mode === WorkstationMode.LIVE && !isRecording ? 'bg-purple-600 text-white border-purple-600 shadow-lg shadow-purple-500/20' : 'bg-zinc-900 text-zinc-500 border-transparent hover:bg-zinc-800 active:scale-95'}`}
            >
              <Activity size={16} /> LIVE PLAY
            </button>

            {/* 2. LIVE MONITOR (NUOVO - La tua voce live) */}
            <button 
              onClick={toggleLiveMonitor}
              className={`py-5 rounded-3xl font-black text-[10px] transition-all border-2 flex flex-col items-center justify-center gap-1 ${isLiveMonitorEnabled ? 'bg-blue-600 text-white border-blue-600 shadow-lg shadow-blue-500/20' : 'bg-zinc-900 text-zinc-500 border-transparent hover:bg-zinc-800 active:scale-95'}`}
            >
              <Headphones size={16} /> {isLiveMonitorEnabled ? 'VOICE ON' : 'LIVE VOICE'}
            </button>

            {/* 3. RECORD */}
            <button 
              onClick={() => { toggleRecording(); }}
              className={`py-5 rounded-3xl font-black text-[10px] transition-all border-2 flex flex-col items-center justify-center gap-1 ${isRecording ? 'bg-red-600 text-white border-red-600 shadow-xl shadow-red-500/30' : 'bg-zinc-900 text-zinc-500 border-transparent hover:bg-zinc-800 active:scale-95'}`}
            >
              {isRecording ? <Square size={16} fill="white" /> : <Disc size={16} />}
              {isRecording ? 'STOP REC' : 'RECORD'}
            </button>
          </div>

          {/* ... (Resto del codice: Sound Browser, Archive, etc. invariato) */}
        </div>
      )}
    </div>
  );
};

export default App;
