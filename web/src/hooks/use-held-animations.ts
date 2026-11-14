"use client";

import {useLayoutEffect, type RefObject} from "react";

/** Stand every animation inside `root` still while `held`, including ones that start meanwhile. */
export function useHeldAnimations(root: RefObject<HTMLElement | null>, held: boolean): void {
  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    const all = () => element.getAnimations({subtree: true});
    if (!held) {
      for (const animation of all()) {
        if (animation.playState === "paused") animation.play();
      }
      return;
    }
    const hold = () => {
      for (const animation of all()) {
        if (animation.playState === "running") animation.pause();
      }
    };
    hold();
    const observer = new MutationObserver(hold);
    observer.observe(element, {subtree: true, childList: true, attributes: true});
    return () => observer.disconnect();
  }, [root, held]);
}
