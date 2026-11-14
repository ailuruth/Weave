"use client";

import {useLayoutEffect, type RefObject} from "react";

/** Run every animation inside `root` at `rate`, including ones that start meanwhile; 0 stands them still. */
export function useStageAnimations(root: RefObject<HTMLElement | null>, rate: number): void {
  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    const apply = () => {
      for (const animation of element.getAnimations({subtree: true})) {
        if (rate === 0) {
          if (animation.playState === "running") animation.pause();
          continue;
        }
        if (animation.playbackRate !== rate) animation.playbackRate = rate;
        if (animation.playState === "paused") animation.play();
      }
    };
    apply();
    if (rate === 1) return;
    const observer = new MutationObserver(apply);
    observer.observe(element, {subtree: true, childList: true, attributes: true});
    return () => observer.disconnect();
  }, [root, rate]);
}
