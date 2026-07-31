import { describe, it, expect } from "vitest";
import {
  applyScale,
  computeLogDomain,
  decadeTicks,
  toPlottableAt,
  DEFAULT_SCALE,
} from "./useScaleType";

describe("decadeTicks", () => {
  it("emits one tick per decade", () => {
    expect(decadeTicks(1000, 1_000_000)).toEqual([
      1000, 10_000, 100_000, 1_000_000,
    ]);
  });

  it("does not emit intra-decade ticks (the d3Log bug this replaces)", () => {
    // d3Log would add 4M/7M/40M/70M here; every tick must be a power of ten.
    const ticks = decadeTicks(10_000, 30_000_000);
    for (const t of ticks) {
      expect(Math.log10(t) % 1).toBe(0);
    }
  });

  it("handles degenerate ranges", () => {
    expect(decadeTicks(1000, 5000)).toEqual([1000]); // single decade
    expect(decadeTicks(0, 100)).toEqual([1, 10, 100]); // floors at 1
    expect(decadeTicks(0, 0)).toEqual([]);
    expect(decadeTicks(NaN, 10)).toEqual([]);
  });

  it("tolerates reversed arguments", () => {
    expect(decadeTicks(1_000_000, 1000)).toEqual(decadeTicks(1000, 1_000_000));
  });

  it("widens the stride rather than crowding a wide span", () => {
    // A trillion tokens/day next to a 3B local model spans 13 decades. One
    // tick per decade would put 13 labels on a 300px axis.
    const ticks = decadeTicks(1, 1e12);
    expect(ticks.length).toBeLessThanOrEqual(6);
    for (const t of ticks) expect(Math.log10(t) % 1).toBe(0);
    expect(ticks).toEqual([1, 1e3, 1e6, 1e9, 1e12]);
  });

  it("never exceeds the label budget at any span", () => {
    for (let decades = 1; decades <= 20; decades += 1) {
      const ticks = decadeTicks(1, 10 ** decades);
      expect(ticks.length).toBeLessThanOrEqual(6);
      expect(ticks.length).toBeGreaterThan(0);
    }
  });

  it("keeps every decade for the span this page actually produces", () => {
    // A hosted model beside a local one spans about six decades; widening the
    // stride here would drop the axis to three labels for no reason.
    expect(decadeTicks(1000, 1e8)).toEqual([
      1000, 10_000, 100_000, 1_000_000, 10_000_000, 100_000_000,
    ]);
  });

  it("always labels the top decade, dropping from the quiet end instead", () => {
    // The peak is the number a cost view is opened to read, so an uneven
    // stride must not leave it unlabelled.
    const ticks = decadeTicks(1, 1e13);
    expect(ticks[ticks.length - 1]).toBe(1e13);
  });

  it("ignores the tickCount @antv/scale passes in", () => {
    // Log.getDefaultOptions sets tickCount: 5 (scales/log.js) and
    // continuous.js getTicks forwards it as the third argument, so this is
    // how the chart really calls us. Honouring it would cap the budget at 5
    // and drop the six-decade case below to three labels.
    const asChartCalls = (decadeTicks as (...a: number[]) => number[])(
      1000,
      1e8,
      5,
    );
    expect(asChartCalls).toEqual(decadeTicks(1000, 1e8));
    expect(asChartCalls).toHaveLength(6);
  });
});

describe("computeLogDomain", () => {
  it("snaps both ends outward to whole decades", () => {
    expect(computeLogDomain([4321, 987_654], "log")).toEqual({
      domainMin: 1000,
      domainMax: 1_000_000,
    });
  });

  it("is undefined on a linear axis", () => {
    expect(computeLogDomain([1, 2, 3], "linear")).toBeUndefined();
  });

  it("is undefined when nothing is positive", () => {
    expect(computeLogDomain([0, 0], "log")).toBeUndefined();
  });

  it("still spans a decade when every value is identical", () => {
    const d = computeLogDomain([1000, 1000], "log");
    expect(d!.domainMax).toBeGreaterThan(d!.domainMin);
  });
});

describe("toPlottableAt", () => {
  const FLOOR = 1000;
  const at = (value: number, prev: number, next: number) =>
    toPlottableAt(value, prev, next, "log", FLOOR);

  it("passes values straight through on a linear axis, zeros included", () => {
    expect(toPlottableAt(0, 0, 0, "linear", FLOOR)).toBe(0);
    expect(toPlottableAt(5, 0, 0, "linear", FLOOR)).toBe(5);
  });

  it("plots a positive value as itself", () => {
    expect(at(5000, 0, 0)).toBe(5000);
  });

  it("anchors a zero that borders a real value on either side", () => {
    // Without this the line starts in mid-air at its first real value with
    // nothing tying it to the baseline.
    expect(at(0, 5000, 0)).toBe(FLOOR);
    expect(at(0, 0, 5000)).toBe(FLOOR);
  });

  it("nulls a zero with no plottable neighbour", () => {
    // An idle stretch must break the line rather than skim the floor, which
    // would read as sustained low usage. This depends on the charts leaving
    // connectNulls off, or G2 rejoins the anchors across the gap.
    expect(at(0, 0, 0)).toBeNull();
  });

  it("treats a neighbour outside the window as absent", () => {
    // Callers pass 0 for allDates[-1] / allDates[n], so the first day of a
    // window still anchors if the second day has usage.
    expect(at(0, 0, 4000)).toBe(FLOOR);
  });

  it("falls back to 1 when no domain floor is available", () => {
    expect(toPlottableAt(0, 4000, 0, "log")).toBe(1);
  });
});

