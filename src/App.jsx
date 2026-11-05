import { useEffect, useRef, useState } from 'react';
import { Camera, CameraOff, Eye, EyeOff, LoaderCircle, Mic, MicOff, PhoneOff, ScanFace, SwitchCamera, X } from 'lucide-react';
import DailyIframe from '@daily-co/daily-js';

const loadDailyClient = () => Promise.resolve(DailyIframe);
const LOGIN_API_URL = '/api/auth/login';
const REMEMBERED_LOGIN_KEY = 'wyntrr.rememberedLogin';

function redactApiDebugValue(value, key = '') {
  if (/(password|token|secret|authorization|api.?key|email)/i.test(key)) return '[REDACTED]';
  if (Array.isArray(value)) return value.map((item) => redactApiDebugValue(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([childKey, childValue]) => [childKey, redactApiDebugValue(childValue, childKey)]));
  }
  if (typeof value === 'string' && /url$/i.test(key)) {
    try {
      const url = new URL(value, window.location.origin);
      for (const queryKey of url.searchParams.keys()) {
        if (/(token|secret|key|auth|jwt)/i.test(queryKey)) url.searchParams.set(queryKey, '[REDACTED]');
      }
      return url.toString();
    } catch {
      return value;
    }
  }
  return value;
}

async function fetchWithDebug(input, init) {
  const requestUrl = typeof input === 'string' ? input : input.url;
  try {
    const response = await fetch(input, init);
    let body = null;
    try {
      const responseText = await response.clone().text();
      if (responseText) {
        try {
          body = redactApiDebugValue(JSON.parse(responseText));
        } catch {
          body = responseText.slice(0, 4000);
        }
      }
    } catch {
      body = '[Unable to read response body]';
    }
    console.info('[api-response]', { url: requestUrl, status: response.status, ok: response.ok, body });
    return response;
  } catch (error) {
    console.info('[api-response]', { url: requestUrl, ok: false, error: error?.message || 'Network error' });
    throw error;
  }
}

const chatPartners = {
  'lil-spark': {
    name: 'Lil Spark',
    label: "LIL'SPARK",
    icon: '/lil-spark-icon.png',
    avatar: '/lil-spark-avatar.png',
    background: 'partner-lil-spark',
    greeting: "Join LIL'SPARK for a live chat filled with laughs, stories, and playful surprises. Ready, Set, Spark!",
  },
  wyntrr: {
    name: 'Wyntrr',
    label: 'WYNTRR',
    icon: '/wyntrr-icon.png',
    avatar: '/wyntrr-portrait.png',
    background: 'partner-wyntrr',
    greeting: 'A friendly chat, a creative idea, or anything on your mind. Wyntrr is here to talk with you.',
  },
};

function userFacingCallMessage(message, fallback) {
  if (typeof message !== 'string' || !message.trim()) return fallback;
  if (/NotReadableError|camera.*in use|cam in use|could not start video source/i.test(message)) {
    return 'The camera is already in use or the previous call is still releasing it. Close other apps using the camera, wait a moment, and try again.';
  }
  return /tavus/i.test(message) ? fallback : message;
}

function backgroundBlurFailureMessage(errorMessage) {
  if (isMobileBrowser()) return 'Mobile background blur could not start. Turn it off and try again.';
  return userFacingCallMessage(errorMessage, 'Background blur could not start. Try turning it off and on again.');
}

function isMobileBrowser() {
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function createMutedSpeechDetector(audioTrack, onSpeechDetected) {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!audioTrack || !AudioContextClass) return null;

  let monitorTrack;
  let audioContext;
  let source;
  let analyser;
  let resumePromise;
  let animationFrame;
  let stopped = false;

  try {
    monitorTrack = audioTrack.clone();
    audioContext = new AudioContextClass();
    source = audioContext.createMediaStreamSource(new MediaStream([monitorTrack]));
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 2048;
    source.connect(analyser);
    resumePromise = audioContext.resume().then(() => true, () => false);
  } catch {
    monitorTrack?.stop();
    audioContext?.close().catch(() => {});
    return null;
  }

  const stop = () => {
    if (stopped) return;
    stopped = true;
    window.cancelAnimationFrame(animationFrame);
    source.disconnect();
    monitorTrack.stop();
    audioContext.close().catch(() => {});
  };

  const start = async () => {
    try {
      if (!await resumePromise) {
        stop();
        return;
      }
    } catch {
      stop();
      return;
    }

    const samples = new Float32Array(analyser.fftSize);
    let voiceFrames = 0;
    const sampleAudio = () => {
      if (stopped) return;
      analyser.getFloatTimeDomainData(samples);
      const rms = Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length);
      voiceFrames = rms > 0.035 ? voiceFrames + 1 : 0;
      if (voiceFrames >= 7) {
        stop();
        onSpeechDetected();
        return;
      }
      animationFrame = window.requestAnimationFrame(sampleAudio);
    };

    animationFrame = window.requestAnimationFrame(sampleAudio);
  };

  return { start, stop };
}

const readStored = (key, fallback) => {
  try {
    const stored = localStorage.getItem(key);
    return stored ? JSON.parse(stored) : fallback;
  } catch {
    return fallback;
  }
};

