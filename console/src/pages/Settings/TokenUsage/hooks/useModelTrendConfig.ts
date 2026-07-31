import { useMemo } from "react";
import dayjs, { type Dayjs } from "dayjs";
import { formatCompact } from "../../../../utils/formatNumber";
import type { ScaleType } from "./useScaleType";
import { applyScale, computeLogDomain, toPlottableAt } from "./useScaleType";

interface UseModelTrendConfigProps {
  byDateModel: Record<
    string,
    Record<
      string,
      {
        model: string;
        provider_id: string;
        prompt_tokens: number;
        completion_tokens: number;
        call_count: number;
      }
    >
  > | null;
  startDate: Dayjs;
  endDate: Dayjs;
  isDark: boolean;
  scaleType: ScaleType;
}

export function useModelTrendConfig({
  byDateModel,
  startDate,
  endDate,
  isDark,
  scaleType,
}: UseModelTrendConfigProps) {
  return useMemo(() => {
    if (!byDateModel || Object.keys(byDateModel).length === 0) return null;

    const isDarkMode = isDark;

    const allModelKeys = new Set<string>();
    Object.values(byDateModel).forEach((modelMap) => {
      Object.keys(modelMap).forEach((key) => allModelKeys.add(key));
    });

    const allDates: string[] = [];
    let current = startDate.clone();
    while (current.isBefore(endDate) || current.isSame(endDate, "day")) {
      allDates.push(current.format("YYYY-MM-DD"));
      current = current.add(1, "day");
    }

    // Raw prompt tokens for one model on one day; 0 for a day with no
    // record, and for a date outside the window.
    const rawAt = (date: string | undefined, modelKey: string) =>
      (date && byDateModel[date]?.[modelKey]?.prompt_tokens) || 0;

    const chartData: Array<{
      date: string;
      model: string;
      value: number | null;
      rawValue: number;
    }> = [];

    // The domain has to be known before any point can be anchored to the
    // axis floor, so the raw values are collected first.
    const rawValues: number[] = [];
    allDates.forEach((date) => {
      allModelKeys.forEach((modelKey) => {
        rawValues.push(rawAt(date, modelKey));
      });
    });
    const domain = computeLogDomain(rawValues, scaleType);

    allDates.forEach((date, i) => {
      allModelKeys.forEach((modelKey) => {
        const raw = rawAt(date, modelKey);
        chartData.push({
          date,
          model: modelKey,
          // Neighbours are the same model on the adjacent days, which is what
          // decides whether a zero anchors to the floor or breaks the line.
          value: toPlottableAt(
            raw,
            rawAt(allDates[i - 1], modelKey),
            rawAt(allDates[i + 1], modelKey),
            scaleType,
            domain?.domainMin,
          ),
          rawValue: raw,
        });
      });
    });

    const tickCount = Math.min(10, Math.max(3, allDates.length));

    return {
      data: chartData,
      xField: "date",
      yField: "value",
      seriesField: "model",
      colorField: "model",
      smooth: true,
      autoFit: true,
      height: 300,
      theme: isDarkMode ? "dark" : "light",
      style: {
        lineWidth: 3,
        fillOpacity: 0,
      },
      ...applyScale(scaleType, domain, allDates),
      tooltip: {
        title: "date",
        items: [
          // rawValue, not value: a zero anchored at the axis floor is a
          // position, and must still report 0 here.
          (datum: { date: string; rawValue: number; model: string }) => ({
            name: datum.model,
            value: formatCompact(datum.rawValue),
          }),
        ],
      },
      axis: {
        x: {
          range: [0, 1],
          nice: true,
          tickCount,
          labelFormatter: (d: string) => {
            const date = dayjs(d);
            const crossesYear = startDate.year() !== endDate.year();
            return crossesYear ? date.format("YY/MM-DD") : date.format("MM-DD");
          },
          grid: null,
        },
        y: {
          // formatCompact drops a trailing .0, so decade ticks read 1M
          // rather than 1.0M, and it carries a B unit the local formatter
          // lacked (1e11 rendered as "100000.0M").
          labelFormatter: (v: number) => formatCompact(v),
          grid: {
            line: {
              style: {
                stroke: isDarkMode
                  ? "rgba(255, 255, 255, 0.05)"
                  : "rgba(0, 0, 0, 0.04)",
              },
            },
          },
        },
      },
      legend: {
        position: "top" as const,
        maxRows: 2,
        itemMarker: "circle",
        itemMarkerSize: 8,
        itemLabelFontSize: 11,
        itemSpacing: 8,
        itemName: {
          style: {
            fill: isDarkMode ? "rgba(255, 255, 255, 0.85)" : "#333",
            fontSize: 11,
          },
        },
      },
    };
  }, [byDateModel, startDate, endDate, isDark, scaleType]);
}
