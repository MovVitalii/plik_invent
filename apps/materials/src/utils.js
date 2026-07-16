/* ==========================================================
   Pack Materials Analytics
   src/utils.js
========================================================== */

(function initializeUtils(global) {
    "use strict";

    const PMA = global.PMA || (global.PMA = {});

    if (!PMA.constants) {
        throw new Error("PMA.constants must be loaded before src/utils.js.");
    }

    const {
        DATA_TYPES,
        FIELD_ALIASES,
        MONTHS,
        WEEKDAYS,
        SEASONS,
        NUMBER_FORMAT,
        DATE_FORMAT,
        BOOLEAN_VALUES,
        IMPORT_LIMITS,
        VALIDATION_CODES,
        NORMALIZATION,
        SYSTEM_FIELD_MAP
    } = PMA.constants;

    function isNullish(value) {
        return value === null || value === undefined;
    }

    function isBlank(value) {
        return isNullish(value) || (typeof value === "string" && value.trim() === "");
    }

    function toText(value) {
        return isNullish(value) ? "" : String(value);
    }

    function cleanText(value) {
        return toText(value)
            .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
            .replace(/\s+/g, " ")
            .trim();
    }

    function normalizeComparableText(value) {
        return cleanText(value)
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .toLocaleLowerCase("pl-PL")
            .replace(/[łŁ]/g, "l")
            .replace(/[\u2010-\u2015]/g, "-")
            .replace(/[^a-z0-9ąćęńóśźżа-яёіїєґ\-\s]/gi, " ")
            .replace(/\s+/g, " ")
            .trim();
    }

    function normalizeIdentifier(value) {
        const normalized = normalizeComparableText(value)
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "");
        return normalized || "field";
    }

    function escapeHtml(value) {
        return toText(value).replace(/[&<>'"]/g, (character) => ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            "'": "&#39;",
            '"': "&quot;"
        })[character]);
    }

    function stripHtml(value) {
        const element = document.createElement("div");
        element.innerHTML = toText(value);
        return element.textContent || "";
    }

    function truncate(value, maximumLength = 80, suffix = "…") {
        const text = toText(value);
        const limit = Math.max(0, Number(maximumLength) || 0);
        return text.length <= limit ? text : text.slice(0, Math.max(0, limit - suffix.length)) + suffix;
    }

    function createId(prefix = "id") {
        if (global.crypto?.randomUUID) {
            return `${prefix}-${global.crypto.randomUUID()}`;
        }
        return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    }

    function clamp(value, minimum, maximum) {
        return Math.min(maximum, Math.max(minimum, Number(value)));
    }

    function round(value, digits = 2) {
        const number = Number(value);
        if (!Number.isFinite(number)) {
            return null;
        }
        const factor = 10 ** Math.max(0, Math.trunc(digits));
        return Math.round((number + Number.EPSILON) * factor) / factor;
    }

    function clonePlain(value) {
        if (typeof structuredClone === "function") {
            try {
                return structuredClone(value);
            } catch {
                // Fallback below.
            }
        }
        if (value === undefined) {
            return undefined;
        }
        return JSON.parse(JSON.stringify(value));
    }

    function deepFreeze(value, seen = new WeakSet()) {
        if (!value || typeof value !== "object" || seen.has(value)) {
            return value;
        }
        seen.add(value);
        Object.getOwnPropertyNames(value).forEach((name) => deepFreeze(value[name], seen));
        return Object.freeze(value);
    }

    function safeJsonParse(value, fallback = null) {
        try {
            return JSON.parse(value);
        } catch {
            return fallback;
        }
    }

    function safeJsonStringify(value, fallback = "") {
        try {
            return JSON.stringify(value);
        } catch {
            return fallback;
        }
    }

    function parseNumber(value) {
        if (typeof value === "number") {
            return Number.isFinite(value) ? value : null;
        }

        if (typeof value === "bigint") {
            const number = Number(value);
            return Number.isSafeInteger(number) ? number : null;
        }

        if (isBlank(value)) {
            return null;
        }

        let source = cleanText(value)
            .replace(/\u00A0/g, " ")
            .replace(/\s+/g, "")
            .replace(/[%]/g, "");

        const negativeParentheses = /^\(.*\)$/.test(source);
        if (negativeParentheses) {
            source = source.slice(1, -1);
        }

        const commaIndex = source.lastIndexOf(",");
        const dotIndex = source.lastIndexOf(".");

        if (commaIndex >= 0 && dotIndex >= 0) {
            if (commaIndex > dotIndex) {
                source = source.replace(/\./g, "").replace(",", ".");
            } else {
                source = source.replace(/,/g, "");
            }
        } else if (commaIndex >= 0) {
            const decimals = source.length - commaIndex - 1;
            if (decimals === 3 && /^[-+]?\d{1,3}(,\d{3})+$/.test(source)) {
                source = source.replace(/,/g, "");
            } else {
                source = source.replace(/,/g, ".");
            }
        } else if (dotIndex >= 0 && /^[-+]?\d{1,3}(\.\d{3})+$/.test(source)) {
            source = source.replace(/\./g, "");
        }

        if (!/^[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?$/i.test(source)) {
            return null;
        }

        const number = Number(source);
        if (!Number.isFinite(number)) {
            return null;
        }

        return negativeParentheses ? -number : number;
    }

    function isNumeric(value) {
        return parseNumber(value) !== null;
    }

    function formatNumber(value, options = {}) {
        const number = typeof value === "number" ? value : parseNumber(value);
        if (number === null || !Number.isFinite(number)) {
            return options.fallback ?? "—";
        }

        const formatter = new Intl.NumberFormat(
            options.locale || NUMBER_FORMAT.locale,
            {
                minimumFractionDigits: options.minimumFractionDigits ?? NUMBER_FORMAT.minimumFractionDigits,
                maximumFractionDigits: options.maximumFractionDigits ?? NUMBER_FORMAT.maximumFractionDigits,
                useGrouping: options.useGrouping !== false
            }
        );
        return formatter.format(number);
    }

    function formatInteger(value, fallback = "—") {
        const number = typeof value === "number" ? value : parseNumber(value);
        if (number === null || !Number.isFinite(number)) {
            return fallback;
        }
        return new Intl.NumberFormat(NUMBER_FORMAT.locale, {
            maximumFractionDigits: 0
        }).format(Math.round(number));
    }

    function formatPercent(value, options = {}) {
        const number = typeof value === "number" ? value : parseNumber(value);
        if (number === null) {
            return options.fallback ?? "—";
        }
        return new Intl.NumberFormat(options.locale || NUMBER_FORMAT.locale, {
            style: "percent",
            minimumFractionDigits: options.minimumFractionDigits ?? 0,
            maximumFractionDigits: options.maximumFractionDigits ?? 1
        }).format(options.valueIsPercentage ? number / 100 : number);
    }

    function sum(values) {
        return values.reduce((total, value) => {
            const number = parseNumber(value);
            return number === null ? total : total + number;
        }, 0);
    }

    function average(values) {
        const numeric = values.map(parseNumber).filter((value) => value !== null);
        return numeric.length ? sum(numeric) / numeric.length : 0;
    }

    function minimum(values) {
        const numeric = values.map(parseNumber).filter((value) => value !== null);
        return numeric.length ? Math.min(...numeric) : null;
    }

    function maximum(values) {
        const numeric = values.map(parseNumber).filter((value) => value !== null);
        return numeric.length ? Math.max(...numeric) : null;
    }

    function isValidDate(value) {
        return value instanceof Date && !Number.isNaN(value.getTime());
    }

    function isExcelDateSerial(value) {
        const number = typeof value === "number" ? value : Number.NaN;
        return Number.isFinite(number) && number > 0 && number < 2958466;
    }

    function excelSerialToDate(value) {
        if (!isExcelDateSerial(value)) {
            return null;
        }
        const milliseconds = DATE_FORMAT.excelEpochUTC + Math.round(value * DATE_FORMAT.millisecondsPerDay);
        const date = new Date(milliseconds);
        return isValidDate(date) ? date : null;
    }

    function dateToExcelSerial(value) {
        const date = parseDate(value);
        if (!date) {
            return null;
        }
        return (Date.UTC(
            date.getFullYear(),
            date.getMonth(),
            date.getDate(),
            date.getHours(),
            date.getMinutes(),
            date.getSeconds(),
            date.getMilliseconds()
        ) - DATE_FORMAT.excelEpochUTC) / DATE_FORMAT.millisecondsPerDay;
    }

    function parseDate(value, options = {}) {
        if (isValidDate(value)) {
            return new Date(value.getTime());
        }

        if (typeof value === "number" && options.allowExcelSerial !== false) {
            return excelSerialToDate(value);
        }

        if (isBlank(value)) {
            return null;
        }

        const source = cleanText(value);

        if (
            options.allowNumericStringExcelSerial === true &&
            /^\d+(?:[.,]\d+)?$/.test(source)
        ) {
            const serial = parseNumber(source);
            const date = excelSerialToDate(serial);
            if (date) {
                return date;
            }
        }

        const isoMatch = source.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T](\d{1,2}):?(\d{2})?(?::?(\d{2}))?)?$/);
        if (isoMatch) {
            return createCheckedDate(
                Number(isoMatch[1]),
                Number(isoMatch[2]),
                Number(isoMatch[3]),
                Number(isoMatch[4] || 0),
                Number(isoMatch[5] || 0),
                Number(isoMatch[6] || 0)
            );
        }

        const europeanMatch = source.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})(?:[ T](\d{1,2}):?(\d{2})?(?::?(\d{2}))?)?$/);
        if (europeanMatch) {
            const yearValue = Number(europeanMatch[3]);
            const year = yearValue < 100 ? (yearValue >= 70 ? 1900 + yearValue : 2000 + yearValue) : yearValue;
            return createCheckedDate(
                year,
                Number(europeanMatch[2]),
                Number(europeanMatch[1]),
                Number(europeanMatch[4] || 0),
                Number(europeanMatch[5] || 0),
                Number(europeanMatch[6] || 0)
            );
        }

        const hasExplicitFourDigitYear = /(?:^|\D)(?:19|20)\d{2}(?:\D|$)/.test(source);
        const hasAlphabeticMonth = /[A-Za-zÀ-ÖØ-öø-ÿ]{3,}/.test(source);
        const hasRfcOrIsoTimeZone = /(?:T\d{2}:\d{2}|\b(?:GMT|UTC)\b|[+-]\d{2}:?\d{2}$)/i.test(source);

        if (hasExplicitFourDigitYear && (hasAlphabeticMonth || hasRfcOrIsoTimeZone)) {
            const timestamp = Date.parse(source);
            if (!Number.isNaN(timestamp)) {
                const date = new Date(timestamp);
                return isValidDate(date) ? date : null;
            }
        }

        return null;
    }

    function createCheckedDate(year, month, day, hour = 0, minute = 0, second = 0) {
        const date = new Date(year, month - 1, day, hour, minute, second, 0);
        if (
            date.getFullYear() !== year ||
            date.getMonth() !== month - 1 ||
            date.getDate() !== day ||
            date.getHours() !== hour ||
            date.getMinutes() !== minute ||
            date.getSeconds() !== second
        ) {
            return null;
        }
        return date;
    }

    function toISODate(value) {
        const date = parseDate(value, { allowExcelSerial: true });
        if (!date) {
            return "";
        }
        return [
            date.getFullYear(),
            String(date.getMonth() + 1).padStart(2, "0"),
            String(date.getDate()).padStart(2, "0")
        ].join("-");
    }

    function toISODateTime(value) {
        const date = parseDate(value, { allowExcelSerial: true });
        return date ? date.toISOString() : "";
    }

    function formatDate(value, options = {}) {
        const date = parseDate(value, { allowExcelSerial: true });
        if (!date) {
            return options.fallback ?? "—";
        }
        return new Intl.DateTimeFormat(
            options.locale || DATE_FORMAT.locale,
            options.format || DATE_FORMAT.dateOptions
        ).format(date);
    }

    function formatDateTime(value, options = {}) {
        const date = parseDate(value, { allowExcelSerial: true });
        if (!date) {
            return options.fallback ?? "—";
        }
        return new Intl.DateTimeFormat(
            options.locale || DATE_FORMAT.locale,
            options.format || DATE_FORMAT.dateTimeOptions
        ).format(date);
    }

    function getIsoWeekInfo(value) {
        const date = parseDate(value);
        if (!date) {
            return null;
        }
        const utc = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
        const weekday = utc.getUTCDay() || 7;
        utc.setUTCDate(utc.getUTCDate() + 4 - weekday);
        const weekYear = utc.getUTCFullYear();
        const yearStart = new Date(Date.UTC(weekYear, 0, 1));
        const week = Math.ceil((((utc - yearStart) / DATE_FORMAT.millisecondsPerDay) + 1) / 7);
        return { week, year: weekYear, key: `${weekYear}-W${String(week).padStart(2, "0")}` };
    }

    function getWeekdayNumber(value) {
        const date = parseDate(value);
        if (!date) {
            return null;
        }
        return date.getDay() || 7;
    }

    function getMonthLabel(monthNumber) {
        return MONTHS.find((item) => item.number === Number(monthNumber))?.label || "";
    }

    function getWeekdayLabel(weekdayNumber) {
        return WEEKDAYS.find((item) => item.number === Number(weekdayNumber))?.label || "";
    }

    function getSeason(monthNumber) {
        return SEASONS.find((season) => season.months.includes(Number(monthNumber)))?.label || "";
    }

    function getSeasonPeriod(yearValue, monthValue) {
        const year = Number(yearValue);
        const month = Number(monthValue);
        if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
            return {
                label: "",
                startYear: null,
                order: null,
                sortKey: null
            };
        }

        if (month === 12) {
            return {
                label: `Zima ${year}/${year + 1}`,
                startYear: year,
                order: 4,
                sortKey: year * 10 + 4
            };
        }
        if (month === 1 || month === 2) {
            return {
                label: `Zima ${year - 1}/${year}`,
                startYear: year - 1,
                order: 4,
                sortKey: (year - 1) * 10 + 4
            };
        }
        if (month >= 3 && month <= 5) {
            return {
                label: `Wiosna ${year}`,
                startYear: year,
                order: 1,
                sortKey: year * 10 + 1
            };
        }
        if (month >= 6 && month <= 8) {
            return {
                label: `Lato ${year}`,
                startYear: year,
                order: 2,
                sortKey: year * 10 + 2
            };
        }
        return {
            label: `Jesień ${year}`,
            startYear: year,
            order: 3,
            sortKey: year * 10 + 3
        };
    }

    function deriveDateFields(value) {
        const date = parseDate(value, { allowExcelSerial: true });
        if (!date) {
            return {
                date: null,
                year: null,
                quarter: null,
                month: null,
                monthNumber: null,
                monthKey: null,
                week: null,
                weekKey: null,
                weekday: null,
                weekdayNumber: null,
                day: null,
                season: null,
                seasonPeriod: null,
                seasonStartYear: null,
                seasonOrder: null,
                seasonSortKey: null,
                isWeekend: null,
                hour: null,
                time: null
            };
        }

        const monthNumber = date.getMonth() + 1;
        const weekdayNumber = getWeekdayNumber(date);
        const weekInfo = getIsoWeekInfo(date);
        const isoDate = toISODate(date);
        const year = date.getFullYear();
        const seasonPeriod = getSeasonPeriod(year, monthNumber);

        return {
            date: isoDate,
            year,
            quarter: `Q${Math.floor((monthNumber - 1) / 3) + 1}`,
            month: getMonthLabel(monthNumber),
            monthNumber,
            monthKey: `${date.getFullYear()}-${String(monthNumber).padStart(2, "0")}`,
            week: weekInfo?.week ?? null,
            weekKey: weekInfo?.key ?? null,
            weekday: getWeekdayLabel(weekdayNumber),
            weekdayNumber,
            day: date.getDate(),
            season: getSeason(monthNumber),
            seasonPeriod: seasonPeriod.label,
            seasonStartYear: seasonPeriod.startYear,
            seasonOrder: seasonPeriod.order,
            seasonSortKey: seasonPeriod.sortKey,
            isWeekend: weekdayNumber >= 6,
            hour: date.getHours(),
            time: `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`
        };
    }

    function isDateLikeHeader(header) {
        const normalized = normalizeComparableText(header);
        return /(^|\s)(data|date|datum|dzien|day|czas|time)(\s|$)/.test(normalized);
    }

    function parseBoolean(value) {
        if (typeof value === "boolean") {
            return value;
        }
        if (isBlank(value)) {
            return null;
        }
        const normalized = normalizeComparableText(value);
        if (BOOLEAN_VALUES.trueValues.includes(normalized)) {
            return true;
        }
        if (BOOLEAN_VALUES.falseValues.includes(normalized)) {
            return false;
        }
        return null;
    }

    function detectDataType(value, options = {}) {
        if (isBlank(value)) {
            return DATA_TYPES.EMPTY;
        }
        if (typeof value === "boolean") {
            return DATA_TYPES.BOOLEAN;
        }
        if (typeof value === "number") {
            if (options.preferDate && isExcelDateSerial(value)) {
                return DATA_TYPES.DATE;
            }
            return DATA_TYPES.NUMBER;
        }
        if (isValidDate(value)) {
            return DATA_TYPES.DATE;
        }
        if (parseBoolean(value) !== null) {
            return DATA_TYPES.BOOLEAN;
        }
        if (parseNumber(value) !== null) {
            return DATA_TYPES.NUMBER;
        }
        if (parseDate(value, { allowExcelSerial: false })) {
            return DATA_TYPES.DATE;
        }
        return DATA_TYPES.TEXT;
    }

    function detectColumnTypes(rows, headers, options = {}) {
        const sampleSize = Math.max(1, Number(options.sampleSize) || 300);
        const result = {};

        headers.forEach((header, columnIndex) => {
            const counts = {
                [DATA_TYPES.TEXT]: 0,
                [DATA_TYPES.NUMBER]: 0,
                [DATA_TYPES.DATE]: 0,
                [DATA_TYPES.BOOLEAN]: 0,
                [DATA_TYPES.EMPTY]: 0
            };

            let inspected = 0;
            for (const row of rows) {
                if (inspected >= sampleSize) {
                    break;
                }
                const value = Array.isArray(row) ? row[columnIndex] : row?.[header];
                const type = detectDataType(value, { preferDate: isDateLikeHeader(header) });
                counts[type] += 1;
                if (type !== DATA_TYPES.EMPTY) {
                    inspected += 1;
                }
            }

            const nonEmptyCounts = Object.entries(counts)
                .filter(([type]) => type !== DATA_TYPES.EMPTY)
                .sort((left, right) => right[1] - left[1]);

            if (!nonEmptyCounts.length || nonEmptyCounts[0][1] === 0) {
                result[header] = DATA_TYPES.EMPTY;
            } else if (nonEmptyCounts.length > 1 && nonEmptyCounts[1][1] / Math.max(1, nonEmptyCounts[0][1]) > 0.35) {
                result[header] = DATA_TYPES.MIXED;
            } else {
                result[header] = nonEmptyCounts[0][0];
            }
        });

        return result;
    }

    function isTypeCompatible(sourceType, targetType) {
        if (!sourceType || sourceType === DATA_TYPES.EMPTY || sourceType === DATA_TYPES.MIXED) {
            return true;
        }
        if (sourceType === targetType) {
            return true;
        }
        return targetType === DATA_TYPES.TEXT;
    }

    function normalizeHeader(value, index = 0) {
        const cleaned = cleanText(value);
        return cleaned || `Kolumna ${index + 1}`;
    }

    function createUniqueHeaders(headers) {
        const counts = new Map();
        return headers.map((header, index) => {
            const base = normalizeHeader(header, index);
            const key = normalizeComparableText(base);
            const count = (counts.get(key) || 0) + 1;
            counts.set(key, count);
            return count === 1 ? base : `${base} (${count})`;
        });
    }

    function removeDuplicateSuffix(header) {
        return cleanText(header).replace(/\s+\(\d+\)$/, "");
    }

    function findHeaderIndex(headers, target) {
        const normalizedTarget = normalizeComparableText(target);
        return headers.findIndex((header) => normalizeComparableText(removeDuplicateSuffix(header)) === normalizedTarget);
    }

    function createHeaderSignature(headers) {
        return [...headers]
            .map((header) => normalizeComparableText(removeDuplicateSuffix(header)))
            .sort()
            .join("|");
    }

    function levenshteinDistance(left, right) {
        const a = normalizeComparableText(left);
        const b = normalizeComparableText(right);
        if (a === b) {
            return 0;
        }
        if (!a.length) {
            return b.length;
        }
        if (!b.length) {
            return a.length;
        }

        const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
        const current = new Array(b.length + 1);

        for (let i = 1; i <= a.length; i += 1) {
            current[0] = i;
            for (let j = 1; j <= b.length; j += 1) {
                const cost = a[i - 1] === b[j - 1] ? 0 : 1;
                current[j] = Math.min(
                    current[j - 1] + 1,
                    previous[j] + 1,
                    previous[j - 1] + cost
                );
            }
            for (let j = 0; j <= b.length; j += 1) {
                previous[j] = current[j];
            }
        }

        return previous[b.length];
    }

    function similarity(left, right) {
        const a = normalizeComparableText(left);
        const b = normalizeComparableText(right);
        if (!a || !b) {
            return 0;
        }
        if (a === b) {
            return 1;
        }
        const distance = levenshteinDistance(a, b);
        return 1 - distance / Math.max(a.length, b.length);
    }

    function tokenSimilarity(left, right) {
        const leftTokens = new Set(normalizeComparableText(left).split(" ").filter(Boolean));
        const rightTokens = new Set(normalizeComparableText(right).split(" ").filter(Boolean));
        if (!leftTokens.size || !rightTokens.size) {
            return 0;
        }
        const intersection = [...leftTokens].filter((token) => rightTokens.has(token)).length;
        const union = new Set([...leftTokens, ...rightTokens]).size;
        return intersection / union;
    }

    function bestAliasSimilarity(header, aliases = []) {
        return aliases.reduce((best, alias) => Math.max(
            best,
            similarity(header, alias),
            tokenSimilarity(header, alias)
        ), 0);
    }

    function scoreFieldMatch(header, field, detectedType = null) {
        const aliases = [field.label, field.id, ...(FIELD_ALIASES[field.id] || [])];
        const normalizedHeader = normalizeComparableText(removeDuplicateSuffix(header));
        const exact = aliases.some((alias) => normalizeComparableText(alias) === normalizedHeader);
        const aliasScore = exact ? 1 : bestAliasSimilarity(header, aliases);
        const tokenScore = Math.max(...aliases.map((alias) => tokenSimilarity(header, alias)), 0);
        let score = Math.max(aliasScore, tokenScore * 0.95);

        if (isTypeCompatible(detectedType, field.type)) {
            score += 0.08;
        } else {
            score -= 0.18;
        }

        if (field.id === "date" && isDateLikeHeader(header)) {
            score += 0.12;
        }

        return clamp(score, 0, 1);
    }

    function unique(values) {
        return [...new Set(values)];
    }

    function compact(values) {
        return values.filter((value) => !isBlank(value));
    }

    function chunk(values, size = 1000) {
        const result = [];
        const normalizedSize = Math.max(1, Math.trunc(size));
        for (let index = 0; index < values.length; index += normalizedSize) {
            result.push(values.slice(index, index + normalizedSize));
        }
        return result;
    }

    function groupBy(values, resolver) {
        const result = new Map();
        values.forEach((value, index) => {
            const key = typeof resolver === "function" ? resolver(value, index) : value?.[resolver];
            if (!result.has(key)) {
                result.set(key, []);
            }
            result.get(key).push(value);
        });
        return result;
    }

    function keyBy(values, resolver) {
        const result = {};
        values.forEach((value, index) => {
            const key = typeof resolver === "function" ? resolver(value, index) : value?.[resolver];
            result[key] = value;
        });
        return result;
    }

    const naturalCollator = new Intl.Collator("pl-PL", {
        numeric: true,
        sensitivity: "base"
    });

    function naturalCompare(left, right, options = {}) {
        const direction = options.direction === "desc" ? -1 : 1;
        const leftBlank = isBlank(left);
        const rightBlank = isBlank(right);
        if (leftBlank || rightBlank) {
            if (leftBlank && rightBlank) {
                return 0;
            }
            const emptyComparison = leftBlank ? 1 : -1;
            return (options.nullsLast === false ? -emptyComparison : emptyComparison) * direction;
        }
        return naturalCollator.compare(String(left), String(right)) * direction;
    }

    function sortNatural(values, options = {}) {
        return [...values].sort((left, right) => naturalCompare(left, right, options));
    }

    function flatten(values) {
        return values.reduce((result, value) => result.concat(value), []);
    }

    function moveArrayItem(values, fromIndex, toIndex) {
        const result = [...values];
        const source = clamp(Math.trunc(fromIndex), 0, result.length - 1);
        const target = clamp(Math.trunc(toIndex), 0, result.length - 1);
        const [item] = result.splice(source, 1);
        result.splice(target, 0, item);
        return result;
    }

    function createCompositeKey(values, options = {}) {
        return values.map((value) => {
            if (isNullish(value)) {
                return "";
            }
            if (value instanceof Date) {
                return value.toISOString();
            }
            const text = cleanText(value);
            return options.caseSensitive ? text : normalizeComparableText(text);
        }).join("\u241F");
    }

    function rowHasValues(row) {
        if (Array.isArray(row)) {
            return row.some((value) => !isBlank(value));
        }
        if (row && typeof row === "object") {
            return Object.values(row).some((value) => !isBlank(value));
        }
        return !isBlank(row);
    }

    function countEmptyRows(rows) {
        return rows.reduce((count, row) => count + (rowHasValues(row) ? 0 : 1), 0);
    }

    function rowsToObjects(rows, headers) {
        return rows.map((row) => Object.fromEntries(
            headers.map((header, index) => [header, Array.isArray(row) ? row[index] : row?.[header]])
        ));
    }

    function objectToRow(record, headers) {
        return headers.map((header) => record?.[header]);
    }

    function getColumnValues(rows, header, columnIndex = null) {
        return rows.map((row) => Array.isArray(row) ? row[columnIndex] : row?.[header]);
    }

    function getFileExtension(fileName) {
        const match = cleanText(fileName).toLocaleLowerCase("pl-PL").match(/\.([a-z0-9]+)$/);
        return match ? match[1] : "";
    }

    function isSupportedExcelFile(file) {
        const extension = getFileExtension(file?.name || file);
        return ["xlsx", "xls", "xlsb"].includes(extension);
    }

    function validateExcelFile(file) {
        const errors = [];
        if (!(file instanceof File)) {
            errors.push({ code: "not_file", message: "Nie wybrano prawidłowego pliku." });
        } else {
            if (!isSupportedExcelFile(file)) {
                errors.push({ code: "unsupported_extension", message: "Obsługiwane formaty to XLSX, XLS i XLSB." });
            }
            if (file.size <= 0) {
                errors.push({ code: "empty_file", message: "Wybrany plik jest pusty." });
            }
            if (file.size > IMPORT_LIMITS.maximumFileSizeBytes) {
                errors.push({
                    code: "file_too_large",
                    message: `Plik przekracza limit ${formatFileSize(IMPORT_LIMITS.maximumFileSizeBytes)}.`
                });
            }
        }
        return { valid: errors.length === 0, errors };
    }

    function formatFileSize(bytes) {
        const value = Number(bytes);
        if (!Number.isFinite(value) || value < 0) {
            return "—";
        }
        if (value < 1024) {
            return `${value} B`;
        }
        const units = ["KB", "MB", "GB", "TB"];
        let size = value / 1024;
        let index = 0;
        while (size >= 1024 && index < units.length - 1) {
            size /= 1024;
            index += 1;
        }
        return `${formatNumber(size, { maximumFractionDigits: size >= 10 ? 1 : 2 })} ${units[index]}`;
    }

    function sanitizeFileName(value) {
        return cleanText(value)
            .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "-")
            .replace(/\.+$/g, "")
            .replace(/\s+/g, "-")
            .replace(/-+/g, "-")
            .slice(0, 120) || "export";
    }

    function createExportFileName(baseName, extension) {
        const date = new Date();
        const timestamp = [
            date.getFullYear(),
            String(date.getMonth() + 1).padStart(2, "0"),
            String(date.getDate()).padStart(2, "0"),
            "_",
            String(date.getHours()).padStart(2, "0"),
            String(date.getMinutes()).padStart(2, "0")
        ].join("");
        return `${sanitizeFileName(baseName)}_${timestamp}.${String(extension || "").replace(/^\./, "")}`;
    }

    function downloadBlob(blob, fileName, mimeType = null) {
        const normalizedBlob = blob instanceof Blob ? blob : new Blob([blob], { type: mimeType || "application/octet-stream" });
        const url = URL.createObjectURL(normalizedBlob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = sanitizeFileName(fileName);
        anchor.style.display = "none";
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        global.setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    function escapeCsvValue(value, delimiter = ";") {
        const text = isNullish(value) ? "" : String(value);
        if (text.includes(delimiter) || /["\r\n]/.test(text)) {
            return `"${text.replace(/"/g, '""')}"`;
        }
        return text;
    }

    function rowsToCsv(rows, options = {}) {
        const delimiter = options.delimiter || ";";
        const lineEnding = options.lineEnding || "\r\n";
        const content = rows.map((row) => row.map((value) => escapeCsvValue(value, delimiter)).join(delimiter)).join(lineEnding);
        return options.includeBom === false ? content : `\uFEFF${content}`;
    }

    function debounce(callback, wait = 100) {
        let timer = null;
        function debounced(...args) {
            global.clearTimeout(timer);
            timer = global.setTimeout(() => callback.apply(this, args), wait);
        }
        debounced.cancel = () => {
            global.clearTimeout(timer);
            timer = null;
        };
        debounced.flush = () => {
            if (timer) {
                global.clearTimeout(timer);
                timer = null;
                return callback();
            }
            return undefined;
        };
        return debounced;
    }

    function throttle(callback, wait = 100) {
        let lastRun = 0;
        let timer = null;
        let lastArgs = null;
        return function throttled(...args) {
            const now = Date.now();
            const remaining = wait - (now - lastRun);
            lastArgs = args;
            if (remaining <= 0) {
                global.clearTimeout(timer);
                timer = null;
                lastRun = now;
                callback.apply(this, args);
            } else if (!timer) {
                timer = global.setTimeout(() => {
                    timer = null;
                    lastRun = Date.now();
                    callback.apply(this, lastArgs);
                }, remaining);
            }
        };
    }

    function nextFrame() {
        return new Promise((resolve) => global.requestAnimationFrame(() => resolve()));
    }

    function yieldToBrowser() {
        return new Promise((resolve) => global.setTimeout(resolve, 0));
    }

    async function processInBatches(values, handler, options = {}) {
        const batchSize = Math.max(1, Math.trunc(options.batchSize || 1000));
        for (let start = 0; start < values.length; start += batchSize) {
            const end = Math.min(start + batchSize, values.length);
            for (let index = start; index < end; index += 1) {
                await handler(values[index], index, values);
            }
            if (typeof options.onProgress === "function") {
                options.onProgress(end, values.length);
            }
            if (end < values.length) {
                await yieldToBrowser();
            }
        }
    }

    function validateRecord(record) {
        const errors = [];
        const warnings = [];
        const date = parseDate(record.date, { allowExcelSerial: true, allowNumericStringExcelSerial: true });
        if (isBlank(record.date)) errors.push(VALIDATION_CODES.MISSING_DATE);
        else if (!date) errors.push(VALIDATION_CODES.INVALID_DATE);

        if (!cleanText(record.material)) errors.push(VALIDATION_CODES.MISSING_MATERIAL);

        const quantity = parseNumber(record.quantity);
        if (isBlank(record.quantity)) errors.push(VALIDATION_CODES.MISSING_QUANTITY);
        else if (quantity === null) errors.push(VALIDATION_CODES.INVALID_QUANTITY);
        else {
            if (quantity < 0 && !NORMALIZATION.quantityAllowsNegative) errors.push(VALIDATION_CODES.NEGATIVE_QUANTITY);
            if (quantity === 0) (NORMALIZATION.quantityAllowsZero ? warnings : errors).push(VALIDATION_CODES.ZERO_QUANTITY);
        }

        if (!cleanText(record.brand)) errors.push(VALIDATION_CODES.MISSING_BRAND);

        // "line" (pack station) is only enforced when marked required in constants.js —
        // some source files (e.g. procurement exports) have no such concept.
        if (SYSTEM_FIELD_MAP?.line?.required && !cleanText(record.line)) {
            errors.push(VALIDATION_CODES.MISSING_LINE);
        }

        return { errors: [...new Set(errors)], warnings: [...new Set(warnings)] };
    }

    function createDuplicateKey(record, sourceRow = []) {
        if (!NORMALIZATION.duplicateDetectionEnabled) return "";

        const identifierField = NORMALIZATION.duplicateIdentifierField || "recordId";
        const identifier = cleanText(record?.[identifierField]);
        if (identifier) {
            return `id:${createCompositeKey([identifier], {
                caseSensitive: NORMALIZATION.duplicateIdentifierCaseSensitive === true
            })}`;
        }

        if (NORMALIZATION.duplicateFallback !== "exact_source_row" || !Array.isArray(sourceRow) || !sourceRow.length) {
            return "";
        }

        return `row:${createCompositeKey(sourceRow, {
            caseSensitive: NORMALIZATION.duplicateSourceRowCaseSensitive !== false
        })}`;
    }

    function normalizeError(error, context = "") {
        const source = error instanceof Error ? error : new Error(String(error || "Nieznany błąd."));
        return {
            name: source.name || "Error",
            message: context ? `${context}: ${source.message}` : source.message,
            code: source.code || null,
            stack: source.stack || null,
            context: context || null,
            occurredAt: new Date().toISOString()
        };
    }

    function assert(condition, message = "Assertion failed.") {
        if (!condition) {
            throw new Error(message);
        }
    }

    const api = Object.freeze({
        isNullish,
        isBlank,
        toText,
        cleanText,
        normalizeComparableText,
        normalizeIdentifier,
        escapeHtml,
        stripHtml,
        truncate,
        createId,
        clamp,
        round,
        clonePlain,
        deepFreeze,
        safeJsonParse,
        safeJsonStringify,
        parseNumber,
        isNumeric,
        formatNumber,
        formatInteger,
        formatPercent,
        sum,
        average,
        minimum,
        maximum,
        isValidDate,
        parseDate,
        isExcelDateSerial,
        excelSerialToDate,
        dateToExcelSerial,
        toISODate,
        toISODateTime,
        formatDate,
        formatDateTime,
        getIsoWeekInfo,
        getWeekdayNumber,
        getMonthLabel,
        getWeekdayLabel,
        getSeason,
        getSeasonPeriod,
        deriveDateFields,
        isDateLikeHeader,
        parseBoolean,
        detectDataType,
        detectColumnTypes,
        isTypeCompatible,
        normalizeHeader,
        createUniqueHeaders,
        removeDuplicateSuffix,
        findHeaderIndex,
        createHeaderSignature,
        similarity,
        bestAliasSimilarity,
        scoreFieldMatch,
        levenshteinDistance,
        tokenSimilarity,
        unique,
        compact,
        chunk,
        groupBy,
        keyBy,
        naturalCompare,
        sortNatural,
        flatten,
        moveArrayItem,
        createCompositeKey,
        rowHasValues,
        countEmptyRows,
        rowsToObjects,
        objectToRow,
        getColumnValues,
        getFileExtension,
        isSupportedExcelFile,
        validateExcelFile,
        formatFileSize,
        sanitizeFileName,
        createExportFileName,
        downloadBlob,
        escapeCsvValue,
        rowsToCsv,
        debounce,
        throttle,
        nextFrame,
        yieldToBrowser,
        processInBatches,
        normalizeError,
        assert,
        validateRecord,
        createDuplicateKey
    });

    Object.defineProperty(PMA, "utils", {
        value: api,
        writable: false,
        enumerable: true,
        configurable: false
    });
})(window);
