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
  const [isLiveMonitorEnabled, setIsLiveMonitorEnabled] = useState(false); 
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

    switch (instrument.category) {
      case 'PIANO': settings = { oscillator: { type: 'triangle8' }, envelope: { attack: 0.005, decay: 0.2, sustain: 0.3, release: 1.2 } }; break;
      case 'STRINGS': settings = { oscillator: { type: 'sawtooth' }, envelope: { attack: 0.4, decay: 0.4, sustain: 0.8, release: 1.5 } }; break;
      case 'SYNTH': settings = { oscillator: { type: 'fatsawtooth', count: 3, spread: 30 }, envelope: { attack: 0.05, decay: 0.3, sustain: 0.4, release: 0.8 } }; break;
      case 'BASS': settings = { oscillator: { type: 'square' }, envelope: { attack: 0.01, decay: 0.1, sustain: 0.6, release: 0.2 } }; break;
      default: settings = { oscillator: { type: 'triangle' }, envelope: { attack: 0.01, decay: 0.1, sustain: 0.5, release: 0.5 } };
    }
    synthRef.current.set(settings);
  }, []);

  const toggleLiveMonitor = useCallback(() => {
    if (!micRef.current) return;
    if (!isLiveMonitorEnabled) {
      micRef.current.connect(Tone.getDestination());
      setIsLiveMonitorEnabled(true);
    } else {
      micRef.current.disconnect(Tone.getDestination());
      if (analyserRef.current) micRef.current.connect(analyserRef.current);
      if (recorderRef.current) micRef.current.connect(recorderRef.current);
      setIsLiveMonitorEnabled(false);
    }
  }, [isLiveMonitorEnabled]);

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
      
      if (activeNoteStartRef.current) {
        const duration = Math.max(0, Tone.now() - recordingStartTimeRef.current - activeNoteStartRef.current.start);
        if (duration >= MIN_NOTE_DURATION) {
          recordingNotesRef.current.push({ ...activeNoteStartRef.current, duration, time: activeNoteStartRef.current.start });
        }
        activeNoteStartRef.current = null;
      }

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

  const stopAllAudio = () => {
    synthRef.current?.releaseAll();
    if (playerRef.current) {
      playerRef.current.stop();
      playerRef.current.dispose();
      playerRef.current = null;
    }
    if (isRecording) toggleRecording();
    if (isLiveMonitorEnabled) toggleLiveMonitor();
    setMode(WorkstationMode.IDLE);
    setIsPlayingBack(null);
    setCurrentMidiNote(null);
  };

  const audioLoop = () => {
    if (!analyserRef.current || !synthRef.current) return;
    if (stateRef.current.isPlayingBack) { requestAnimationFrame(audioLoop); return; }

    const buffer = analyserRef.current.getValue() as Float32Array;
    let sum = 0;
    for (let i = 0; i < buffer.length; i++) {
      const boostedSample = buffer[i] * stateRef.current.micBoost;
      sum += boostedSample * boostedSample;
    }
    const rms = Math.sqrt(sum / buffer.length);
    setRmsVolume(prev => prev * 0.7 + rms * 0.3);

    if (stateRef.current.isConfiguring && setupStep !== 'VOICE') { requestAnimationFrame(audioLoop); return; }

    const shouldHearSynth = stateRef.current.mode === WorkstationMode.LIVE && !stateRef.current.isRecording;

    if (rms > stateRef.current.sensitivity) {
      const freq = detectPitch(buffer, Tone.getContext().sampleRate);
      const midi = freq ? frequencyToMidi(freq) : null;

      if (midi !== null && midi !== stateRef.current.lastMidi) {
        const noteName = midiToNoteName(midi);
        if (stateRef.current.lastMidi !== null) {
          synthRef.current.triggerRelease(midiToNoteName(stateRef.current.lastMidi));
          if (stateRef.current.isRecording && activeNoteStartRef.current) {
            const duration = Tone.now() - recordingStartTimeRef.current - activeNoteStartRef.current.start;
            if (duration >= MIN_NOTE_DURATION) recordingNotesRef.current.push({ ...activeNoteStartRef.current, duration, time: activeNoteStartRef.current.start });
            activeNoteStartRef.current = null;
          }
        }
        if (shouldHearSynth) synthRef.current.triggerAttack(noteName);
        setCurrentMidiNote(midi);
        if (stateRef.current.isRecording) activeNoteStartRef.current = { note: noteName, start: Tone.now() - recordingStartTimeRef.current };
      }
    } else if (stateRef.current.lastMidi !== null) {
      synthRef.current.triggerRelease(midiToNoteName(stateRef.current.lastMidi));
      setCurrentMidiNote(null);
    }
    requestAnimationFrame(audioLoop);
  };

  const initAudioCore = async () => {
    await Tone.start();
    if (synthRef.current) return true;
    try {
      const mic = new Tone.UserMedia();
      await mic.open();
      micRef.current = mic;
      synthRef.current = new Tone.PolySynth(Tone.Synth).toDestination();
      analyserRef.current = new Tone.Analyser('waveform', 1024);
      recorderRef.current = new Tone.Recorder();
      mic.connect(analyserRef.current);
      mic.connect(recorderRef.current);
      applyInstrumentSettings(selectedInstrument);
      return true;
    } catch { return false; }
  };

  const startSetupWizard = async () => {
    setIsConfiguring(true); setSetupStep('PERMISSION');
    if (await initAudioCore()) {
      requestAnimationFrame(audioLoop);
      setSetupStep('SILENCE');
      setTimeout(() => { setSetupStep('VOICE'); }, 2000);
      setTimeout(() => { setSetupStep('COMPLETE'); }, 5000);
    }
  };

  return (
    <div className="min-h-screen bg-black text-white flex flex-col items-center p-4 pb-32 max-w-lg mx-auto">
      <header className="w-full flex justify-between items-center py-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-purple-600 rounded-xl flex items-center justify-center"><Music /></div>
          <h1 className="text-lg font-black uppercase">VocalSynth<span className="text-purple-500">Pro</span></h1>
        </div>
        {isStarted && <button onClick={() => setShowSettings(!showSettings)} className="p-2 bg-zinc-900 rounded-full"><Settings /></button>}
      </header>

      {!isStarted && !isConfiguring && (
        <button onClick={startSetupWizard} className="mt-20 px-10 py-5 bg-purple-600 rounded-full font-bold">START STUDIO</button>
      )}

      {isConfiguring && (
        <div className="text-center mt-20">
          <h2 className="text-2xl font-bold">{setupStep}</h2>
          {setupStep === 'COMPLETE' && <button onClick={() => {setIsStarted(true); setIsConfiguring(false);}} className="mt-10 px-10 py-5 bg-white text-black rounded-full font-bold">ENTER</button>}
        </div>
      )}

      {isStarted && (
        <div className="w-full flex flex-col">
          <div className="w-full h-44 bg-zinc-900 rounded-[2.5rem] mb-6 flex items-center justify-center relative overflow-hidden">
             <Mic size={48} className={rmsVolume > sensitivity ? 'text-purple-500 scale-110' : 'text-zinc-700'} />
          </div>

          <div className="grid grid-cols-3 gap-2 mb-8">
            <button onClick={() => setMode(mode === WorkstationMode.LIVE ? WorkstationMode.IDLE : WorkstationMode.LIVE)}
              className={`py-5 rounded-3xl text-[10px] font-bold border-2 ${mode === WorkstationMode.LIVE ? 'bg-purple-600 border-purple-600' : 'bg-zinc-900 border-transparent'}`}>
              <Activity className="mx-auto mb-1" /> LIVE PLAY
            </button>

            <button onClick={toggleLiveMonitor}
              className={`py-5 rounded-3xl text-[10px] font-bold border-2 ${isLiveMonitorEnabled ? 'bg-blue-600 border-blue-600' : 'bg-zinc-900 border-transparent'}`}>
              <Headphones className="mx-auto mb-1" /> LIVE VOICE
            </button>

            <button onClick={toggleRecording}
              className={`py-5 rounded-3xl text-[10px] font-bold border-2 ${isRecording ? 'bg-red-600 border-red-600' : 'bg-zinc-900 border-transparent'}`}>
              <Disc className="mx-auto mb-1" /> {isRecording ? 'STOP' : 'RECORD'}
            </button>
          </div>
          
          <div className="text-[10px] text-zinc-500 uppercase font-bold mb-4">Instruments</div>
          <div className="grid grid-cols-2 gap-2">
            {INSTRUMENTS.slice(0, 4).map(inst => (
              <button key={inst.id} onClick={() => setSelectedInstrument(inst)} 
                className={`p-4 rounded-2xl border-2 ${selectedInstrument.id === inst.id ? 'border-purple-600 bg-zinc-900' : 'border-zinc-900'}`}>
                {inst.name}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
