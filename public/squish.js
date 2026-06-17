const normalImage = "assets/mooncat.png";
const squishedImage = "assets/squish.png";
const squishSoundSrc = "assets/squishy.mp3";
const unsquishSoundSrc = "assets/unsquish.mp3";

// Tune hold/replay thresholds here to balance responsiveness against audio clutter.
const MIN_HOLD_MS = 50;
const MIN_SQUISH_REPLAY_MS = 70;
const MIN_IMAGE_SWAP_MS = 90;

const catButton = document.querySelector(".cat-button");
const mooncat = document.querySelector("#mooncat");
const squishSound = document.querySelector("#squishy-sound");
const unsquishSound = document.querySelector("#unsquish-sound");

squishSound.src = squishSoundSrc;
unsquishSound.src = unsquishSoundSrc;
squishSound.load();
unsquishSound.load();

const AudioContext = window.AudioContext || window.webkitAudioContext;
const page = document.querySelector(".page");
let audioContext = null;
let squishBuffer = null;
let unsquishBuffer = null;
let activeUnsquishSource = null;

function getAudioContext() {
  if (!AudioContext) {
    return null;
  }

  if (!audioContext) {
    audioContext = new AudioContext();
  }

  return audioContext;
}

async function loadAudioBuffer(src, onLoad) {
  const context = getAudioContext();

  if (!context) {
    return;
  }

  try {
    const response = await fetch(src);

    if (!response.ok) {
      throw new Error(`Audio request failed: ${response.status}`);
    }

    const audioData = await response.arrayBuffer();
    const buffer = await context.decodeAudioData(audioData);
    onLoad(buffer);
  } catch (error) {
    console.warn("Audio decode failed", src, error);
  }
}

loadAudioBuffer(squishSoundSrc, (buffer) => {
  squishBuffer = buffer;
});

loadAudioBuffer(unsquishSoundSrc, (buffer) => {
  unsquishBuffer = buffer;
});

let activePointerId = null;
let isPressed = false;
let pressStartedAt = 0;
let releaseSoundAllowed = false;
let lastTapAt = 0;
let lastSquishSoundAt = -Infinity;
let lastImageSwapAt = -Infinity;
let currentImage = normalImage;
let pendingImage = null;
let imageSwapTimerId = null;

function resetSound(sound) {
  sound.pause();
  sound.currentTime = 0;
}

function playSound(sound) {
  resetSound(sound);

  const playPromise = sound.play();

  if (playPromise) {
    playPromise.catch(() => {
      // Browser autoplay policy can still block audio in unusual contexts.
    });
  }
}

async function resumeAudioContext() {
  const context = getAudioContext();

  if (!context) {
    return null;
  }

  if (context.state === "suspended") {
    try {
      await context.resume();
    } catch (error) {
      console.warn("AudioContext resume failed", error);
    }
  }

  return context;
}

function playBuffer(buffer, options = {}) {
  const context = getAudioContext();

  if (!context || !buffer) {
    return false;
  }

  try {
    if (options.stopPrevious && options.activeSource) {
      try {
        options.activeSource.stop();
      } catch {
        // Source may already have ended.
      }
    }

    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    source.start();
    return source;
  } catch (error) {
    console.warn("Web Audio play failed", error);
    return false;
  }
}

function playFallbackSound(sound) {
  playSound(sound);
}

function playSquishSound() {
  const source = playBuffer(squishBuffer);

  if (!source) {
    playFallbackSound(squishSound);
  }
}

function playUnsquishSound() {
  const source = playBuffer(unsquishBuffer, {
    activeSource: activeUnsquishSource,
    stopPrevious: true,
  });

  if (source) {
    activeUnsquishSource = source;
    source.addEventListener("ended", () => {
      if (activeUnsquishSource === source) {
        activeUnsquishSource = null;
      }
    });
    return;
  }

  playFallbackSound(unsquishSound);
}

function stopUnsquishSound() {
  if (activeUnsquishSource) {
    try {
      activeUnsquishSource.stop();
    } catch {
      // Source may already have ended.
    }

    activeUnsquishSource = null;
  }

  resetSound(unsquishSound);
}

function setMooncatImage(src, now = performance.now()) {
  if (src === currentImage) {
    pendingImage = null;

    if (imageSwapTimerId !== null) {
      clearTimeout(imageSwapTimerId);
      imageSwapTimerId = null;
    }

    return;
  }

  const elapsed = now - lastImageSwapAt;

  if (elapsed >= MIN_IMAGE_SWAP_MS) {
    if (imageSwapTimerId !== null) {
      clearTimeout(imageSwapTimerId);
      imageSwapTimerId = null;
    }

    pendingImage = null;
    currentImage = src;
    lastImageSwapAt = now;
    mooncat.src = src;
    return;
  }

  pendingImage = src;

  if (imageSwapTimerId !== null) {
    return;
  }

  imageSwapTimerId = setTimeout(() => {
    imageSwapTimerId = null;

    if (pendingImage === null || pendingImage === currentImage) {
      pendingImage = null;
      return;
    }

    currentImage = pendingImage;
    pendingImage = null;
    lastImageSwapAt = performance.now();
    mooncat.src = currentImage;
  }, MIN_IMAGE_SWAP_MS - elapsed);
}

function startPress(event) {
  if (isPressed) {
    return;
  }

  event.preventDefault();

  const now = performance.now();

  resumeAudioContext();

  if (now - lastSquishSoundAt >= MIN_SQUISH_REPLAY_MS) {
    lastSquishSoundAt = now;
    playSquishSound();
  }

  activePointerId = event.pointerId;
  isPressed = true;
  pressStartedAt = now;
  releaseSoundAllowed = false;
  setMooncatImage(squishedImage, now);

  page.setPointerCapture?.(event.pointerId);
  stopUnsquishSound();
}

function endPress(event, options = {}) {
  if (!isPressed) {
    return;
  }

  if (
    activePointerId !== null &&
    event.pointerId !== activePointerId
  ) {
    return;
  }

  const now = performance.now();
  const holdDuration = now - pressStartedAt;

  releaseSoundAllowed = options.playReleaseSound && holdDuration >= MIN_HOLD_MS;
  lastTapAt = now;
  isPressed = false;
  activePointerId = null;
  setMooncatImage(normalImage, now);

  if (releaseSoundAllowed) {
    playUnsquishSound();
  } else {
    stopUnsquishSound();
  }

  if (event.pointerId !== undefined && page.hasPointerCapture?.(event.pointerId)) {
    page.releasePointerCapture(event.pointerId);
  }
}

function releasePress(event) {
  endPress(event, { playReleaseSound: true });
}

function cancelPress(event) {
  endPress(event, { playReleaseSound: false });
}

page.addEventListener("pointerdown", startPress);
page.addEventListener("pointerup", releasePress);
page.addEventListener("pointercancel", cancelPress);
page.addEventListener("lostpointercapture", cancelPress);
page.addEventListener("contextmenu", (event) => event.preventDefault());
page.addEventListener("dragstart", (event) => event.preventDefault());
page.addEventListener("selectstart", (event) => event.preventDefault());
