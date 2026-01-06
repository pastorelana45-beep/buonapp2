import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import * as Tone from 'tone';
import { 
  Music, Settings, Mic, Play, Square, Volume2, Trash2, 
  Activity, Sliders, Wand2, Disc, Headphones, 
  Download, XCircle, History, AudioWaveform, Zap, Clock, ChevronRight, CheckCircle2, ShieldCheck, Layers, ArrowLeftRight, Mic2
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
  const monitorGainRef = useRef<Tone.Gain | null>(null); // Per la nuova funzione monitor
  
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

  useEffect(() => {
    stateRef.current = { 
      mode, isRecording, isPlayingBack: !!isPlayingBack, 
      lastMidi: currentMidiNote, sensitivity, micBoost, isConfiguring
    };
    
    // Gestione monitor voce (la tua richiesta: sentire la propria voce)
    if (monitorGainRef.current) {
        monitorGainRef.current.gain.value = (mode === WorkstationMode.MONITOR) ? 1 : 0;
    }
  }, [mode, isRecording, isPlayingBack, currentMidiNote, sensitivity, micBoost, isConfiguring]);

  const initAudioCore = async () => {
    await Tone.start();
    if (synthRef.current) return true;
    
    const synth = new Tone.PolySynth(Tone.Synth).toDestination();
    const mic = new Tone.UserMedia();
    const analyser = new Tone.Analyser('waveform', 1024);
    const recorder = new Tone.Recorder();
    const monitorGain = new Tone.Gain(0).toDestination(); // Inizialmente muto
    
    try {
      await mic.open();
      mic.connect(analyser);
      mic.connect(recorder);
      mic.connect(monitorGain); // Colleghiamo il mic al monitor
      
      synthRef.current = synth;
      micRef.current = mic;
      analyserRef.current = analyser;
      recorderRef.current = recorder;
      monitorGainRef.current = monitorGain;
      
      return true;
    } catch (err) { return false; }
  };

  const startSetupWizard = async () => {
    setIsConfiguring(true);
    setSetupStep('PERMISSION');
    const success = await initAudioCore();
    if (!success) { setIsConfiguring(false); return; }
    requestAnimationFrame(audioLoop);
    setSetupStep('COMPLETE');
  };

  const stopAllAudio = () => {
    synthRef.current?.releaseAll();
    if (playerRef.current) { playerRef.current.stop(); playerRef.current.dispose(); playerRef.current = null; }
    setMode(WorkstationMode.IDLE);
    setIsPlayingBack(null);
  };

  const audioLoop = () => {
    if (!analyserRef.current || !synthRef.current || stateRef.current.isPlayingBack) {
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

    const isTrackingMidi = stateRef.current.mode === WorkstationMode.LIVE || stateRef.current.isRecording;

    if (rms > stateRef.current.sensitivity && isTrackingMidi) {
      const freq = detectPitch(buffer, Tone.getContext().sampleRate);
      const midi = freq ? frequencyToMidi(freq) : null;
      if (midi !== null && midi !== stateRef.current.lastMidi) {
        const noteName = midiToNoteName(midi);
        if (stateRef.current.lastMidi !== null) synthRef.current.triggerRelease(midiToNoteName(stateRef.current.lastMidi));
        if (stateRef.current.mode === WorkstationMode.LIVE) synthRef.current.triggerAttack(noteName);
        setCurrentMidiNote(midi);
        if (stateRef.current.isRecording) activeNoteStartRef.current = { note: noteName, start: Tone.now() - recordingStartTimeRef.current };
      }
    } else if (stateRef.current.lastMidi !== null) {
      synthRef.current.triggerRelease(midiToNoteName(stateRef.current.lastMidi));
      if (stateRef.current.isRecording && activeNoteStartRef.current) {
        const duration = Tone.now() - recordingStartTimeRef.current - activeNoteStartRef.current.start;
        recordingNotesRef.current.push({ ...activeNoteStartRef.current, duration, time: activeNoteStartRef.current.start });
        activeNoteStartRef.current = null;
      }
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
      setShowHistory(true);
    }
  };

  const playBoth = async (session: StudioSession) => {
    stopAllAudio();
    setIsPlayingBack(session.id + "_both");
    const player = new Tone.Player({
      url: session.audioUrl,
      onstop: () => setIsPlayingBack(null)
    }).toDestination();
    playerRef.current = player;
    const now = Tone.now() + 0.1;
    player.start(now);
    session.midiNotes.forEach(n => {
      synthRef.current?.triggerAttackRelease(n.note, n.duration, now + n.time);
    });
  };

  return (
    <div className="min-h-screen bg-black text-white flex flex-col items-center p-4 pb-32 max-w-lg mx-auto">
      <header className="w-full flex justify-between items-center py-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-purple-600 rounded-xl flex items-center justify-center"><Music size={24} /></div>
          <h1 className="text-lg font-black uppercase tracking-tighter">VocalSynth<span className="text-purple-500">Pro</span></h1>
        </div>
        {isStarted && <button onClick={stopAllAudio} className="p-2 bg-zinc-900 rounded-full"><XCircle size={20} /></button>}
      </header>

      {!isStarted ? (
        <button onClick={startSetupWizard} className="mt-20 px-12 py-6 bg-white text-black rounded-full font-black text-xl animate-pulse">AVVIA STUDIO</button>
      ) : (
        <div className="w-full space-y-6">
          <div className="w-full h-44 bg-zinc-950 rounded-[2.5rem] border border-white/5 flex flex-col items-center justify-center relative">
             <Mic size={48} className={rmsVolume > sensitivity ? 'text-purple-500' : 'text-zinc-800'} />
             <span className="mt-4 text-[10px] font-black uppercase text-zinc-600">
               {mode === WorkstationMode.MONITOR ? 'Voice Monitor Active' : (mode === WorkstationMode.LIVE ? 'Synth Active' : 'Idle')}
             </span>
          </div>
          
          {/* LE 3 MODALITÀ (GRID A 3) */}
          <div className="grid grid-cols-3 gap-3">
            <button 
                onClick={() => setMode(WorkstationMode.LIVE)} 
                className={`py-5 rounded-2xl font-black text-[9px] flex flex-col items-center gap-2 border-2 transition-all ${mode === WorkstationMode.LIVE ? 'bg-purple-600 border-purple-600' : 'bg-zinc-900 border-transparent'}`}
            >
              <Activity size={16} /> LIVE SYNTH
            </button>
            <button 
                onClick={() => {
                    // Se è già monitor, spegni. Altrimenti attiva.
                    setMode(mode === WorkstationMode.MONITOR ? WorkstationMode.IDLE : WorkstationMode.MONITOR);
                }} 
                className={`py-5 rounded-2xl font-black text-[9px] flex flex-col items-center gap-2 border-2 transition-all ${mode === WorkstationMode.MONITOR ? 'bg-blue-600 border-blue-600 shadow-[0_0_15px_rgba(37,99,235,0.4)]' : 'bg-zinc-900 border-transparent'}`}
            >
              <Mic2 size={16} /> MONITOR VOCE
            </button>
            <button 
                onClick={toggleRecording} 
                className={`py-5 rounded-2xl font-black text-[9px] flex flex-col items-center gap-2 border-2 transition-all ${isRecording ? 'bg-red-600 border-red-600' : 'bg-zinc-900 border-transparent'}`}
            >
              <Disc size={16} /> {isRecording ? 'STOP' : 'REC STUDIO'}
            </button>
          </div>

          {!showHistory ? (
            <div className="space-y-4">
              <div className="flex justify-between items-center"><span className="text-xs font-black uppercase text-zinc-500">Instruments</span><button onClick={() => setShowHistory(true)} className="text-purple-400 text-xs">ARCHIVE ({sessions.length})</button></div>
              <div className="grid grid-cols-2 gap-3 max-h-60 overflow-y-auto no-scrollbar">
                {INSTRUMENTS.map(inst => (
                  <button key={inst.id} onClick={() => setSelectedInstrument(inst)} className={`p-4 rounded-xl border ${selectedInstrument.id === inst.id ? 'border-purple-600 bg-zinc-900' : 'border-zinc-900'}`}>
                    <span className="text-[10px] font-bold uppercase">{inst.name}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="animate-in slide-in-from-bottom duration-300">
              <button onClick={() => setShowHistory(false)} className="mb-4 text-xs font-black text-purple-400">← TORNA AGLI STRUMENTI</button>
              {sessions.map(s => (
                <div key={s.id} className="p-4 bg-zinc-900 rounded-2xl mb-3 flex flex-col gap-3">
                  <span className="text-[10px] font-mono text-zinc-500">{s.instrumentName} - {new Date(s.timestamp).toLocaleTimeString()}</span>
                  <div className="grid grid-cols-2 gap-2">
                    <button onClick={() => playBoth(s)} className="py-3 bg-white text-black rounded-xl font-black text-[9px] flex items-center justify-center gap-2"><ArrowLeftRight size={12}/> PLAY BOTH</button>
                    <button onClick={() => deleteSession(s.id)} className="py-3 bg-zinc-800 text-red-500 rounded-xl font-black text-[9px] flex items-center justify-center gap-2"><Trash2 size={12}/> DELETE</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default App;
