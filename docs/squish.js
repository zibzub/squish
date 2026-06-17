const normalImage = "assets/mooncat.png";
const squishedImage = "assets/squish.png";
const squishSoundSrc = "assets/squishy.mp3";
const unsquishSoundSrc = "assets/unsquish.mp3";

const MIN_SQUISH_REPLAY_MS = 70;
const MIN_UNSQUISH_DELAY_MS = 0;
const MIN_UNSQUISH_REPLAY_MS = 80;

const page = document.querySelector(".page");
const bootScreen = document.querySelector(".boot-screen");
const mooncat = document.querySelector("#mooncat");
const squishSound = document.querySelector("#squishy-sound");
const unsquishSound = document.querySelector("#unsquish-sound");

squishSound.src = squishSoundSrc;
unsquishSound.src = unsquishSoundSrc;
squishSound.load();
unsquishSound.load();

let activePointerId = null;
let isPressed = false;
let pressStartedAt = 0;
let lastSquishSoundAt = -Infinity;
let lastUnsquishSoundAt = -Infinity;
let pressToken = 0;
let pendingUnsquishTimerId = null;
let audioPrimed = false;
let bootScreenDismissed = false;
const unlockAudios = new Set();

function resetAudio(audio) {
  audio.pause();

  try {
    audio.currentTime = 0;
  } catch (error) {
    console.warn("Audio reset failed", error);
  }
}

function stopSound(audio) {
  resetAudio(audio);
}

function playFresh(audio) {
  resetAudio(audio);

  const playPromise = audio.play();

  if (playPromise) {
    playPromise.catch((error) => {
      console.warn("Audio play failed", error);
    });
  }
}

function resetLiveAudio(audio) {
  audio.pause();

  try {
    audio.currentTime = 0;
  } catch (error) {
    // Some mobile browsers can reject currentTime changes before metadata loads.
  }
}

function primeAudioFromGesture(audio) {
  const unlockAudio = new Audio(audio.currentSrc || audio.src);
  unlockAudios.add(unlockAudio);

  unlockAudio.muted = true;
  unlockAudio.preload = "auto";
  unlockAudio.load();

  const cleanup = () => {
    unlockAudio.pause();
    unlockAudios.delete(unlockAudio);
  };

  const playPromise = unlockAudio.play();

  if (playPromise) {
    playPromise
      .then(cleanup)
      .catch(cleanup);
  } else {
    cleanup();
  }
}

function resumeAudioContextFromGesture() {
  const audioContexts = [
    window.audioContext,
    window.audioCtx,
    window.squishAudioContext,
  ].filter((context) => context && typeof context.resume === "function");

  audioContexts.forEach((context) => {
    const resumePromise = context.resume();

    if (resumePromise) {
      resumePromise.catch(() => {});
    }
  });
}

function dismissBootScreen() {
  if (bootScreenDismissed) {
    return;
  }

  bootScreenDismissed = true;
  audioPrimed = true;

  resumeAudioContextFromGesture();
  squishSound.load();
  unsquishSound.load();
  resetLiveAudio(squishSound);
  resetLiveAudio(unsquishSound);
  primeAudioFromGesture(squishSound);
  primeAudioFromGesture(unsquishSound);

  bootScreen.classList.add("is-hidden");
  bootScreen.remove();
}

function stopPendingUnsquish() {
  if (pendingUnsquishTimerId !== null) {
    clearTimeout(pendingUnsquishTimerId);
    pendingUnsquishTimerId = null;
  }

  stopSound(unsquishSound);
}

function playUnsquishForToken(token, delayMs) {
  const playUnsquish = () => {
    pendingUnsquishTimerId = null;

    if (token !== pressToken || isPressed) {
      return;
    }

    const now = performance.now();

    if (now - lastUnsquishSoundAt < MIN_UNSQUISH_REPLAY_MS) {
      return;
    }

    lastUnsquishSoundAt = now;
    playFresh(unsquishSound);
  };

  if (delayMs <= 0) {
    playUnsquish();
    return;
  }

  pendingUnsquishTimerId = setTimeout(playUnsquish, delayMs);
}

function startPress(event) {
  if (isPressed) {
    return;
  }

  const now = performance.now();

  activePointerId = event.pointerId;
  isPressed = true;
  pressStartedAt = now;
  pressToken += 1;
  mooncat.src = squishedImage;

  page.setPointerCapture?.(event.pointerId);
  stopPendingUnsquish();

  if (now - lastSquishSoundAt >= MIN_SQUISH_REPLAY_MS) {
    lastSquishSoundAt = now;
    playFresh(squishSound);
  }
}

function endPress(event, options = {}) {
  if (!isPressed) {
    return;
  }

  if (activePointerId !== null && event.pointerId !== activePointerId) {
    return;
  }

  const now = performance.now();
  const pressDuration = now - pressStartedAt;
  const unsquishDelay = Math.max(0, MIN_UNSQUISH_DELAY_MS - pressDuration);
  const releaseToken = pressToken;

  isPressed = false;
  activePointerId = null;
  mooncat.src = normalImage;

  if (options.playUnsquish) {
    playUnsquishForToken(releaseToken, unsquishDelay);
  } else {
    stopPendingUnsquish();
  }

  if (event.pointerId !== undefined && page.hasPointerCapture?.(event.pointerId)) {
    page.releasePointerCapture(event.pointerId);
  }
}

function releasePress(event) {
  endPress(event, { playUnsquish: true });
}

function cancelPress(event) {
  endPress(event, { playUnsquish: false });
}

page.addEventListener("pointerdown", startPress);
page.addEventListener("pointerup", releasePress);
page.addEventListener("pointercancel", cancelPress);
page.addEventListener("lostpointercapture", cancelPress);
page.addEventListener("dragstart", (event) => event.preventDefault());
page.addEventListener("selectstart", (event) => event.preventDefault());

const bootStartEvent = window.PointerEvent ? "pointerdown" : "click";
bootScreen.addEventListener(bootStartEvent, dismissBootScreen, { once: true });