describe("computeLogDomain on large inputs", () => {
  it("does not spread the value array into Math.min/Math.max", () => {
    // 400k points is days x series for a multi-year window with many models.
    // Math.min(...values) throws RangeError well below this.
    const values = new Array(400_000).fill(5000);
    values[1234] = 70;
    values[9999] = 8_000_000;
    expect(() => computeLogDomain(values, "log")).not.toThrow();
    expect(computeLogDomain(values, "log")).toEqual({
      domainMin: 10,
      domainMax: 10_000_000,
    });
  });
});

describe("applyScale x domain", () => {
  const dates = ["2026-07-01", "2026-07-02", "2026-07-03"];

  it("pins the category axis to the requested window on both scales", () => {
    // Regression: with the domain inferred from data instead, a day whose
    // value cannot be plotted on a log axis would drop out of the axis and
    // silently shorten the period shown.
    for (const scaleType of ["log", "linear"] as const) {
      const { scale } = applyScale(scaleType, undefined, dates);
      expect((scale as { x: { domain: string[] } }).x.domain).toEqual(dates);
    }
  });

  it("clears the x domain, rather than omitting it, with no window", () => {
    // The key must be present so a previously pinned domain is overwritten.
    const { scale } = applyScale("linear");
    expect(scale).toHaveProperty("x");
    expect(scale.x.domain).toBeUndefined();
  });
});

describe("applyScale", () => {
  it("uses the decade tick generator for log", () => {
    const { scale } = applyScale("log", {
      domainMin: 1000,
      domainMax: 1e6,
    });
    expect(scale.y.type).toBe("log");
    expect(scale.y).toHaveProperty("tickMethod", decadeTicks);
    expect(scale.y).toHaveProperty("domainMin", 1000);
  });

  it("emits a linear scale that actively clears the log keys", () => {
    // Present-but-undefined, not absent: see the deepAssign test below.
    const { scale } = applyScale("linear");
    expect(scale.y.type).toBe("linear");
    expect(scale.y).toHaveProperty("tickMethod");
    expect(scale.y.tickMethod).toBeUndefined();
    expect(scale.y).toHaveProperty("domainMin");
    expect(scale.y.domainMin).toBeUndefined();
  });
});

describe("switching log -> linear on a retained chart node", () => {
  /**
   * G2 does not replace the spec on update. `chart.options()` merges into the
   * retained node with `deepAssign`, reproduced here: it walks the keys of the
   * incoming object, so a key the new spec omits keeps its old value.
   */
  const deepAssign = (
    dist: Record<string, unknown>,
    src: Record<string, unknown>,
  ) => {
    for (const key of Object.keys(src)) {
      const value = src[key];
      const target = dist[key];
      const plain = (v: unknown) =>
        typeof v === "object" && v !== null && !Array.isArray(v);
      if (!plain(value) || !plain(target)) {
        dist[key] = value;
      } else {
        deepAssign(
          target as Record<string, unknown>,
          value as Record<string, unknown>,
        );
      }
    }
    return dist;
  };

  const dates = ["2026-07-01", "2026-07-02"];

  it("leaves neither the tick method nor the domain on the linear axis", () => {
    // Regression: the linear branch used to omit these keys entirely, so they
    // survived the merge. decadeTicks then anchored a linear axis at 1 and
    // emitted 1, 10, ... 100M, collapsing every tick below ~1M onto the
    // baseline. Linear is the default view, so the toggle broke the axis for
    // people who never used it.
    const node = {} as Record<string, unknown>;
    deepAssign(
      node,
      applyScale("log", { domainMin: 1e3, domainMax: 1e8 }, dates),
    );
    deepAssign(node, applyScale("linear", undefined, dates));

    const y = (node.scale as { y: Record<string, unknown> }).y;
    expect(y.type).toBe("linear");
    expect(y.tickMethod).toBeUndefined();
    expect(y.domainMin).toBeUndefined();
    expect(y.domainMax).toBeUndefined();
  });

  it("still clears the tick method when log had no plottable domain", () => {
    // The log branch emits undefined bounds when nothing is positive; those
    // must not mask the tickMethod reset on the way back to linear.
    const node = {} as Record<string, unknown>;
    deepAssign(node, applyScale("log", undefined, dates));
    deepAssign(node, applyScale("linear", undefined, dates));

    const y = (node.scale as { y: Record<string, unknown> }).y;
    expect(y.tickMethod).toBeUndefined();
  });
});

describe("DEFAULT_SCALE", () => {
  it("is linear, so a cost view does not flatten spikes by default", () => {
    expect(DEFAULT_SCALE).toBe("linear");
  });
});
