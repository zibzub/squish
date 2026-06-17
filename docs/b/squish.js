const normalImage = "assets/mooncat.png";
const squishedImage = "assets/squish.png";
const squishSoundSrc = "assets/squishy.mp3";
const unsquishSoundSrc = "assets/unsquish.mp3";

const MIN_SQUISH_REPLAY_MS = 70;
const MIN_UNSQUISH_DELAY_MS = 0;
const MIN_UNSQUISH_REPLAY_MS = 80;
const FIRST_SQUISH_RETRY_MS = 100;

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
let firstSquishRetryTimerId = null;
let bootScreenDismissed = false;

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

function restoreAudioAfterPrime(audio, wasMuted) {
  audio.pause();

  try {
    audio.currentTime = 0;
  } catch (error) {
    // Some mobile browsers can reject currentTime changes before metadata loads.
  }

  audio.muted = wasMuted;
}

function primeAudioFromGesture(audio) {
  audio.load();

  const wasMuted = audio.muted;
  audio.muted = true;

  const playPromise = audio.play();

  if (playPromise) {
    playPromise
      .then(() => restoreAudioAfterPrime(audio, wasMuted))
      .catch(() => {
        audio.muted = wasMuted;
      });
  } else {
    restoreAudioAfterPrime(audio, wasMuted);
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

  resumeAudioContextFromGesture();
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

function clearFirstSquishRetry() {
  if (firstSquishRetryTimerId !== null) {
    clearTimeout(firstSquishRetryTimerId);
    firstSquishRetryTimerId = null;
  }
}

function scheduleFirstSquishRetry(token) {
  firstSquishRetryTimerId = setTimeout(() => {
    firstSquishRetryTimerId = null;

    if (token !== pressToken || !isPressed) {
      return;
    }

    playFresh(squishSound);
  }, FIRST_SQUISH_RETRY_MS);
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
  const shouldRetryFirstSquish = !audioPrimed;

  activePointerId = event.pointerId;
  isPressed = true;
  pressStartedAt = now;
  pressToken += 1;

  if (shouldRetryFirstSquish) {
    squishSound.load();
    unsquishSound.load();
  }

  if (now - lastSquishSoundAt >= MIN_SQUISH_REPLAY_MS) {
    lastSquishSoundAt = now;
    playFresh(squishSound);
  }

  mooncat.src = squishedImage;

  page.setPointerCapture?.(event.pointerId);
  clearFirstSquishRetry();
  stopPendingUnsquish();

  if (shouldRetryFirstSquish) {
    audioPrimed = true;
    scheduleFirstSquishRetry(pressToken);
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
  clearFirstSquishRetry();

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

bootScreen.addEventListener("pointerdown", dismissBootScreen, { once: true });
bootScreen.addEventListener("click", dismissBootScreen, { once: true });
