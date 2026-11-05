import { FilesetResolver, ImageSegmenter } from '@mediapipe/tasks-vision';

const VISION_WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.2/wasm';
const SELFIE_SEGMENTER_MODEL = 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter_landscape/float16/latest/selfie_segmenter_landscape.tflite';

let segmenter;
let lastTimestamp = 0;

self.onmessage = async ({ data }) => {
  if (data.type === 'init') {
    try {
      // Module workers cannot use importScripts(). Use the ESM WASM loader so
      // its ModuleFactory is attached to globalThis before MediaPipe starts.
      const vision = await FilesetResolver.forVisionTasks(VISION_WASM_URL, true);
      segmenter = await ImageSegmenter.createFromOptions(vision, {
        baseOptions: { modelAssetPath: SELFIE_SEGMENTER_MODEL, delegate: 'CPU' },
        runningMode: 'VIDEO',
        outputCategoryMask: false,
        outputConfidenceMasks: true,
      });
      self.postMessage({ type: 'ready' });
    } catch (error) {
      self.postMessage({ type: 'error', message: error?.message || 'Could not initialize mobile video segmentation.' });
    }
    return;
  }

  if (data.type !== 'frame' || !segmenter) return;
  const { bitmap, timestamp } = data;
  lastTimestamp = Math.max(timestamp, lastTimestamp + 1);
  try {
    let frameResult;
    segmenter.segmentForVideo(bitmap, lastTimestamp, (result) => {
      const masks = result.confidenceMasks || [];
      const labels = segmenter.getLabels?.() || [];
      const labeledPersonIndex = labels.findIndex((label) => /person|human/i.test(label));
      // The selfie landscape model may return a single person-confidence mask;
      // models with per-category outputs put person after background at index 1.
      const personMaskIndex = masks.length === 1
        ? 0
        : labeledPersonIndex >= 0
          ? labeledPersonIndex
          : 1;
      const personMask = masks[personMaskIndex] || (masks.length === 1 ? masks[0] : undefined);
      if (!personMask) {
        throw new Error(`The segmentation model returned no person mask (${masks.length} confidence masks).`);
      }
      const confidence = personMask.getAsFloat32Array().slice();
      frameResult = { width: personMask.width, height: personMask.height, confidence };
    });
    if (!frameResult) throw new Error('The segmentation model returned no frame result.');
    self.postMessage({
      type: 'frame',
      bitmap,
      width: frameResult.width,
      height: frameResult.height,
      confidence: frameResult.confidence.buffer,
    }, [bitmap, frameResult.confidence.buffer]);
  } catch (error) {
    bitmap.close();
    self.postMessage({ type: 'error', message: error?.message || 'Mobile video segmentation failed.' });
  }
};
