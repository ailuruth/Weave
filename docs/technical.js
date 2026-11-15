(() => {
  document.documentElement.classList.add("js");
  const still = window.matchMedia("(prefers-reduced-motion: reduce)");
  const PARKED_MS = 60000;
  const TAIL_MS = 900;
  const FALLBACK_MS = 4200;

  const run = (line) => {
    line.classList.remove("play");
    void line.offsetWidth;
    line.classList.add("play");
  };

  const cycleMs = (line) => {
    let end = 0;
    for (const animation of line.getAnimations({subtree: true})) {
      const timing = animation.effect?.getComputedTiming();
      if (!timing || (timing.delay || 0) >= PARKED_MS) continue;
      if (Number.isFinite(timing.endTime) && timing.endTime > end) end = timing.endTime;
    }
    return (end > 0 ? end : FALLBACK_MS) + TAIL_MS;
  };

  const timers = new WeakMap();
  const stop = (line) => {
    clearTimeout(timers.get(line));
    timers.delete(line);
  };
  const loop = (line) => {
    run(line);
    if (still.matches) {
      timers.delete(line);
      return;
    }
    timers.set(line, setTimeout(() => loop(line), cycleMs(line)));
  };
  const start = (line) => {
    if (timers.has(line)) return;
    timers.set(line, setTimeout(() => loop(line), 160));
  };

  const playing = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.intersectionRatio >= 0.55) start(entry.target);
      else if (!entry.isIntersecting) stop(entry.target);
    }
  }, {threshold: [0, 0.55]});
  document.querySelectorAll(".line").forEach((line) => playing.observe(line));

  const revealing = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add("in");
      revealing.unobserve(entry.target);
    }
  }, {rootMargin: "0px 0px -10% 0px"});
  document.querySelectorAll(".reveal").forEach((el) => revealing.observe(el));

  const links = new Map([...document.querySelectorAll("#chapters a")]
    .map((link) => [link.getAttribute("href").slice(1), link]));
  const seen = new Map();
  const spy = new IntersectionObserver((entries) => {
    for (const entry of entries) seen.set(entry.target.id, entry.isIntersecting);
    let current = null;
    for (const id of links.keys()) {
      if (seen.get(id)) {
        current = id;
        break;
      }
    }
    for (const [id, link] of links) {
      if (id === current) link.setAttribute("aria-current", "true");
      else link.removeAttribute("aria-current");
    }
  }, {rootMargin: "-30% 0px -60% 0px"});
  for (const id of links.keys()) {
    const target = document.getElementById(id);
    if (target) spy.observe(target);
  }
})();
