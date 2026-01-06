import React, { useState, useEffect, useRef } from 'react';
import * as Tone from 'tone';
import { 
  Music, Mic, Activity, Disc, XCircle, Speaker, Square, Play, ArrowLeftRight, Trash2
} from 'lucide-react';
import { INSTRUMENTS } from './constants';
import { Instrument, WorkstationMode, RecordedNote, StudioSession } from './types';
import { detectPitch, frequencyToMidi, midiToNoteName } from './services/pitchDetection';

const App: React.FC = () => {
  const [selectedInstrument, setSelectedInstrument] = useState<Instrument>(INSTRUMENTS[0]);
  const [mode, setMode] = useState<WorkstationMode>(WorkstationMode.IDLE);
  const [isStarted, setIsStarted] = useState(false);
  const [currentMidiNote, setCurrentMidiNote] = useState<number | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [sessions, setSessions] = useState<StudioSession[]>([]);
  const [rmsVolume, setRmsVolume] = useState(0);
  const [showHistory, setShowHistory] = useState(false);

  const synthRef = useRef<Tone.PolySynth | null>(null);
  const micRef = useRef<Tone.UserMedia | null>(null);
  const analyserRef = useRef<Tone.Analyser | null>(null);
  const recorderRef = useRef<Tone.Recorder | null>(null);
  const monitorGainRef = useRef<Tone.Gain | null>(null);
  
  const stateRef = useRef({ 
    mode: WorkstationMode.IDLE, 
    isRecording: false,
    sensitivity: 0.015,
    micBoost: 2.5
  });

  useEffect(() => {
    stateRef.current.mode = mode;
    stateRef.current.isRecording = isRecording;
    
    if (monitorGainRef.current) {
        // Attiva/Disattiva il passaggio della voce alle casse
        monitorGainRef.current.gain.rampTo(mode === WorkstationMode.MONITOR ? 1 : 0, 0.1);
    }
  }, [mode, isRecording]);

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

  // Ciclo audio semplificato per questa versione
  const audioLoop = () => {
    if (!analyserRef.current) {
      requestAnimationFrame(audioLoop);
      return;
    }
    const buffer = analyserRef.current.getValue() as Float32Array;
    let sum = 0;
    for (let i = 0; i < buffer.length; i++) {
      sum += buffer[i] * buffer[i];
    }
    setRmsVolume(Math.sqrt(sum / buffer.length));
    requestAnimationFrame(audioLoop);
  };

  const toggleRecording = async () => {
    if (!isRecording) {
      recorderRef.current?.start();
      setIsRecording(true);
      setMode(WorkstationMode.RECORD);
    } else {
      const audioBlob = await recorderRef.current?.stop();
      if (audioBlob) {
        const url = URL.createObjectURL(audioBlob);
        setSessions(prev => [{
          id: Math.random().toString(36).substr(2, 9),
          timestamp: Date.now(),
          midiNotes: [],
          audioUrl: url,
          instrumentName: selectedInstrument.name
        }, ...prev]);
      }
      setIsRecording(false);
      setMode(WorkstationMode.IDLE);
    }
  };

  return (
    <div className="min-h-screen bg-black text-white flex flex-col items-center p-4 max-w-lg mx-auto font-sans">
      
      {/* HEADER */}
      <header className="w-full flex justify-between items-center py-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-purple-600 rounded-xl flex items-center justify-center shadow-lg shadow-purple-500/50">
            <Music size={24} />
          </div>
          <h1 className="text-xl font-black uppercase tracking-tighter italic">VocalSynth<span className="text-purple-500 text-sm">PRO</span></h1>
        </div>
      </header>

      {!isStarted ? (
        <div className="flex-1 flex items-center">
          <button 
            onClick={async () => { const ok = await initAudioCore(); if(ok) { setIsStarted(true); requestAnimationFrame(audioLoop); } }} 
            className="px-12 py-6 bg-white text-black rounded-full font-black text-xl hover:scale-105 transition-all shadow-2xl"
          >
            AVVIA WORKSTATION
          </button>
        </div>
      ) : (
        <div className="w-full space-y-6">
          
          {/* VISUALIZER */}
          <div className="w-full h-40 bg-zinc-950 rounded-[2.5rem] border border-white/5 flex flex-col items-center justify-center relative overflow-hidden">
            <div className={`absolute inset-0 bg-purple-600/5 transition-opacity ${rmsVolume > 0.05 ? 'opacity-100' : 'opacity-0'}`} />
            <Mic size={48} className={`relative transition-all ${rmsVolume > 0.02 ? 'text-purple-500 scale-110' : 'text-zinc-800'}`} />
            <span className="mt-2 text-[9px] font-black uppercase text-zinc-500 tracking-widest">
              {mode === WorkstationMode.MONITOR ? 'Direct Voice' : (mode === WorkstationMode.LIVE ? 'Synth Engine' : 'System Idle')}
            </span>
          </div>

          {/* I 3 BOTTONI PRINCIPALI */}
          <div className="flex flex-row gap-2 w-full">
            <button 
              onClick={() => setMode(WorkstationMode.LIVE)}
              className={`flex-1 py-5 rounded-2xl flex flex-col items-center gap-2 border-2 transition-all ${mode === WorkstationMode.LIVE ? 'bg-purple-600 border-purple-400 shadow-lg shadow-purple-500/20' : 'bg-zinc-900 border-transparent text-zinc-600'}`}
            >
              <Activity size={20} />
              <span className="text-[8px] font-black uppercase tracking-tighter">Live Synth</span>
            </button>

            <button 
              onClick={() => setMode(mode === WorkstationMode.MONITOR ? WorkstationMode.IDLE : WorkstationMode.MONITOR)}
              className={`flex-1 py-5 rounded-2xl flex flex-col items-center gap-2 border-2 transition-all ${mode === WorkstationMode.MONITOR ? 'bg-blue-600 border-blue-400 shadow-lg shadow-blue-500/20' : 'bg-zinc-900 border-transparent text-zinc-600'}`}
            >
              <Speaker size={20} />
              <span className="text-[8px] font-black uppercase tracking-tighter">Live Voice</span>
            </button>

            <button 
              onClick={toggleRecording}
              className={`flex-1 py-5 rounded-2xl flex flex-col items-center gap-2 border-2 transition-all ${isRecording ? 'bg-red-600 border-red-400 animate-pulse' : 'bg-zinc-900 border-transparent text-zinc-600'}`}
            >
              {isRecording ? <Square size={20} fill="white" /> : <Disc size={20} />}
              <span className="text-[8px] font-black uppercase tracking-tighter">{isRecording ? 'Stop' : 'Record'}</span>
            </button>
          </div>

          {/* SEZIONE STRUMENTI / ARCHIVIO */}
          <div className="flex justify-between items-center text-[10px] font-black uppercase text-zinc-500 px-1 pt-2">
            <span>Sound Browser</span>
            <button onClick={() => setShowHistory(!showHistory)} className="text-purple-400 flex items-center gap-1">
              <History size={12} /> Archive ({sessions.length})
            </button>
          </div>

          {!showHistory ? (
            <div className="grid grid-cols-2 gap-3 max-h-64 overflow-y-auto no-scrollbar">
              {INSTRUMENTS.map(inst => (
                <button 
                  key={inst.id} 
                  onClick={() => setSelectedInstrument(inst)}
                  className={`p-4 rounded-xl border-2 transition-all ${selectedInstrument.id === inst.id ? 'border-purple-600 bg-zinc-900 shadow-lg' : 'border-zinc-900 bg-transparent text-zinc-700'}`}
                >
                  <span className="text-[9px] font-black uppercase truncate block text-center tracking-tighter">{inst.name}</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="space-y-3 animate-in fade-in duration-300">
              {sessions.length === 0 && <div className="text-center py-10 text-zinc-700 text-[10px] uppercase font-black">No recordings yet</div>}
              {sessions.map(s => (
                <div key={s.id} className="p-4 bg-zinc-900 rounded-2xl flex items-center justify-between border border-white/5">
                  <div className="flex flex-col">
                    <span className="text-[10px] font-black uppercase">{s.instrumentName}</span>
                    <span className="text-[8px] text-zinc-600">{new Date(s.timestamp).toLocaleTimeString()}</span>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => { const p = new Tone.Player(s.audioUrl).toDestination(); p.start(); }} className="p-2 bg-white text-black rounded-lg"><Play size={14} fill="currentColor" /></button>
                    <button onClick={() => setSessions(prev => prev.filter(x => x.id !== s.id))} className="p-2 bg-zinc-800 text-red-500 rounded-lg"><Trash2 size={14} /></button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* FOOTER STATS */}
      {isStarted && (
        <div className="fixed bottom-4 left-4 right-4 bg-zinc-900/80 backdrop-blur-md rounded-2xl p-4 flex justify-between items-center border border-white/5 shadow-2xl">
          <div className="flex flex-col">
            <span className="text-[8px] font-black text-zinc-500 uppercase italic">Selected</span>
            <span className="text-xs font-black text-purple-400 uppercase tracking-tighter">{selectedInstrument.name}</span>
          </div>
          <div className="w-10 h-10 rounded-full border-2 border-zinc-800 flex items-center justify-center">
             <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
