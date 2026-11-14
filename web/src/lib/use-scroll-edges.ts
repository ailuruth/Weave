import {useEffect, type RefObject} from "react";

export function useScrollEdges(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const box = ref.current;
    if (!box) return;
    const mark = () => {
      box.dataset.above = box.scrollTop > 1 ? "true" : "false";
      box.dataset.more = box.scrollHeight - box.clientHeight - box.scrollTop > 1 ? "true" : "false";
    };
    mark();
    const resize = new ResizeObserver(mark);
    resize.observe(box);
    for (const child of box.children) resize.observe(child);
    const mutate = new MutationObserver(mark);
    mutate.observe(box, {childList: true});
    box.addEventListener("scroll", mark, {passive: true});
    return () => {
      resize.disconnect();
      mutate.disconnect();
      box.removeEventListener("scroll", mark);
    };
  }, [ref]);
}
