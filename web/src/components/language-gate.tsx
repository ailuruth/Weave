"use client";

import {Film, Upload, X} from "lucide-react";
import {useEffect, useRef, useState, type CSSProperties} from "react";
import {WeaveMark} from "@/components/weave-mark";
import type {LanguageSession} from "@/hooks/use-caption-stream";

type CSSVars = CSSProperties & Record<`--${string}`, string | number>;

export const LANGUAGE_NAMES: Record<string, string> = {
  en: "English",
  ko: "Korean",
  multi: "English + Korean",
};

const QUIET = {weight: 260, stretch: 78};
const LOUD = {weight: 1000, stretch: 151};
const LETTER_LAG_MS = 110;
const STILL_LEVEL = 0.45;
const W_BEARING_QUIET_EM = 0.017;
const W_BEARING_LOUD_EM = -0.012;
const E_BEARING_EM = 0.009;
const CAP_HEIGHT_EM = 0.72;

function speech(ms: number): number {
  const s = ms / 1000;
  const syllables = Math.max(0, Math.sin(s * 5.1)) ** 2 * 0.5
    + (0.5 + 0.5 * Math.sin(s * 1.3 + 1)) * 0.5;
  return Math.min(1, syllables * (0.6 + 0.4 * Math.max(0, Math.sin(s * 0.47))));
}

