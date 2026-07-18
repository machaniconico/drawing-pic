import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { RGBA } from "../core/model/types";
import { hexToRgba, hsvaToRgba, rgbaToHex, rgbaToHsva, type HSVA } from "./colorConvert";
import "./ColorPicker.css";

export interface ColorPickerProps {
  readonly ariaLabel: string;
  readonly disabled?: boolean;
  readonly onChange: (color: RGBA) => void;
  readonly value: RGBA;
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const POPOVER_WIDTH = 218;
const POPOVER_GAP = 6;
const VIEWPORT_MARGIN = 8;

export function ColorPicker({
  ariaLabel,
  disabled = false,
  onChange,
  value,
}: ColorPickerProps) {
  const [open, setOpen] = useState(false);
  const [hsva, setHsva] = useState<HSVA>(() => rgbaToHsva(value));
  const [hexDraft, setHexDraft] = useState(() => rgbaToHex(value));
  const [popoverPosition, setPopoverPosition] = useState({ left: 0, top: 0 });
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const hexInputRef = useRef<HTMLInputElement>(null);
  const labelId = useId();

  const updatePopoverPosition = useCallback((): void => {
    const trigger = triggerRef.current;
    const popover = popoverRef.current;
    if (trigger === null || popover === null) {
      return;
    }

    const triggerBounds = trigger.getBoundingClientRect();
    const popoverHeight = popover.offsetHeight;
    const maxLeft = Math.max(VIEWPORT_MARGIN, window.innerWidth - POPOVER_WIDTH - VIEWPORT_MARGIN);
    const left = clamp(triggerBounds.right - POPOVER_WIDTH, VIEWPORT_MARGIN, maxLeft);
    const below = triggerBounds.bottom + POPOVER_GAP;
    const preferredTop =
      below + popoverHeight <= window.innerHeight - VIEWPORT_MARGIN
        ? below
        : triggerBounds.top - popoverHeight - POPOVER_GAP;
    const maxTop = Math.max(VIEWPORT_MARGIN, window.innerHeight - popoverHeight - VIEWPORT_MARGIN);
    const top = clamp(preferredTop, VIEWPORT_MARGIN, maxTop);

    setPopoverPosition((current) =>
      current.left === left && current.top === top ? current : { left, top },
    );
  }, []);

  useEffect(() => {
    const converted = rgbaToHsva(value);
    setHsva((current) => ({
      ...converted,
      h: converted.s === 0 ? current.h : converted.h,
    }));
    setHexDraft(rgbaToHex(value));
  }, [value]);

  useLayoutEffect(() => {
    if (open) {
      updatePopoverPosition();
    }
  }, [open, updatePopoverPosition]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const closeOnOutsidePointer = (event: PointerEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };

    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    window.addEventListener("resize", updatePopoverPosition);
    window.addEventListener("scroll", updatePopoverPosition, true);
    hexInputRef.current?.focus();

    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("resize", updatePopoverPosition);
      window.removeEventListener("scroll", updatePopoverPosition, true);
    };
  }, [open, updatePopoverPosition]);

  const applyHsva = (nextHsva: HSVA): void => {
    setHsva(nextHsva);
    onChange(hsvaToRgba(nextHsva));
  };

  const updateSaturationValue = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const bounds = event.currentTarget.getBoundingClientRect();
    if (bounds.width === 0 || bounds.height === 0) {
      return;
    }

    applyHsva({
      ...hsva,
      s: clamp((event.clientX - bounds.left) / bounds.width, 0, 1),
      v: 1 - clamp((event.clientY - bounds.top) / bounds.height, 0, 1),
    });
  };

  const beginSaturationValueDrag = (event: ReactPointerEvent<HTMLDivElement>): void => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    updateSaturationValue(event);
  };

  const continueSaturationValueDrag = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      updateSaturationValue(event);
    }
  };

  const adjustSaturationValue = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    const step = event.shiftKey ? 0.1 : 0.01;
    let nextSaturation = hsva.s;
    let nextValue = hsva.v;

    if (event.key === "ArrowLeft") {
      nextSaturation -= step;
    } else if (event.key === "ArrowRight") {
      nextSaturation += step;
    } else if (event.key === "ArrowDown") {
      nextValue -= step;
    } else if (event.key === "ArrowUp") {
      nextValue += step;
    } else {
      return;
    }

    event.preventDefault();
    applyHsva({
      ...hsva,
      s: clamp(nextSaturation, 0, 1),
      v: clamp(nextValue, 0, 1),
    });
  };

  const updateHex = (draft: string): void => {
    setHexDraft(draft);
    const parsed = hexToRgba(draft);
    if (parsed !== null) {
      onChange(parsed);
    }
  };

  const parsedDraft = hexToRgba(hexDraft);
  const opaqueHue = hsvaToRgba({ h: hsva.h, s: 1, v: 1, a: 1 });
  const currentColor = hsvaToRgba(hsva);
  const swatchStyle = {
    backgroundColor: `rgba(${currentColor.r}, ${currentColor.g}, ${currentColor.b}, ${currentColor.a})`,
  };
  const alphaStyle = {
    backgroundImage: `linear-gradient(to right, rgba(${currentColor.r}, ${currentColor.g}, ${currentColor.b}, 0), rgb(${currentColor.r}, ${currentColor.g}, ${currentColor.b}))`,
  };

  return (
    <div className="color-picker" ref={rootRef}>
      <button
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={ariaLabel}
        className="color-picker__trigger color-picker__checker"
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        ref={triggerRef}
        type="button"
      >
        <span className="color-picker__swatch" style={swatchStyle} />
      </button>

      {open ? (
        <div
          aria-labelledby={labelId}
          className="color-picker__popover"
          ref={popoverRef}
          role="dialog"
          style={popoverPosition}
        >
          <span className="color-picker__visually-hidden" id={labelId}>
            {ariaLabel}
          </span>
          <div
            aria-label="Saturation and value"
            aria-valuemax={100}
            aria-valuemin={0}
            aria-valuenow={Math.round(hsva.v * 100)}
            aria-valuetext={`${Math.round(hsva.s * 100)}% saturation, ${Math.round(hsva.v * 100)}% value`}
            className="color-picker__sv"
            onKeyDown={adjustSaturationValue}
            onPointerDown={beginSaturationValueDrag}
            onPointerMove={continueSaturationValueDrag}
            role="slider"
            style={{ backgroundColor: `rgb(${opaqueHue.r}, ${opaqueHue.g}, ${opaqueHue.b})` }}
            tabIndex={0}
          >
            <span
              className="color-picker__sv-thumb"
              style={{ left: `${hsva.s * 100}%`, top: `${(1 - hsva.v) * 100}%` }}
            />
          </div>

          <label className="color-picker__control">
            <span>Hue</span>
            <input
              aria-label="Hue"
              className="color-picker__range color-picker__range--hue"
              max={359}
              min={0}
              onChange={(event) => applyHsva({ ...hsva, h: event.currentTarget.valueAsNumber })}
              type="range"
              value={Math.round(hsva.h)}
            />
          </label>

          <label className="color-picker__control">
            <span>Alpha</span>
            <span className="color-picker__alpha color-picker__checker">
              <span className="color-picker__alpha-color" style={alphaStyle} />
              <input
                aria-label="Alpha"
                className="color-picker__range color-picker__range--alpha"
                max={1}
                min={0}
                onChange={(event) => applyHsva({ ...hsva, a: event.currentTarget.valueAsNumber })}
                step={0.01}
                type="range"
                value={hsva.a}
              />
            </span>
          </label>

          <div className="color-picker__footer">
            <span aria-hidden="true" className="color-picker__current color-picker__checker">
              <span className="color-picker__swatch" style={swatchStyle} />
            </span>
            <label className="color-picker__hex">
              <span>Hex</span>
              <input
                aria-invalid={parsedDraft === null}
                aria-label="Hex color"
                autoCapitalize="off"
                autoComplete="off"
                onBlur={() => {
                  if (parsedDraft === null) {
                    setHexDraft(rgbaToHex(value));
                  }
                }}
                onChange={(event) => updateHex(event.currentTarget.value)}
                ref={hexInputRef}
                spellCheck={false}
                value={hexDraft}
              />
            </label>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default ColorPicker;
