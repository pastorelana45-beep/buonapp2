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
  const [isLiveVoice, setIsLiveVoice] = useState(false); // Stato per LIVE 2
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
  const liveVoiceNode = useRef<Tone.Gain | null>(null); // Nodo per LIVE 2
  
  const stateRef = useRef({ 
    mode: WorkstationMode.IDLE, 
    isRecording: false, 
    isLiveVoice: false,
    sensitivity: 0.015,
    micBoost: 2.5
  });

  useEffect(() => {
    stateRef.current = { 
      mode, 
      isRecording, 
      isLiveVoice,
      sensitivity,
      micBoost
    };
  }, [mode, isRecording, isLiveVoice, sensitivity, micBoost]);

  const groupedInstruments = useMemo(() => {
    return INSTRUMENTS.reduce((acc, inst) => {
      if (!acc[inst.category]) acc[inst.category] = [];
      acc[inst.category].push(inst);
      return acc;
    }, {} as Record<string, Instrument[]>);
  }, []);

  const initAudioCore = async () => {
    await Tone.start();
    if (synthRef.current) return true;

    const synth = new Tone.PolySynth(Tone.Synth).toDestination();
    const mic = new Tone.UserMedia();
    const analyser = new Tone.Analyser('waveform', 1024);
    const recorder = new Tone.Recorder();
    const liveGain = new Tone.Gain(0).toDestination();
    
    try {
      await mic.open();
      mic.connect(analyser);
      mic.connect(recorder);
      mic.connect(liveGain);
      
      synthRef.current = synth;
      micRef.current = mic;
      analyserRef.current = analyser;
      recorderRef.current = recorder;
      liveVoiceNode.current = liveGain;
      
      return true;
    } catch (err) {
      return false;
    }
  };

  const startSetupWizard = async () => {
    setIsConfiguring(true);
    setSetupStep('PERMISSION');
    const success = await initAudioCore();
    if (!success) {
      alert("Permessi microfono necessari");
      setIsConfiguring(false);
      return;
    }
    requestAnimationFrame(audioLoop);
    setSetupStep('SILENCE');
    let p = 0;
    const interval = setInterval(() => {
      p += 10;
      setSetupProgress(p);
      if (p >= 100) {
        clearInterval(interval);
        setSetupStep('COMPLETE');
      }
    }, 200);
  };

  const audioLoop = () => {
    if (!analyserRef.current || !synthRef.current) return;

    const buffer = analyserRef.current.getValue() as Float32Array;
    let sum = 0;
    for (let i = 0; i < buffer.length; i++) {
      const boosted = buffer[i] * stateRef.current.micBoost;
      sum += boosted * boosted;
    }
    const rms = Math.sqrt(sum / buffer.length);
    setRmsVolume(rms);

    if (stateRef.current.mode === WorkstationMode.LIVE && !stateRef.current.isLiveVoice) {
      if (rms > stateRef.current.sensitivity) {
        const freq = detectPitch(buffer, Tone.getContext().sampleRate);
        const midi = freq ? frequencyToMidi(freq) : null;
        if (midi !== null) {
          const noteName = midiToNoteName(midi);
          synthRef.current.triggerAttackRelease(noteName, 0.1);
          setCurrentMidiNote(midi);
        }
      } else {
        setCurrentMidiNote(null);
      }
    }
    requestAnimationFrame(audioLoop);
  };

  const toggleLiveVoice = () => {
    if (!liveVoiceNode.current) return;
    const newState = !isLiveVoice;
    setIsLiveVoice(newState);
    if (newState) {
      setMode(WorkstationMode.IDLE);
      liveVoiceNode.current.gain.rampTo(1, 0.1);
    } else {
      liveVoiceNode.current.gain.rampTo(0, 0.1);
    }
  };

  // --- RENDERING SCHERMATE ---

  // 1. SCHERMATA INIZIALE (Come tua immagine 2)
  if (!isStarted && !isConfiguring) {
    return (
      <div className="fixed inset-0 bg-black flex flex-col items-center justify-center p-8 text-center overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-purple-900/20 to-transparent pointer-events-none" />
        <div className="relative mb-10">
          <div className="absolute inset-0 bg-purple-600 blur-[100px] opacity-20 animate-pulse" />
          <div className="w-28 h-28 bg-white text-black rounded-[3rem] flex items-center justify-center shadow-2xl relative rotate-3">
            <Music className="w-14 h-14" />
          </div>
        </div>
        <h2 className="text-5xl font-black mb-4 tracking-tighter uppercase italic leading-none text-white">
          VOCALSTUDIO<br/><span className="text-purple-500">PRO</span>
        </h2>
        <p className="text-zinc-500 text-sm mb-12 max-w-[280px] leading-relaxed font-medium italic">
          Your voice is the ultimate instrument. Grouped by nature, refined by synthesis.
        </p>
        
        <button 
          onClick={startSetupWizard}
          className="w-full max-w-xs bg-white text-black py-7 rounded-full font-black text-xl hover:scale-105 active:scale-95 transition-all uppercase tracking-tighter shadow-2xl flex items-center justify-center gap-3"
        >
          CONFIGURA MICROFONO <ChevronRight size={24} />
        </button>
        
        <div className="mt-12 flex items-center gap-6 text-[9px] font-black uppercase text-zinc-700 tracking-widest">
          <div className="flex items-center gap-2"><Layers size={12} /> CATEGORIZED</div>
          <div className="flex items-center gap-2"><Disc size={12} /> RECORD READY</div>
          <div className="flex items-center gap-2"><Activity size={12} /> NOISE GATE</div>
        </div>
      </div>
    );
  }

  // 2. SCHERMATA CARICAMENTO/CALIBRAZIONE
  if (isConfiguring) {
    return (
      <div className="fixed inset-0 bg-black flex flex-col items-center justify-center p-8">
         <h3 className="text-white text-xl font-black mb-8 uppercase tracking-widest">{setupStep}</h3>
         <div className="w-full max-w-xs h-2 bg-zinc-800 rounded-full overflow-hidden">
            <div className="h-full bg-purple-500 transition-all duration-300" style={{width: `${setupProgress}%`}} />
         </div>
         {setupStep === 'COMPLETE' && (
           <button onClick={() => {setIsConfiguring(false); setIsStarted(true);}} className="mt-10 bg-white text-black px-10 py-4 rounded-full font-bold">ENTRA</button>
         )}
      </div>
    );
  }

  // 3. STUDIO PRINCIPALE CON BOTTONE LIVE 2
  return (
    <div className="min-h-screen bg-black text-white p-4 pb-32 max-w-lg mx-auto">
      <header className="flex justify-between items-center py-6">
         <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-purple-600 rounded-xl flex items-center justify-center"><Music size={24} /></div>
            <h1 className="font-black uppercase tracking-tighter">VocalSynth<span className="text-purple-500">Pro</span></h1>
         </div>
         <button onClick={() => setShowSettings(!showSettings)} className="p-2 bg-zinc-900 rounded-full"><Settings size={20} /></button>
      </header>

      {/* Visualizer */}
      <div className="w-full h-40 bg-zinc-950 rounded-[2rem] border border-white/5 mb-6 flex items-center justify-center relative overflow-hidden">
          <Mic size={40} className={`${rmsVolume > sensitivity ? 'text-white scale-110' : 'text-zinc-800'} transition-all`} />
          {isLiveVoice && <div className="absolute top-4 right-6 text-[10px] text-blue-400 font-bold animate-pulse">LIVE 2 ATTIVO</div>}
      </div>

      {/* Grid Bottoni con LIVE 2 */}
      <div className="grid grid-cols-3 gap-3 mb-8">
        <button 
          onClick={() => {setMode(WorkstationMode.LIVE); setIsLiveVoice(false); liveVoiceNode.current?.gain.setTargetAtTime(0, Tone.now(), 0.1);}}
          className={`py-4 rounded-2xl font-black text-[10px] flex flex-col items-center gap-2 border-2 transition-all ${mode === WorkstationMode.LIVE && !isLiveVoice ? 'bg-purple-600 border-purple-600' : 'bg-zinc-900 border-transparent text-zinc-500'}`}
        >
          <Activity size={18} /> LIVE PLAY
        </button>

        <button 
          onClick={toggleLiveVoice}
          className={`py-4 rounded-2xl font-black text-[10px] flex flex-col items-center gap-2 border-2 transition-all ${isLiveVoice ? 'bg-blue-600 border-blue-600 text-white shadow-lg shadow-blue-500/20' : 'bg-zinc-900 border-transparent text-zinc-500'}`}
        >
          <Headphones size={18} /> LIVE 2
        </button>

        <button 
          onClick={() => setMode(isRecording ? WorkstationMode.IDLE : WorkstationMode.RECORD)}
          className={`py-4 rounded-2xl font-black text-[10px] flex flex-col items-center gap-2 border-2 transition-all ${isRecording ? 'bg-red-600 border-red-600' : 'bg-zinc-900 border-transparent text-zinc-500'}`}
        >
          <Disc size={18} /> RECORD
        </button>
      </div>

      {/* Sound Browser */}
      <div className="space-y-4">
        <p className="text-[10px] font-black uppercase text-zinc-500 tracking-widest px-2">Instruments</p>
        <div className="grid grid-cols-2 gap-3">
          {INSTRUMENTS.slice(0, 6).map(inst => (
            <button 
              key={inst.id}
              onClick={() => setSelectedInstrument(inst)}
              className={`p-4 rounded-2xl border-2 text-left transition-all ${selectedInstrument.id === inst.id ? 'border-purple-600 bg-zinc-900' : 'border-zinc-900 text-zinc-600'}`}
            >
              <div className="text-[10px] font-bold uppercase">{inst.name}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Status Bar */}
      <div className="fixed bottom-6 left-4 right-4 bg-zinc-900 border border-white/10 p-4 rounded-3xl flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${isLiveVoice ? 'bg-blue-600' : 'bg-purple-600'}`}>
            {isLiveVoice ? <Headphones size={20} /> : <Music size={20} />}
          </div>
          <div>
            <div className="text-[10px] font-black uppercase">{isLiveVoice ? 'Live Voice 2' : selectedInstrument.name}</div>
            <div className="text-[9px] font-mono text-zinc-500">{currentMidiNote ? midiToNoteName(currentMidiNote) : '--'}</div>
          </div>
        </div>
        <div className="text-2xl font-black text-purple-500 italic">
          {currentMidiNote ? midiToNoteName(currentMidiNote).replace(/\d+/, '') : '--'}
        </div>
      </div>
    </div>
  );
};

export default App;
