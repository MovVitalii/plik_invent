/* ==========================================================
   Materials Analytics
   Smart Analytics Core — deterministic statistical helpers.
========================================================== */
(function initializeAnalyticsCore(global) {
    "use strict";

    const PMA = global.PMA || (global.PMA = {});
    const DAY_MS = 86400000;

    function isBlank(value) {
        return value === null || value === undefined || (typeof value === "string" && value.trim() === "");
    }

    function cleanText(value) {
        return isBlank(value) ? "" : String(value).replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim();
    }

    function normalizeLabel(value) {
        return cleanText(value)
            .toLocaleLowerCase("pl-PL")
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .replace(/[^a-z0-9%]+/g, " ")
            .trim();
    }

    function parseNumber(value) {
        if (typeof value === "number") return Number.isFinite(value) ? value : null;
        if (typeof value === "bigint") return Number(value);
        if (isBlank(value) || typeof value === "boolean") return null;
        let normalized = String(value).trim();
        normalized = normalized
            .replace(/[€$£]/g, "")
            .replace(/\b(?:PLN|USD|EUR|GBP|ZŁ)\b/gi, "")
            .replace(/%/g, "")
            .replace(/[\s\u00A0\u202F]/g, "");
        const comma = normalized.lastIndexOf(",");
        const dot = normalized.lastIndexOf(".");
        if (comma >= 0 && dot >= 0) {
            if (comma > dot) normalized = normalized.replace(/\./g, "").replace(",", ".");
            else normalized = normalized.replace(/,/g, "");
        } else if (comma >= 0) {
            normalized = normalized.replace(/,/g, ".");
        } else if (dot >= 0 && /^[-+]?\d{1,3}(?:\.\d{3})+(?:[eE][-+]?\d+)?$/.test(normalized)) {
            normalized = normalized.replace(/\./g, "");
        }
        if (!/^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[-+]?\d+)?$/i.test(normalized)) return null;
        const number = Number(normalized);
        return Number.isFinite(number) ? number : null;
    }

    function parseBoolean(value) {
        if (typeof value === "boolean") return value;
        if (isBlank(value)) return null;
        const normalized = normalizeLabel(value);
        if (["true", "tak", "yes", "y", "1", "prawda"].includes(normalized)) return true;
        if (["false", "nie", "no", "n", "0", "falsz"].includes(normalized)) return false;
        return null;
    }

    function parseDate(value) {
        if (value instanceof Date && !Number.isNaN(value.getTime())) return new Date(value.getTime());
        if (typeof value === "number" && Number.isFinite(value)) {
            if (value > 20000 && value < 100000) {
                const date = new Date(Date.UTC(1899, 11, 30) + value * DAY_MS);
                return Number.isNaN(date.getTime()) ? null : date;
            }
            if (value > 1e11) {
                const date = new Date(value);
                return Number.isNaN(date.getTime()) ? null : date;
            }
        }
        if (isBlank(value)) return null;
        const text = String(value).trim();
        const validParts = (year, month, day, hour = 0, minute = 0, second = 0) => {
            if (![year, month, day, hour, minute, second].every(Number.isFinite)) return null;
            if (year < 1000 || year > 9999 || month < 1 || month > 12 || day < 1 || hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59) return null;
            const date = new Date(year, month - 1, day, hour, minute, second);
            return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
                && date.getHours() === hour && date.getMinutes() === minute && date.getSeconds() === second ? date : null;
        };
        const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/);
        if (iso) {
            const year = Number(iso[1]);
            const month = Number(iso[2]);
            const day = Number(iso[3]);
            const calendarCheck = validParts(year, month, day);
            if (!calendarCheck) return null;
            if (!iso[4]) return calendarCheck;
            const parsed = new Date(text);
            return Number.isNaN(parsed.getTime()) ? null : parsed;
        }
        const dmy = text.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
        if (dmy) {
            const year = Number(dmy[3]) < 100 ? 2000 + Number(dmy[3]) : Number(dmy[3]);
            return validParts(year, Number(dmy[2]), Number(dmy[1]), Number(dmy[4] || 0), Number(dmy[5] || 0), Number(dmy[6] || 0));
        }
        if (/^[A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4}/.test(text)) {
            const date = new Date(text);
            return Number.isNaN(date.getTime()) ? null : date;
        }
        return null;
    }

    function toISODate(value) {
        const date = parseDate(value);
        if (!date) return null;
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    }

    function clamp(value, minimum = 0, maximum = 1) {
        return Math.max(minimum, Math.min(maximum, Number(value) || 0));
    }

    function round(value, digits = 4) {
        if (!Number.isFinite(value)) return null;
        const factor = 10 ** digits;
        return Math.round((value + Number.EPSILON) * factor) / factor;
    }

    function sum(values) {
        return values.reduce((total, value) => total + (Number.isFinite(value) ? value : 0), 0);
    }

    function mean(values) {
        return values.length ? sum(values) / values.length : null;
    }

    function sortedNumbers(values) {
        return values.filter(Number.isFinite).slice().sort((a, b) => a - b);
    }

    function quantile(values, probability) {
        const sorted = sortedNumbers(values);
        if (!sorted.length) return null;
        if (sorted.length === 1) return sorted[0];
        const index = clamp(probability) * (sorted.length - 1);
        const lower = Math.floor(index);
        const upper = Math.ceil(index);
        if (lower === upper) return sorted[lower];
        return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
    }

    function median(values) {
        return quantile(values, 0.5);
    }

    function variance(values, sample = false) {
        const numeric = values.filter(Number.isFinite);
        if (numeric.length < (sample ? 2 : 1)) return null;
        const average = mean(numeric);
        const denominator = sample ? numeric.length - 1 : numeric.length;
        return numeric.reduce((total, value) => total + (value - average) ** 2, 0) / denominator;
    }

    function standardDeviation(values, sample = false) {
        const result = variance(values, sample);
        return result === null ? null : Math.sqrt(result);
    }

    function mad(values) {
        const center = median(values);
        return center === null ? null : median(values.filter(Number.isFinite).map((value) => Math.abs(value - center)));
    }

    function frequency(values, limit = Infinity) {
        const counts = new Map();
        values.forEach((value) => {
            if (isBlank(value)) return;
            const key = String(value);
            counts.set(key, (counts.get(key) || 0) + 1);
        });
        return [...counts.entries()]
            .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], "pl"))
            .slice(0, limit)
            .map(([value, count]) => ({ value, count }));
    }

    function uniqueCount(values) {
        return new Set(values.filter((value) => !isBlank(value)).map((value) => String(value))).size;
    }

    function sampleRows(rows, maximum = 10000) {
        if (!Array.isArray(rows) || rows.length <= maximum) return Array.isArray(rows) ? rows : [];
        const limit = Math.max(1, Math.min(rows.length, Math.floor(maximum)));
        const gcd = (left, right) => {
            let a = Math.abs(left);
            let b = Math.abs(right);
            while (b) [a, b] = [b, a % b];
            return a || 1;
        };
        let stride = Math.max(1, Math.floor(rows.length / limit));
        while (gcd(stride, rows.length) !== 1) stride += 1;
        let cursor = Math.floor(rows.length * 0.3819660112501051);
        const output = new Array(limit);
        for (let index = 0; index < limit; index += 1) {
            output[index] = rows[cursor];
            cursor = (cursor + stride) % rows.length;
        }
        return output;
    }

    function groupBy(rows, getter) {
        const groups = new Map();
        rows.forEach((row, index) => {
            const key = getter(row, index);
            if (key === null || key === undefined || key === "") return;
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(row);
        });
        return groups;
    }

    function stableStringify(value) {
        if (value === null || typeof value !== "object") return JSON.stringify(value);
        if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
        return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
    }

    function rank(values) {
        const indexed = values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value);
        const ranks = new Array(values.length);
        let position = 0;
        while (position < indexed.length) {
            let end = position + 1;
            while (end < indexed.length && indexed[end].value === indexed[position].value) end += 1;
            const averageRank = (position + end - 1) / 2 + 1;
            for (let cursor = position; cursor < end; cursor += 1) ranks[indexed[cursor].index] = averageRank;
            position = end;
        }
        return ranks;
    }

    function pearson(left, right) {
        const pairs = [];
        for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
            if (Number.isFinite(left[index]) && Number.isFinite(right[index])) pairs.push([left[index], right[index]]);
        }
        if (pairs.length < 3) return { coefficient: null, sampleSize: pairs.length };
        const x = pairs.map((pair) => pair[0]);
        const y = pairs.map((pair) => pair[1]);
        const meanX = mean(x);
        const meanY = mean(y);
        let numerator = 0;
        let sumSquaresX = 0;
        let sumSquaresY = 0;
        for (let index = 0; index < pairs.length; index += 1) {
            const dx = x[index] - meanX;
            const dy = y[index] - meanY;
            numerator += dx * dy;
            sumSquaresX += dx ** 2;
            sumSquaresY += dy ** 2;
        }
        const denominator = Math.sqrt(sumSquaresX * sumSquaresY);
        return { coefficient: denominator ? numerator / denominator : null, sampleSize: pairs.length };
    }

    function spearman(left, right) {
        const pairs = [];
        for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
            if (Number.isFinite(left[index]) && Number.isFinite(right[index])) pairs.push([left[index], right[index]]);
        }
        if (pairs.length < 3) return { coefficient: null, sampleSize: pairs.length };
        return pearson(rank(pairs.map((pair) => pair[0])), rank(pairs.map((pair) => pair[1])));
    }

    function linearRegression(points) {
        const valid = points.filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
        if (valid.length < 2) return { slope: null, intercept: null, r2: null, sampleSize: valid.length };
        const meanX = mean(valid.map((point) => point.x));
        const meanY = mean(valid.map((point) => point.y));
        let numerator = 0;
        let denominator = 0;
        valid.forEach((point) => {
            numerator += (point.x - meanX) * (point.y - meanY);
            denominator += (point.x - meanX) ** 2;
        });
        const slope = denominator ? numerator / denominator : 0;
        const intercept = meanY - slope * meanX;
        const predicted = valid.map((point) => intercept + slope * point.x);
        const totalSquares = valid.reduce((total, point) => total + (point.y - meanY) ** 2, 0);
        const residualSquares = valid.reduce((total, point, index) => total + (point.y - predicted[index]) ** 2, 0);
        return {
            slope,
            intercept,
            r2: totalSquares ? 1 - residualSquares / totalSquares : 1,
            sampleSize: valid.length
        };
    }

    function periodKey(dateValue, granularity = "month") {
        const date = parseDate(dateValue);
        if (!date) return null;
        const year = date.getFullYear();
        const month = date.getMonth() + 1;
        if (granularity === "day") return `${year}-${String(month).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
        if (granularity === "week") {
            const utc = new Date(Date.UTC(year, date.getMonth(), date.getDate()));
            const day = utc.getUTCDay() || 7;
            utc.setUTCDate(utc.getUTCDate() + 4 - day);
            const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
            const week = Math.ceil((((utc - yearStart) / DAY_MS) + 1) / 7);
            return `${utc.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
        }
        if (granularity === "quarter") return `${year}-Q${Math.floor((month - 1) / 3) + 1}`;
        if (granularity === "year") return String(year);
        return `${year}-${String(month).padStart(2, "0")}`;
    }

    function chooseGranularity(minDateValue, maxDateValue) {
        const minimum = parseDate(minDateValue);
        const maximum = parseDate(maxDateValue);
        if (!minimum || !maximum) return "month";
        const days = Math.max(1, Math.round((maximum - minimum) / DAY_MS));
        if (days <= 62) return "day";
        if (days <= 240) return "week";
        if (days <= 1460) return "month";
        return "quarter";
    }

    function dateRange(values) {
        const dates = values.map(parseDate).filter(Boolean).sort((a, b) => a - b);
        return dates.length ? { minimum: dates[0], maximum: dates[dates.length - 1], days: Math.max(1, Math.round((dates[dates.length - 1] - dates[0]) / DAY_MS) + 1) } : null;
    }

    function etaSquared(categories, numbers) {
        const pairs = [];
        for (let index = 0; index < Math.min(categories.length, numbers.length); index += 1) {
            const category = categories[index];
            const number = numbers[index];
            if (!isBlank(category) && Number.isFinite(number)) pairs.push([String(category), number]);
        }
        if (pairs.length < 4) return { coefficient: null, sampleSize: pairs.length };
        const grandMean = mean(pairs.map((pair) => pair[1]));
        const groups = groupBy(pairs, (pair) => pair[0]);
        let between = 0;
        let total = 0;
        groups.forEach((group) => {
            const groupMean = mean(group.map((pair) => pair[1]));
            between += group.length * (groupMean - grandMean) ** 2;
        });
        pairs.forEach((pair) => { total += (pair[1] - grandMean) ** 2; });
        return { coefficient: total ? between / total : null, sampleSize: pairs.length, groups: groups.size };
    }

    function cramersV(leftValues, rightValues) {
        const pairs = [];
        for (let index = 0; index < Math.min(leftValues.length, rightValues.length); index += 1) {
            if (!isBlank(leftValues[index]) && !isBlank(rightValues[index])) pairs.push([String(leftValues[index]), String(rightValues[index])]);
        }
        if (pairs.length < 4) return { coefficient: null, sampleSize: pairs.length };
        const leftKeys = [...new Set(pairs.map((pair) => pair[0]))];
        const rightKeys = [...new Set(pairs.map((pair) => pair[1]))];
        if (leftKeys.length < 2 || rightKeys.length < 2 || leftKeys.length > 50 || rightKeys.length > 50) return { coefficient: null, sampleSize: pairs.length };
        const leftIndex = new Map(leftKeys.map((key, index) => [key, index]));
        const rightIndex = new Map(rightKeys.map((key, index) => [key, index]));
        const table = Array.from({ length: leftKeys.length }, () => Array(rightKeys.length).fill(0));
        pairs.forEach(([left, right]) => { table[leftIndex.get(left)][rightIndex.get(right)] += 1; });
        const rowTotals = table.map((row) => sum(row));
        const columnTotals = rightKeys.map((_, column) => sum(table.map((row) => row[column])));
        let chiSquare = 0;
        table.forEach((row, rowIndex) => row.forEach((observed, columnIndex) => {
            const expected = rowTotals[rowIndex] * columnTotals[columnIndex] / pairs.length;
            if (expected > 0) chiSquare += (observed - expected) ** 2 / expected;
        }));
        const denominator = pairs.length * Math.min(leftKeys.length - 1, rightKeys.length - 1);
        return { coefficient: denominator ? Math.sqrt(chiSquare / denominator) : null, sampleSize: pairs.length, rows: leftKeys.length, columns: rightKeys.length };
    }

    function histogram(values, binCount = 10) {
        const numeric = values.filter(Number.isFinite);
        if (!numeric.length) return [];
        let minimum = Infinity;
        let maximum = -Infinity;
        numeric.forEach((value) => {
            if (value < minimum) minimum = value;
            if (value > maximum) maximum = value;
        });
        if (minimum === maximum) return [{ from: minimum, to: maximum, count: numeric.length }];
        const bins = Math.max(3, Math.min(30, Math.round(binCount)));
        const width = (maximum - minimum) / bins;
        const result = Array.from({ length: bins }, (_, index) => ({ from: minimum + width * index, to: minimum + width * (index + 1), count: 0 }));
        numeric.forEach((value) => {
            const index = Math.min(bins - 1, Math.floor((value - minimum) / width));
            result[index].count += 1;
        });
        return result;
    }

    function inferFieldList(rows, fields = []) {
        const byId = new Map((fields || [])
            .filter((field) => field && field.id && field.source !== "internal" && !String(field.id).startsWith("__"))
            .map((field) => [field.id, { ...field }]));
        sampleRows(rows, 200).forEach((row) => {
            Object.keys(row || {}).forEach((key) => {
                if (key.startsWith("__")) return;
                if (!byId.has(key)) byId.set(key, { id: key, label: key, type: null, source: "inferred" });
            });
        });
        return [...byId.values()].filter((field) => field.id && field.source !== "internal" && !String(field.id).startsWith("__"));
    }

    function confidenceFromEvidence(score, sampleSize, minimumSample = 20) {
        const sampleFactor = clamp(Math.log10(Math.max(1, sampleSize)) / Math.log10(Math.max(10, minimumSample * 10)));
        return round(clamp(score * (0.55 + 0.45 * sampleFactor)), 3);
    }

    const api = Object.freeze({
        DAY_MS,
        isBlank,
        cleanText,
        normalizeLabel,
        parseNumber,
        parseBoolean,
        parseDate,
        toISODate,
        clamp,
        round,
        sum,
        mean,
        quantile,
        median,
        variance,
        standardDeviation,
        mad,
        frequency,
        uniqueCount,
        sampleRows,
        groupBy,
        stableStringify,
        rank,
        pearson,
        spearman,
        linearRegression,
        periodKey,
        chooseGranularity,
        dateRange,
        etaSquared,
        cramersV,
        histogram,
        inferFieldList,
        confidenceFromEvidence
    });

    Object.defineProperty(PMA, "analyticsCore", { value: api, enumerable: true, configurable: false, writable: false });
}(typeof window !== "undefined" ? window : self));
