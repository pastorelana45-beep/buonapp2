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

const MIN_NOTE_DURATION = 0.02; // 20ms minima durata per evitare errori di Tone.js

const App: React.FC = () => {
  const [selectedInstrument, setSelectedInstrument] = useState<Instrument>(INSTRUMENTS[0]);
  const [mode, setMode] = useState<WorkstationMode>(WorkstationMode.IDLE);
  const [isStarted, setIsStarted] = useState(false);
  const [isConfiguring, setIsConfiguring] = useState(false);
  const [setupStep, setSetupStep] = useState<'PERMISSION' | 'SILENCE' | 'VOICE' | 'COMPLETE'>('PERMISSION');
  const [currentMidiNote, setCurrentMidiNote] = useState<number | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [isLiveVoice, setIsLiveVoice] = useState(false); // NUOVO: Stato per Live 2
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
  const liveVoiceNode = useRef<Tone.Gain | null>(null); // NUOVO: Nodo per il passaggio diretto
  
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
      if (!acc[inst.category]) {
        acc[inst.category] = [];
      }
      acc[inst.category].push(inst);
      return acc;
    }, {} as Record<string, Instrument[]>);
  }, []);

  useEffect(() => {
    stateRef.current = { 
      mode, 
      isRecording, 
      isPlayingBack: !!isPlayingBack, 
      lastMidi: currentMidiNote,
      sensitivity,
      micBoost,
      isConfiguring
    };
  }, [mode, isRecording, isPlayingBack, currentMidiNote, sensitivity, micBoost, isConfiguring]);

  const applyInstrumentSettings = useCallback((instrument: Instrument) => {
    if (!synthRef.current) return;
    let settings: any = {
      oscillator: { type: 'triangle' },
      envelope: { attack: 0.01, decay: 0.1, sustain: 0.5, release: 0.5 }
    };
    // ... (Logica settings invariata)
    synthRef.current.set(settings);
  }, []);

  useEffect(() => {
    applyInstrumentSettings(selectedInstrument);
  }, [selectedInstrument, applyInstrumentSettings]);

  const initAudioCore = async () => {
    await Tone.start();
    if (Tone.context.state !== 'running') {
      await Tone.context.resume();
    }
    
    if (synthRef.current) return true;

    const synth = new Tone.PolySynth(Tone.Synth).toDestination();
    const mic = new Tone.UserMedia();
    const analyser = new Tone.Analyser('waveform', 1024);
    const recorder = new Tone.Recorder();
    const liveGain = new Tone.Gain(0).toDestination(); // Inizialmente muto
    
    try {
      await mic.open();
      mic.connect(analyser);
      mic.connect(recorder);
      mic.connect(liveGain); // Collega il mic al nodo live
      
      synthRef.current = synth;
      micRef.current = mic;
      analyserRef.current = analyser;
      recorderRef.current = recorder;
      liveVoiceNode.current = liveGain;
      
      applyInstrumentSettings(selectedInstrument);
      return true;
    } catch (err) {
      console.error("Audio init error:", err);
      return false;
    }
  };

  // Funzione per attivare/disattivare il segnale diretto alle casse
  const toggleLiveVoice = () => {
    if (!liveVoiceNode.current) return;
    
    const newState = !isLiveVoice;
    setIsLiveVoice(newState);
    
    // Se attiviamo Live 2, disattiviamo il synth live per pulizia
    if (newState) {
      setMode(WorkstationMode.IDLE);
      synthRef.current?.releaseAll();
      liveVoiceNode.current.gain.rampTo(1, 0.1); // Volume a 1
    } else {
      liveVoiceNode.current.gain.rampTo(0, 0.1); // Mute
    }
  };

  const startSetupWizard = async () => {
    setIsConfiguring(true);
    setSetupStep('PERMISSION');
    const success = await initAudioCore();
    if (!success) {
      alert("Errore microfono.");
      setIsConfiguring(false);
      return;
    }
    requestAnimationFrame(audioLoop);
    setSetupStep('SILENCE');
    setTimeout(() => { setSetupStep('VOICE'); startVoiceCalibration(); }, 2000);
  };

  const startVoiceCalibration = () => {
    setTimeout(() => setSetupStep('COMPLETE'), 3000);
  };

  const finishSetup = () => {
    setIsConfiguring(false);
    setIsStarted(true);
  };

  const stopAllAudio = () => {
    synthRef.current?.releaseAll();
    liveVoiceNode.current?.gain.setValueAtTime(0, Tone.now());
    setIsLiveVoice(false);
    if (playerRef.current) {
        playerRef.current.stop();
        playerRef.current.dispose();
        playerRef.current = null;
    }
    if (isRecording) toggleRecording();
    setMode(WorkstationMode.IDLE);
    setIsPlayingBack(null);
    setCurrentMidiNote(null);
  };

  const audioLoop = () => {
    if (!analyserRef.current || !synthRef.current) return;
    if (stateRef.current.isPlayingBack) {
      requestAnimationFrame(audioLoop);
      return;
    }

    const buffer = analyserRef.current.getValue() as Float32Array;
    let sum = 0;
    for (let i = 0; i < buffer.length; i++) {
      const boostedSample = buffer[i] * stateRef.current.micBoost;
      sum += boostedSample * boostedSample;
    }
    const rms = Math.sqrt(sum / buffer.length);
    setRmsVolume(prev => prev * 0.7 + rms * 0.3);

    const shouldHearSynth = stateRef.current.mode === WorkstationMode.LIVE && !stateRef.current.isRecording;

    if (rms > stateRef.current.sensitivity) {
      const freq = detectPitch(buffer, Tone.getContext().sampleRate);
      const midi = freq ? frequencyToMidi(freq) : null;

      if (midi !== null && midi !== stateRef.current.lastMidi) {
        const noteName = midiToNoteName(midi);
        if (stateRef.current.lastMidi !== null) {
          synthRef.current.triggerRelease(midiToNoteName(stateRef.current.lastMidi));
        }
        if (shouldHearSynth) synthRef.current.triggerAttack(noteName);
        setCurrentMidiNote(midi);
      }
    } else if (stateRef.current.lastMidi !== null) {
      synthRef.current.triggerRelease(midiToNoteName(stateRef.current.lastMidi));
      setCurrentMidiNote(null);
    }

    requestAnimationFrame(audioLoop);
  };

  const toggleRecording = async () => {
    if (!isRecording) {
      recordingNotesRef.current = [];
      recordingStartTimeRef.current = Tone.now();
      recorderRef.current?.start();
      setIsRecording(true);
      setMode(WorkstationMode.RECORD);
    } else {
      const audioBlob = await recorderRef.current?.stop();
      if (!audioBlob) return;
      const url = URL.createObjectURL(audioBlob);
      const newSession: StudioSession = {
        id: Math.random().toString(36).substr(2, 9),
        timestamp: Date.now(),
        midiNotes: [...recordingNotesRef.current],
        audioUrl: url,
        instrumentName: selectedInstrument.name
      };
      setSessions(prev => [newSession, ...prev]);
      setIsRecording(false);
      setMode(WorkstationMode.IDLE);
    }
  };

  const safeMidiToNoteName = (midi: number | null) => {
    if (midi === null) return "--";
    return midiToNoteName(midi) || "--";
  };

  const getCleanNote = (midi: number | null) => {
    const name = safeMidiToNoteName(midi);
    return name === "--" ? "--" : String(name).replace(/\d+/g, '');
  };

  return (
    <div className="min-h-screen bg-black text-white flex flex-col items-center p-4 pb-32 max-w-lg mx-auto overflow-x-hidden">
      
      <header className="w-full flex justify-between items-center py-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-purple-600 rounded-xl flex items-center justify-center shadow-lg">
            <Music className="w-6 h-6" />
          </div>
          <h1 className="text-lg font-black uppercase">VocalSynth<span className="text-purple-500">Pro</span></h1>
        </div>
        {(isStarted || isConfiguring) && (
          <button onClick={() => setShowSettings(!showSettings)} className="p-2 bg-zinc-900 rounded-full"><Settings size={20} /></button>
        )}
      </header>

      {/* SETUP WIZARD (Omitted for brevity, keep your original) */}

      {!showHistory && isStarted && !isConfiguring && (
        <div className="w-full flex flex-col h-[calc(100vh-180px)]">
          {/* DISPLAY VISUALIZER */}
          <div className="w-full h-44 bg-[#050505] rounded-[2.5rem] border border-white/5 relative overflow-hidden mb-6 flex items-center justify-center shadow-2xl shrink-0">
            <div className="flex flex-col items-center z-10">
              <div className={`transition-transform ${rmsVolume > sensitivity ? 'scale-110' : 'scale-100'}`}>
                <Mic size={48} className={isLiveVoice ? 'text-blue-400' : (rmsVolume > sensitivity ? 'text-white' : 'text-zinc-800')} />
              </div>
              <div className="mt-4 text-[10px] font-mono text-zinc-500 uppercase tracking-widest">
                {isLiveVoice ? 'LIVE VOICE 2 ACTIVE' : (isRecording ? 'Recording' : 'Standby')}
              </div>
            </div>
          </div>

          {/* CONTROLLI PRINCIPALI AGGIORNATI */}
          <div className="w-full grid grid-cols-3 gap-3 mb-8 shrink-0">
            <button 
              onClick={() => { 
                if (mode === WorkstationMode.LIVE) {
                  setMode(WorkstationMode.IDLE);
                  synthRef.current?.releaseAll();
                } else {
                  setMode(WorkstationMode.LIVE);
                  setIsLiveVoice(false);
                  liveVoiceNode.current?.gain.rampTo(0, 0.1);
                }
              }}
              className={`py-4 rounded-2xl font-black text-[10px] transition-all border-2 flex flex-col items-center justify-center gap-1 ${mode === WorkstationMode.LIVE ? 'bg-purple-600 border-purple-600' : 'bg-zinc-900 border-transparent text-zinc-500'}`}
            >
              <Activity size={16} /> LIVE PLAY
            </button>

            <button 
              onClick={toggleLiveVoice}
              className={`py-4 rounded-2xl font-black text-[10px] transition-all border-2 flex flex-col items-center justify-center gap-1 ${isLiveVoice ? 'bg-blue-600 border-blue-600 text-white shadow-lg shadow-blue-500/20' : 'bg-zinc-900 border-transparent text-zinc-500'}`}
            >
              <Headphones size={16} /> LIVE 2
            </button>

            <button 
              onClick={toggleRecording}
              className={`py-4 rounded-2xl font-black text-[10px] transition-all border-2 flex flex-col items-center justify-center gap-1 ${isRecording ? 'bg-red-600 border-red-600' : 'bg-zinc-900 border-transparent text-zinc-500'}`}
            >
              {isRecording ? <Square size={16} fill="white" /> : <Disc size={16} />}
              {isRecording ? 'STOP' : 'REC'}
            </button>
          </div>

          {/* SOUND BROWSER (Keep your original) */}
          <div className="w-full flex-grow overflow-y-auto no-scrollbar pb-10">
              {/* Mappa degli strumenti qui... */}
          </div>
        </div>
      )}

      {/* STATUS BAR PERSISTENTE */}
      {isStarted && (
        <div className="fixed bottom-8 left-4 right-4 bg-zinc-900/95 backdrop-blur-xl border border-white/10 p-4 rounded-[2.5rem] flex items-center justify-between z-[60]">
          <div className="flex items-center gap-3">
            <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${isLiveVoice ? 'bg-blue-600' : (isRecording ? 'bg-red-600' : 'bg-purple-600')}`}>
              {isLiveVoice ? <Volume2 size={20} /> : <Music size={20} />}
            </div>
            <div>
              <div className="text-[10px] font-black uppercase">{isLiveVoice ? 'Live Voice (Direct)' : 'Synth Monitor'}</div>
              <div className="text-[9px] font-mono text-zinc-500 uppercase">{safeMidiToNoteName(currentMidiNote)}</div>
            </div>
          </div>
          <div className="text-3xl font-black italic text-purple-500">{getCleanNote(currentMidiNote)}</div>
        </div>
      )}

      {/* START SCREEN (Keep your original) */}
      
      <style>{`
        .no-scrollbar::-webkit-scrollbar { display: none; }
        .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
      `}</style>
    </div>
  );
};

export default App;
