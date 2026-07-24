interface Props {
  // Called with the horizontal mouse delta (px) during a drag.
  onResize: (dx: number) => void;
}

// A thin vertical divider the user can drag to resize an adjacent panel.
export default function ResizeHandle({ onResize }: Props) {
  function onMouseDown(e: React.MouseEvent) {
    e.preventDefault();
    let last = e.clientX;
    const move = (ev: MouseEvent) => {
      onResize(ev.clientX - last);
      last = ev.clientX;
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }

  return <div className="resize-handle" onMouseDown={onMouseDown} />;
}