function AxisWord({ink, loud}: {ink: {dark: string; light: string} | null; loud: boolean}) {
  const frameRef = useRef<HTMLDivElement>(null);
  const wordRef = useRef<HTMLHeadingElement>(null);
  const loudRef = useRef(loud);
  useEffect(() => {
    loudRef.current = loud;
  }, [loud]);

  useEffect(() => {
    const frame = frameRef.current;
    const word = wordRef.current;
    if (!frame || !word) return;
    const letters = [...word.children] as HTMLElement[];
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let shout = 0;
    let raf = 0;
    let alive = true;
    let size = 100;
    let room = 0;
    let tallest = Number.POSITIVE_INFINITY;
    const set = (letter: HTMLElement, level: number) => {
      letter.style.setProperty("--w", String(Math.round(QUIET.weight + level * (LOUD.weight - QUIET.weight))));
      letter.style.setProperty("--x", `${(QUIET.stretch + level * (LOUD.stretch - QUIET.stretch)).toFixed(1)}%`);
    };
    const span = (first: number) => {
      const lead = W_BEARING_QUIET_EM + first * (W_BEARING_LOUD_EM - W_BEARING_QUIET_EM);
      word.style.setProperty("--lead", `${(-lead).toFixed(4)}em`);
      const ink = word.getBoundingClientRect().width / size - lead - E_BEARING_EM;
      const next = Math.min(room / ink, tallest);
      if (Math.abs(next - size) > 0.05) {
        size = next;
        word.style.setProperty("--fit", `${size.toFixed(2)}px`);
      }
    };
    const paint = (now: number) => {
      shout += ((loudRef.current ? 1 : 0) - shout) * 0.08;
      const levels = letters.map((_, index) =>
        still ? Math.max(shout, STILL_LEVEL) : Math.max(shout, speech(now - index * LETTER_LAG_MS)));
      letters.forEach((letter, index) => set(letter, levels[index]));
      span(levels[0]);
    };
    const fit = () => {
      room = frame.clientWidth;
      tallest = frame.clientHeight / CAP_HEIGHT_EM;
      paint(performance.now());
    };
    const loop = (now: number) => {
      paint(now);
      raf = requestAnimationFrame(loop);
    };
    const observer = new ResizeObserver(fit);
    void document.fonts.ready.then(() => {
      if (!alive) return;
      word.style.setProperty("--fit", `${size}px`);
      fit();
      observer.observe(frame);
      if (!still) raf = requestAnimationFrame(loop);
    });
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, []);

  return (
    <div className="gate-word" ref={frameRef}>
      <h1
        ref={wordRef}
        aria-label="Weave"
        data-ink={ink ? "true" : "false"}
        style={ink ? {"--ink-dark": ink.dark, "--ink-light": ink.light} as CSSVars : undefined}
      >
        {[..."Weave"].map((letter, index) => (
          <span key={index} aria-hidden="true" style={{"--i": index} as CSSVars}>{letter}</span>
        ))}
      </h1>
    </div>
  );
}

export function LanguageGate({
  session,
  error,
  onSelect,
  onImport,
  stage,
  palette,
  paletteLight,
}: {
  session: LanguageSession;
  error: string | null;
  /** The server's boot stage, which for an import carries its progress. */
  stage: string;
  onSelect: (language: string) => void;
  onImport: (file: File, language: string) => Promise<void>;
  palette: readonly string[];
  paletteLight: readonly string[];
}) {
  const unavailable = session.state === "unavailable";
  const [file, setFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [dropping, setDropping] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);
  const [pressed, setPressed] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const selecting = session.state === "selecting" && !importing;
  const colourOf = (id: string | null | undefined) => {
    const index = session.languages.findIndex((language) => language.id === id);
    if (index < 0) return null;
    return {
      dark: palette[index % palette.length],
      light: paletteLight[index % paletteLight.length] ?? palette[index % palette.length],
    };
  };
  const choose = (language: string) => {
    setPressed(language);
    if (!file) {
      onSelect(language);
      return;
    }
    setImporting(true);
    void onImport(file, language).finally(() => setImporting(false));
  };
  const chooseRef = useRef(choose);
  useEffect(() => {
    chooseRef.current = choose;
  });
  const languageIds = session.languages.map((language) => language.id).join(" ");
  useEffect(() => {
    if (!selecting) return;
    const ids = languageIds.split(" ");
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "Escape") {
        setFile(null);
        return;
      }
      const index = Number(event.key) - 1;
      if (Number.isInteger(index) && index >= 0 && index < ids.length) {
        event.preventDefault();
        chooseRef.current(ids[index]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selecting, languageIds]);

  const active = selecting ? hovered : (pressed ?? session.language);
  const selectedName = session.language
    ? LANGUAGE_NAMES[session.language]
      ?? session.languages.find((language) => language.id === session.language)?.label
    : null;
  const status = unavailable
    ? "The local caption engine is unavailable"
    : importing && file
      ? `Importing ${file.name}`
      : /^analysing/.test(stage)
        ? `Analysing ${stage.replace(/^analysing\s*/, "")}`
        : stage === "transcribing"
          ? "Transcribing"
          : selectedName
            ? `Preparing ${selectedName}`
            : "Preparing language setup";

  return (
    <section
      className="language-gate"
      data-file={file ? "true" : "false"}
      data-selecting={selecting ? "true" : "false"}
      role="dialog"
      aria-modal="true"
      aria-label="Caption language setup"
      onDragOver={(event) => {
        if (!selecting || !event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        setDropping(true);
      }}
      onDragLeave={(event) => {
        if (event.currentTarget === event.target) setDropping(false);
      }}
      onDrop={(event) => {
        setDropping(false);
        const dropped = event.dataTransfer.files?.[0];
        if (!selecting || !dropped) return;
        event.preventDefault();
        if (/^(video|audio)\//.test(dropped.type)) setFile(dropped);
      }}
    >
      <header className="gate-bar">
        <WeaveMark size={32} />
        <p>Captions where the voice sets the type. Louder is wider and heavier, and every speaker has a color.</p>
      </header>

      <AxisWord ink={colourOf(active)} loud={selecting && hovered !== null} />

      {selecting ? (
        <div className="gate-low">
          <p className="gate-label">
            {file ? `Choose the language spoken in ${file.name}` : "Choose the language you'll speak"}
          </p>
          <p className="gate-label gate-label-end">{file ? "Video" : "Or drop a video on this screen"}</p>
          <div className="gate-languages" role="list" aria-label="Caption language">
            {session.languages.map((language, index) => {
              const colour = colourOf(language.id);
              return (
                <button
                  key={language.id}
                  type="button"
                  className="gate-language"
                  aria-keyshortcuts={String(index + 1)}
                  style={colour ? {"--spk-dark": colour.dark, "--spk-light": colour.light} as CSSVars : undefined}
                  onPointerEnter={() => setHovered(language.id)}
                  onPointerLeave={() => setHovered(null)}
                  onFocus={() => setHovered(language.id)}
                  onBlur={() => setHovered(null)}
                  onClick={() => choose(language.id)}
                >
                  {LANGUAGE_NAMES[language.id] ?? language.label}
                </button>
              );
            })}
          </div>
          <div className="gate-import">
            <input
              ref={picker}
              type="file"
              accept="video/*,audio/*"
              hidden
              onChange={(event) => {
                setFile(event.target.files?.[0] ?? null);
                event.target.value = "";
              }}
            />
            {file ? (
              <div className="gate-file">
                <Film size={18} aria-hidden="true" />
                <span>{file.name}</span>
                <button
                  type="button"
                  aria-label="Remove the video"
                  title="Remove (Esc)"
                  onClick={() => setFile(null)}
                >
                  <X size={16} />
                </button>
              </div>
            ) : (
              <button type="button" className="gate-import-button" onClick={() => picker.current?.click()}>
                <Upload size={18} aria-hidden="true" />
                Import a video
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="gate-low gate-status">
          <div>
            {!unavailable && <span className="language-loader" role="status" aria-label="Loading" />}
            <h2>{status}</h2>
          </div>
          {unavailable && (
            <p className="gate-label">
              Open this studio through “python -m autocwi live” so it can reach the local session controller.
            </p>
          )}
        </div>
      )}

      {error && <p className="language-error" role="alert">{error}</p>}
      {dropping && (
        <div className="language-drop" aria-hidden="true">
          <Film size={28} />
          <span>Drop to import</span>
        </div>
      )}
    </section>
  );
}
