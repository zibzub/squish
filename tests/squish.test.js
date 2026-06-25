const { readFileSync } = require("node:fs");
const { join } = require("node:path");

const rootDir = join(__dirname, "..");
const indexHtml = readFileSync(join(rootDir, "docs/index.html"), "utf8");
const squishScript = readFileSync(join(rootDir, "docs/squish.js"), "utf8");

function bodyHtml() {
  return indexHtml.match(/<body[^>]*>([\s\S]*)<\/body>/i)[1];
}

function pointerEvent(type, pointerId = 1) {
  const event = new Event(type, { bubbles: true });
  Object.defineProperty(event, "pointerId", {
    configurable: true,
    value: pointerId,
  });
  return event;
}

function installBrowserStubs({ coarsePointer = false, touchPoints = 0 } = {}) {
  const playSpy = vi
    .spyOn(window.HTMLMediaElement.prototype, "play")
    .mockImplementation(() => Promise.resolve());
  const pauseSpy = vi
    .spyOn(window.HTMLMediaElement.prototype, "pause")
    .mockImplementation(() => {});
  const loadSpy = vi
    .spyOn(window.HTMLMediaElement.prototype, "load")
    .mockImplementation(() => {});

  Object.defineProperty(window.HTMLElement.prototype, "setPointerCapture", {
    configurable: true,
    value: vi.fn(),
  });
  Object.defineProperty(window.HTMLElement.prototype, "releasePointerCapture", {
    configurable: true,
    value: vi.fn(),
  });
  Object.defineProperty(window.HTMLElement.prototype, "hasPointerCapture", {
    configurable: true,
    value: vi.fn(() => true),
  });

  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn((query) => ({
      matches: query === "(pointer: coarse)" ? coarsePointer : false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });

  Object.defineProperty(window.navigator, "maxTouchPoints", {
    configurable: true,
    value: touchPoints,
  });

  Object.defineProperty(window, "PointerEvent", {
    configurable: true,
    value: function PointerEvent() {},
  });

  const createdAudio = [];

  Object.defineProperty(window, "Audio", {
    configurable: true,
    value: vi.fn((src) => {
      const audio = document.createElement("audio");

      if (src) {
        audio.src = src;
      }

      createdAudio.push(audio);
      return audio;
    }),
  });

  return {
    createdAudio,
    loadSpy,
    pauseSpy,
    playSpy,
  };
}

function callCountFor(spy, instance) {
  return spy.mock.instances.filter((callInstance) => callInstance === instance).length;
}

function srcPath(audio) {
  return new URL(audio.src, window.location.href).pathname.replace(/^\//, "");
}

function playedPaths(playSpy) {
  return playSpy.mock.instances.map(srcPath);
}

function enableSound(soundToggle, playSpy) {
  soundToggle.click();
  playSpy.mockClear();
}

function expectedSoundPaths() {
  return [
    ...window.MoonCatSquish.soundSrcs.squish,
    ...window.MoonCatSquish.soundSrcs.unsquish,
    ...window.MoonCatSquish.soundSrcs.fastSquish,
    ...window.MoonCatSquish.soundSrcs.fastUnsquish,
  ];
}

function loadApp(options) {
  document.body.innerHTML = bodyHtml();
  window.__MOONCAT_SQUISH_SKIP_AUTO_INIT__ = false;

  const stubs = installBrowserStubs(options);
  vi.spyOn(window.performance, "now").mockReturnValue(1000);
  vi.spyOn(Math, "random").mockReturnValue(0);
  window.eval(squishScript);

  return {
    ...stubs,
    mooncat: document.querySelector("#mooncat"),
    page: document.querySelector(".page"),
    soundToggle: document.querySelector(".sound-toggle"),
  };
}

describe("MoonCat Squish", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
    delete window.MoonCatSquish;
    delete window.__MOONCAT_SQUISH_SKIP_AUTO_INIT__;
  });

  test("startup shows the main screen with sound off and does not initialize audio", () => {
    const { createdAudio, loadSpy, mooncat, soundToggle } = loadApp();

    expect(document.querySelector(".boot-screen")).toBeNull();
    expect(mooncat.getAttribute("src")).toBe("assets/mooncat.png");
    expect(soundToggle.getAttribute("aria-pressed")).toBe("false");
    expect(createdAudio).toHaveLength(0);
    expect(loadSpy).not.toHaveBeenCalled();
  });

  test("sound toggle preloads and unlocks all clips", () => {
    const { createdAudio, loadSpy, soundToggle } = loadApp({
      coarsePointer: true,
      touchPoints: 1,
    });

    soundToggle.click();
    const liveAudio = createdAudio.slice(0, expectedSoundPaths().length);
    const unlockAudio = createdAudio.slice(liveAudio.length);

    expect(soundToggle.getAttribute("aria-pressed")).toBe("true");
    expect(unlockAudio).toHaveLength(expectedSoundPaths().length);
    expect(unlockAudio.map(srcPath)).toEqual(expectedSoundPaths());
    expect(loadSpy.mock.instances).toEqual(expect.arrayContaining(liveAudio));
    expect(loadSpy.mock.instances).toEqual(expect.arrayContaining(unlockAudio));
  });

  test("desktop pointerdown squishes the image and plays only squish audio", () => {
    const { mooncat, page, playSpy, soundToggle } = loadApp();

    enableSound(soundToggle, playSpy);
    page.dispatchEvent(pointerEvent("pointerdown"));

    expect(mooncat.getAttribute("src")).toBe("assets/squish.png");
    expect(playedPaths(playSpy)).toEqual(["assets/squishy-1.mp3"]);
  });

  test("pointerup restores the image and plays only unsquish audio", () => {
    const { mooncat, page, playSpy, soundToggle } = loadApp();

    enableSound(soundToggle, playSpy);
    page.dispatchEvent(pointerEvent("pointerdown"));
    page.dispatchEvent(pointerEvent("pointerup"));

    expect(mooncat.getAttribute("src")).toBe("assets/mooncat.png");
    expect(playedPaths(playSpy)).toEqual([
      "assets/squishy-1.mp3",
      "assets/unsquish-1.mp3",
    ]);
  });

  test("fast tap timing selects fast squish and fast unsquish pools", () => {
    const { page, playSpy, soundToggle } = loadApp();

    enableSound(soundToggle, playSpy);
    window.performance.now.mockReturnValue(1000);
    page.dispatchEvent(pointerEvent("pointerdown", 1));
    page.dispatchEvent(pointerEvent("pointerup", 1));

    window.performance.now.mockReturnValue(
      1000 + window.MoonCatSquish.constants.FAST_TAP_MS,
    );
    page.dispatchEvent(pointerEvent("pointerdown", 2));
    page.dispatchEvent(pointerEvent("pointerup", 2));

    expect(playedPaths(playSpy)).toEqual([
      "assets/squishy-1.mp3",
      "assets/unsquish-1.mp3",
      "assets/fast-squishy-1.mp3",
      "assets/fast-unsquish-1.mp3",
    ]);
  });

  test("squish replay throttle prevents immediate duplicate squish sounds", () => {
    const { page, playSpy, soundToggle } = loadApp();

    enableSound(soundToggle, playSpy);
    window.performance.now.mockReturnValue(1000);
    page.dispatchEvent(pointerEvent("pointerdown", 1));
    page.dispatchEvent(pointerEvent("pointerup", 1));

    window.performance.now.mockReturnValue(
      1000 + window.MoonCatSquish.constants.MIN_SQUISH_REPLAY_MS - 1,
    );
    page.dispatchEvent(pointerEvent("pointerdown", 2));

    expect(playedPaths(playSpy).filter((src) => src.includes("squishy"))).toEqual([
      "assets/squishy-1.mp3",
    ]);
  });

  test("unsquish replay throttle prevents immediate duplicate unsquish sounds", () => {
    const { page, playSpy, soundToggle } = loadApp();

    enableSound(soundToggle, playSpy);
    window.performance.now.mockReturnValue(1000);
    page.dispatchEvent(pointerEvent("pointerdown", 1));
    page.dispatchEvent(pointerEvent("pointerup", 1));

    window.performance.now.mockReturnValue(
      1000 + window.MoonCatSquish.constants.MIN_UNSQUISH_REPLAY_MS - 1,
    );
    page.dispatchEvent(pointerEvent("pointerdown", 2));
    page.dispatchEvent(pointerEvent("pointerup", 2));

    expect(playedPaths(playSpy).filter((src) => src.includes("unsquish"))).toEqual([
      "assets/unsquish-1.mp3",
    ]);
  });

  test("press and release do not create new Audio objects", () => {
    const { createdAudio, page, playSpy, soundToggle } = loadApp();
    enableSound(soundToggle, playSpy);
    const audioCountAfterStartup = createdAudio.length;

    page.dispatchEvent(pointerEvent("pointerdown"));
    page.dispatchEvent(pointerEvent("pointerup"));

    expect(createdAudio).toHaveLength(audioCountAfterStartup);
  });

  test("sound starts off and controls do not squish the image", () => {
    const { mooncat, playSpy, soundToggle } = loadApp();
    const backControl = document.querySelector(".back-control");

    expect(soundToggle.getAttribute("aria-pressed")).toBe("false");
    soundToggle.dispatchEvent(pointerEvent("pointerdown"));
    backControl.dispatchEvent(pointerEvent("pointerdown"));

    expect(mooncat.getAttribute("src")).toBe("assets/mooncat.png");
    expect(playedPaths(playSpy)).toEqual([]);
  });
});
