import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import dayjs from "dayjs";
import { useModelTrendConfig } from "./useModelTrendConfig";
import { useTokenTypeConfig } from "./useTokenTypeConfig";

/**
 * The data both hooks emit is the surface the zero rule acts on, and it is
 * built per series rather than per date so a point can see its neighbours.
 *
 * The window below is deliberately seven days with usage only on 07-02 and
 * 07-06: that gives a leading zero, a trailing zero, and a three-day gap,
 * the narrowest gap that actually has an interior day, since a zero touching
 * a real day on either side is anchored rather than nulled.
 */

const START = dayjs("2026-07-01");
const END = dayjs("2026-07-07");
const DATES = [
  "2026-07-01",
  "2026-07-02",
  "2026-07-03",
  "2026-07-04",
  "2026-07-05",
  "2026-07-06",
  "2026-07-07",
];

type Point = {
  date: string;
  value: number | null;
  rawValue: number;
  model?: string;
  type?: string;
};

const MODEL = "openai:gpt-x";

const byDateModel = {
  "2026-07-02": {
    [MODEL]: {
      model: "gpt-x",
      provider_id: "openai",
      prompt_tokens: 5_000_000,
      completion_tokens: 1000,
      call_count: 10,
    },
  },
  "2026-07-06": {
    [MODEL]: {
      model: "gpt-x",
      provider_id: "openai",
      prompt_tokens: 7_000_000,
      completion_tokens: 2000,
      call_count: 12,
    },
  },
};

const byDate = {
  "2026-07-02": {
    prompt_tokens: 5_000_000,
    completion_tokens: 150_000,
    call_count: 10,
  },
  "2026-07-06": {
    prompt_tokens: 7_000_000,
    completion_tokens: 200_000,
    call_count: 12,
  },
};

function seriesOf(data: Point[], key: "model" | "type", name: string) {
  return data.filter((d) => d[key] === name);
}

function renderModel(scaleType: "linear" | "log") {
  const { result } = renderHook(() =>
    useModelTrendConfig({
      byDateModel,
      startDate: START,
      endDate: END,
      isDark: false,
      scaleType,
    }),
  );
  return seriesOf(result.current!.data as Point[], "model", MODEL);
}

function renderTypes(scaleType: "linear" | "log") {
  const { result } = renderHook(() =>
    useTokenTypeConfig({
      byDate,
      startDate: START,
      endDate: END,
      isDark: false,
      scaleType,
    }),
  );
  return result.current!.data as Point[];
}

describe("useModelTrendConfig data", () => {
  it("emits one point per day in the picker window, in date order", () => {
    expect(renderModel("linear").map((p) => p.date)).toEqual(DATES);
  });

  it("keeps zeros as zero on a linear axis", () => {
    expect(renderModel("linear").map((p) => p.value)).toEqual([
      0, 5_000_000, 0, 0, 0, 7_000_000, 0,
    ]);
  });

  it("anchors boundary zeros and nulls the interior on a log axis", () => {
    // 5M..7M snaps the domain floor to 1e6.
    const FLOOR = 1_000_000;
    expect(renderModel("log").map((p) => p.value)).toEqual([
      FLOOR, // 07-01 borders 07-02
      5_000_000,
      FLOOR, // 07-03 borders 07-02
      null, // 07-04 has no plottable neighbour
      FLOOR, // 07-05 borders 07-06
      7_000_000,
      FLOOR, // 07-07 borders 07-06
    ]);
  });

  it("keeps the true value in rawValue, so an anchor still reports 0", () => {
    const points = renderModel("log");
    expect(points.map((p) => p.rawValue)).toEqual([
      0, 5_000_000, 0, 0, 0, 7_000_000, 0,
    ]);
    expect(points[0].value).toBe(1_000_000);
    expect(points[0].rawValue).toBe(0);
  });
});

describe("y axis labels", () => {
  it("drops the trailing .0 and carries a B unit", () => {
    const { result } = renderHook(() =>
      useModelTrendConfig({
        byDateModel,
        startDate: START,
        endDate: END,
        isDark: false,
        scaleType: "log",
      }),
    );
    const label = (
      result.current as unknown as {
        axis: { y: { labelFormatter: (v: number) => string } };
      }
    ).axis.y.labelFormatter;

    // Every decade tick is a whole number of its unit, so ".0" was pure noise.
    expect([1e3, 1e6, 1e7, 1e8].map(label)).toEqual([
      "1K",
      "1M",
      "10M",
      "100M",
    ]);
    // The previous local formatter had no B branch and rendered 1e11 as
    // "100000.0M".
    expect(label(1e11)).toBe("100B");
    // A real fraction is still shown.
    expect(label(1_500_000)).toBe("1.5M");
  });
});

describe("useTokenTypeConfig data", () => {
  it("emits the fixed triple across the whole window", () => {
    const data = renderTypes("linear");
    for (const type of ["Prompt Tokens", "Completion Tokens", "Total Tokens"]) {
      expect(seriesOf(data, "type", type).map((p) => p.date)).toEqual(DATES);
    }
  });

  it("emits rows date-major, one block per day", () => {
    // The row order feeds G2's colour and legend domains, which are inferred
    // from first appearance. Keeping it date-major preserves the ordering the
    // charts had before the zero rule was added.
    const data = renderTypes("linear");
    expect(data.slice(0, 3).map((p) => p.date)).toEqual([
      DATES[0],
      DATES[0],
      DATES[0],
    ]);
    expect(data.slice(0, 3).map((p) => p.type)).toEqual([
      "Prompt Tokens",
      "Completion Tokens",
      "Total Tokens",
    ]);
    expect(data[3].date).toBe(DATES[1]);
  });

  it("totals prompt and completion per day", () => {
    const total = seriesOf(renderTypes("linear"), "type", "Total Tokens");
    expect(total.map((p) => p.rawValue)).toEqual([
      0, 5_150_000, 0, 0, 0, 7_200_000, 0,
    ]);
  });

  it("applies the zero rule within a series, not across the dataset", () => {
    // The floor (1e5) is deliberately not equal to any real value here, so an
    // anchor cannot be mistaken for a measurement.
    const completion = seriesOf(
      renderTypes("log"),
      "type",
      "Completion Tokens",
    );
    expect(completion.map((p) => p.value)).toEqual([
      100_000, // anchor, not the 150K measured on 07-02
      150_000,
      100_000,
      null,
      100_000,
      200_000,
      100_000,
    ]);
  });
});