function ParticipantMedia({ participant, local = false, onSwitchCamera, cameraSwitching = false, cameraOn = true, displayName = 'Wyntrr' }) {
  const videoRef = useRef(null);
  const audioRef = useRef(null);
  const [videoPlaying, setVideoPlaying] = useState(false);
  const videoState = participant?.tracks?.video?.state;
  const videoTrack = participant?.tracks?.video?.persistentTrack;
  const videoReady = Boolean(videoTrack && videoState === 'playable');
  const audioState = participant?.tracks?.audio?.state;
  const audioTrack = participant?.tracks?.audio?.track;

  useEffect(() => {
    setVideoPlaying(false);
    if (!videoRef.current || !videoTrack || !videoReady) return;
    videoRef.current.srcObject = new MediaStream([videoTrack]);
    videoRef.current.play().catch(() => {});
    return () => { if (videoRef.current) videoRef.current.srcObject = null; };
  }, [videoTrack, videoReady]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || local) return;

    if (audioState !== 'playable' || !audioTrack) {
      audio.pause();
      audio.srcObject = null;
      return;
    }

    const stream = new MediaStream([audioTrack]);
    const resumeAudio = () => {
      audio.srcObject = stream;
      audio.play().catch(() => {});
    };
    audio.volume = 1;
    audio.muted = false;
    resumeAudio();
    audioTrack.addEventListener('unmute', resumeAudio);
    return () => {
      audioTrack.removeEventListener('unmute', resumeAudio);
      audio.pause();
      audio.srcObject = null;
    };
  }, [audioState, audioTrack, local]);

  const tileRef = useRef(null);
  const dragRef = useRef(null);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (!local || !tileRef.current?.parentElement) return;
    const observer = new ResizeObserver(() => {
      dragRef.current = null;
      setDragging(false);
      setOffset({ x: 0, y: 0 });
    });
    observer.observe(tileRef.current.parentElement);
    return () => observer.disconnect();
  }, [local]);

  const startDrag = (event) => {
    if (!local || (event.pointerType === 'mouse' && event.button !== 0)) return;
    const tile = tileRef.current;
    if (!tile?.parentElement) return;
    tile.setPointerCapture(event.pointerId);
    dragRef.current = { startX: event.clientX, startY: event.clientY, origin: offset, rect: tile.getBoundingClientRect(), bounds: tile.parentElement.getBoundingClientRect() };
    setDragging(true);
  };

  const moveDrag = (event) => {
    const drag = dragRef.current;
    if (!drag) return;
    const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
    const dx = clamp(event.clientX - drag.startX, drag.bounds.left - drag.rect.left, drag.bounds.right - drag.rect.right);
    const dy = clamp(event.clientY - drag.startY, drag.bounds.top - drag.rect.top, drag.bounds.bottom - drag.rect.bottom);
    setOffset({ x: drag.origin.x + dx, y: drag.origin.y + dy });
  };

  const endDrag = () => {
    dragRef.current = null;
    setDragging(false);
  };

  return <div ref={tileRef} className={local ? `participant-tile local-tile${dragging ? ' dragging' : ''}` : 'participant-tile remote-tile'} style={local ? { transform: `translate(${offset.x}px, ${offset.y}px)` } : undefined} onPointerDown={local ? startDrag : undefined} onPointerMove={local ? moveDrag : undefined} onPointerUp={local ? endDrag : undefined} onPointerCancel={local ? endDrag : undefined}>
    {videoReady && participant.video ? <><video ref={videoRef} className={videoPlaying ? 'video-playing' : 'video-waiting'} onPlaying={() => setVideoPlaying(true)} onWaiting={() => setVideoPlaying(false)} autoPlay playsInline muted={local} />{!videoPlaying && <div className="participant-placeholder"><div className="placeholder-avatar"><LoaderCircle size={24} className="spin" /></div><span>Waiting for video...</span></div>}</> : <div className="participant-placeholder"><div className="placeholder-avatar">{!local && <LoaderCircle size={24} className="spin" />}</div><span>{local ? 'You' : `Waiting for ${displayName} video...`}</span></div>}
    {local && cameraOn && <button className="switch-camera" type="button" aria-label="Switch camera" title="Switch camera" disabled={cameraSwitching} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); onSwitchCamera(); }}><SwitchCamera size={18} /></button>}
    {!local && <audio ref={audioRef} autoPlay />}
    <span className="participant-name">{local ? (participant.user_name || 'You') : displayName}</span>
  </div>;
}

