import type { ChangeEvent } from "react";
import type { NodeId } from "../core/model/types";
import { useEditorStore } from "../state/store";
import "./GuidePrefs.css";

interface GuidePrefsProps {
  activeGuideId: NodeId | null;
}

const DEFAULT_GUIDE_COLOR = "#20d9ff";

export default function GuidePrefs({ activeGuideId }: GuidePrefsProps) {
  const guide = useEditorStore((state) =>
    activeGuideId === null
      ? null
      : state.doc.guides.find((candidate) => candidate.id === activeGuideId) ?? null,
  );
  const setGuideColor = useEditorStore((state) => state.setGuideColor);
  const setGuideLocked = useEditorStore((state) => state.setGuideLocked);
  const setGuideHidden = useEditorStore((state) => state.setGuideHidden);

  if (guide === null) {
    return null;
  }

  const onColorChange = (event: ChangeEvent<HTMLInputElement>): void => {
    setGuideColor(guide.id, event.currentTarget.value);
  };

  return (
    <section className="guide-prefs" aria-label="Guide preferences">
      <div className="guide-prefs__meta">
        <span className="guide-prefs__title">Guide</span>
        <span className="guide-prefs__position">{Math.round(guide.position * 100) / 100}px</span>
      </div>
      <label className="guide-prefs__color" title="Guide color">
        <span className="guide-prefs__swatch" style={{ backgroundColor: guide.color ?? DEFAULT_GUIDE_COLOR }} />
        <input
          aria-label="Guide color"
          className="guide-prefs__color-input"
          onChange={onColorChange}
          type="color"
          value={guide.color ?? DEFAULT_GUIDE_COLOR}
        />
      </label>
      <label className="guide-prefs__toggle">
        <input
          checked={guide.locked === true}
          onChange={(event) => setGuideLocked(guide.id, event.currentTarget.checked)}
          type="checkbox"
        />
        Lock
      </label>
      <label className="guide-prefs__toggle">
        <input
          checked={guide.hidden === true}
          onChange={(event) => setGuideHidden(guide.id, event.currentTarget.checked)}
          type="checkbox"
        />
        Hide
      </label>
    </section>
  );
}
