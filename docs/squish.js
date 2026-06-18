(function () {
  const normalImage = "assets/mooncat.png";
  const squishedImage = "assets/squish.png";

  const squishSoundSrcs = [
    "assets/squishy-1.mp3",
    "assets/squishy-2.mp3",
    "assets/squishy-3.mp3",
  ];
  const unsquishSoundSrcs = [
    "assets/unsquish-1.mp3",
    "assets/unsquish-2.mp3",
    "assets/unsquish-3.mp3",
  ];
  const fastSquishSoundSrcs = [
    "assets/fast-squishy-1.mp3",
    "assets/fast-squishy-2.mp3",
  ];
  const fastUnsquishSoundSrcs = [
    "assets/fast-unsquish-1.mp3",
    "assets/fast-unsquish-2.mp3",
  ];

  const MIN_SQUISH_REPLAY_MS = 70;
  const MIN_UNSQUISH_REPLAY_MS = 80;
  const FAST_TAP_MS = 220;

  function shouldUseBootScreen() {
    const hasCoarsePointer = window.matchMedia("(pointer: coarse)").matches;
    const hasTouchPoints = navigator.maxTouchPoints > 0;

    return hasCoarsePointer || hasTouchPoints;
  }

  function createAudioClip(src) {
    const audio = new Audio(src);
    audio.preload = "auto";
    audio.load();
    return audio;
  }

  function createAudioPool(srcs) {
    return srcs.map(createAudioClip);
  }

  function chooseRandomAudio(pool) {
    return pool[Math.floor(Math.random() * pool.length)];
  }

  function init(root = document) {
    const page = root.querySelector(".page");
    const bootScreen = root.querySelector(".boot-screen");
    const mooncat = root.querySelector("#mooncat");

    const squishSounds = createAudioPool(squishSoundSrcs);
    const unsquishSounds = createAudioPool(unsquishSoundSrcs);
    const fastSquishSounds = createAudioPool(fastSquishSoundSrcs);
    const fastUnsquishSounds = createAudioPool(fastUnsquishSoundSrcs);
    const allSounds = [
      ...squishSounds,
      ...unsquishSounds,
      ...fastSquishSounds,
      ...fastUnsquishSounds,
    ];

    let activePointerId = null;
    let isPressed = false;
    let activePressIsFast = false;
    let lastPressAt = -Infinity;
    let lastReleaseAt = -Infinity;
    let lastSquishSoundAt = -Infinity;
    let lastUnsquishSoundAt = -Infinity;
    let pressToken = 0;
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

    function preloadSounds() {
      allSounds.forEach((audio) => {
        audio.load();
      });
    }

    function resetSounds() {
      allSounds.forEach(resetLiveAudio);
    }

    function dismissBootScreen() {
      if (bootScreenDismissed) {
        return;
      }

      bootScreenDismissed = true;

      resumeAudioContextFromGesture();
      preloadSounds();
      resetSounds();
      allSounds.forEach(primeAudioFromGesture);

      bootScreen.remove();
    }

    function setupBootScreen() {
      if (!bootScreen) {
        return;
      }

      if (!shouldUseBootScreen()) {
        bootScreen.remove();
        return;
      }

      const bootStartEvent = window.PointerEvent ? "pointerdown" : "click";
      bootScreen.addEventListener(bootStartEvent, dismissBootScreen, { once: true });
    }

    function stopUnsquishSounds() {
      unsquishSounds.forEach(resetAudio);
      fastUnsquishSounds.forEach(resetAudio);
    }

    function playUnsquishForToken(token) {
      if (token !== pressToken || isPressed) {
        return;
      }

      const now = performance.now();

      if (now - lastUnsquishSoundAt < MIN_UNSQUISH_REPLAY_MS) {
        return;
      }

      const wasFastRelease =
        activePressIsFast || now - lastReleaseAt <= FAST_TAP_MS;
      const pool = wasFastRelease ? fastUnsquishSounds : unsquishSounds;

      lastReleaseAt = now;
      lastUnsquishSoundAt = now;
      playFresh(chooseRandomAudio(pool));
    }

    function startPress(event) {
      if (isPressed) {
        return;
      }

      const now = performance.now();

      activePointerId = event.pointerId;
      activePressIsFast = now - lastPressAt <= FAST_TAP_MS;
      isPressed = true;
      pressToken += 1;
      mooncat.src = squishedImage;

      page.setPointerCapture?.(event.pointerId);
      stopUnsquishSounds();

      if (now - lastSquishSoundAt >= MIN_SQUISH_REPLAY_MS) {
        const pool = activePressIsFast ? fastSquishSounds : squishSounds;

        lastSquishSoundAt = now;
        playFresh(chooseRandomAudio(pool));
      }

      lastPressAt = now;
    }

    function endPress(event, options = {}) {
      if (!isPressed) {
        return;
      }

      if (activePointerId !== null && event.pointerId !== activePointerId) {
        return;
      }

      const releaseToken = pressToken;

      isPressed = false;
      activePointerId = null;
      mooncat.src = normalImage;

      if (options.playUnsquish) {
        playUnsquishForToken(releaseToken);
      } else {
        stopUnsquishSounds();
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

    setupBootScreen();

    return {
      dismissBootScreen,
      shouldUseBootScreen,
    };
  }

  window.MoonCatSquish = {
    init,
    shouldUseBootScreen,
    constants: {
      FAST_TAP_MS,
      MIN_SQUISH_REPLAY_MS,
      MIN_UNSQUISH_REPLAY_MS,
    },
    soundSrcs: {
      fastSquish: fastSquishSoundSrcs,
      fastUnsquish: fastUnsquishSoundSrcs,
      squish: squishSoundSrcs,
      unsquish: unsquishSoundSrcs,
    },
  };

  if (!window.__MOONCAT_SQUISH_SKIP_AUTO_INIT__) {
    init();
  }
})();
