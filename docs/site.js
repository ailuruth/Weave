(() => {
  const QUIET = {weight: 260, stretch: 78};
  const LOUD = {weight: 1000, stretch: 151};
  const LETTER_LAG_MS = 110;
  const STILL_LEVEL = 0.45;
  const W_BEARING_QUIET_EM = 0.017;
  const W_BEARING_LOUD_EM = -0.012;
  const E_BEARING_EM = 0.009;
  const CAP_HEIGHT_EM = 0.72;
  const X_HEIGHT_EM = 0.54;
  const CLEAR_PX = 24;
  const FOLLOW = 0.16;
  const MIC_FLOOR_DB = -58;
  const MIC_CEILING_DB = -14;
  const MIC_ATTACK = 0.5;
  const MIC_RELEASE = 0.07;
  const HISTORY_MS = 800;

  const frame = document.getElementById("word-frame");
  const copy = document.getElementById("hero-copy");
  const word = document.getElementById("word");
  const letters = [...word.children];
  const ways = [...document.querySelectorAll(".way")];
  const voice = document.getElementById("voice");
  const voiceText = document.getElementById("voice-text");
  const voiceNote = document.getElementById("voice-note");
  const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const speech = (ms) => {
    const s = ms / 1000;
    const syllables = Math.max(0, Math.sin(s * 5.1)) ** 2 * 0.5
      + (0.5 + 0.5 * Math.sin(s * 1.3 + 1)) * 0.5;
    return Math.min(1, syllables * (0.6 + 0.4 * Math.max(0, Math.sin(s * 0.47))));
  };

  let source = still ? "held" : "idle";
  let target = STILL_LEVEL;
  let level = STILL_LEVEL;
  let mic = null;
  let size = 100;
  let room = 0;
  let limits = null;
  const history = [];

  const levelAt = (now, lagMs) => {
    const want = now - lagMs;
    for (let i = history.length - 1; i >= 0; i -= 1) {
      if (history[i][0] <= want) return history[i][1];
    }
    return history.length ? history[0][1] : level;
  };

  const paint = (now) => {
    if (source === "idle") target = speech(now);
    else if (source === "mic" && mic) target = mic.read();
    level = still ? target : level + (target - level) * (source === "idle" ? 1 : FOLLOW);
    history.push([now, level]);
    while (history.length > 2 && history[0][0] < now - HISTORY_MS) history.shift();
    letters.forEach((letter, index) => {
      const value = still ? level : levelAt(now, index * LETTER_LAG_MS);
      letter.style.setProperty("--w", String(Math.round(QUIET.weight + value * (LOUD.weight - QUIET.weight))));
      letter.style.setProperty("--x", `${(QUIET.stretch + value * (LOUD.stretch - QUIET.stretch)).toFixed(1)}%`);
    });
    const first = still ? level : levelAt(now, 0);
    const lead = W_BEARING_QUIET_EM + first * (W_BEARING_LOUD_EM - W_BEARING_QUIET_EM);
    word.style.setProperty("--lead", `${(-lead).toFixed(4)}em`);
    const ink = word.getBoundingClientRect().width / size - lead - E_BEARING_EM;
    let next = room / ink;
    if (limits) {
      next = Math.min(next, limits.height / CAP_HEIGHT_EM, limits.under / X_HEIGHT_EM);
      const firstEm = letters[0].getBoundingClientRect().width / size;
      if (firstEm * next > limits.beside) {
        next = Math.min(next, Math.max(limits.beside / firstEm, limits.under / CAP_HEIGHT_EM));
      }
    }
    if (Math.abs(next - size) > 0.05) {
      size = next;
      word.style.setProperty("--fit", `${size.toFixed(2)}px`);
    }
  };

  const fit = () => {
    room = frame.clientWidth;
    limits = getComputedStyle(copy).position === "absolute" ? {
      height: frame.clientHeight,
      under: frame.clientHeight - copy.offsetTop - copy.offsetHeight - CLEAR_PX,
      beside: copy.offsetLeft - CLEAR_PX,
    } : null;
    paint(performance.now());
  };

  const loop = (now) => {
    paint(now);
    requestAnimationFrame(loop);
  };

  const hold = (button) => {
    source = "held";
    target = Number(button.dataset.level);
    word.style.setProperty("--word-ink", button.dataset.ink);
    ways.forEach((way) => way.setAttribute("aria-pressed", way === button ? "true" : "false"));
    if (still) paint(performance.now());
  };

  const text = (el, key) => {
    const ko = document.documentElement.dataset.lang === "ko";
    return el.dataset[ko ? `${key}Ko` : key];
  };

  const stopMic = () => {
    if (!mic) return;
    mic.stop();
    mic = null;
    voice.setAttribute("aria-pressed", "false");
    voiceText.textContent = text(voiceText, "start");
    voiceNote.textContent = text(voiceNote, "idle");
    if (source === "mic") source = still ? "held" : "idle";
  };

  const startMic = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({audio: true});
      const context = new AudioContext();
      const analyser = context.createAnalyser();
      analyser.fftSize = 1024;
      context.createMediaStreamSource(stream).connect(analyser);
      const samples = new Float32Array(analyser.fftSize);
      let heard = 0;
      mic = {
        read() {
          analyser.getFloatTimeDomainData(samples);
          let sum = 0;
          for (const sample of samples) sum += sample * sample;
          const db = 10 * Math.log10(sum / samples.length + 1e-12);
          const now = Math.min(1, Math.max(0, (db - MIC_FLOOR_DB) / (MIC_CEILING_DB - MIC_FLOOR_DB)));
          heard += (now - heard) * (now > heard ? MIC_ATTACK : MIC_RELEASE);
          return heard;
        },
        stop() {
          stream.getTracks().forEach((track) => track.stop());
          void context.close();
        },
      };
      source = "mic";
      ways.forEach((way) => way.setAttribute("aria-pressed", "false"));
      word.style.removeProperty("--word-ink");
      voice.setAttribute("aria-pressed", "true");
      voiceText.textContent = text(voiceText, "stop");
      voiceNote.textContent = text(voiceNote, "on");
    } catch {
      voiceNote.textContent = text(voiceNote, "off");
    }
  };

  ways.forEach((way) => {
    way.addEventListener("click", () => {
      stopMic();
      hold(way);
    });
  });
  voice.addEventListener("click", () => {
    if (mic) stopMic();
    else void startMic();
  });
  window.addEventListener("pagehide", stopMic);

  const translatable = [...document.querySelectorAll("[data-ko]")].map((el) => ({
    el, en: el.textContent, ko: el.dataset.ko,
  }));
  const langButtons = [...document.querySelectorAll("[data-set-lang]")];
  const setLang = (lang) => {
    const ko = lang === "ko";
    document.documentElement.lang = lang;
    document.documentElement.dataset.lang = lang;
    translatable.forEach((item) => {
      item.el.textContent = ko ? item.ko : item.en;
    });
    voiceText.textContent = text(voiceText, mic ? "stop" : "start");
    voiceNote.textContent = text(voiceNote, mic ? "on" : "idle");
    langButtons.forEach((button) => {
      button.setAttribute("aria-pressed", button.dataset.setLang === lang ? "true" : "false");
    });
    try {
      localStorage.setItem("weave-lang", lang);
    } catch {
      return;
    }
  };
  langButtons.forEach((button) => {
    button.addEventListener("click", () => setLang(button.dataset.setLang));
  });
  let chosen = null;
  try {
    chosen = localStorage.getItem("weave-lang");
  } catch {
    chosen = null;
  }
  if (chosen !== "en" && chosen !== "ko") chosen = /^ko\b/i.test(navigator.language || "") ? "ko" : "en";
  if (chosen === "ko") setLang("ko");

  void document.fonts.ready.then(() => {
    word.style.setProperty("--fit", `${size}px`);
    fit();
    new ResizeObserver(fit).observe(frame);
    if (!still) requestAnimationFrame(loop);
  });
})();
