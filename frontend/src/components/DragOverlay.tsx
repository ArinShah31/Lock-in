import { useEffect, useState } from "react";

type DragOverlayProps = {
  onDropFile: (file: File) => void;
};

export default function DragOverlay({ onDropFile }: DragOverlayProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let dragCounter = 0;

    const dragEnter = (e: DragEvent) => {
      e.preventDefault();

      if (!e.dataTransfer?.types.includes("Files")) return;

      dragCounter++;
      setVisible(true);
    };

    const dragLeave = (e: DragEvent) => {
      e.preventDefault();

      dragCounter--;

      if (dragCounter <= 0) {
        setVisible(false);
      }
    };

    const dragOver = (e: DragEvent) => {
      e.preventDefault();
    };

    const drop = (e: DragEvent) => {
      e.preventDefault();

      dragCounter = 0;
      setVisible(false);

      const file = e.dataTransfer?.files?.[0];

      if (!file) return;

      onDropFile(file);
    };

    document.addEventListener("dragenter", dragEnter);
    document.addEventListener("dragleave", dragLeave);
    document.addEventListener("dragover", dragOver);
    document.addEventListener("drop", drop);

    return () => {
      document.removeEventListener("dragenter", dragEnter);
      document.removeEventListener("dragleave", dragLeave);
      document.removeEventListener("dragover", dragOver);
      document.removeEventListener("drop", drop);
    };
  }, [onDropFile]);

  if (!visible) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="scale-100 rounded-3xl border-4 border-dashed border-cyan-400 bg-slate-900/70 px-20 py-16 text-center shadow-2xl transition-all duration-200">
        <div className="text-7xl">📁</div>

        <h2 className="mt-6 text-3xl font-bold text-white">
          Drop files to upload
        </h2>

        <p className="mt-3 text-slate-300">Release your files anywhere</p>
      </div>
    </div>
  );
}
