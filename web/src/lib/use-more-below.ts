import {useEffect, type RefObject} from "react";

export function useMoreBelow(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const box = ref.current;
    if (!box) return;
    const mark = () => {
      const more = box.scrollHeight - box.clientHeight - box.scrollTop > 1;
      box.dataset.more = more ? "true" : "false";
    };
    mark();
    const observer = new ResizeObserver(mark);
    observer.observe(box);
    for (const child of box.children) observer.observe(child);
    box.addEventListener("scroll", mark, {passive: true});
    return () => {
      observer.disconnect();
      box.removeEventListener("scroll", mark);
    };
  }, [ref]);
}