function App() {
  const [loginComplete, setLoginComplete] = useState(false);
  const [loginSession, setLoginSession] = useState(null);
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [loginBusy, setLoginBusy] = useState(false);
  const [loginError, setLoginError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(() => Boolean(readStored(REMEMBERED_LOGIN_KEY, null)));
  const [active, setActive] = useState(null);
  const [selectedPartner, setSelectedPartner] = useState(null);
  const [tavusReady, setTavusReady] = useState(false);
  const [palConfigured, setPalConfigured] = useState(false);
  const [lilSparkConfigured, setLilSparkConfigured] = useState(false);
  const [checkingHealth, setCheckingHealth] = useState(true);
  const [busy, setBusy] = useState(false);
  const [ending, setEnding] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const dailyContainerRef = useRef(null);
  const logoutTriggerRef = useRef(null);
  const logoutCancelRef = useRef(null);
  const loginEmailRef = useRef(null);
  const loginPasswordRef = useRef(null);
  const rememberedCredentialsRef = useRef(null);
  const dailyCallRef = useRef(null);
  const mobileBlurPipelineRef = useRef(null);
  const pendingCallCleanupRef = useRef(Promise.resolve());
  const activeConversationRef = useRef(null);
  const endingConversationIdsRef = useRef(new Set());
  const callStartedAtRef = useRef(null);
  const lemonSliceMessagesRef = useRef([]);
  const [callConnected, setCallConnected] = useState(false);
  const [participants, setParticipants] = useState([]);
  const [cameraOn, setCameraOn] = useState(true);
  const [cameraSwitching, setCameraSwitching] = useState(false);
  const [backgroundBlurStrength, setBackgroundBlurStrength] = useState(null);
  const [backgroundBlurBusy, setBackgroundBlurBusy] = useState(false);
  const [backgroundBlurMenuOpen, setBackgroundBlurMenuOpen] = useState(false);
  const backgroundBlurControlRef = useRef(null);
  const backgroundBlurTriggerRef = useRef(null);
  const backgroundBlurRequestRef = useRef(0);
  const [micOn, setMicOn] = useState(true);
  const [captionsEnabled, setCaptionsEnabled] = useState(false);
  const [captions, setCaptions] = useState([]);
  const [callError, setCallError] = useState('');
  const mutedSpeechDetectorRef = useRef(null);
  const captionSequenceRef = useRef(0);
  const captionTranscriptRef = useRef(null);
  useEffect(() => {
    let mounted = true;
    if (loginComplete) return undefined;

    const rememberedCredentials = rememberedCredentialsRef.current
      || (rememberMe ? readStored(REMEMBERED_LOGIN_KEY, null) : null);
    if (rememberMe && typeof rememberedCredentials?.email === 'string' && typeof rememberedCredentials?.password === 'string') {
      rememberedCredentialsRef.current = rememberedCredentials;
      if (loginEmailRef.current) loginEmailRef.current.value = rememberedCredentials.email;
      if (loginPasswordRef.current) loginPasswordRef.current.value = rememberedCredentials.password;
      return undefined;
    }

    if (!window.isSecureContext || !window.PasswordCredential || !navigator.credentials?.get) return undefined;

    navigator.credentials.get({ password: true, mediation: 'optional' }).then((credential) => {
      if (!mounted || !credential || credential.type !== 'password') return;
      if (loginEmailRef.current?.value || loginPasswordRef.current?.value) return;
      if (loginEmailRef.current) loginEmailRef.current.value = credential.id;
      if (loginPasswordRef.current) loginPasswordRef.current.value = credential.password;
      setRememberMe(true);
    }).catch(() => {});

    return () => { mounted = false; };
  }, [loginComplete]);
  useEffect(() => {
    if (captionsEnabled && captionTranscriptRef.current) {
      captionTranscriptRef.current.scrollTop = captionTranscriptRef.current.scrollHeight;
    }
  }, [captions, captionsEnabled]);
  useEffect(() => {
    if (!backgroundBlurMenuOpen) return undefined;

    const closeOnOutsidePointer = (event) => {
      if (!backgroundBlurControlRef.current?.contains(event.target)) setBackgroundBlurMenuOpen(false);
    };
    const closeOnEscape = (event) => {
      if (event.key !== 'Escape') return;
      setBackgroundBlurMenuOpen(false);
      backgroundBlurTriggerRef.current?.focus();
    };

    document.addEventListener('pointerdown', closeOnOutsidePointer);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [backgroundBlurMenuOpen]);
  useEffect(() => {
    if (!logoutOpen) return undefined;

    logoutCancelRef.current?.focus();
    const closeOnEscape = (event) => {
      if (event.key !== 'Escape') return;
      setLogoutOpen(false);
      logoutTriggerRef.current?.focus();
    };
    const keepFocusInDialog = (event) => {
      if (event.key !== 'Tab') return;
      const buttons = document.querySelectorAll('.logout-dialog button');
      const first = buttons[0];
      const last = buttons[buttons.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener('keydown', closeOnEscape);
    document.addEventListener('keydown', keepFocusInDialog);
    return () => {
      document.removeEventListener('keydown', closeOnEscape);
      document.removeEventListener('keydown', keepFocusInDialog);
    };
  }, [logoutOpen]);
  useEffect(() => {
    fetchWithDebug('/api/health')
      .then((response) => response.json())
      .then((data) => {
        setTavusReady(Boolean(data.tavusConfigured));
        setPalConfigured(Boolean(data.palConfigured));
        setLilSparkConfigured(Boolean(data.lilSparkConfigured));
      })
      .catch(() => { setTavusReady(false); setPalConfigured(false); })
      .finally(() => setCheckingHealth(false));
  }, []);

  useEffect(() => {
    const endConversationOnPageHide = () => {
      const conversation = activeConversationRef.current;
      if (!conversation || conversation.provider === 'lemonslice' || endingConversationIdsRef.current.has(conversation.id)) return;

      endingConversationIdsRef.current.add(conversation.id);
      const endpoint = `/api/conversations/${encodeURIComponent(conversation.id)}/end`;
      const queued = navigator.sendBeacon?.(endpoint);
      if (!queued) {
        fetchWithDebug(endpoint, { method: 'POST', keepalive: true }).catch(() => {});
      }
    };

    window.addEventListener('pagehide', endConversationOnPageHide);
    return () => window.removeEventListener('pagehide', endConversationOnPageHide);
  }, []);

  useEffect(() => {
    if (!active) {
      setCallConnected(false);
      setCallError('');
      backgroundBlurRequestRef.current += 1;
      mobileBlurPipelineRef.current?.stop();
      mobileBlurPipelineRef.current = null;
      setBackgroundBlurStrength(null);
      setBackgroundBlurBusy(false);
      setBackgroundBlurMenuOpen(false);
      return undefined;
    }

    let disposed = false;
    let call;
    let joined = false;
    let joinTimeout;
    setCallConnected(false);
    setParticipants([]);
    setCameraOn(active.mode !== 'audio');
    backgroundBlurRequestRef.current += 1;
    setBackgroundBlurStrength(null);
    setBackgroundBlurBusy(false);
    setBackgroundBlurMenuOpen(false);
    setMicOn(true);
    setCaptions([]);
    setCallError('');
    callStartedAtRef.current = null;
    if (active.provider === 'lemonslice') lemonSliceMessagesRef.current = [];

    const onJoinedMeeting = () => {
      joined = true;
      callStartedAtRef.current ??= Date.now();
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

    const onAppMessage = (event) => {
      let message = event?.data;
      if (typeof message === 'string') {
        try {
          message = JSON.parse(message);
        } catch {
          return;
        }
      }
      if (!message || typeof message !== 'object') return;
      if (message.type === 'user_transcription' || message.type === 'agent_transcription') {
        const transcript = typeof message.transcription === 'string' ? message.transcription.trim() : '';
        if (disposed || !transcript) return;
        const role = message.type === 'user_transcription' ? 'user' : 'assistant';
        if (active.provider === 'lemonslice') {
          const offsetSeconds = callStartedAtRef.current
            ? Math.max(0, (Date.now() - callStartedAtRef.current) / 1000)
            : 0;
          const language = message.language ?? message.language_code ?? message.metadata?.language;
          lemonSliceMessagesRef.current.push({
            role,
            text: transcript,
            offsetSeconds: Math.round(offsetSeconds * 1000) / 1000,
            ...(typeof language === 'string' && language.trim() ? { metadata: { language: language.trim() } } : {}),
          });
        }
        const captionRole = role === 'assistant' ? 'replica' : 'user';
        setCaptions((previous) => [...previous, { id: `caption-${++captionSequenceRef.current}`, role: captionRole, text: transcript, streaming: false }].slice(-4));
        return;
      }
      const eventType = message.event_type;
      if (!['conversation.utterance.streaming', 'conversation.utterance'].includes(eventType)) return;

      const properties = message.properties && typeof message.properties === 'object' ? message.properties : {};
      const text = [
        properties.text, message.text,
        properties.speech, message.speech,
        properties.content, message.content,
        properties.transcript, message.transcript,
      ].find((value) => typeof value === 'string' && value.trim());
      const rawRole = String(properties.role ?? message.role ?? '').toLowerCase();
      const isReplica = ['replica', 'assistant'].includes(rawRole)
        || Boolean(properties.inference_id ?? message.inference_id)
        || eventType === 'conversation.utterance';
      const role = rawRole === 'user' ? 'user' : isReplica ? 'replica' : 'user';
      if (disposed || typeof text !== 'string') return;
      const streaming = eventType === 'conversation.utterance.streaming';
      const utteranceId = [properties.utterance_id, message.utterance_id, properties.inference_id, message.inference_id]
        .find((value) => typeof value === 'string' && value.trim());
      const entryId = utteranceId || `caption-${++captionSequenceRef.current}`;
      setCaptions((previous) => {
        const matchingIndex = utteranceId ? previous.findIndex((entry) => entry.utteranceId === utteranceId) : -1;
        const lastIndex = previous.length - 1;
        const updateIndex = matchingIndex >= 0
          ? matchingIndex
          : lastIndex >= 0 && previous[lastIndex].streaming && previous[lastIndex].role === role ? lastIndex : -1;
        const entry = { id: updateIndex >= 0 ? previous[updateIndex].id : entryId, utteranceId, role, text, streaming };
        if (updateIndex >= 0) {
          return previous.map((item, index) => index === updateIndex ? entry : item);
        }
        return [...previous, entry].slice(-4);
      });
    };

    const onCallJoinError = (event) => {
      window.clearTimeout(joinTimeout);
      if (!disposed) {
      setCallError(userFacingCallMessage(event?.errorMsg || event?.error?.message || event?.error?.msg || event?.message, 'The call connection encountered an error.'));
      }
    };

    const onNonfatalError = (event) => {
      if (!['input-settings-error', 'video-processor-error'].includes(event?.type)) return;

      backgroundBlurRequestRef.current += 1;
      setBackgroundBlurStrength(null);
      setBackgroundBlurBusy(false);
      setCallError(backgroundBlurFailureMessage(event?.errorMsg));
    };

    const onLeftMeeting = () => {
      if (!disposed) {
        setCallConnected(false);
        endConversation(active, 'client_disconnected');
      }
    };

    const connectToCall = async () => {
      try {
        await pendingCallCleanupRef.current;
        if (disposed || !dailyContainerRef.current) return;
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
        call.on('app-message', onAppMessage);
        call.on('error', onCallJoinError);
        call.on('load-attempt-failed', onCallJoinError);
        call.on('nonfatal-error', onNonfatalError);
        joinTimeout = window.setTimeout(() => {
          if (!disposed && !joined) {
            setCallError('Still connecting. Check browser camera and microphone permissions.');
          }
        }, 25000);
        await call.join({ url: active.url, ...(active.token ? { token: active.token } : {}), startVideoOff: active.mode === 'audio' });
      } catch (joinError) {
        window.clearTimeout(joinTimeout);
        if (!disposed) setCallError(userFacingCallMessage(joinError?.message, 'Could not join the call.'));
      }
    };

    connectToCall();
    return () => {
      disposed = true;
      mutedSpeechDetectorRef.current?.stop();
      mutedSpeechDetectorRef.current = null;
      mobileBlurPipelineRef.current?.stop();
      mobileBlurPipelineRef.current = null;
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
        call.off('app-message', onAppMessage);
        call.off('nonfatal-error', onNonfatalError);
        const cleanup = (async () => {
          try { await call.leave(); } catch { /* the call may already have ended */ }
          try { await call.destroy(); } catch { /* release any remaining call resources */ }
        })();
        pendingCallCleanupRef.current = cleanup;
        cleanup.finally(() => {
          if (pendingCallCleanupRef.current === cleanup) pendingCallCleanupRef.current = Promise.resolve();
        });
      }
      dailyContainerRef.current?.replaceChildren();
    };
  }, [active?.id, active?.url]);

  const startConversation = async (mode) => {
    setError('');
    setNotice('');
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setError('For calls from another computer, open this site over trusted HTTPS. Plain HTTP LAN addresses cannot access the camera or microphone.');
      return;
    }
    if (typeof window.RTCPeerConnection !== 'function') {
      setError('This browser does not have WebRTC available. Try an up-to-date version of Chrome, Edge, Firefox, or Safari.');
      return;
    }
    setBusy(true);
    try {
      const provider = selectedPartner === 'lil-spark' ? 'lemonslice' : 'tavus';
      const response = await fetchWithDebug('/api/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          partner: selectedPartner,
          audio_only: mode === 'audio',
          conversational_context: [
            `At the start of this call, the user's camera is ${mode === 'audio' ? 'OFF' : 'ON'}.`,
            'The app will send an update whenever the camera state changes; the latest update is authoritative and supersedes earlier states.',
            'Never claim to currently see the user just because they ask. If the camera is OFF, or live visual input is unavailable, clearly say you cannot currently see them.',
          ].join(' '),
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(userFacingCallMessage(result.error || result.message, 'Could not start the call.'));
      if (!result.conversation_url || !result.conversation_id) {
        throw new Error('The call service response was missing a connection URL. Check your call profile and avatar settings.');
      }
      const session = {
        id: result.conversation_id,
        url: result.conversation_url,
        token: result.token,
        provider: result.provider || provider,
        name: result.conversation_name || (mode === 'audio' ? 'Audio call' : 'Video call'),
        mode,
        videoSessionId: null,
        expectedRevision: null,
      };
      try {
        const trackingPayload = {
          provider,
          providerSessionId: result.conversation_id,
          conversationId: loginSession?.conversationId,
          metadata: { source: 'web' },
        };
        console.info('[video-session-create] request', {
          url: '/api/video/sessions',
          provider: trackingPayload.provider,
          providerSessionId: trackingPayload.providerSessionId,
          conversationId: trackingPayload.conversationId,
        });
        const trackingResponse = await fetchWithDebug('/api/video/sessions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...trackingPayload,
            token: loginSession?.token,
          }),
        });
        const trackingResult = await trackingResponse.json().catch(() => null);
        if (!trackingResponse.ok) {
          setNotice(trackingResult?.error || trackingResult?.message || 'The call started, but its session could not be saved.');
        } else {
          session.videoSessionId = typeof trackingResult?.id === 'string' ? trackingResult.id : null;
          session.expectedRevision = Number.isInteger(trackingResult?.revision) ? trackingResult.revision : null;
          if (!session.videoSessionId || session.expectedRevision === null) {
            setNotice('The call started, but the session response did not include its ID and revision.');
          }
        }
      } catch {
        setNotice('The call started, but its session could not be saved.');
      }
      activeConversationRef.current = session;
      setActive(session);
    } catch (err) {
      setError(err.message || 'Something went wrong while creating the conversation.');
    } finally {
      setBusy(false);
    }
  };

  const signIn = async (event) => {
    event.preventDefault();
    setLoginError('');
    const formData = new FormData(event.currentTarget);
    setLoginBusy(true);
    try {
      const response = await fetchWithDebug(LOGIN_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: formData.get('email'),
          password: formData.get('password'),
        }),
      });
      const contentType = response.headers.get('content-type') || '';
      if (!response.ok) {
        const payload = contentType.includes('application/json') ? await response.json().catch(() => null) : null;
        throw new Error(payload?.message || payload?.error || (response.status === 401 || response.status === 403 ? 'Email or password is incorrect.' : 'Could not sign in. Please try again.'));
      }
      if (!contentType.includes('application/json')) {
        throw new Error('The sign-in service returned an unexpected response.');
      }
      const payload = await response.json();
      if (payload?.success === false || payload?.authenticated === false || payload?.ok === false) {
        throw new Error(payload.message || payload.error || 'Email or password is incorrect.');
      }
      if (typeof payload?.conversationId !== 'string' || !payload.conversationId.trim()) {
        throw new Error('The login response did not include a conversation ID.');
      }
      if (rememberMe) {
        rememberedCredentialsRef.current = {
          email: String(formData.get('email') || ''),
          password: String(formData.get('password') || ''),
        };
        try {
          localStorage.setItem(REMEMBERED_LOGIN_KEY, JSON.stringify(rememberedCredentialsRef.current));
        } catch {
          // The in-memory copy still supports logging out without reloading.
        }
      } else {
        rememberedCredentialsRef.current = null;
        try { localStorage.removeItem(REMEMBERED_LOGIN_KEY); } catch { /* Storage may be unavailable. */ }
      }
      if (rememberMe && window.isSecureContext && window.PasswordCredential && navigator.credentials?.store) {
        try {
          const credential = new window.PasswordCredential({
            id: String(formData.get('email') || ''),
            password: String(formData.get('password') || ''),
            name: String(formData.get('email') || ''),
          });
          navigator.credentials.store(credential).catch(() => {});
        } catch {
          // Credential storage is optional and must not block a successful sign-in.
        }
      }
      setLoginSession({ conversationId: payload.conversationId, token: payload.token });
      setLoginComplete(true);
    } catch (signInError) {
      setLoginError(signInError instanceof TypeError ? 'Could not reach the sign-in service. Check the connection and try again.' : (signInError.message || 'Could not sign in. Please try again.'));
    } finally {
      setLoginBusy(false);
    }
  };

  const endConversation = async (conversation = active, requestedEndReason = 'user_ended_call') => {
    if (!conversation || typeof conversation.id !== 'string' || !conversation.id.trim()) return;
    if (endingConversationIdsRef.current.has(conversation.id)) return;
    endingConversationIdsRef.current.add(conversation.id);
    setEnding(true);
    setError('');
    let endNotice = 'Conversation ended.';
    let messages = [];
    let cost;
    let endReason = requestedEndReason;
    try {
      if (conversation.provider === 'lemonslice') {
        // Stops the avatar and its billing before this client leaves the room.
        try { dailyCallRef.current?.sendAppMessage({ event: 'force-end' }, '*'); } catch { /* the room may already be closed */ }
      } else {
        const response = await fetchWithDebug(`/api/conversations/${encodeURIComponent(conversation.id)}/end`, { method: 'POST', keepalive: true });
        const result = await response.json();
        if (!response.ok) throw new Error(userFacingCallMessage(result.error || result.message, 'Could not end this conversation.'));

        try {
          const detailsResponse = await fetchWithDebug(`/api/conversations/${encodeURIComponent(conversation.id)}?verbose=true`);
          const details = await detailsResponse.json();
          if (!detailsResponse.ok) throw new Error(details.error || 'Could not retrieve the Tavus conversation.');
          if (!details.transcriptReady) endNotice = 'Conversation ended. Tavus has not returned a transcript yet.';
          messages = Array.isArray(details.messages) ? details.messages : [];
          const tavusConversation = details.conversation;
          const finalCost = tavusConversation?.cost ?? tavusConversation?.properties?.cost;
          if (Number.isFinite(finalCost)) cost = finalCost;
          const finalReason = tavusConversation?.end_reason ?? tavusConversation?.endReason;
          if (typeof finalReason === 'string' && finalReason.trim()) endReason = finalReason.trim();
        } catch {
          endNotice = 'Conversation ended, but Tavus conversation details could not be retrieved.';
        }
      }

      if (conversation.provider === 'lemonslice') messages = [...lemonSliceMessagesRef.current];

      const durationSeconds = callStartedAtRef.current
        ? Math.round(Math.max(0, (Date.now() - callStartedAtRef.current) / 1000) * 1000) / 1000
        : 0;
      if (conversation.videoSessionId && Number.isInteger(conversation.expectedRevision)) {
        const logUrl = `/api/video/sessions/${encodeURIComponent(conversation.videoSessionId)}/logs`;
        const logBody = {
          providerSessionId: conversation.id,
          status: 'completed',
          expectedRevision: conversation.expectedRevision,
          durationSeconds,
          ...(Number.isFinite(cost) ? { cost } : {}),
          endReason,
          messages,
          metadata: { source: 'web' },
          token: loginSession?.token,
        };
        const debugBody = { ...logBody };
        delete debugBody.token;
        console.log('[video-session-log] request', { url: logUrl, body: debugBody });
        try {
          const logResponse = await fetchWithDebug(logUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(logBody),
          });
          const logResult = await logResponse.json().catch(() => null);
          if (!logResponse.ok) {
            endNotice = `Conversation ended, but its log could not be saved: ${logResult?.error || 'the log service returned an error.'}`;
          }
        } catch {
          endNotice = 'Conversation ended, but its log could not be saved because the service could not be reached.';
        }
      } else {
        console.warn('[video-session-log] skipped: the session response did not provide an ID and revision.', {
          videoSessionId: conversation.videoSessionId ?? null,
          expectedRevision: conversation.expectedRevision ?? null,
        });
        endNotice = 'Conversation ended, but its log could not be saved because the session ID or revision is missing.';
      }

      if (activeConversationRef.current?.id === conversation.id) {
        activeConversationRef.current = null;
        setActive(null);
        setSelectedPartner(null);
      }
      setNotice(endNotice);
    } catch (err) {
      setError(userFacingCallMessage(err.message, 'Could not end this conversation.'));
    } finally {
      endingConversationIdsRef.current.delete(conversation.id);
      setEnding(false);
    }
  };

  const toggleCamera = async () => {
    const call = dailyCallRef.current;
    if (!call) return;

    const next = !cameraOn;
    try {
      if (!next && mobileBlurPipelineRef.current) {
        await call.updateInputSettings({ video: { settings: {} } });
        mobileBlurPipelineRef.current.stop();
        mobileBlurPipelineRef.current = null;
        setBackgroundBlurStrength(null);
      }
      await call.setLocalVideo(next);
      setCameraOn(next);

      const conversation = activeConversationRef.current;
      if (conversation?.id && conversation.provider !== 'lemonslice') {
        call.sendAppMessage({
          message_type: 'conversation',
          event_type: 'conversation.append_llm_context',
          conversation_id: conversation.id,
          properties: {
            context: `Camera state update from the app: the user's camera is now ${next ? 'ON' : 'OFF'}. This is the latest authoritative state and supersedes earlier camera states. If OFF, say you cannot currently see the user. If ON, only say you can see them when live visual input is actually available.`,
          },
        }, '*');
      }
    } catch (cameraError) {
      setCallError(userFacingCallMessage(cameraError?.message, 'Could not update the camera.'));
    }
  };

  const switchCamera = async () => {
    const call = dailyCallRef.current;
    if (!call || !cameraOn || cameraSwitching) return;

    const restoreMobileBlur = mobileBlurPipelineRef.current ? backgroundBlurStrength : null;
    setCameraSwitching(true);
    try {
      if (mobileBlurPipelineRef.current) {
        const pipeline = mobileBlurPipelineRef.current;
        await call.updateInputSettings({ video: { settings: {} } });
        mobileBlurPipelineRef.current = null;
        pipeline.stop();
        setBackgroundBlurStrength(null);
      }
      await call.cycleCamera({ preferDifferentFacingMode: true });
      if (restoreMobileBlur && !(await setBackgroundBlur(restoreMobileBlur))) setBackgroundBlurStrength(null);
    } catch (cameraError) {
      setCallError(userFacingCallMessage(cameraError?.message, 'Could not switch cameras.'));
    } finally {
      setCameraSwitching(false);
    }
  };

  const setBackgroundBlur = async (strength) => {
    const call = dailyCallRef.current;
    if (!call || !cameraOn || backgroundBlurBusy) return;

    const requestId = ++backgroundBlurRequestRef.current;
    setBackgroundBlurBusy(true);
    try {
      if (isMobileBrowser() && strength && mobileBlurPipelineRef.current) {
        mobileBlurPipelineRef.current.setStrength(strength);
      } else if (isMobileBrowser() && strength) {
        const localVideoTrack = call.participants()?.local?.tracks?.video?.persistentTrack
          || call.participants()?.local?.tracks?.video?.track;
        if (!localVideoTrack || localVideoTrack.readyState !== 'live') {
          throw new Error('The camera video is not ready yet. Try again in a moment.');
        }

        const { createMobileBackgroundBlur } = await import('./mobileBackgroundBlur.js');
        let pipeline;
        pipeline = await createMobileBackgroundBlur(localVideoTrack, strength, (blurError) => {
          if (mobileBlurPipelineRef.current !== pipeline) return;
          mobileBlurPipelineRef.current = null;
          backgroundBlurRequestRef.current += 1;
          setBackgroundBlurStrength(null);
          setBackgroundBlurBusy(false);
          call.updateInputSettings({ video: { settings: {} } }).catch(() => {});
          setCallError(blurError?.message || 'Mobile background blur stopped unexpectedly.');
        });
        if (requestId !== backgroundBlurRequestRef.current) {
          pipeline.stop();
          return false;
        }

        mobileBlurPipelineRef.current = pipeline;
        try {
          await call.updateInputSettings({ video: { settings: { customTrack: pipeline.track } } });
        } catch (blurError) {
          if (mobileBlurPipelineRef.current === pipeline) mobileBlurPipelineRef.current = null;
          pipeline.stop();
          throw blurError;
        }
      } else if (isMobileBrowser() && mobileBlurPipelineRef.current) {
        await call.updateInputSettings({ video: { settings: {} } });
        mobileBlurPipelineRef.current.stop();
        mobileBlurPipelineRef.current = null;
      } else {
        await call.updateInputSettings({
          video: {
            processor: strength ? { type: 'background-blur', config: { strength: strength === 'light' ? 0.5 : 1 } } : { type: 'none' },
          },
        });
      }
      if (requestId !== backgroundBlurRequestRef.current) return false;
      setBackgroundBlurStrength(strength);
      setBackgroundBlurMenuOpen(false);
      backgroundBlurTriggerRef.current?.focus();
      return true;
    } catch (blurError) {
      if (requestId !== backgroundBlurRequestRef.current) return false;
      setCallError(isMobileBrowser()
        ? `Mobile blur could not start. ${blurError?.message || 'Check your connection and camera, then try again.'}`
        : backgroundBlurFailureMessage(blurError?.message));
      return false;
    } finally {
      if (requestId === backgroundBlurRequestRef.current) setBackgroundBlurBusy(false);
    }
  };

  const backgroundBlur = backgroundBlurStrength !== null;

  const toggleMicrophone = async () => {
    const call = dailyCallRef.current;
    if (!call) return;

    const next = !micOn;
    const localAudioTrack = call.participants()?.local?.tracks?.audio?.persistentTrack;
    const detector = next ? null : createMutedSpeechDetector(localAudioTrack, () => {
      const conversation = activeConversationRef.current;
      if (!conversation?.id || conversation.provider === 'lemonslice') return;
      call.sendAppMessage({
        message_type: 'conversation',
        event_type: 'conversation.echo',
        conversation_id: conversation.id,
        properties: {
          modality: 'text',
          text: 'Are you saying something?',
          done: true,
        },
      }, '*');
    });

    try {
      await call.setLocalAudio(next);
      setMicOn(next);
      if (next) {
        mutedSpeechDetectorRef.current?.stop();
        mutedSpeechDetectorRef.current = null;
      } else if (detector) {
        mutedSpeechDetectorRef.current?.stop();
        mutedSpeechDetectorRef.current = detector;
        detector.start();
      }
    } catch (micError) {
      detector?.stop();
      setCallError(userFacingCallMessage(micError?.message, 'Could not update the microphone.'));
      return;
    }

    if (!next && !detector) {
      setCallError('Muted speech detection is unavailable on this device. Your microphone remains muted.');
    }
  };

  const partner = selectedPartner ? chatPartners[selectedPartner] : null;
  const partnerConfigured = selectedPartner === 'lil-spark' ? lilSparkConfigured : palConfigured;

  const confirmLogout = () => {
    setLogoutOpen(false);
    setLoginComplete(false);
    setLoginSession(null);
    setSelectedPartner(null);
    setLoginError('');
    setError('');
    setNotice('');
    setShowPassword(false);
  };

  const shellClass = active ? `in-call ${partner?.background ?? ''}` : !loginComplete ? 'login-screen' : selectedPartner ? `pal-selected ${partner.background}` : 'partner-selection';

  return (
    <div className={`chat-shell ${shellClass}`}>
      <main className="main-panel">
        {loginComplete && !active && !selectedPartner && <button ref={logoutTriggerRef} className="logout-trigger" type="button" onClick={() => setLogoutOpen(true)}>Log out</button>}
        {(error || notice) && <div className={error ? 'notice error' : 'notice'} role={error ? 'alert' : 'status'}>
          <span>{error || notice}</span><button aria-label="Dismiss notification" onClick={() => { setError(''); setNotice(''); }}><X size={16} /></button>
        </div>}

        {logoutOpen && <div className="logout-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) { setLogoutOpen(false); logoutTriggerRef.current?.focus(); } }}>
          <section className="logout-dialog" role="dialog" aria-modal="true" aria-labelledby="logout-heading" aria-describedby="logout-description">
            <img className="logout-dialog-background" src="/logout-dialog-bg.png" alt="" />
            <div className="logout-dialog-content">
              <img className="logout-dialog-icon" src="/logout-warning-icon.png" alt="" />
              <h2 id="logout-heading">Logout?</h2>
              <p id="logout-description">Are you sure you want to logout?</p>
              <div className="logout-dialog-actions">
                <button ref={logoutCancelRef} type="button" aria-label="Cancel logout" onClick={() => { setLogoutOpen(false); logoutTriggerRef.current?.focus(); }}><img src="/logout-cancel.png" alt="" /></button>
                <button type="button" aria-label="Yes, logout" onClick={confirmLogout}><img src="/logout-confirm.png" alt="" /></button>
              </div>
            </div>
          </section>
        </div>}

        {!active ? (!loginComplete ? <section className="login-panel" aria-labelledby="login-heading">
          <img className="login-logo" src="/wyntrr-logo.png" alt="Wyntrr" />
          <h1 id="login-heading">Sign In</h1>
          <form className="login-form" onSubmit={signIn}>
            <label htmlFor="login-email">Email</label>
            <input ref={loginEmailRef} id="login-email" name="email" type="email" autoComplete="username" placeholder="you@example.com" required />
            <label htmlFor="login-password">Password</label>
            <div className="login-password-input">
              <input ref={loginPasswordRef} id="login-password" name="password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" placeholder="Your password" required />
              <button className="login-password-toggle" type="button" onClick={() => setShowPassword((visible) => !visible)} aria-label={showPassword ? 'Hide password' : 'Show password'} title={showPassword ? 'Hide password' : 'Show password'}>
                {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
            <label className="login-remember">
              <input name="rememberMe" type="checkbox" checked={rememberMe} onChange={(event) => {
                const checked = event.target.checked;
                setRememberMe(checked);
                if (!checked) {
                  rememberedCredentialsRef.current = null;
                  try { localStorage.removeItem(REMEMBERED_LOGIN_KEY); } catch { /* Storage may be unavailable. */ }
                }
              }} />
              <span>Remember me</span>
            </label>
            {loginError && <p className="login-message login-error" role="alert">{loginError}</p>}
            <button className="login-submit" type="submit" disabled={loginBusy}>{loginBusy ? <><LoaderCircle size={16} className="spin" />Signing in…</> : <>Sign in <span aria-hidden="true">›</span></>}</button>
          </form>
        </section> : partner ? <section className="welcome pal-welcome">
          <img className="welcome-mark" src={partner.avatar} alt={partner.name} />
          <h1>Ready to meet {partner.name}? <img className="title-icon" src={partner.icon} alt="" /></h1>
          <p>{partner.greeting}</p>
          <div className="call-start-options">
            <button className="primary start-button" onClick={() => startConversation('video')} disabled={busy || checkingHealth || !partnerConfigured || (selectedPartner !== 'lil-spark' && !tavusReady)} aria-busy={busy}>
              {busy ? <LoaderCircle size={22} className="spin" /> : <span className="call-icon" aria-hidden="true" />}Start video call
            </button>
          </div>
          <button className="go-back" type="button" onClick={() => setSelectedPartner(null)} disabled={busy}>Go back</button>
          {!partnerConfigured && <div className="privacy-note">{selectedPartner === 'lil-spark' ? 'Configure LEMONSLICE_API_KEY and LEMONSLICE_AGENT_ID on the server to enable Lil Spark.' : 'Configure TAVUS_PAL_ID on the server to enable calls.'}</div>}
        </section> : <section className="partner-picker" aria-labelledby="partner-heading">
          <h1 id="partner-heading">Who Would You Like to Talk To?</h1>
          <div className="partner-options">
            {Object.entries(chatPartners).map(([id, option]) => <button className={`partner-choice partner-choice-${id}`} type="button" key={id} onClick={() => setSelectedPartner(id)} aria-label={`Meet ${option.name}`}>
              <img src={option.avatar} alt="" />
              <span>{option.label}<img className="label-icon" src={option.icon} alt="" /></span>
            </button>)}
          </div>
        </section>) : <div className={`conversation ${captionsEnabled ? 'captions-enabled' : ''}`}>
          <section className="video-column">
            <div className="call-frame">
              <div ref={dailyContainerRef} className="custom-call-stage">
                {participants.filter((participant) => !participant.local).map((participant) => <ParticipantMedia key={participant.session_id} participant={participant} displayName={partner?.name} />)}
                {!callConnected && <div className="joining-state" role="status" aria-label="Starting call"><LoaderCircle size={22} className="spin" aria-hidden="true" /><span>{callError ? 'Having trouble connecting' : 'Connecting...'}</span></div>}
                {active.mode === 'audio' && callConnected && <div className="audio-presence"><div className="audio-orb"><span /><span /><span /><span /><span /></div><strong>{partner?.name}</strong><small>Audio call</small></div>}
                {participants.filter((participant) => participant.local).map((participant) => <ParticipantMedia key={participant.session_id} participant={participant} local onSwitchCamera={switchCamera} cameraSwitching={cameraSwitching} cameraOn={cameraOn} />)}
              </div>
            </div>
            {callConnected && captionsEnabled && captions.length > 0 && <div ref={captionTranscriptRef} className="caption-transcript" role="log" aria-live="polite" aria-relevant="additions text">
              {captions.map((entry) => <div className={`caption-entry ${entry.role}`} key={entry.id}>
                <span className="caption-speaker-mark" aria-hidden="true">{entry.role === 'user' ? 'Y' : partner?.name?.[0]}</span>
                <div className="caption-copy"><strong>{entry.role === 'user' ? 'You' : partner?.name}</strong><p>{entry.text}</p></div>
              </div>)}
            </div>}
            {callConnected && <div className="call-controls">
              <button aria-label={cameraOn ? 'Turn camera off' : 'Turn camera on'} onClick={toggleCamera}>{cameraOn ? <Camera size={19} /> : <CameraOff size={19} />}{cameraOn ? 'Camera' : 'Camera off'}</button>
              <div className="background-blur-control" ref={backgroundBlurControlRef}>
                <button ref={backgroundBlurTriggerRef} className={`background-blur${backgroundBlur ? ' active' : ''}`} aria-label="Background blur settings" aria-pressed={backgroundBlur} aria-expanded={backgroundBlurMenuOpen} aria-haspopup="dialog" title="Background blur settings" onClick={() => setBackgroundBlurMenuOpen((open) => !open)} disabled={!cameraOn || backgroundBlurBusy}><ScanFace size={19} />{backgroundBlurBusy ? 'Applying...' : backgroundBlur ? 'Blur on' : 'Blur'}</button>
                {backgroundBlurMenuOpen && <div className="background-blur-menu" role="dialog" aria-label="Background blur settings" aria-busy={backgroundBlurBusy}>
                  <div className="background-blur-menu-heading"><span>Background blur</span><button type="button" className="background-blur-off" onClick={() => setBackgroundBlur(null)} disabled={!backgroundBlur || backgroundBlurBusy}>Off</button></div>
                  <div className="background-blur-menu-options">
                    <button type="button" className={`background-blur-option${backgroundBlurStrength === 'light' ? ' selected' : ''}`} aria-pressed={backgroundBlurStrength === 'light'} onClick={() => setBackgroundBlur('light')} disabled={backgroundBlurBusy}>
                      <span className="background-blur-option-preview" aria-hidden="true"><ScanFace size={30} /></span><span>Slight blur</span>
                    </button>
                    <button type="button" className={`background-blur-option${backgroundBlurStrength === 'strong' ? ' selected' : ''}`} aria-pressed={backgroundBlurStrength === 'strong'} onClick={() => setBackgroundBlur('strong')} disabled={backgroundBlurBusy}>
                      <span className="background-blur-option-preview" aria-hidden="true"><ScanFace size={30} /></span><span>Strong blur</span>
                    </button>
                  </div>
                </div>}
              </div>
              <button aria-label={micOn ? 'Mute microphone' : 'Unmute microphone'} title={micOn ? 'Mute microphone' : 'Muted. Speech is detected on this device; audio is not sent while muted.'} onClick={toggleMicrophone}>{micOn ? <Mic size={19} /> : <MicOff size={19} />}{micOn ? 'Mic' : 'Muted'}</button>
              <button className={`caption-toggle ${captionsEnabled ? 'active' : ''}`} aria-label={`Turn captions ${captionsEnabled ? 'off' : 'on'}`} aria-pressed={captionsEnabled} onClick={() => { setCaptions([]); setCaptionsEnabled(!captionsEnabled); }}><span aria-hidden="true">CC</span>Captions</button>
              <button className="leave-call" aria-label="Leave call" onClick={() => endConversation()} disabled={ending}><PhoneOff size={19} />Leave</button>
            </div>}
            {callError && <div className="call-error" role="alert"><span>{callError}</span><button onClick={() => endConversation()} disabled={ending}>{ending ? 'Ending...' : 'End call'}</button></div>}
          </section>

        </div>}
      </main>
    </div>
  );
}

export default App;
