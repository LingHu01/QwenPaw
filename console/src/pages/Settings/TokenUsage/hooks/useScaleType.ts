import { useCallback, useState } from "react";

/**
 * Y-axis scaling for the token trend charts. Linear is the default: this is a
 * cost view, and a log axis flattens the spikes people open the page to see.
 */
export type ScaleType = "linear" | "log";

export const DEFAULT_SCALE: ScaleType = "linear";

const STORAGE_KEY = "qwenpaw-token-usage-scale";

function getInitialScale(fallback: ScaleType): ScaleType {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "linear" || stored === "log") {
      return stored;
    }
  } catch {
    // ignore storage errors
  }
  return fallback;
}

/** Scale preference, persisted across reloads (same pattern as ThemeContext). */
export function useScaleType(
  initial: ScaleType = DEFAULT_SCALE,
): [ScaleType, (next: ScaleType) => void] {
  const [scaleType, setScaleTypeState] = useState<ScaleType>(() =>
    getInitialScale(initial),
  );

  const setScaleType = useCallback((next: ScaleType) => {
    setScaleTypeState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // ignore
    }
  }, []);

  return [scaleType, setScaleType];
}

/**
 * Labels a 300px axis carries before crowding. Six, not five: ticks are powers
 * of ten, so the next stride up roughly halves the count, and five would force
 * stride 2 on a six-decade span (the common case) leaving only three labels.
 */
const MAX_DECADE_TICKS = 6;

/**
 * Tick values for a log axis: powers of ten, strided to fit the label budget.
 *
 * Replaces @antv/scale's `d3Log`, which adds intra-decade values (`10^e * k`,
 * k=1..9) when the span covers fewer decades than `tickCount`, giving axes
 * labelled 900K / 4M / 7M / 40M. A very wide span cannot take one tick per
 * decade either, so the stride widens until the count fits.
 *
 * Generated downward from the top decade, so an uneven stride drops a label
 * from the quiet end rather than leaving the top of the axis unlabelled.
 *
 * Signature matches d3Log's `(min, max, count, base)`, but `count` is ignored:
 * the Log scale defaults it to 5 and forwards it (scales/log.js,
 * continuous.js `getTicks`), which would cap the budget at 5 and drop a
 * six-decade span to three labels. The ceiling here is space, not preference.
 */
export const decadeTicks = (a: number, b: number): number[] => {
  const lo = Math.max(1, Math.min(a, b));
  const hi = Math.max(a, b);
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi <= 0) return [];

  const first = Math.floor(Math.log10(lo));
  const last = Math.floor(Math.log10(hi));
  const stride = Math.max(1, Math.ceil((last - first + 1) / MAX_DECADE_TICKS));

  const ticks: number[] = [];
  for (let e = last; e >= first; e -= stride) {
    ticks.push(10 ** e);
  }
  ticks.reverse();
  return ticks.length > 0 ? ticks : [10 ** first];
};

/**
 * Log-axis bounds, snapped outward to whole powers of ten so `decadeTicks`
 * gets a clean span to fill.
 *
 * The floor follows the smallest positive value across every series, so one
 * unusually cheap day widens the span for the whole chart; `Math.max(1, ...)`
 * only guards against fractional decades. Undefined on a linear axis, and
 * when nothing positive is plottable.
 */
export function computeLogDomain(
  values: number[],
  scaleType: ScaleType,
): { domainMin: number; domainMax: number } | undefined {
  if (scaleType !== "log") return undefined;

  // Single pass rather than Math.min(...values): the caller passes
  // days × series, and a wide date range with many models would exceed the
  // engine's argument limit and throw inside a useMemo.
  let lo = Infinity;
  let hi = 0;
  for (const v of values) {
    if (v > 0 && Number.isFinite(v)) {
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  }
  if (hi === 0) return undefined;
  const domainMin = Math.max(1, 10 ** Math.floor(Math.log10(lo)));
  let domainMax = 10 ** Math.ceil(Math.log10(hi));
  if (domainMax <= domainMin) domainMax = domainMin * 10;
  return { domainMin, domainMax };
}

/**
 * What the axis can plot for one point, given the same series' values on the
 * adjacent days. Callers pass 0 for a neighbour outside the window.
 *
 * A log scale cannot draw 0, and dropping those points would shrink the x band
 * scale and narrow the visible date range. Nulling every zero instead leaves
 * the series floating, appearing in mid-air at its first real value. So a zero
 * bordering a non-zero day is anchored at the axis floor, giving the line an
 * edge to descend to; interior zeros stay `null` and break it, since an idle
 * stretch drawn along the floor reads as sustained low usage.
 *
 * Requires `connectNulls` to stay off: with it enabled G2 draws one path
 * through the defined points (shape/line/curve.js) and would rejoin the
 * anchors across the gap.
 *
 * The floor is a position, not a measurement, so callers keep `rawValue` and
 * the tooltip still reports the true 0.
 */
export function toPlottableAt(
  value: number,
  prev: number,
  next: number,
  scaleType: ScaleType,
  domainMin?: number,
): number | null {
  if (scaleType !== "log") return value;
  if (value > 0) return value;
  return prev > 0 || next > 0 ? domainMin ?? 1 : null;
}

/**
 * G2/@ant-design/plots scale fragment. Spread into the chart config.
 *
 * Both branches emit every key, `undefined` included, and that is load-bearing.
 * The chart is not remounted on a scale change, so G2 merges the new spec into
 * the retained node with `deepAssign` (api/utils.js), which walks only the keys
 * it is given: an omitted key keeps its previous value. Omitting `tickMethod`
 * on the linear branch left `decadeTicks` installed and anchored a linear axis
 * at 1. Passing `undefined` clears it, and `@antv/scale`'s `deepMix` skips
 * `undefined` and restores its own `d3Ticks`.
 */
export function applyScale(
  scaleType: ScaleType,
  domain?: { domainMin: number; domainMax: number },
  xDomain?: string[],
) {
  const y =
    scaleType === "log"
      ? {
          type: "log" as const,
          tickMethod: decadeTicks,
          domainMin: domain?.domainMin,
          domainMax: domain?.domainMax,
        }
      : {
          type: "linear" as const,
          tickMethod: undefined,
          domainMin: undefined,
          domainMax: undefined,
        };

  // Pin the category axis to the requested window. Without this the band
  // scale is inferred from the data, so any date the series cannot plot
  // would drop out of the axis and the chart would cover a shorter period
  // than the picker says.
  const x = { domain: xDomain && xDomain.length > 0 ? xDomain : undefined };

  return { scale: { y, x } };
}
