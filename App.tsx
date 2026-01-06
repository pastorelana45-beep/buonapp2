import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import * as Tone from 'tone';
import { 
  Music, Settings, Mic, Play, Square, Volume2, Trash2, 
  Activity, Sliders, Wand2, Disc, Headphones, 
  Download, XCircle, History, AudioWaveform, Zap, Clock, ChevronRight, CheckCircle2, ShieldCheck, Layers, ArrowLeftRight, Mic2
} from 'lucide-react';
import { INSTRUMENTS } from './constants';
import { Instrument, WorkstationMode, RecordedNote, StudioSession } from './types';
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

  const synthRef = useRef<Tone.PolySynth | null>(null);
  const micRef = useRef<Tone.UserMedia | null>(null);
  const analyserRef = useRef<Tone.Analyser | null>(null);
  const recorderRef = useRef<Tone.Recorder | null>(null);
  const playerRef = useRef<Tone.Player | null>(null);
  const monitorGainRef = useRef<Tone.Gain | null>(null);
  
  const stateRef = useRef({ 
    mode: WorkstationMode.IDLE, 
    isRecording: false, 
    isPlayingBack: false, 
    lastMidi: null as number | null,
    sensitivity: 0.015,
    micBoost: 2.5
  });
  
  const recordingNotesRef = useRef<RecordedNote[]>([]);
  const recordingStartTimeRef = useRef<number>(0);
  const activeNoteStartRef = useRef<{ note: string, start: number } | null>(null);

  useEffect(() => {
    stateRef.current = { 
      mode, isRecording, isPlayingBack: !!isPlayingBack, 
      lastMidi: currentMidiNote, sensitivity, micBoost
    };
    
    // Gestione tempo reale del Monitor Voce
    if (monitorGainRef.current) {
        monitorGainRef.current.gain.rampTo(mode === WorkstationMode.MONITOR ? 1 : 0, 0.1);
    }
  }, [mode, isRecording, isPlayingBack, currentMidiNote, sensitivity, micBoost]);

  const initAudioCore = async () => {
    await Tone.start();
    if (synthRef.current) return true;
    
    const synth = new Tone.PolySynth(Tone.Synth).toDestination();
    const mic = new Tone.UserMedia();
    const analyser = new Tone.Analyser('waveform', 1024);
    const recorder = new Tone.Recorder();
    const monitorGain = new Tone.Gain(0).toDestination(); 
    
    try {
      await mic.open();
      mic.connect(analyser);
      mic.connect(recorder);
      mic.connect(monitorGain); 
      
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
    const success = await initAudioCore();
    if (success) {
      requestAnimationFrame(audioLoop);
      setIsConfiguring(false);
      setIsStarted(true);
    }
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

    // Il synth suona solo in modalità LIVE o mentre registri
    const shouldHearSynth = stateRef.current.mode === WorkstationMode.LIVE || stateRef.current.isRecording;

    if (rms > stateRef.current.sensitivity && shouldHearSynth) {
      const freq = detectPitch(buffer, Tone.getContext().sampleRate);
      const midi = freq ? frequencyToMidi(freq) : null;
      if (midi !== null && midi !== stateRef.current.lastMidi) {
        const noteName = midiToNoteName(midi);
        if (stateRef.current.lastMidi !== null) synthRef.current.triggerRelease(midiToNoteName(stateRef.current.lastMidi));
        synthRef.current.triggerAttack(noteName);
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
    } else {
      const audioBlob = await recorderRef.current?.stop();
      if (audioBlob) {
        const url = URL.createObjectURL(audioBlob);
        setSessions(prev => [{
          id: Math.random().toString(36).substr(2, 9),
          timestamp: Date.now(),
          midiNotes: [...recordingNotesRef.current],
          audioUrl: url,
          instrumentName: selectedInstrument.name
        }, ...prev]);
      }
      setIsRecording(false);
      setMode(WorkstationMode.IDLE);
    }
  };

  const playBoth = async (session: StudioSession) => {
    setIsPlayingBack(session.id);
    const player = new Tone.Player(session.audioUrl).toDestination();
    player.onstop = () => setIsPlayingBack(null);
    const now = Tone.now() + 0.1;
    player.start(now);
    session.midiNotes.forEach(n => synthRef.current?.triggerAttackRelease(n.note, n.duration, now + n.time));
  };

  return (
    <div className="min-h-screen bg-black text-white flex flex-col items-center p-4 pb-32 max-w-lg mx-auto overflow-x-hidden">
      <header className="w-full flex justify-between items-center py-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-purple-600 rounded-xl flex items-center justify-center shadow-lg shadow-purple-600/20"><Music className="w-6 h-6" /></div>
          <h1 className="text-lg font-black uppercase tracking-tighter leading-none">VocalSynth<span className="text-purple-500">Pro</span></h1>
        </div>
        {isStarted && <button onClick={() => { setMode(WorkstationMode.IDLE); synthRef.current?.releaseAll(); }} className="p-2 bg-zinc-900 rounded-full"><XCircle size={20} /></button>}
      </header>

      {!isStarted ? (
        <button onClick={startSetupWizard} className="mt-20 px-12 py-6 bg-white text-black rounded-full font-black text-xl hover:scale-105 transition-all shadow-2xl">AVVIA WORKSTATION</button>
      ) : (
        <div className="w-full space-y-6">
          <div className="w-full h-44 bg-zinc-950 rounded-[2.5rem] border border-white/5 flex flex-col items-center justify-center relative overflow-hidden">
            <div className="absolute inset-0 opacity-10" style={{ backgroundImage: 'radial-gradient(circle, #6366f1 1px, transparent 1px)', backgroundSize: '20px 20px' }} />
            <Mic size={48} className={`relative transition-all duration-300 ${rmsVolume > sensitivity ? 'text-purple-500 scale-110' : 'text-zinc-800'}`} />
            <div className="mt-4 text-[10px] font-black uppercase text-zinc-500 tracking-[0.2em] relative">
              {mode === WorkstationMode.MONITOR ? 'Voice Monitor Active' : (mode === WorkstationMode.LIVE ? 'Synth Engine Active' : 'System Idle')}
            </div>
          </div>

          {/* NUOVA GRIGLIA A 3 BOTTONI */}
          <div className="grid grid-cols-3 gap-3">
            <button 
              onClick={() => { setMode(WorkstationMode.LIVE); if(isRecording) toggleRecording(); }}
              className={`py-5 rounded-2xl flex flex-col items-center gap-2 border-2 transition-all ${mode === WorkstationMode.LIVE ? 'bg-purple-600 border-purple-600 shadow-lg shadow-purple-500/30' : 'bg-zinc-900 border-transparent text-zinc-500'}`}
            >
              <Activity size={18} />
              <span className="text-[8px] font-black uppercase">Live Synth</span>
            </button>

            <button 
              onClick={() => { setMode(WorkstationMode.MONITOR); if(isRecording) toggleRecording(); }}
              className={`py-5 rounded-2xl flex flex-col items-center gap-2 border-2 transition-all ${mode === WorkstationMode.MONITOR ? 'bg-blue-600 border-blue-600 shadow-lg shadow-blue-500/30' : 'bg-zinc-900 border-transparent text-zinc-500'}`}
            >
              <Mic2 size={18} />
              <span className="text-[8px] font-black uppercase">Monitor</span>
            </button>

            <button 
              onClick={toggleRecording}
              className={`py-5 rounded-2xl flex flex-col items-center gap-2 border-2 transition-all ${isRecording ? 'bg-red-600 border-red-600 animate-pulse' : 'bg-zinc-900 border-transparent text-zinc-500'}`}
            >
              {isRecording ? <Square size={18} fill="currentColor" /> : <Disc size={18} />}
              <span className="text-[8px] font-black uppercase">{isRecording ? 'Stop Rec' : 'Record'}</span>
            </button>
          </div>

          <div className="flex justify-between items-center text-[10px] font-black uppercase tracking-widest text-zinc-500 px-1">
            <span>Sound Browser</span>
            <button onClick={() => setShowHistory(!showHistory)} className="text-purple-400 hover:text-purple-300">Archive ({sessions.length})</button>
          </div>

          {showHistory ? (
            <div className="space-y-3 max-h-80 overflow-y-auto no-scrollbar">
              {sessions.map(s => (
                <div key={s.id} className="p-4 bg-zinc-900 rounded-2xl flex items-center justify-between border border-white/5">
                  <div className="flex flex-col">
                    <span className="text-[10px] font-black uppercase text-white">{s.instrumentName}</span>
                    <span className="text-[8px] text-zinc-500">{new Date(s.timestamp).toLocaleTimeString()}</span>
                  </div>
                  <button onClick={() => playBoth(s)} className="p-3 bg-white text-black rounded-xl hover:bg-purple-500 hover:text-white transition-all">
                    <ArrowLeftRight size={16} />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 max-h-80 overflow-y-auto no-scrollbar">
              {INSTRUMENTS.map(inst => (
                <button key={inst.id} onClick={() => setSelectedInstrument(inst)} className={`p-4 rounded-2xl border-2 transition-all flex flex-col items-center gap-2 ${selectedInstrument.id === inst.id ? 'border-purple-600 bg-zinc-900 shadow-xl' : 'border-zinc-900 bg-transparent text-zinc-600'}`}>
                  <Music size={14} className={selectedInstrument.id === inst.id ? 'text-purple-500' : ''} />
                  <span className="text-[9px] font-black uppercase truncate w-full">{inst.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* FOOTER STATS */}
      {isStarted && (
        <div className="fixed bottom-0 left-0 right-0 bg-black/80 backdrop-blur-xl border-t border-white/5 p-4 z-50">
           <div className="max-w-lg mx-auto flex items-center justify-between px-2">
              <div className="flex flex-col">
                <span className="text-[7px] font-black text-zinc-500 uppercase tracking-widest">Input Note</span>
                <span className="text-xs font-mono font-bold text-white leading-none">{currentMidiNote ? midiToNoteName(currentMidiNote).replace(/\d+/, '') : '--'}</span>
              </div>
              <div className="flex flex-col items-end">
                <span className="text-[7px] font-black text-zinc-500 uppercase tracking-widest">Active Tool</span>
                <span className="text-[9px] font-black text-purple-500 uppercase">{selectedInstrument.name}</span>
              </div>
           </div>
        </div>
      )}
    </div>
  );
};

export default App;
