/* ==========================================================
   Excel Analytics Trainer
   src/data-quality-engine.js
========================================================== */

(function initializeDataQualityEngine(global) {
    "use strict";

    const EAT = global.EAT || (global.EAT = {});

    if (
        !EAT.constants ||
        !EAT.state ||
        !EAT.utils ||
        !EAT.dom
    ) {
        throw new Error(
            "EAT core modules must be loaded before src/data-quality-engine.js."
        );
    }

    const {
        STATUS,
        SECTIONS,
        EVENTS,
        DATA_TYPES,
        LEARNING_CONTENT
    } = EAT.constants;

    const {
        parseNumber,
        parseDate,
        formatInteger,
        stableRowKey,
        yieldToBrowser,
        normalizeError
    } = EAT.utils;

    const state = EAT.state;
    const dom = EAT.dom;
    const elements = dom.elements;

    const handlers = [];
    const YIELD_EVERY = 3000;

    let initialized = false;
    let qualityToken = 0;

    function initialize() {
        if (initialized) {
            return api;
        }

        bind(
            elements.runQualityCheckButton,
            "click",
            handleRunQualityCheck
        );

        bind(
            global,
            EVENTS.DATA_READY,
            invalidateQualityResult
        );

        bind(
            global,
            EVENTS.CLEANING_APPLIED,
            invalidateQualityResult
        );

        bind(
            global,
            EVENTS.CLEANING_UNDONE,
            invalidateQualityResult
        );

        bind(
            global,
            EVENTS.WORKSPACE_RESET,
            reset
        );

        renderCurrentState();

        initialized = true;

        return api;
    }

    function destroy() {
        handlers.forEach(
            ({
                element,
                eventName,
                handler
            }) => {
                element.removeEventListener(
                    eventName,
                    handler
                );
            }
        );

        handlers.length = 0;
        qualityToken += 1;
        initialized = false;
    }

    function bind(
        element,
        eventName,
        handler
    ) {
        if (
            !element ||
            typeof element.addEventListener !==
                "function" ||
            !eventName ||
            typeof handler !== "function"
        ) {
            return;
        }

        element.addEventListener(
            eventName,
            handler
        );

        handlers.push({
            element,
            eventName,
            handler
        });
    }

    async function handleRunQualityCheck() {
        await runQualityCheck();
    }

    async function runQualityCheck() {
        const token =
            ++qualityToken;

        const headers =
            state.get(
                "import.headers",
                []
            );

        const rows =
            state.get(
                "table.workingRows",
                []
            );

        if (
            !headers.length ||
            !rows.length
        ) {
            dom.showWarning(
                "Brak danych do kontroli jakości.",
                "Jakość danych"
            );

            return null;
        }

        try {
            state.clearError();

            state.setBusy({
                title:
                    "Kontrola jakości",

                message:
                    "Analizowanie kolumn...",

                progress: 10
            });

            await yieldToBrowser();

            const columns =
                await analyzeColumns(
                    headers,
                    rows,
                    token
                );

            if (
                token !== qualityToken
            ) {
                return null;
            }

            state.updateBusy({
                message:
                    "Wyszukiwanie pełnych duplikatów...",

                progress: 75
            });

            const duplicateRowCount =
                await countDuplicateRows(
                    headers,
                    rows,
                    token
                );

            if (
                token !== qualityToken
            ) {
                return null;
            }

            const report =
                createReport({
                    headers,
                    rows,
                    columns,
                    duplicateRowCount
                });

            state.setQualityReport(
                report
            );

            state.completeSection(
                SECTIONS.QUALITY
            );

            dom.renderQualitySummary(
                report
            );

            dom.renderQualityTable(
                report.columns
            );

            const learning =
                LEARNING_CONTENT.quality;

            state.setLearningContext(
                "quality",
                {
                    context:
                        learning.explanation,

                    excelEquivalent:
                        learning.excelEquivalent,

                    verificationTip:
                        learning.verificationTip
                }
            );

            state.clearBusy(
                STATUS.READY
            );

            const issueCount =
                report.emptyCellCount +
                report.duplicateRowCount +
                report.typeErrorCount;

            if (issueCount > 0) {
                dom.showWarning(
                    `Wykryto ${formatInteger(
                        issueCount
                    )} potencjalnych problemów.`,

                    "Kontrola zakończona"
                );
            } else {
                dom.showSuccess(
                    "Nie wykryto pustych komórek, duplikatów ani niespójnych typów.",

                    "Kontrola zakończona"
                );
            }

            EAT.exportEngine
                ?.syncAvailability?.();

            return report;
        } catch (error) {
            return handleQualityError(
                error
            );
        }
    }

    async function analyzeColumns(
        headers,
        rows,
        token = qualityToken
    ) {
        const columns = [];
        const totalOperations =
            Math.max(
                1,
                headers.length *
                rows.length
            );

        let operationCount = 0;

        for (
            let columnIndex = 0;
            columnIndex <
                headers.length;
            columnIndex += 1
        ) {
            const name =
                headers[columnIndex];

            const profile =
                createColumnProfile(
                    name,
                    rows.length
                );

            const uniqueValues =
                new Set();

            const numericValues = [];
            const dateValues = [];

            for (
                let rowIndex = 0;
                rowIndex <
                    rows.length;
                rowIndex += 1
            ) {
                if (
                    token !== qualityToken
                ) {
                    return [];
                }

                const value =
                    rows[rowIndex]?.[name];

                analyzeCell({
                    profile,
                    value,
                    uniqueValues,
                    numericValues,
                    dateValues
                });

                operationCount += 1;

                if (
                    operationCount %
                    YIELD_EVERY ===
                    0
                ) {
                    state.updateBusy({
                        message:
                            `Analizowanie kolumny „${name}”...`,

                        progress:
                            Math.min(
                                70,
                                10 +
                                Math.round(
                                    (
                                        operationCount /
                                        totalOperations
                                    ) * 60
                                )
                            )
                    });

                    await yieldToBrowser();
                }
            }

            finalizeColumnProfile({
                profile,
                uniqueValues,
                numericValues,
                dateValues
            });

            columns.push(profile);
        }

        return columns;
    }

    function createColumnProfile(
        name,
        rowCount
    ) {
        return {
            name,
            type: DATA_TYPES.EMPTY,
            dominantType:
                DATA_TYPES.EMPTY,
            rowCount,
            populatedCount: 0,
            emptyCount: 0,
            uniqueCount: 0,
            typeErrorCount: 0,
            minimum: null,
            maximum: null,
            average: null,
            sum: null,
            whitespaceOnlyCount: 0,
            edgeWhitespaceCount: 0,
            typeCounts: {
                [DATA_TYPES.TEXT]: 0,
                [DATA_TYPES.NUMBER]: 0,
                [DATA_TYPES.DATE]: 0,
                [DATA_TYPES.BOOLEAN]: 0
            },
            problems: []
        };
    }

    function analyzeCell({
        profile,
        value,
        uniqueValues,
        numericValues,
        dateValues
    }) {
        if (isTrulyEmpty(value)) {
            profile.emptyCount += 1;
            return;
        }

        profile.populatedCount += 1;

        const type =
            detectQualityType(value);

        profile.typeCounts[type] =
            (
                profile.typeCounts[type] ||
                0
            ) + 1;

        uniqueValues.add(
            canonicalValue(
                value,
                type
            )
        );

        if (
            typeof value ===
            "string"
        ) {
            if (
                value.length > 0 &&
                value.trim().length === 0
            ) {
                profile
                    .whitespaceOnlyCount +=
                    1;
            } else if (
                value !== value.trim()
            ) {
                profile
                    .edgeWhitespaceCount +=
                    1;
            }
        }

        if (
            type ===
            DATA_TYPES.NUMBER
        ) {
            const number =
                parseNumber(value);

            if (
                number !== null &&
                Number.isFinite(number)
            ) {
                numericValues.push(number);
            }
        }

        if (
            type ===
            DATA_TYPES.DATE
        ) {
            const date =
                parseDate(value);

            if (date) {
                dateValues.push(date);
            }
        }
    }

    function finalizeColumnProfile({
        profile,
        uniqueValues,
        numericValues,
        dateValues
    }) {
        profile.uniqueCount =
            uniqueValues.size;

        const existingTypes =
            Object.entries(
                profile.typeCounts
            ).filter(
                (
                    [, count]
                ) =>
                    count > 0
            );

        if (!existingTypes.length) {
            profile.type =
                DATA_TYPES.EMPTY;

            profile.dominantType =
                DATA_TYPES.EMPTY;
        } else {
            profile.dominantType =
                findDominantType(
                    profile.typeCounts
                );

            profile.type =
                existingTypes.length ===
                1
                    ? existingTypes[0][0]
                    : DATA_TYPES.MIXED;

            profile.typeErrorCount =
                profile.populatedCount -
                (
                    profile.typeCounts[
                        profile.dominantType
                    ] || 0
                );
        }

        if (
            profile.dominantType ===
                DATA_TYPES.NUMBER &&
            numericValues.length
        ) {
            profile.sum =
                sumValues(
                    numericValues
                );

            profile.average =
                profile.sum /
                numericValues.length;

            profile.minimum =
                findMinimum(
                    numericValues
                );

            profile.maximum =
                findMaximum(
                    numericValues
                );
        }

        if (
            profile.dominantType ===
                DATA_TYPES.DATE &&
            dateValues.length
        ) {
            profile.minimum =
                findEarliestDate(
                    dateValues
                );

            profile.maximum =
                findLatestDate(
                    dateValues
                );
        }

        profile.problems =
            buildProblems(profile);
    }

    function detectQualityType(value) {
        if (isTrulyEmpty(value)) {
            return DATA_TYPES.EMPTY;
        }

        if (
            typeof value ===
            "boolean"
        ) {
            return DATA_TYPES.BOOLEAN;
        }

        if (
            typeof value ===
                "number" &&
            Number.isFinite(value)
        ) {
            return DATA_TYPES.NUMBER;
        }

        if (
            value instanceof Date &&
            !Number.isNaN(
                value.getTime()
            )
        ) {
            return DATA_TYPES.DATE;
        }

        if (
            typeof value ===
            "string"
        ) {
            const normalized =
                value
                    .trim()
                    .toLocaleLowerCase(
                        "pl-PL"
                    );

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
                    /^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}/
                        .test(normalized) ||
                    /^\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}/
                        .test(normalized)
                ) &&
                parseDate(value)
            ) {
                return DATA_TYPES.DATE;
            }

            if (
                parseNumber(value) !==
                null
            ) {
                return DATA_TYPES.NUMBER;
            }
        }

        return DATA_TYPES.TEXT;
    }

    function findDominantType(
        counts
    ) {
        let result =
            DATA_TYPES.TEXT;

        let highest = -1;

        [
            DATA_TYPES.NUMBER,
            DATA_TYPES.DATE,
            DATA_TYPES.BOOLEAN,
            DATA_TYPES.TEXT
        ].forEach((type) => {
            const count =
                Number(
                    counts[type]
                ) || 0;

            if (count > highest) {
                result = type;
                highest = count;
            }
        });

        return result;
    }

    function buildProblems(profile) {
        const problems = [];

        if (
            profile.emptyCount > 0
        ) {
            problems.push(
                `Puste: ${formatInteger(
                    profile.emptyCount
                )}`
            );
        }

        if (
            profile.type ===
            DATA_TYPES.MIXED
        ) {
            problems.push(
                `Mieszane typy: ${formatInteger(
                    profile.typeErrorCount
                )}`
            );
        }

        if (
            profile
                .whitespaceOnlyCount >
            0
        ) {
            problems.push(
                `Tylko spacje: ${formatInteger(
                    profile
                        .whitespaceOnlyCount
                )}`
            );
        }

        if (
            profile
                .edgeWhitespaceCount >
            0
        ) {
            problems.push(
                `Spacje na brzegach: ${formatInteger(
                    profile
                        .edgeWhitespaceCount
                )}`
            );
        }

        return problems;
    }

    async function countDuplicateRows(
        headers,
        rows,
        token = qualityToken
    ) {
        const seen =
            new Set();

        let duplicateCount = 0;

        for (
            let index = 0;
            index < rows.length;
            index += 1
        ) {
            if (
                token !== qualityToken
            ) {
                return 0;
            }

            const key =
                stableRowKey(
                    rows[index],
                    headers
                );

            if (seen.has(key)) {
                duplicateCount += 1;
            } else {
                seen.add(key);
            }

            if (
                index > 0 &&
                index % YIELD_EVERY ===
                    0
            ) {
                await yieldToBrowser();
            }
        }

        return duplicateCount;
    }

    function canonicalValue(
        value,
        type
    ) {
        if (
            type === DATA_TYPES.EMPTY
        ) {
            return "empty:";
        }

        if (
            type === DATA_TYPES.NUMBER
        ) {
            return (
                "number:" +
                String(
                    parseNumber(value)
                )
            );
        }

        if (
            type === DATA_TYPES.DATE
        ) {
            return (
                "date:" +
                (
                    parseDate(value)
                        ?.toISOString() ||
                    String(value)
                )
            );
        }

        if (
            type ===
            DATA_TYPES.BOOLEAN
        ) {
            return (
                "boolean:" +
                String(value)
                    .trim()
                    .toLocaleLowerCase(
                        "pl-PL"
                    )
            );
        }

        return (
            "text:" +
            String(value)
        );
    }

    function createReport({
        headers,
        rows,
        columns,
        duplicateRowCount
    }) {
        const completedAt =
            new Date().toISOString();

        return {
            completed: true,
            rowCount: rows.length,
            columnCount:
                headers.length,

            emptyCellCount:
                columns.reduce(
                    (
                        total,
                        column
                    ) =>
                        total +
                        column.emptyCount,
                    0
                ),

            duplicateRowCount,

            typeErrorCount:
                columns.reduce(
                    (
                        total,
                        column
                    ) =>
                        total +
                        column.typeErrorCount,
                    0
                ),

            uniqueValueCount:
                columns.reduce(
                    (
                        total,
                        column
                    ) =>
                        total +
                        column.uniqueCount,
                    0
                ),

            columns,
            checkedAt:
                completedAt,
            completedAt
        };
    }

    function sumValues(values) {
        return values.reduce(
            (
                total,
                value
            ) =>
                total + value,
            0
        );
    }

    function findMinimum(values) {
        return values.reduce(
            (
                minimum,
                value
            ) =>
                value < minimum
                    ? value
                    : minimum,
            Infinity
        );
    }

    function findMaximum(values) {
        return values.reduce(
            (
                maximum,
                value
            ) =>
                value > maximum
                    ? value
                    : maximum,
            -Infinity
        );
    }

    function findEarliestDate(
        values
    ) {
        return values.reduce(
            (
                earliest,
                value
            ) =>
                value.getTime() <
                earliest.getTime()
                    ? value
                    : earliest
        );
    }

    function findLatestDate(
        values
    ) {
        return values.reduce(
            (
                latest,
                value
            ) =>
                value.getTime() >
                latest.getTime()
                    ? value
                    : latest
        );
    }

    function isTrulyEmpty(value) {
        return (
            value === null ||
            value === undefined ||
            value === ""
        );
    }

    function invalidateQualityResult() {
        qualityToken += 1;

        state.set(
            "quality",
            {
                completed: false,
                rowCount: 0,
                columnCount: 0,
                emptyCellCount: 0,
                duplicateRowCount: 0,
                typeErrorCount: 0,
                uniqueValueCount: 0,
                columns: [],
                checkedAt: null,
                completedAt: null
            },
            {
                notify: false
            }
        );

        dom.renderQualitySummary({});
        dom.renderQualityTable([]);

        EAT.exportEngine
            ?.syncAvailability?.();
    }

    function renderCurrentState() {
        const quality =
            state.get(
                "quality",
                {}
            );

        if (
            quality.completed &&
            Array.isArray(
                quality.columns
            )
        ) {
            dom.renderQualitySummary(
                quality
            );

            dom.renderQualityTable(
                quality.columns
            );
        } else {
            dom.renderQualitySummary({});
            dom.renderQualityTable([]);
        }
    }

    function reset() {
        invalidateQualityResult();
    }

    function handleQualityError(error) {
        const normalized =
            normalizeError(
                error,
                "Kontrola jakości"
            );

        state.setError(
            error,
            "Kontrola jakości"
        );

        state.clearBusy(
            STATUS.ERROR
        );

        dom.showError(
            normalized.message,
            "Kontrola jakości"
        );

        return null;
    }

    const api = Object.freeze({
        initialize,
        destroy,
        runQualityCheck,
        analyzeColumns,
        detectQualityType,
        countDuplicateRows,
        createReport,
        sumValues,
        findMinimum,
        findMaximum,
        invalidateQualityResult,
        reset,

        get initialized() {
            return initialized;
        }
    });

    Object.defineProperty(
        EAT,
        "dataQualityEngine",
        {
            value: api,
            writable: false,
            enumerable: true,
            configurable: false
        }
    );
})(window);
