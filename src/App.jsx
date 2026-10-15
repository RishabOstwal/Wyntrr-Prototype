import { useEffect, useRef, useState } from 'react';
import { Camera, LoaderCircle, Maximize2, Minimize2, Mic, MicOff, PhoneOff, Video, X } from 'lucide-react';
import DailyIframe from '@daily-co/daily-js';

const loadDailyClient = () => Promise.resolve(DailyIframe);

const readStored = (key, fallback) => {
  try {
    const stored = localStorage.getItem(key);
    return stored ? JSON.parse(stored) : fallback;
  } catch {
    return fallback;
  }
};

function ParticipantMedia({ participant, local = false }) {
  const videoRef = useRef(null);
  const audioRef = useRef(null);
  const [videoPlaying, setVideoPlaying] = useState(false);
  const videoState = participant?.tracks?.video?.state;
  const videoTrack = participant?.tracks?.video?.persistentTrack;
  const videoReady = Boolean(videoTrack && videoState === 'playable');
  const audioTrack = participant?.tracks?.audio?.persistentTrack;

  useEffect(() => {
    setVideoPlaying(false);
    if (!videoRef.current || !videoTrack || !videoReady) return;
    videoRef.current.srcObject = new MediaStream([videoTrack]);
    videoRef.current.play().catch(() => {});
    return () => { if (videoRef.current) videoRef.current.srcObject = null; };
  }, [videoTrack, videoReady]);

  useEffect(() => {
    if (!audioRef.current || !audioTrack || local) return;
    audioRef.current.srcObject = new MediaStream([audioTrack]);
    audioRef.current.play().catch(() => {});
    return () => { if (audioRef.current) audioRef.current.srcObject = null; };
  }, [audioTrack, local]);

  return <div className={local ? 'participant-tile local-tile' : 'participant-tile remote-tile'}>
    {videoReady && participant.video ? <><video ref={videoRef} className={videoPlaying ? 'video-playing' : 'video-waiting'} onPlaying={() => setVideoPlaying(true)} onWaiting={() => setVideoPlaying(false)} autoPlay playsInline muted={local} />{!videoPlaying && <div className="participant-placeholder"><div className="placeholder-avatar"><LoaderCircle size={24} className="spin" /></div><span>Waiting for video...</span></div>}</> : <div className="participant-placeholder"><div className="placeholder-avatar">{!local && <LoaderCircle size={24} className="spin" />}</div><span>{local ? 'You' : `Waiting for ${participant.user_name || 'PAL'} video...`}</span></div>}
    {!local && <audio ref={audioRef} autoPlay />}
    <span className="participant-name">{participant.user_name || (local ? 'You' : 'PAL')}</span>
  </div>;
}

