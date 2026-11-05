const OUTPUT_FPS = 15;
const MAX_OUTPUT_DIMENSION = 480;

function waitForVideoFrame(video) {
  if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const onLoaded = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error('The camera video could not be read for background blur.'));
    };
    const cleanup = () => {
      video.removeEventListener('loadeddata', onLoaded);
      video.removeEventListener('error', onError);
    };
    video.addEventListener('loadeddata', onLoaded, { once: true });
    video.addEventListener('error', onError, { once: true });
  });
}

export async function createMobileBackgroundBlur(inputTrack, initialStrength, onError) {
  if (typeof HTMLCanvasElement.prototype.captureStream !== 'function') {
    throw new Error('This browser cannot publish a processed camera video track.');
  }

  const sourceTrack = inputTrack.clone();
  const sourceStream = new MediaStream([sourceTrack]);
  const video = document.createElement('video');
  video.autoplay = true;
  video.muted = true;
  video.playsInline = true;
  video.srcObject = sourceStream;
  Object.assign(video.style, {
    position: 'fixed',
    top: '0',
    left: '0',
    width: '2px',
    height: '2px',
    opacity: '0',
    pointerEvents: 'none',
  });
  document.body.append(video);

  let worker;
  let outputStream;
  let videoFrameCallbackId;
  let animationFrameId;
  let stopped = false;
  let workerBusy = false;
  let blurRadius = initialStrength === 'light' ? 10 : 20;
  let lastSegmentTime = 0;
  let outputCanvas;
  let backgroundContext;
  let foregroundCanvas;
  let foregroundContext;
  let maskCanvas;
  let maskContext;
  let maskImageData;
  let outputContext;
  let resolveReady;
  let rejectReady;
  let resolveFirstFrame;
  let rejectFirstFrame;

  const cleanup = () => {
    if (stopped) return;
    stopped = true;
    if (videoFrameCallbackId && typeof video.cancelVideoFrameCallback === 'function') {
      video.cancelVideoFrameCallback(videoFrameCallbackId);
    }
    if (animationFrameId) window.cancelAnimationFrame(animationFrameId);
    worker?.terminate();
    video.pause();
    video.srcObject = null;
    video.remove();
    sourceTrack.stop();
    outputStream?.getTracks().forEach((track) => track.stop());
  };

  const handleWorkerError = (message) => {
    const error = new Error(message || 'Mobile video segmentation failed.');
    workerBusy = false;
    if (rejectReady) {
      rejectReady(error);
      resolveReady = null;
      rejectReady = null;
      cleanup();
      return;
    }
    if (rejectFirstFrame) {
      rejectFirstFrame(error);
      resolveFirstFrame = null;
      rejectFirstFrame = null;
    }
    cleanup();
    onError?.(error);
  };

  try {
    await video.play();
    await waitForVideoFrame(video);

    const sourceWidth = video.videoWidth;
    const sourceHeight = video.videoHeight;
    if (!sourceWidth || !sourceHeight) throw new Error('The camera did not provide a usable video frame.');
    const scale = Math.min(1, MAX_OUTPUT_DIMENSION / Math.max(sourceWidth, sourceHeight));
    const width = Math.max(2, Math.round((sourceWidth * scale) / 2) * 2);
    const height = Math.max(2, Math.round((sourceHeight * scale) / 2) * 2);

    outputCanvas = document.createElement('canvas');
    outputCanvas.width = width;
    outputCanvas.height = height;
    outputContext = outputCanvas.getContext('2d');
    backgroundContext = outputContext;

    foregroundCanvas = document.createElement('canvas');
    foregroundCanvas.width = width;
    foregroundCanvas.height = height;
    foregroundContext = foregroundCanvas.getContext('2d');

    maskCanvas = document.createElement('canvas');
    maskContext = maskCanvas.getContext('2d');
    if (!outputContext || !foregroundContext || !maskContext) {
      throw new Error('This browser could not create the canvases needed for background blur.');
    }

    worker = new Worker(new URL('./mobileBlurWorker.js', import.meta.url), { type: 'module' });
    const workerReady = new Promise((resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
    });
    const firstFrame = new Promise((resolve, reject) => {
      resolveFirstFrame = resolve;
      rejectFirstFrame = reject;
    });

    const drawProcessedFrame = (bitmap, widthOfMask, heightOfMask, confidenceBuffer) => {
      if (maskCanvas.width !== widthOfMask || maskCanvas.height !== heightOfMask) {
        maskCanvas.width = widthOfMask;
        maskCanvas.height = heightOfMask;
        maskImageData = maskContext.createImageData(widthOfMask, heightOfMask);
      }

      const confidence = new Float32Array(confidenceBuffer);
      const pixels = maskImageData.data;
      for (let index = 0; index < confidence.length; index += 1) {
        const pixel = index * 4;
        pixels[pixel] = 255;
        pixels[pixel + 1] = 255;
        pixels[pixel + 2] = 255;
        pixels[pixel + 3] = Math.round(Math.max(0, Math.min(1, confidence[index])) * 255);
      }
      maskContext.putImageData(maskImageData, 0, 0);

      const blurBleed = Math.ceil(blurRadius * 2);
      backgroundContext.save();
      backgroundContext.clearRect(0, 0, width, height);
      backgroundContext.filter = `blur(${blurRadius}px)`;
      backgroundContext.drawImage(bitmap, -blurBleed, -blurBleed, width + blurBleed * 2, height + blurBleed * 2);
      backgroundContext.restore();

      foregroundContext.save();
      foregroundContext.clearRect(0, 0, width, height);
      foregroundContext.drawImage(bitmap, 0, 0, width, height);
      foregroundContext.globalCompositeOperation = 'destination-in';
      foregroundContext.drawImage(maskCanvas, 0, 0, width, height);
      foregroundContext.restore();
      outputContext.drawImage(foregroundCanvas, 0, 0);
    };

    worker.onmessage = ({ data }) => {
      if (data.type === 'ready') {
        resolveReady?.();
        resolveReady = null;
        rejectReady = null;
        return;
      }
      if (data.type === 'error') {
        handleWorkerError(data.message);
        return;
      }
      if (data.type !== 'frame') return;

      workerBusy = false;
      try {
        drawProcessedFrame(data.bitmap, data.width, data.height, data.confidence);
        resolveFirstFrame?.();
        resolveFirstFrame = null;
        rejectFirstFrame = null;
      } catch (error) {
        handleWorkerError(error?.message);
      } finally {
        data.bitmap.close();
      }
    };
    worker.onerror = (event) => handleWorkerError(event.message);
    worker.postMessage({ type: 'init' });
    await workerReady;

    outputStream = outputCanvas.captureStream(OUTPUT_FPS);
    const [outputTrack] = outputStream.getVideoTracks();
    if (!outputTrack) throw new Error('The browser did not create a processed video track.');

    const processFrame = async (timestamp) => {
      if (stopped || workerBusy || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
      if (timestamp - lastSegmentTime < 1000 / OUTPUT_FPS) return;
      lastSegmentTime = timestamp;
      workerBusy = true;
      try {
        const bitmap = await createImageBitmap(video);
        if (stopped) {
          bitmap.close();
          return;
        }
        worker.postMessage({ type: 'frame', bitmap, timestamp }, [bitmap]);
      } catch (error) {
        handleWorkerError(error?.message);
      }
    };

    const scheduleNextFrame = () => {
      if (stopped) return;
      if (typeof video.requestVideoFrameCallback === 'function') {
        videoFrameCallbackId = video.requestVideoFrameCallback((timestamp) => {
          processFrame(timestamp);
          scheduleNextFrame();
        });
      } else {
        animationFrameId = window.requestAnimationFrame((timestamp) => {
          processFrame(timestamp);
          scheduleNextFrame();
        });
      }
    };

    scheduleNextFrame();
    await firstFrame;
    return {
      track: outputTrack,
      setStrength(strength) {
        blurRadius = strength === 'light' ? 10 : 20;
      },
      stop: cleanup,
    };
  } catch (error) {
    cleanup();
    throw error;
  }
}
