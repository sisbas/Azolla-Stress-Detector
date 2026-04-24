import { useState } from 'react';
import { Layer, Rect, Stage } from 'react-konva';

type Props = {
  onSave: (roi: { x: number; y: number; width: number; height: number }) => void;
};

export function MaskEditor({ onSave }: Props) {
  const [roi, setRoi] = useState({ x: 40, y: 40, width: 240, height: 180 });

  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-300">Manuel ROI düzenleme (ilk prototip). Maske fırça düzenleme ileri iterasyonda genişletilir.</p>
      <Stage width={640} height={360} className="border border-slate-700 bg-slate-900">
        <Layer>
          <Rect
            x={roi.x}
            y={roi.y}
            width={roi.width}
            height={roi.height}
            stroke="#22c55e"
            draggable
            onDragEnd={(e) => setRoi((p) => ({ ...p, x: e.target.x(), y: e.target.y() }))}
          />
        </Layer>
      </Stage>
      <button className="rounded bg-green-600 px-3 py-2 text-white" onClick={() => onSave(roi)}>
        ROI Kaydet
      </button>
    </div>
  );
}