function App() {
  const [active, setActive] = useState(null);
  const [tavusReady, setTavusReady] = useState(false);
  const [palConfigured, setPalConfigured] = useState(false);
  const [checkingHealth, setCheckingHealth] = useState(true);
  const [busy, setBusy] = useState(false);
  const [ending, setEnding] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const callFrameRef = useRef(null);
  const dailyContainerRef = useRef(null);
  const dailyCallRef = useRef(null);
  const activeConversationRef = useRef(null);
  const endingConversationIdsRef = useRef(new Set());
  const [callConnected, setCallConnected] = useState(false);
  const [participants, setParticipants] = useState([]);
  const [cameraOn, setCameraOn] = useState(true);
  const [micOn, setMicOn] = useState(true);
  const [callError, setCallError] = useState('');
  useEffect(() => {
    fetch('/api/health')
      .then((response) => response.json())
      .then((data) => {
        setTavusReady(Boolean(data.tavusConfigured));
        setPalConfigured(Boolean(data.palConfigured));
      })
      .catch(() => { setTavusReady(false); setPalConfigured(false); })
      .finally(() => setCheckingHealth(false));
  }, []);

  useEffect(() => {
    const syncFullscreenState = () => setIsFullscreen(document.fullscreenElement === callFrameRef.current);
    document.addEventListener('fullscreenchange', syncFullscreenState);
    return () => document.removeEventListener('fullscreenchange', syncFullscreenState);
  }, []);

  useEffect(() => {
    const endConversationOnPageHide = () => {
      const conversation = activeConversationRef.current;
      if (!conversation || endingConversationIdsRef.current.has(conversation.id)) return;

      endingConversationIdsRef.current.add(conversation.id);
      const endpoint = `/api/conversations/${encodeURIComponent(conversation.id)}/end`;
      const queued = navigator.sendBeacon?.(endpoint);
      if (!queued) {
        fetch(endpoint, { method: 'POST', keepalive: true }).catch(() => {});
      }
    };

    window.addEventListener('pagehide', endConversationOnPageHide);
    return () => window.removeEventListener('pagehide', endConversationOnPageHide);
  }, []);

  useEffect(() => {
    if (!active) {
      setCallConnected(false);
      setCallError('');
      return undefined;
    }

    let disposed = false;
    let call;
    let joined = false;
    let joinTimeout;
    setCallConnected(false);
    setParticipants([]);
    setCameraOn(active.mode !== 'audio');
    setMicOn(true);
    setCallError('');

    const onJoinedMeeting = () => {
      joined = true;
      window.clearTimeout(joinTimeout);
      if (!disposed) {
        setCallConnected(true);
        setCallError('');
        setParticipants(Object.values(call?.participants?.() || {}));
      }
    };

    const syncParticipants = () => {
      if (!disposed && call) setParticipants(Object.values(call.participants() || {}));
    };

    const onCallJoinError = (event) => {
      window.clearTimeout(joinTimeout);
      if (!disposed) {
        setCallError(event?.errorMsg || event?.error?.message || event?.error?.msg || event?.message || 'The call connection encountered an error.');
      }
    };

    const onLeftMeeting = () => {
      if (!disposed) {
        setCallConnected(false);
        endConversation(active);
      }
    };

    const connectToCall = async () => {
      try {
        const DailyIframe = await loadDailyClient();
        if (disposed || !dailyContainerRef.current) return;

        // A call object gives us a custom call UI and skips Daily Prebuilt's lobby.
        call = DailyIframe.createCallObject({ subscribeToTracksAutomatically: true });
        dailyCallRef.current = call;
        call.on('joined-meeting', onJoinedMeeting);
        call.on('left-meeting', onLeftMeeting);
        call.on('participant-joined', syncParticipants);
        call.on('participant-updated', syncParticipants);
        call.on('participant-left', syncParticipants);
        call.on('track-started', syncParticipants);
        call.on('track-stopped', syncParticipants);
        call.on('error', onCallJoinError);
        call.on('load-attempt-failed', onCallJoinError);
        joinTimeout = window.setTimeout(() => {
          if (!disposed && !joined) {
            setCallError('Still connecting. Check browser camera and microphone permissions.');
          }
        }, 25000);
        await call.join({ url: active.url, startVideoOff: active.mode === 'audio' });
      } catch (joinError) {
        window.clearTimeout(joinTimeout);
        if (!disposed) setCallError(joinError?.message || 'Could not join the Tavus call.');
      }
    };

    connectToCall();
    return () => {
      disposed = true;
      window.clearTimeout(joinTimeout);
      if (dailyCallRef.current === call) dailyCallRef.current = null;
      if (call) {
        call.off('joined-meeting', onJoinedMeeting);
        call.off('left-meeting', onLeftMeeting);
        call.off('error', onCallJoinError);
        call.off('load-attempt-failed', onCallJoinError);
        call.off('participant-joined', syncParticipants);
        call.off('participant-updated', syncParticipants);
        call.off('participant-left', syncParticipants);
        call.off('track-started', syncParticipants);
        call.off('track-stopped', syncParticipants);
        call.leave().catch(() => {}).finally(() => call.destroy());
      }
      dailyContainerRef.current?.replaceChildren();
    };
  }, [active?.id, active?.url]);

  const startConversation = async (mode) => {
    setError('');
    setNotice('');
    setBusy(true);
    try {
      const response = await fetch('/api/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          audio_only: mode === 'audio',
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || result.message || 'Tavus could not create this conversation.');
      if (!result.conversation_url || !result.conversation_id) {
        throw new Error('Tavus created a response without a conversation URL. Check your PAL and Face settings.');
      }
      const session = {
        id: result.conversation_id,
        url: result.conversation_url,
        name: result.conversation_name || (mode === 'audio' ? 'Audio call' : 'Video call'),
        mode,
      };
      activeConversationRef.current = session;
      setActive(session);
    } catch (err) {
      if (document.fullscreenElement === callFrameRef.current) {
        document.exitFullscreen?.().catch(() => {});
      }
      setError(err.message || 'Something went wrong while creating the conversation.');
    } finally {
      setBusy(false);
    }
  };

  const endConversation = async (conversation = active) => {
    if (!conversation || typeof conversation.id !== 'string' || !conversation.id.trim()) return;
    if (endingConversationIdsRef.current.has(conversation.id)) return;
    endingConversationIdsRef.current.add(conversation.id);
    setEnding(true);
    setError('');
    try {
      const response = await fetch(`/api/conversations/${encodeURIComponent(conversation.id)}/end`, { method: 'POST', keepalive: true });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || result.message || 'Could not end this conversation.');
      if (document.fullscreenElement === callFrameRef.current) {
        await document.exitFullscreen?.().catch(() => {});
      }
      if (activeConversationRef.current?.id === conversation.id) {
        activeConversationRef.current = null;
        setActive(null);
      }
      setNotice('Conversation ended.');
    } catch (err) {
      setError(err.message || 'Could not end this conversation.');
    } finally {
      endingConversationIdsRef.current.delete(conversation.id);
      setEnding(false);
    }
  };

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await callFrameRef.current?.requestFullscreen?.();
      }
    } catch {
      setError('Fullscreen is unavailable in this browser. Use “Open call” to view the conversation in a full window.');
    }
  };

  return (
    <div className={`chat-shell ${active ? 'in-call' : ''}`}>
      <main className="main-panel">
        <header className="topbar">
          <span className={tavusReady ? 'connection ready' : 'connection'}><i />{checkingHealth ? 'Checking setup' : tavusReady ? 'Ready' : 'API key needed'}</span>
        </header>

        {(error || notice) && <div className={error ? 'notice error' : 'notice'} role={error ? 'alert' : 'status'}>
          <span>{error || notice}</span><button aria-label="Dismiss notification" onClick={() => { setError(''); setNotice(''); }}><X size={16} /></button>
        </div>}

        {!active ? <section className="welcome">
          <div className="welcome-mark"><Video size={24} /></div>
          <h1>What would you like to talk about?</h1>
          <div className="call-start-options">
            <button className="primary start-button" onClick={() => startConversation('video')} disabled={busy || checkingHealth || !tavusReady || !palConfigured}>
              {busy ? <LoaderCircle size={17} className="spin" /> : <Video size={17} />}{busy ? 'Connecting...' : 'Start video call'}
            </button>
          </div>
          {!palConfigured && <div className="privacy-note">Add TAVUS_PAL_ID to the server .env file to enable calls.</div>}
        </section> : <div className="conversation">
          <section className="video-column">
            <div ref={callFrameRef} className="call-frame">
              <div ref={dailyContainerRef} className="custom-call-stage">
                {participants.filter((participant) => !participant.local).map((participant) => <ParticipantMedia key={participant.session_id} participant={participant} />)}
                {!callConnected && <div className="joining-state"><LoaderCircle size={22} className="spin" /><span>{callError ? 'Having trouble connecting' : 'Connecting to your Tavus call...'}</span></div>}
                {active.mode === 'audio' && callConnected && <div className="audio-presence"><div className="audio-orb"><span /><span /><span /><span /><span /></div><strong>PAL</strong><small>Audio call</small></div>}
                {participants.filter((participant) => participant.local).map((participant) => <ParticipantMedia key={participant.session_id} participant={participant} local />)}
                {callConnected && <div className="call-controls">
                  <button aria-label={cameraOn ? 'Turn camera off' : 'Turn camera on'} onClick={async () => { const next = !cameraOn; await dailyCallRef.current?.setLocalVideo(next); setCameraOn(next); }}><Camera size={19} />{cameraOn ? 'Camera' : 'Camera off'}</button>
                  <button aria-label={micOn ? 'Mute microphone' : 'Unmute microphone'} onClick={async () => { const next = !micOn; await dailyCallRef.current?.setLocalAudio(next); setMicOn(next); }}>{micOn ? <Mic size={19} /> : <MicOff size={19} />}{micOn ? 'Mic' : 'Muted'}</button>
                  <button className="leave-call" aria-label="Leave call" onClick={() => endConversation()} disabled={ending}><PhoneOff size={19} />Leave</button>
                </div>}
              </div>
              <div className="fullscreen-controls">
                <button onClick={toggleFullscreen}><Minimize2 size={16} />Exit fullscreen</button>
                <button className="end-button" onClick={() => endConversation()} disabled={ending}>{ending ? 'Ending...' : 'End call'}</button>
              </div>
            </div>
            <div className="call-toolbar">
              <span className="call-state"><i className={callConnected ? 'online' : ''} />{callConnected ? 'Connected' : callError ? 'Connection issue' : 'Joining call...'}</span>
              <div className="toolbar-actions">
                <button onClick={toggleFullscreen}>{isFullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}{isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}</button>
                <button className="end-button" onClick={() => endConversation()} disabled={ending}>{ending ? 'Ending...' : 'End call'}</button>
              </div>
            </div>
            {callError && <div className="call-error" role="alert"><span>{callError}</span><button onClick={() => endConversation()} disabled={ending}>{ending ? 'Ending...' : 'End call'}</button></div>}
          </section>

        </div>}
      </main>
    </div>
  );
}

export default App;
