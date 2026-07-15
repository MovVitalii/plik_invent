/* ==========================================================
   Excel Analytics Trainer
   src/utils.js
========================================================== */

(function initializeUtils(global) {
    "use strict";

    const EAT = global.EAT || (global.EAT = {});

    if (!EAT.constants) {
        throw new Error("EAT.constants must be loaded before src/utils.js.");
    }

    const {
        DATA_TYPES
    } = EAT.constants;

    const numberFormatter = new Intl.NumberFormat("pl-PL", {
        maximumFractionDigits: 2
    });

    const integerFormatter = new Intl.NumberFormat("pl-PL", {
        maximumFractionDigits: 0
    });

    const dateFormatter = new Intl.DateTimeFormat("pl-PL", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
    });

    const dateTimeFormatter = new Intl.DateTimeFormat("pl-PL", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit"
    });

    function isBlank(value) {
        return (
            value === null ||
            value === undefined ||
            (
                typeof value === "string" &&
                value.trim() === ""
            )
        );
    }

    function cleanText(value) {
        return value === null || value === undefined
            ? ""
            : String(value)
                .replace(
                    /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g,
                    ""
                )
                .replace(/\s+/g, " ")
                .trim();
    }

    function normalizeComparableText(value) {
        return cleanText(value)
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .toLocaleLowerCase("pl-PL");
    }

    function clonePlain(value) {
        if (typeof structuredClone === "function") {
            try {
                return structuredClone(value);
            } catch {
                // JSON fallback.
            }
        }

        if (value === undefined) {
            return undefined;
        }

        return JSON.parse(
            JSON.stringify(value)
        );
    }

    function cloneRows(rows) {
        return Array.isArray(rows)
            ? rows.map((row) => ({ ...(row || {}) }))
            : [];
    }

    function truncate(value, maximumLength = 100, suffix = "…") {
        const text = String(value ?? "");
        const limit = Math.max(
            0,
            Math.trunc(Number(maximumLength) || 0)
        );

        return text.length <= limit
            ? text
            : text.slice(
                0,
                Math.max(
                    0,
                    limit - suffix.length
                )
            ) + suffix;
    }

    function createId(prefix = "id") {
        if (global.crypto?.randomUUID) {
            return `${prefix}-${global.crypto.randomUUID()}`;
        }

        return (
            `${prefix}-${Date.now().toString(36)}-` +
            Math.random()
                .toString(36)
                .slice(2, 10)
        );
    }

    function formatNumber(value) {
        const number = Number(value);

        return Number.isFinite(number)
            ? numberFormatter.format(number)
            : "—";
    }

    function formatInteger(value) {
        const number = Number(value);

        return Number.isFinite(number)
            ? integerFormatter.format(number)
            : "0";
    }

    function formatDate(value) {
        const date = parseDate(value);

        return date
            ? dateFormatter.format(date)
            : "—";
    }

    function formatDateTime(value) {
        const date = parseDate(value);

        return date
            ? dateTimeFormatter.format(date)
            : "—";
    }

    function formatFileSize(bytes) {
        const size = Number(bytes) || 0;

        if (size < 1024) {
            return `${size} B`;
        }

        if (size < 1024 ** 2) {
            return `${(size / 1024).toFixed(1)} KB`;
        }

        return `${(size / 1024 ** 2).toFixed(1)} MB`;
    }

    function parseNumber(value) {
        if (
            typeof value === "number" &&
            Number.isFinite(value)
        ) {
            return value;
        }

        if (
            typeof value === "boolean" ||
            value === null ||
            value === undefined
        ) {
            return null;
        }

        let text = String(value)
            .replace(/\u00A0/g, " ")
            .trim();

        if (!text) {
            return null;
        }

        let percent = false;

        if (text.endsWith("%")) {
            percent = true;
            text = text.slice(0, -1).trim();
        }

        text = text
            .replace(/\s+/g, "")
            .replace(/'/g, "");

        if (!/^[+-]?[0-9.,]+(?:e[+-]?\d+)?$/i.test(text)) {
            return null;
        }

        const commaIndex = text.lastIndexOf(",");
        const dotIndex = text.lastIndexOf(".");

        if (
            commaIndex >= 0 &&
            dotIndex >= 0
        ) {
            if (commaIndex > dotIndex) {
                text = text
                    .replace(/\./g, "")
                    .replace(",", ".");
            } else {
                text = text.replace(/,/g, "");
            }
        } else if (commaIndex >= 0) {
            text = text.replace(",", ".");
        }

        const number = Number(text);

        if (!Number.isFinite(number)) {
            return null;
        }

        return percent
            ? number / 100
            : number;
    }

    function parseDate(value) {
        if (
            value instanceof Date &&
            !Number.isNaN(value.getTime())
        ) {
            return new Date(value.getTime());
        }

        if (
            typeof value === "number" &&
            Number.isFinite(value) &&
            value > 25569 &&
            value < 60000
        ) {
            return new Date(
                Math.round(
                    (value - 25569) *
                    86400 *
                    1000
                )
            );
        }

        if (
            value === null ||
            value === undefined
        ) {
            return null;
        }

        const text = String(value).trim();

        if (!text) {
            return null;
        }

        let match = text.match(
            /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T](\d{1,2}):?(\d{2})?)?$/
        );

        if (match) {
            return createSafeDate(
                Number(match[1]),
                Number(match[2]),
                Number(match[3]),
                Number(match[4] || 0),
                Number(match[5] || 0)
            );
        }

        match = text.match(
            /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})(?:[ T](\d{1,2}):?(\d{2})?)?$/
        );

        if (match) {
            let year = Number(match[3]);

            if (year < 100) {
                year += year >= 70
                    ? 1900
                    : 2000;
            }

            return createSafeDate(
                year,
                Number(match[2]),
                Number(match[1]),
                Number(match[4] || 0),
                Number(match[5] || 0)
            );
        }

        const timestamp = Date.parse(text);

        if (Number.isNaN(timestamp)) {
            return null;
        }

        return new Date(timestamp);
    }

    function createSafeDate(
        year,
        month,
        day,
        hours = 0,
        minutes = 0
    ) {
        const date = new Date(
            year,
            month - 1,
            day,
            hours,
            minutes
        );

        return (
            date.getFullYear() === year &&
            date.getMonth() === month - 1 &&
            date.getDate() === day
        )
            ? date
            : null;
    }

    function detectValueType(value) {
        if (isBlank(value)) {
            return DATA_TYPES.EMPTY;
        }

        if (typeof value === "boolean") {
            return DATA_TYPES.BOOLEAN;
        }

        if (
            typeof value === "number" &&
            Number.isFinite(value)
        ) {
            return DATA_TYPES.NUMBER;
        }

        if (
            value instanceof Date &&
            !Number.isNaN(value.getTime())
        ) {
            return DATA_TYPES.DATE;
        }

        if (typeof value === "string") {
            const normalized =
                value
                    .trim()
                    .toLocaleLowerCase("pl-PL");

            if (
                [
                    "true",
                    "false",
                    "tak",
                    "nie",
                    "yes",
                    "no"
                ].includes(normalized)
            ) {
                return DATA_TYPES.BOOLEAN;
            }

            if (
                (
                    /^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}/.test(normalized) ||
                    /^\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}/.test(normalized)
                ) &&
                parseDate(value)
            ) {
                return DATA_TYPES.DATE;
            }

            if (parseNumber(value) !== null) {
                return DATA_TYPES.NUMBER;
            }
        }

        return DATA_TYPES.TEXT;
    }

    function detectColumnTypes(
        headers,
        rows,
        maximumSampleSize = 2000
    ) {
        const sampleRows =
            Array.isArray(rows)
                ? rows.slice(
                    0,
                    maximumSampleSize
                )
                : [];

        return Object.fromEntries(
            (headers || []).map((header) => {
                const counts = {
                    [DATA_TYPES.TEXT]: 0,
                    [DATA_TYPES.NUMBER]: 0,
                    [DATA_TYPES.DATE]: 0,
                    [DATA_TYPES.BOOLEAN]: 0
                };

                sampleRows.forEach((row) => {
                    const type =
                        detectValueType(
                            row?.[header]
                        );

                    if (
                        type !== DATA_TYPES.EMPTY
                    ) {
                        counts[type] =
                            (counts[type] || 0) + 1;
                    }
                });

                const existing = Object.entries(counts)
                    .filter(([, count]) => count > 0)
                    .sort(
                        (left, right) =>
                            right[1] - left[1]
                    );

                let detectedType =
                    DATA_TYPES.EMPTY;

                if (existing.length === 1) {
                    detectedType =
                        existing[0][0];
                } else if (existing.length > 1) {
                    const total = existing.reduce(
                        (sum, [, count]) =>
                            sum + count,
                        0
                    );

                    detectedType =
                        existing[0][1] / total >= 0.9
                            ? existing[0][0]
                            : DATA_TYPES.MIXED;
                }

                return [
                    header,
                    detectedType
                ];
            })
        );
    }

    function createUniqueHeaders(values) {
        const used = new Map();

        return (values || []).map(
            (value, index) => {
                const base =
                    cleanText(value) ||
                    `Kolumna ${index + 1}`;

                const count =
                    (used.get(base) || 0) + 1;

                used.set(base, count);

                return count === 1
                    ? base
                    : `${base} (${count})`;
            }
        );
    }

    function rowHasValues(row, headers = null) {
        const values = Array.isArray(row)
            ? row
            : (
                headers
                    ? headers.map(
                        (header) =>
                            row?.[header]
                    )
                    : Object.values(row || {})
            );

        return values.some(
            (value) =>
                !isBlank(value)
        );
    }

    function filterRows(
        rows,
        options = {}
    ) {
        const search =
            normalizeComparableText(
                options.searchText
            );

        const filters =
            options.columnFilters || {};

        return (rows || []).filter((row) => {
            if (
                search &&
                !Object.values(row || {})
                    .some(
                        (value) =>
                            normalizeComparableText(
                                value
                            ).includes(search)
                    )
            ) {
                return false;
            }

            return Object.entries(filters)
                .every(
                    ([column, expected]) => {
                        if (
                            expected === "" ||
                            expected === null ||
                            expected === undefined
                        ) {
                            return true;
                        }

                        return normalizeComparableText(
                            row?.[column]
                        ) ===
                        normalizeComparableText(
                            expected
                        );
                    }
                );
        });
    }

    function sortRows(
        rows,
        column,
        direction = "asc"
    ) {
        const sign =
            direction === "desc"
                ? -1
                : 1;

        return [...(rows || [])]
            .sort((left, right) => {
                const leftValue =
                    left?.[column];

                const rightValue =
                    right?.[column];

                if (
                    isBlank(leftValue) &&
                    isBlank(rightValue)
                ) {
                    return 0;
                }

                if (isBlank(leftValue)) {
                    return 1;
                }

                if (isBlank(rightValue)) {
                    return -1;
                }

                const leftNumber =
                    parseNumber(leftValue);

                const rightNumber =
                    parseNumber(rightValue);

                if (
                    leftNumber !== null &&
                    rightNumber !== null
                ) {
                    return (
                        leftNumber -
                        rightNumber
                    ) * sign;
                }

                const leftDate =
                    parseDate(leftValue);

                const rightDate =
                    parseDate(rightValue);

                if (
                    leftDate &&
                    rightDate
                ) {
                    return (
                        leftDate.getTime() -
                        rightDate.getTime()
                    ) * sign;
                }

                return String(leftValue)
                    .localeCompare(
                        String(rightValue),
                        "pl-PL",
                        {
                            numeric: true,
                            sensitivity: "base"
                        }
                    ) * sign;
            });
    }

    function paginateRows(
        rows,
        requestedPage,
        pageSize
    ) {
        const source =
            Array.isArray(rows)
                ? rows
                : [];

        const size = Math.max(
            1,
            Math.trunc(Number(pageSize) || 25)
        );

        const totalPages = Math.max(
            1,
            Math.ceil(
                source.length / size
            )
        );

        const page = Math.min(
            totalPages,
            Math.max(
                1,
                Math.trunc(
                    Number(requestedPage) || 1
                )
            )
        );

        const start =
            (page - 1) * size;

        return {
            page,
            pageSize: size,
            totalPages,
            totalRows: source.length,
            rows: source.slice(
                start,
                start + size
            )
        };
    }

    function rowMatchesCriteria(
        row,
        criteria = []
    ) {
        return criteria.every(
            (criterion) =>
                valueMatchesCriterion(
                    row?.[criterion.column],
                    criterion
                )
        );
    }

    function valueMatchesCriterion(
        rawValue,
        criterion
    ) {
        const operator =
            criterion.operator ||
            "equals";

        const expected =
            criterion.value;

        if (operator === "is-empty") {
            return isBlank(rawValue);
        }

        if (
            operator ===
            "is-not-empty"
        ) {
            return !isBlank(rawValue);
        }

        const rawNumber =
            parseNumber(rawValue);

        const expectedNumber =
            parseNumber(expected);

        const rawDate =
            parseDate(rawValue);

        const expectedDate =
            parseDate(expected);

        const numericComparison =
            rawNumber !== null &&
            expectedNumber !== null;

        const dateComparison =
            !numericComparison &&
            rawDate &&
            expectedDate;

        let comparableLeft;
        let comparableRight;

        if (numericComparison) {
            comparableLeft =
                rawNumber;

            comparableRight =
                expectedNumber;
        } else if (dateComparison) {
            comparableLeft =
                rawDate.getTime();

            comparableRight =
                expectedDate.getTime();
        } else {
            comparableLeft =
                normalizeComparableText(
                    rawValue
                );

            comparableRight =
                normalizeComparableText(
                    expected
                );
        }

        switch (operator) {
            case "equals":
                return (
                    comparableLeft ===
                    comparableRight
                );

            case "not-equals":
                return (
                    comparableLeft !==
                    comparableRight
                );

            case "greater-than":
                return (
                    comparableLeft >
                    comparableRight
                );

            case "greater-or-equal":
                return (
                    comparableLeft >=
                    comparableRight
                );

            case "less-than":
                return (
                    comparableLeft <
                    comparableRight
                );

            case "less-or-equal":
                return (
                    comparableLeft <=
                    comparableRight
                );

            case "contains":
                return String(
                    comparableLeft
                ).includes(
                    String(
                        comparableRight
                    )
                );

            case "not-contains":
                return !String(
                    comparableLeft
                ).includes(
                    String(
                        comparableRight
                    )
                );

            case "starts-with":
                return String(
                    comparableLeft
                ).startsWith(
                    String(
                        comparableRight
                    )
                );

            case "ends-with":
                return String(
                    comparableLeft
                ).endsWith(
                    String(
                        comparableRight
                    )
                );

            default:
                return false;
        }
    }

    function buildExcelCriterion(
        operator,
        value
    ) {
        if (operator === "is-empty") {
            return '""';
        }

        if (
            operator ===
            "is-not-empty"
        ) {
            return '"<>"';
        }

        const symbols = {
            equals: "=",
            "not-equals": "<>",
            "greater-than": ">",
            "greater-or-equal": ">=",
            "less-than": "<",
            "less-or-equal": "<=",
            contains: "*",
            "not-contains": "<>*",
            "starts-with": "",
            "ends-with": "*"
        };

        const suffixes = {
            contains: "*",
            "not-contains": "*",
            "starts-with": "*",
            "ends-with": ""
        };

        const prefix =
            symbols[operator] ?? "=";

        const suffix =
            suffixes[operator] ?? "";

        const escaped =
            String(value ?? "")
                .replace(/"/g, '""');

        return (
            `"${prefix}${escaped}${suffix}"`
        );
    }

    function stableRowKey(
        row,
        headers
    ) {
        return (headers || [])
            .map((header) => {
                const value =
                    row?.[header];

                if (
                    value instanceof Date &&
                    !Number.isNaN(
                        value.getTime()
                    )
                ) {
                    return (
                        "date:" +
                        value.toISOString()
                    );
                }

                return (
                    typeof value +
                    ":" +
                    String(value ?? "")
                );
            })
            .join("\u241E");
    }

    function properCase(value) {
        return String(value ?? "")
            .toLocaleLowerCase("pl-PL")
            .replace(
                /(^|[\s\-–—/])([\p{L}\p{N}])/gu,
                (
                    match,
                    prefix,
                    character
                ) =>
                    prefix +
                    character.toLocaleUpperCase(
                        "pl-PL"
                    )
            );
    }

    function cleanControlCharacters(value) {
        return String(value ?? "")
            .replace(
                /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g,
                ""
            );
    }

    function debounce(
        callback,
        delay = 150
    ) {
        let timer = null;

        return function debounced(...args) {
            global.clearTimeout(timer);

            timer = global.setTimeout(
                () => callback.apply(
                    this,
                    args
                ),
                delay
            );
        };
    }

    function yieldToBrowser() {
        return new Promise((resolve) => {
            if (
                typeof global.requestAnimationFrame ===
                "function"
            ) {
                global.requestAnimationFrame(
                    () => resolve()
                );
            } else {
                global.setTimeout(resolve, 0);
            }
        });
    }

    function normalizeError(
        error,
        context = ""
    ) {
        const message =
            error instanceof Error
                ? error.message
                : String(
                    error ||
                    "Nieznany błąd."
                );

        return {
            name:
                error instanceof Error
                    ? error.name
                    : "Error",

            message:
                context
                    ? `${context}: ${message}`
                    : message,

            originalMessage:
                message,

            context
        };
    }

    function downloadBlob(
        blob,
        fileName
    ) {
        const url =
            URL.createObjectURL(blob);

        const anchor =
            document.createElement("a");

        anchor.href = url;
        anchor.download =
            fileName || "download";

        document.body.appendChild(
            anchor
        );

        anchor.click();
        anchor.remove();

        global.setTimeout(
            () =>
                URL.revokeObjectURL(
                    url
                ),
            0
        );
    }

    const api = Object.freeze({
        isBlank,
        cleanText,
        normalizeComparableText,
        clonePlain,
        cloneRows,
        truncate,
        createId,

        formatNumber,
        formatInteger,
        formatDate,
        formatDateTime,
        formatFileSize,

        parseNumber,
        parseDate,
        detectValueType,
        detectColumnTypes,
        createUniqueHeaders,
        rowHasValues,

        filterRows,
        sortRows,
        paginateRows,

        rowMatchesCriteria,
        valueMatchesCriterion,
        buildExcelCriterion,

        stableRowKey,
        properCase,
        cleanControlCharacters,

        debounce,
        yieldToBrowser,
        normalizeError,
        downloadBlob
    });

    Object.defineProperty(EAT, "utils", {
        value: api,
        writable: false,
        enumerable: true,
        configurable: false
    });
})(window);
