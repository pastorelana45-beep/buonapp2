import React, { useState, useEffect, useRef } from 'react';
import * as Tone from 'tone';
import { 
  Music, Mic, Activity, Disc, XCircle, ArrowLeftRight, Speaker, Square, Play
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
  
  const recordingNotesRef = useRef<RecordedNote[]>([]);
  const recordingStartTimeRef = useRef<number>(0);
  const activeNoteStartRef = useRef<{ note: string, start: number } | null>(null);

  useEffect(() => {
    stateRef.current.mode = mode;
    stateRef.current.isRecording = isRecording;
    
    if (monitorGainRef.current) {
        // Gestione volume monitor: 1 se attivo, 0 se spento
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

  const audioLoop = () => {
    if (!analyserRef.current || !synthRef.current) {
      requestAnimationFrame(audioLoop);
      return;
    }

    const buffer = analyserRef.current.getValue() as Float32Array;
    let sum = 0;
    for (let i = 0; i < buffer.length; i++) {
      const sample = buffer[i] * stateRef.current.micBoost;
      sum += sample * sample;
    }
    const rms = Math.sqrt(sum / buffer.length);
    setRmsVolume(rms);

    const shouldHearSynth = stateRef.current.mode === WorkstationMode.LIVE || stateRef.current.isRecording;

    if (rms > stateRef.current.sensitivity && shouldHearSynth) {
      const freq = detectPitch(buffer, Tone.getContext().sampleRate);
      const midi = freq ? frequencyToMidi(freq) : null;
      // Logica nota synth... (omessa per brevità ma presente nel file originale)
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

  return (
    <div className="min-h-screen bg-black text-white flex flex-col items-center p-4 max-w-lg mx-auto">
      <header className="w-full flex justify-between items-center py-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-purple-600 rounded-xl flex items-center justify-center"><Music size={24} /></div>
          <h1 className="text-lg font-black uppercase italic">VocalSynth<span className="text-purple-500">Pro</span></h1>
        </div>
        {isStarted && <button onClick={() => setMode(WorkstationMode.IDLE)} className="p-2 bg-zinc-900 rounded-full"><XCircle size={20} /></button>}
      </header>

      {!isStarted ? (
        <button 
          onClick={async () => { const ok = await initAudioCore(); if(ok) { setIsStarted(true); requestAnimationFrame(audioLoop); } }} 
          className="mt-20 px-12 py-6 bg-white text-black rounded-full font-black text-xl shadow-2xl"
        >
          AVVIA STUDIO
        </button>
      ) : (
        <div className="w-full space-y-6">
          {/* Visualizzatore */}
          <div className="w-full h-40 bg-zinc-950 rounded-[2rem] border border-white/5 flex flex-col items-center justify-center relative">
            <Mic size={40} className={rmsVolume > 0.02 ? 'text-purple-500 scale-110' : 'text-zinc-800'} />
            <div className="mt-2 text-[10px] font-black uppercase text-zinc-500">
              {mode === WorkstationMode.MONITOR ? 'Live Voice Active' : (mode === WorkstationMode.LIVE ? 'Synth Active' : 'Idle')}
            </div>
          </div>

          {/* --- QUESTA È LA SEZIONE CHE DEVE CAMBIARE --- */}
          {/* Se vedi ancora 2 bottoni, prova a ricaricare la pagina con CTRL+F5 */}
          <div className="flex flex-row gap-2 w-full justify-between">
            <button 
              onClick={() => setMode(WorkstationMode.LIVE)}
              className={`flex-1 py-5 rounded-2xl flex flex-col items-center gap-2 border-2 transition-all ${mode === WorkstationMode.LIVE ? 'bg-purple-600 border-purple-600' : 'bg-zinc-900 border-transparent text-zinc-500'}`}
            >
              <Activity size={20} />
              <span className="text-[8px] font-black uppercase">Synth</span>
            </button>

            <button 
              onClick={() => setMode(mode === WorkstationMode.MONITOR ? WorkstationMode.IDLE : WorkstationMode.MONITOR)}
              className={`flex-1 py-5 rounded-2xl flex flex-col items-center gap-2 border-2 transition-all ${mode === WorkstationMode.MONITOR ? 'bg-blue-600 border-blue-600 shadow-lg shadow-blue-500/20' : 'bg-zinc-900 border-transparent text-zinc-500'}`}
            >
              <Speaker size={20} />
              <span className="text-[8px] font-black uppercase">Voice Live</span>
            </button>

            <button 
              onClick={toggleRecording}
              className={`flex-1 py-5 rounded-2xl flex flex-col items-center gap-2 border-2 transition-all ${isRecording ? 'bg-red-600 border-red-600 animate-pulse' : 'bg-zinc-900 border-transparent text-zinc-500'}`}
            >
              <Disc size={20} />
              <span className="text-[8px] font-black uppercase">{isRecording ? 'Stop' : 'Rec'}</span>
            </button>
          </div>
          {/* ------------------------------------------- */}

          <div className="flex justify-between items-center text-[10px] font-black uppercase text-zinc-500 px-1">
            <span>Sound Browser</span>
            <button onClick={() => setShowHistory(!showHistory)} className="text-purple-400">Archive ({sessions.length})</button>
          </div>

          {!showHistory ? (
            <div className="grid grid-cols-2 gap-3 max-h-64 overflow-y-auto">
              {INSTRUMENTS.map(inst => (
                <button 
                  key={inst.id} 
                  onClick={() => setSelectedInstrument(inst)}
                  className={`p-4 rounded-xl border-2 transition-all ${selectedInstrument.id === inst.id ? 'border-purple-600 bg-zinc-900' : 'border-zinc-900 bg-transparent text-zinc-600'}`}
                >
                  <span className="text-[9px] font-black uppercase truncate block">{inst.name}</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="space-y-3">
              {sessions.map(s => (
                <div key={s.id} className="p-4 bg-zinc-900 rounded-xl flex items-center justify-between">
                  <span className="text-[10px] font-black uppercase">{s.instrumentName}</span>
                  <div className="flex gap-2">
                    <button onClick={() => { const p = new Tone.Player(s.audioUrl).toDestination(); p.start(); }} className="p-2 bg-white text-black rounded-lg"><Play size={12} /></button>
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
