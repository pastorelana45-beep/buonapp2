
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

  // Raggruppamento degli strumenti per categoria
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

    switch (instrument.category) {
      case 'PIANO':
        settings = {
          oscillator: { type: 'triangle8' },
          envelope: { attack: 0.005, decay: 0.2, sustain: 0.3, release: 1.2 }
        };
        break;
      case 'STRINGS':
        settings = {
          oscillator: { type: 'sawtooth' },
          envelope: { attack: 0.4, decay: 0.4, sustain: 0.8, release: 1.5 }
        };
        break;
      case 'SYNTH':
        settings = {
          oscillator: { type: 'fatsawtooth', count: 3, spread: 30 },
          envelope: { attack: 0.05, decay: 0.3, sustain: 0.4, release: 0.8 }
        };
        break;
      case 'BRASS':
        settings = {
          oscillator: { type: 'sawtooth' },
          envelope: { attack: 0.1, decay: 0.2, sustain: 0.7, release: 0.3 }
        };
        break;
      case 'BASS':
        settings = {
          oscillator: { type: 'square' },
          envelope: { attack: 0.01, decay: 0.1, sustain: 0.6, release: 0.2 }
        };
        break;
      case 'REED':
        settings = {
          oscillator: { type: 'pulse', width: 0.5 },
          envelope: { attack: 0.05, decay: 0.1, sustain: 0.8, release: 0.4 }
        };
        break;
      case 'ORGAN':
        settings = {
          oscillator: { type: 'sine' },
          envelope: { attack: 0.01, decay: 0, sustain: 1, release: 0.1 }
        };
        break;
      default:
        settings = {
          oscillator: { type: 'triangle' },
          envelope: { attack: 0.01, decay: 0.1, sustain: 0.5, release: 0.5 }
        };
    }

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

  const startSetupWizard = async () => {
    setIsConfiguring(true);
    setSetupStep('PERMISSION');
    
    const success = await initAudioCore();
    if (!success) {
      alert("Impossibile accedere al microfono. Verifica i permessi nel browser.");
      setIsConfiguring(false);
      return;
    }

    requestAnimationFrame(audioLoop);
    
    setSetupStep('SILENCE');
    const silenceSamples: number[] = [];
    const silenceInterval = setInterval(() => {
      silenceSamples.push(rmsVolume);
      setSetupProgress(prev => Math.min(100, prev + 5));
      if (silenceSamples.length >= 20) {
        clearInterval(silenceInterval);
        const avgSilence = silenceSamples.reduce((a, b) => a + b, 0) / silenceSamples.length;
        setSensitivity(Math.max(0.005, avgSilence * 1.5));
        setSetupStep('VOICE');
        setSetupProgress(0);
        startVoiceCalibration();
      }
    }, 100);
  };

  const startVoiceCalibration = () => {
    const voiceSamples: number[] = [];
    const voiceInterval = setInterval(() => {
      voiceSamples.push(rmsVolume);
      setSetupProgress(prev => Math.min(100, prev + 5));
      if (voiceSamples.length >= 30) {
        clearInterval(voiceInterval);
        const maxVoice = Math.max(...voiceSamples);
        if (maxVoice < 0.05) {
          setMicBoost(4.0);
        } else if (maxVoice < 0.1) {
          setMicBoost(3.0);
        } else {
          setMicBoost(2.0);
        }
        setSetupStep('COMPLETE');
      }
    }, 100);
  };

  const finishSetup = () => {
    setIsConfiguring(false);
    setIsStarted(true);
  };

  const stopAllAudio = () => {
    synthRef.current?.releaseAll();
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

    if (stateRef.current.isConfiguring && setupStep !== 'VOICE') {
      requestAnimationFrame(audioLoop);
      return;
    }

    const shouldHearSynth = stateRef.current.mode === WorkstationMode.LIVE && !stateRef.current.isRecording;

    if (rms > stateRef.current.sensitivity) {
      const freq = detectPitch(buffer, Tone.getContext().sampleRate);
      const midi = freq ? frequencyToMidi(freq) : null;

      if (midi !== null && midi !== stateRef.current.lastMidi) {
        const noteName = midiToNoteName(midi);
        
        if (stateRef.current.lastMidi !== null) {
          const oldNote = midiToNoteName(stateRef.current.lastMidi);
          synthRef.current.triggerRelease(oldNote);
          
          if (stateRef.current.isRecording && activeNoteStartRef.current) {
            const currentTime = Tone.now();
            const duration = Math.max(0, currentTime - recordingStartTimeRef.current - activeNoteStartRef.current.start);
            if (duration >= MIN_NOTE_DURATION) {
              recordingNotesRef.current.push({ ...activeNoteStartRef.current, duration, time: activeNoteStartRef.current.start });
            }
            activeNoteStartRef.current = null;
          }
        }

        if (shouldHearSynth) {
          synthRef.current.triggerAttack(noteName);
        }
        
        setCurrentMidiNote(midi);

        if (stateRef.current.isRecording) {
          activeNoteStartRef.current = { note: noteName, start: Tone.now() - recordingStartTimeRef.current };
        }
      }
    } else if (stateRef.current.lastMidi !== null) {
      const oldNote = midiToNoteName(stateRef.current.lastMidi);
      synthRef.current.triggerRelease(oldNote);
      
      if (stateRef.current.isRecording && activeNoteStartRef.current) {
        const currentTime = Tone.now();
        const duration = Math.max(0, currentTime - recordingStartTimeRef.current - activeNoteStartRef.current.start);
        if (duration >= MIN_NOTE_DURATION) {
          recordingNotesRef.current.push({ ...activeNoteStartRef.current, duration, time: activeNoteStartRef.current.start });
        }
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
      
      if (activeNoteStartRef.current) {
        const currentTime = Tone.now();
        const duration = Math.max(0, currentTime - recordingStartTimeRef.current - activeNoteStartRef.current.start);
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

  const playSessionMidi = async (session: StudioSession) => {
    if (session.midiNotes.length === 0 || !synthRef.current) return;
    
    if (isPlayingBack) stopAllAudio();
    
    setIsPlayingBack(session.id + "_midi");
    await Tone.start();
    await Tone.context.resume();
    
    const origInstrument = INSTRUMENTS.find(i => i.name === session.instrumentName) || selectedInstrument;
    applyInstrumentSettings(origInstrument);
    
    const now = Tone.now();
    session.midiNotes.forEach(n => {
      const safeDuration = Math.max(MIN_NOTE_DURATION, n.duration);
      synthRef.current?.triggerAttackRelease(n.note, safeDuration, now + n.time);
    });
    
    const lastNote = session.midiNotes[session.midiNotes.length - 1];
    const totalDuration = lastNote.time + (lastNote.duration || MIN_NOTE_DURATION);
    
    setTimeout(() => {
        setIsPlayingBack(null);
        applyInstrumentSettings(selectedInstrument);
    }, (totalDuration + 0.2) * 1000);
  };

  const playSessionAudio = async (session: StudioSession) => {
    if (!session.audioUrl) return;
    
    if (isPlayingBack) {
        if (playerRef.current) {
            playerRef.current.stop();
            playerRef.current.dispose();
            playerRef.current = null;
        }
    }

    setIsPlayingBack(session.id + "_audio");
    await Tone.start();
    await Tone.context.resume();

    try {
        const player = new Tone.Player({
            url: session.audioUrl,
            autostart: true,
            onstop: () => {
                setIsPlayingBack(null);
                player.dispose();
                if (playerRef.current === player) playerRef.current = null;
            }
        }).toDestination();
        player.volume.value = 8;
        playerRef.current = player;
    } catch (err) {
        setIsPlayingBack(null);
    }
  };

  const deleteSession = (id: string) => {
    setSessions(prev => prev.filter(s => {
      if (s.id === id && s.audioUrl) URL.revokeObjectURL(s.audioUrl);
      return s.id !== id;
    }));
  };

  const updateSessionInstrument = (sessionId: string, newInstrumentName: string) => {
    setSessions(prev => prev.map(s => 
      s.id === sessionId ? { ...s, instrumentName: newInstrumentName } : s
    ));
  };

  const safeMidiToNoteName = (midi: number | null) => {
    if (midi === null) return "--";
    const name = midiToNoteName(midi);
    return name || "--";
  };

  const getCleanNote = (midi: number | null) => {
    const name = safeMidiToNoteName(midi);
    if (name === "--") return "--";
    return String(name).replace(/\d+/g, '');
  };

  return (
    <div className="min-h-screen bg-black text-white flex flex-col items-center p-4 pb-32 max-w-lg mx-auto overflow-x-hidden">
      
      {/* HEADER */}
      <header className="w-full flex justify-between items-center py-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-purple-600 rounded-xl flex items-center justify-center shadow-lg shadow-purple-600/20">
            <Music className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-lg font-black tracking-tighter uppercase leading-none">VocalSynth<span className="text-purple-500">Pro</span></h1>
            <span className="text-[8px] font-mono text-zinc-500 uppercase tracking-widest">Pure Studio Control</span>
          </div>
        </div>
        {(isStarted || isConfiguring) && (
          <div className="flex gap-2">
            <button 
              onClick={stopAllAudio} 
              className="p-2 bg-red-900/20 text-red-500 rounded-full hover:bg-red-500 hover:text-white transition-all active:scale-90"
            >
              <XCircle size={20} />
            </button>
            <button 
              onClick={() => setShowSettings(!showSettings)} 
              className={`p-2 rounded-full transition-all ${showSettings ? 'bg-purple-600 text-white' : 'bg-zinc-900 text-zinc-400'}`}
            >
              <Settings size={20} />
            </button>
          </div>
        )}
      </header>

      {/* SETUP WIZARD OVERLAY */}
      {isConfiguring && (
        <div className="fixed inset-0 z-[200] bg-black/95 backdrop-blur-xl flex flex-col items-center justify-center p-8 animate-in fade-in duration-500">
          <div className="w-full max-w-sm space-y-12 text-center">
            <div className="relative inline-block">
              <div className="absolute inset-0 bg-purple-600 blur-3xl opacity-20 animate-pulse" />
              <div className="w-20 h-20 bg-zinc-900 rounded-3xl flex items-center justify-center relative border border-white/5">
                {setupStep === 'PERMISSION' && <ShieldCheck size={40} className="text-blue-500" />}
                {setupStep === 'SILENCE' && <Volume2 size={40} className="text-zinc-500 animate-pulse" />}
                {setupStep === 'VOICE' && <Mic size={40} className="text-purple-500 animate-bounce" />}
                {setupStep === 'COMPLETE' && <CheckCircle2 size={40} className="text-emerald-500" />}
              </div>
            </div>

            <div className="space-y-3">
              <h3 className="text-2xl font-black uppercase italic tracking-tighter">
                {setupStep === 'PERMISSION' && "Permessi Microfono"}
                {setupStep === 'SILENCE' && "Calibrazione Silenzio"}
                {setupStep === 'VOICE' && "Test del Segnale"}
                {setupStep === 'COMPLETE' && "Configurazione Pronta"}
              </h3>
              <p className="text-zinc-400 text-sm font-medium leading-relaxed">
                {setupStep === 'PERMISSION' && "Concedi l'accesso per iniziare la calibrazione automatica dello studio."}
                {setupStep === 'SILENCE' && "Rimani in silenzio... Stiamo misurando il rumore di fondo del tuo ambiente."}
                {setupStep === 'VOICE' && "Canta o parla a volume normale per testare il guadagno del microfono."}
                {setupStep === 'COMPLETE' && "Lo studio è ottimizzato per la tua voce e il tuo ambiente. Buon divertimento!"}
              </p>
            </div>

            {(setupStep === 'SILENCE' || setupStep === 'VOICE') && (
              <div className="space-y-4">
                <div className="h-2 w-full bg-zinc-800 rounded-full overflow-hidden">
                  <div 
                    className={`h-full transition-all duration-150 ease-out ${setupStep === 'SILENCE' ? 'bg-zinc-400' : 'bg-purple-500 shadow-[0_0_15px_rgba(168,85,247,0.5)]'}`} 
                    style={{ width: `${setupProgress}%` }} 
                  />
                </div>
                <div className="flex justify-between text-[10px] font-black uppercase text-zinc-600 tracking-widest">
                  <span>Processing...</span>
                  <span>{setupProgress}%</span>
                </div>
              </div>
            )}

            {setupStep === 'COMPLETE' && (
              <button 
                onClick={finishSetup}
                className="w-full max-w-xs bg-white text-black py-6 rounded-full font-black text-lg hover:scale-105 active:scale-95 transition-all uppercase tracking-tighter shadow-2xl"
              >
                Entra in Studio
              </button>
            )}
          </div>
        </div>
      )}

      {!showHistory && isStarted && !isConfiguring && (
        <div className="w-full animate-in fade-in duration-500 flex flex-col h-[calc(100vh-180px)]">
          {showSettings && (
            <div className="w-full mb-6 p-6 bg-zinc-900/50 border border-white/5 rounded-3xl animate-in slide-in-from-top-4 space-y-6 shrink-0">
              <div>
                <div className="flex justify-between text-[10px] font-black uppercase text-zinc-400 mb-3 tracking-widest">
                  <div className="flex items-center gap-1"><Zap size={10} className="text-yellow-500" /> Mic Gain Boost</div>
                  <span className="text-yellow-500">{micBoost.toFixed(1)}x</span>
                </div>
                <input 
                  type="range" min="1" max="10" step="0.5" 
                  value={micBoost} onChange={(e) => setMicBoost(parseFloat(e.target.value))}
                  className="w-full h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-yellow-500"
                />
              </div>
              <div>
                <div className="flex justify-between text-[10px] font-black uppercase text-zinc-400 mb-3 tracking-widest">
                  <div className="flex items-center gap-1"><Activity size={10} className="text-purple-500" /> Noise Gate</div>
                  <span className="text-purple-400">{(sensitivity * 1000).toFixed(0)} units</span>
                </div>
                <input 
                  type="range" min="0.001" max="0.1" step="0.001" 
                  value={sensitivity} onChange={(e) => setSensitivity(parseFloat(e.target.value))}
                  className="w-full h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-purple-500"
                />
              </div>
            </div>
          )}

          <div className="w-full h-44 bg-[#050505] rounded-[2.5rem] border border-white/5 relative overflow-hidden mb-6 flex items-center justify-center shadow-2xl group shrink-0">
            <div className="absolute inset-0 opacity-10 pointer-events-none" style={{ backgroundImage: 'linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)', backgroundSize: '40px 40px' }} />
            
            <div className="absolute left-10 h-28 w-3 bg-zinc-950 rounded-full overflow-hidden flex flex-col justify-end shadow-inner">
              <div 
                className="absolute w-full border-t-2 border-purple-500/50 z-10 transition-all duration-300" 
                style={{ bottom: `${Math.min(100, (sensitivity / (0.1 / micBoost)) * 100)}%` }} 
              />
              <div 
                className={`w-full transition-all duration-100 ease-out ${rmsVolume > sensitivity ? 'bg-gradient-to-t from-purple-800 via-purple-500 to-white shadow-[0_0_25px_rgba(168,85,247,0.6)]' : 'bg-zinc-800'}`} 
                style={{ height: `${Math.min(100, (rmsVolume / (0.3 / micBoost)) * 100)}%` }} 
              />
            </div>

            <div className="flex flex-col items-center z-10">
              <div className={`relative transition-transform duration-100 ${rmsVolume > sensitivity ? 'scale-110' : 'scale-100'}`}>
                <Mic size={48} className={`relative transition-all duration-75 ${rmsVolume > sensitivity ? 'text-white' : 'text-zinc-800'}`} />
                {isRecording && <div className="absolute -top-1 -right-1 w-3 h-3 bg-red-600 rounded-full animate-ping" />}
              </div>
              <div className="mt-4 text-[10px] font-mono text-zinc-500 uppercase tracking-[0.2em] font-black">
                {mode === WorkstationMode.IDLE ? 'System Idle' : (isRecording ? 'Recording' : 'Live')}
              </div>
            </div>
          </div>

          <div className="w-full grid grid-cols-2 gap-4 mb-8 shrink-0">
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
              className={`py-5 rounded-3xl font-black text-xs transition-all border-2 flex items-center justify-center gap-2 ${mode === WorkstationMode.LIVE && !isRecording ? 'bg-purple-600 text-white border-purple-600 shadow-lg shadow-purple-500/20' : 'bg-zinc-900 text-zinc-500 border-transparent hover:bg-zinc-800 active:scale-95'}`}
            >
              <Activity size={16} /> LIVE PLAY
            </button>
            <button 
              onClick={() => { toggleRecording(); }}
              className={`py-5 rounded-3xl font-black text-xs transition-all border-2 flex items-center justify-center gap-2 ${isRecording ? 'bg-red-600 text-white border-red-600 shadow-xl shadow-red-500/30' : 'bg-zinc-900 text-zinc-500 border-transparent hover:bg-zinc-800 active:scale-95'}`}
            >
              {isRecording ? <Square size={16} fill="white" /> : <Disc size={16} />}
              {isRecording ? 'STOP REC' : 'RECORD'}
            </button>
          </div>

          <div className="w-full mb-4 flex items-center justify-between px-1 shrink-0">
            <span className="text-[10px] font-black uppercase text-zinc-500 tracking-widest flex items-center gap-2">
              <Layers size={12} /> Sound Browser
            </span>
            <button onClick={() => setShowHistory(true)} className="text-[10px] font-black uppercase text-purple-400 flex items-center gap-1 hover:text-purple-300 transition-colors">
              <History size={12} /> Archive ({sessions.length})
            </button>
          </div>

          <div className="w-full flex-grow overflow-y-auto no-scrollbar pb-10 px-1 space-y-8">
            {(Object.entries(groupedInstruments) as [string, Instrument[]][]).map(([category, instruments]) => (
              <div key={category} className="space-y-4">
                <div className="sticky top-0 z-20 bg-black/80 backdrop-blur-md py-2 border-b border-white/5">
                  <h3 className="text-[10px] font-black uppercase text-purple-500/70 tracking-[0.3em] flex items-center gap-2">
                    <span className="w-4 h-[1px] bg-purple-500/30" />
                    {category}
                    <span className="text-[8px] font-mono text-zinc-600">[{instruments.length}]</span>
                  </h3>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  {instruments.map(inst => (
                    <button
                      key={inst.id}
                      onClick={() => { setSelectedInstrument(inst); }}
                      className={`p-5 rounded-3xl border-2 transition-all flex flex-col items-center gap-2 active:scale-95 group relative overflow-hidden ${selectedInstrument.id === inst.id ? 'bg-zinc-900 border-purple-600 shadow-xl shadow-purple-500/10' : 'bg-transparent border-zinc-900/50 hover:border-zinc-800'}`}
                    >
                      {selectedInstrument.id === inst.id && (
                        <div className="absolute top-2 right-2 w-1.5 h-1.5 bg-purple-500 rounded-full animate-pulse" />
                      )}
                      <Music size={18} className={`transition-colors ${selectedInstrument.id === inst.id ? 'text-purple-500' : 'text-zinc-700 group-hover:text-zinc-500'}`} />
                      <span className={`text-[9px] font-bold uppercase truncate w-full text-center tracking-tight transition-colors ${selectedInstrument.id === inst.id ? 'text-white' : 'text-zinc-600'}`}>
                        {inst.name}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {showHistory && !isConfiguring && (
        <div className="w-full animate-in slide-in-from-right duration-300 pb-20">
          <div className="flex items-center justify-between mb-8">
            <div className="flex items-center gap-2">
                <History className="text-purple-500" size={24} />
                <h2 className="text-2xl font-black tracking-tighter uppercase italic">Studio Archive</h2>
            </div>
            <button 
                onClick={() => { setShowHistory(false); if(isPlayingBack) stopAllAudio(); }} 
                className="text-[10px] font-black text-zinc-500 uppercase bg-zinc-900 px-4 py-2 rounded-full hover:text-white transition-colors active:scale-95"
            >
                Back to Studio
            </button>
          </div>

          {sessions.length === 0 ? (
            <div className="w-full h-64 flex flex-col items-center justify-center text-zinc-700 border-2 border-dashed border-zinc-900 rounded-[3rem]">
              <AudioWaveform size={64} strokeWidth={1} className="mb-4 opacity-10" />
              <p className="text-[10px] uppercase font-black tracking-widest">Archive is empty</p>
              <button onClick={() => setShowHistory(false)} className="mt-4 text-purple-500 text-[10px] font-black underline underline-offset-4">START RECORDING</button>
            </div>
          ) : (
            <div className="space-y-6">
              {sessions.map((s) => (
                <div key={s.id} className={`p-6 bg-zinc-950/80 border-l-4 rounded-r-[2rem] transition-all relative overflow-hidden group ${isPlayingBack?.startsWith(s.id) ? 'border-purple-500 shadow-2xl shadow-purple-500/10 translate-x-1' : 'border-zinc-800 hover:border-zinc-700'}`}>
                  
                  {isPlayingBack?.startsWith(s.id) && (
                    <div className="absolute top-0 left-0 h-1 bg-purple-500/30 w-full">
                        <div className="h-full bg-purple-500 animate-progress" />
                    </div>
                  )}

                  <div className="flex flex-col mb-6">
                    <div className="flex justify-between items-start mb-4">
                        <div className="flex gap-4">
                            <div className="w-12 h-12 bg-zinc-900 rounded-2xl flex items-center justify-center text-zinc-500">
                               <Disc size={20} className={isPlayingBack?.startsWith(s.id) ? 'animate-spin-slow text-purple-500' : ''} />
                            </div>
                            <div>
                                <div className="flex items-center gap-2 text-zinc-500 mb-1">
                                    <Clock size={10} />
                                    <span className="text-[9px] font-mono uppercase">{new Date(s.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                                    <span className="w-1 h-1 bg-zinc-800 rounded-full" />
                                    <span className="text-[9px] font-mono uppercase">{s.midiNotes.length} Events</span>
                                </div>
                                {/* SELETTORE STRUMENTO SESSIONE */}
                                <div className="relative group/select">
                                    <select 
                                        value={s.instrumentName}
                                        onChange={(e) => updateSessionInstrument(s.id, e.target.value)}
                                        className="bg-zinc-900 text-white text-[11px] font-black uppercase tracking-tighter border-none rounded-lg px-2 py-1 pr-6 appearance-none cursor-pointer hover:bg-zinc-800 focus:ring-1 focus:ring-purple-500 transition-all"
                                    >
                                        {INSTRUMENTS.map(inst => (
                                            <option key={inst.id} value={inst.name}>{inst.name}</option>
                                        ))}
                                    </select>
                                    <div className="absolute right-1 top-1/2 -translate-y-1/2 pointer-events-none text-zinc-500">
                                        <ChevronRight size={10} className="rotate-90" />
                                    </div>
                                </div>
                            </div>
                        </div>
                        <button 
                            onClick={() => deleteSession(s.id)} 
                            className="p-2 text-zinc-800 hover:text-red-500 hover:bg-red-500/10 rounded-xl transition-all active:scale-75"
                        >
                            <Trash2 size={18} />
                        </button>
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-4">
                    <button 
                      onClick={() => playSessionMidi(s)}
                      disabled={s.midiNotes.length === 0}
                      className={`h-14 rounded-2xl flex items-center justify-center gap-2 text-[10px] font-black uppercase tracking-widest transition-all ${isPlayingBack === s.id + "_midi" ? 'bg-purple-600 text-white shadow-lg shadow-purple-600/30' : 'bg-zinc-900 text-zinc-400 hover:bg-zinc-800 active:scale-95 disabled:opacity-20'}`}
                    >
                      {isPlayingBack === s.id + "_midi" ? <Square size={14} fill="white" /> : <Play size={14} fill="currentColor" />}
                      SYNTH
                    </button>
                    <button 
                      onClick={() => playSessionAudio(s)}
                      className={`h-14 rounded-2xl flex items-center justify-center gap-2 text-[10px] font-black uppercase tracking-widest transition-all ${isPlayingBack === s.id + "_audio" ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-600/30' : 'bg-zinc-900 text-zinc-400 hover:bg-zinc-800 active:scale-95'}`}
                    >
                      {isPlayingBack === s.id + "_audio" ? <Square size={14} fill="white" /> : <Mic size={14} />}
                      VOICE
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Persistent Status Bar */}
      {isStarted && (
        <div className="fixed bottom-8 left-4 right-4 bg-zinc-900/95 backdrop-blur-xl border border-white/10 p-4 rounded-[2.5rem] flex items-center justify-between shadow-[0_25px_50px_-12px_rgba(0,0,0,0.5)] z-[60] animate-in slide-in-from-bottom-8">
          <div className="flex items-center gap-3">
            <div className={`w-12 h-12 rounded-2xl flex items-center justify-center transition-all duration-300 ${isRecording ? 'bg-red-600 shadow-lg shadow-red-600/20' : (mode === WorkstationMode.LIVE ? 'bg-purple-600 shadow-lg shadow-purple-600/20' : 'bg-zinc-800')}`}>
              {isRecording ? <Disc size={20} className="animate-spin-slow" /> : (mode === WorkstationMode.LIVE ? <Activity size={20} /> : <Music size={20} />)}
            </div>
            <div>
              <div className="text-[10px] font-black uppercase leading-tight tracking-tight">
                {isRecording ? 'RECORDING' : (mode === WorkstationMode.LIVE ? 'MONITOR' : 'IDLE')}
              </div>
              <div className="text-[9px] font-mono text-zinc-500 uppercase tracking-tighter flex items-center gap-2 mt-0.5">
                <span className={`w-1.5 h-1.5 rounded-full ${currentMidiNote !== null ? 'bg-emerald-500 animate-pulse' : 'bg-zinc-800'}`} />
                {currentMidiNote !== null ? `NOTE: ${safeMidiToNoteName(currentMidiNote)}` : '--'}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-[1px] h-8 bg-white/10 mx-2" />
            <div className={`text-3xl font-mono font-black min-w-[50px] text-right transition-colors duration-75 italic tracking-tighter ${currentMidiNote !== null ? 'text-purple-500 drop-shadow-[0_0_8px_rgba(168,85,247,0.4)]' : 'text-zinc-800'}`}>
              {getCleanNote(currentMidiNote)}
            </div>
          </div>
        </div>
      )}

      {!isStarted && !isConfiguring && (
        <div className="fixed inset-0 z-[100] bg-black flex flex-col items-center justify-center p-8 text-center animate-in fade-in duration-700 overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-b from-purple-900/20 to-transparent pointer-events-none" />
          <div className="relative mb-10">
            <div className="absolute inset-0 bg-purple-600 blur-[100px] opacity-20 animate-pulse" />
            <div className="w-28 h-28 bg-white text-black rounded-[3rem] flex items-center justify-center shadow-2xl relative rotate-3">
              <Music className="w-14 h-14" />
            </div>
          </div>
          <h2 className="text-5xl font-black mb-4 tracking-tighter uppercase italic leading-none">VocalStudio<br/><span className="text-purple-500">Pro</span></h2>
          <p className="text-zinc-500 text-sm mb-12 max-w-[280px] leading-relaxed font-medium italic">Your voice is the ultimate instrument. Grouped by nature, refined by synthesis.</p>
          
          <button 
            onClick={startSetupWizard}
            className="w-full max-w-xs bg-white text-black py-7 rounded-full font-black text-xl hover:scale-105 active:scale-95 transition-all uppercase tracking-tighter shadow-2xl flex items-center justify-center gap-3"
          >
            Configura Microfono <ChevronRight size={24} />
          </button>
          
          <div className="mt-12 flex items-center gap-6 text-[9px] font-black uppercase text-zinc-700 tracking-widest">
            <div className="flex items-center gap-2"><Layers size={12} /> CATEGORIZED</div>
            <div className="flex items-center gap-2"><Disc size={12} /> RECORD READY</div>
            <div className="flex items-center gap-2"><Activity size={12} /> NOISE GATE</div>
          </div>
        </div>
      )}
      <style>{`
        @keyframes progress {
            from { width: 0%; }
            to { width: 100%; }
        }
        .animate-progress {
            animation: progress 5s linear forwards;
        }
        .animate-spin-slow {
            animation: spin 6s linear infinite;
        }
        @keyframes spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
        }
        .no-scrollbar::-webkit-scrollbar {
            display: none;
        }
        .no-scrollbar {
            -ms-overflow-style: none;
            scrollbar-width: none;
        }
      `}</style>
    </div>
  );
};

export default App;
