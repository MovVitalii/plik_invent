/* ==========================================================
   Excel Analytics Trainer
   src/chart-engine.js
========================================================== */

(function initializeChartEngine(global) {
    "use strict";

    const EAT = global.EAT || (global.EAT = {});

    if (
        !EAT.constants ||
        !EAT.state ||
        !EAT.utils ||
        !EAT.dom
    ) {
        throw new Error(
            "EAT core modules must be loaded before src/chart-engine.js."
        );
    }

    const {
        STATUS,
        SECTIONS,
        EVENTS,
        CHART_TYPES,
        LEARNING_CONTENT
    } = EAT.constants;

    const {
        cleanText,
        formatNumber,
        formatInteger,
        clonePlain,
        yieldToBrowser,
        normalizeError
    } = EAT.utils;

    const state = EAT.state;
    const dom = EAT.dom;
    const elements = dom.elements;

    const handlers = [];
    const MAX_CHART_POINTS = 200;

    const COLOR_PALETTE = Object.freeze([
        "#155eef",
        "#137a4d",
        "#a05c00",
        "#8b5cf6",
        "#c43232",
        "#0891b2",
        "#c026d3",
        "#4f6b33",
        "#d97706",
        "#475569",
        "#0f766e",
        "#9333ea"
    ]);

    let initialized = false;
    let chartInstance = null;
    let renderToken = 0;

    function initialize() {
        if (initialized) {
            return api;
        }

        renderChartTypeOptions();

        bind(
            elements.chartTypeSelector,
            "change",
            handleChartTypeChange
        );

        bind(
            elements.renderChartButton,
            "click",
            handleRenderChart
        );

        bind(
            global,
            EVENTS.PIVOT_BUILT,
            handlePivotBuilt
        );

        bind(
            global,
            EVENTS.WORKSPACE_RESET,
            reset
        );

        syncAvailability();

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
        renderToken += 1;
        destroyChart();
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

    async function handleRenderChart() {
        await renderChart();
    }

    function handleChartTypeChange(
        event
    ) {
        const chartType =
            normalizeChartType(
                event.target.value
            );

        event.target.value =
            chartType.id;

        renderToken += 1;
        destroyChart();

        state.setChartState({
            type:
                chartType.id,
            title: "",
            description: "",
            rendered: false,
            config: null
        });

        dom.setText(
            elements.chartDescription,
            "Typ wykresu został zmieniony. Kliknij „Zbuduj wykres”."
        );
    }

    function handlePivotBuilt() {
        renderToken += 1;
        destroyChart();

        state.setChartState({
            type:
                getSelectedChartType()
                    .id,
            title: "",
            description: "",
            rendered: false,
            config: null
        });

        dom.setText(
            elements.chartDescription,
            "Dane Pivot są gotowe. Wybierz typ i zbuduj wykres."
        );

        syncAvailability();
    }

    function renderChartTypeOptions() {
        const current =
            state.get(
                "chart.type",
                "bar"
            );

        dom.renderSelectOptions(
            elements.chartTypeSelector,

            CHART_TYPES.map(
                (chartType) => ({
                    value:
                        chartType.id,

                    label:
                        chartType.label
                })
            ),

            {
                value:
                    CHART_TYPES.some(
                        (item) =>
                            item.id ===
                            current
                    )
                        ? current
                        : "bar"
            }
        );
    }

    function getSelectedChartType() {
        return normalizeChartType(
            elements
                .chartTypeSelector
                .value
        );
    }

    function normalizeChartType(value) {
        const requestedId =
            typeof value ===
            "object"
                ? value.id
                : value;

        return (
            CHART_TYPES.find(
                (item) =>
                    item.id ===
                    requestedId
            ) ||
            CHART_TYPES.find(
                (item) =>
                    item.id === "bar"
            ) ||
            CHART_TYPES[0]
        );
    }

    async function renderChart(
        customOptions = {}
    ) {
        const token =
            ++renderToken;

        const validation =
            validateChartData();

        if (!validation.valid) {
            dom.showWarning(
                validation.errors.join(" "),
                "Wykres"
            );

            return null;
        }

        try {
            assertChartJs();
            state.clearError();

            state.setBusy({
                title:
                    "Tworzenie wykresu",

                message:
                    "Przygotowywanie danych Pivot...",

                progress: 20
            });

            await yieldToBrowser();

            const pivotResult =
                state.get(
                    "pivot.result",
                    null
                );

            const chartType =
                normalizeChartType(
                    customOptions
                        .chartType ||
                    getSelectedChartType()
                );

            const preparedData =
                prepareChartData(
                    pivotResult.chart,
                    chartType
                );

            if (
                token !== renderToken
            ) {
                return null;
            }

            const title =
                cleanText(
                    customOptions.title
                ) ||
                buildChartTitle(
                    pivotResult
                );

            const config =
                buildChartConfig({
                    chartType,
                    chartData:
                        preparedData,
                    title
                });

            destroyChart();

            const context =
                elements
                    .analysisChart
                    .getContext("2d");

            if (!context) {
                throw new Error(
                    "Nie można uzyskać kontekstu wykresu."
                );
            }

            chartInstance =
                new global.Chart(
                    context,
                    config
                );

            const description =
                buildChartDescription(
                    preparedData,
                    chartType
                );

            state.setChartState({
                type:
                    chartType.id,
                title,
                description,
                rendered: true,
                config:
                    createSerializableConfig(
                        config
                    )
            });

            state.completeSection(
                SECTIONS.REPORT
            );

            const learning =
                LEARNING_CONTENT.report;

            state.setLearningContext(
                "report",
                {
                    context:
                        learning.explanation,
                    excelEquivalent:
                        learning.excelEquivalent,
                    verificationTip:
                        learning.verificationTip
                }
            );

            dom.setText(
                elements.chartDescription,
                description
            );

            state.clearBusy(
                STATUS.READY
            );

            if (
                preparedData.truncated
            ) {
                dom.showWarning(
                    `Wykres pokazuje pierwsze ${formatInteger(
                        preparedData
                            .displayedPointCount
                    )} z ${formatInteger(
                        preparedData
                            .originalPointCount
                    )} kategorii.`,

                    "Ograniczony podgląd"
                );
            } else {
                dom.showSuccess(
                    `Utworzono wykres dla ${formatInteger(
                        preparedData
                            .displayedPointCount
                    )} kategorii.`,

                    "Wykres gotowy"
                );
            }

            return {
                type:
                    chartType.id,
                title,
                description,
                data:
                    clonePlain(
                        preparedData
                    )
            };
        } catch (error) {
            return handleChartError(
                error
            );
        }
    }

    function validateChartData() {
        const errors = [];

        const chartData =
            state.get(
                "pivot.result.chart",
                null
            );

        if (!chartData) {
            errors.push(
                "Najpierw zbuduj tabelę przestawną."
            );
        } else {
            if (
                !Array.isArray(
                    chartData.labels
                ) ||
                !chartData.labels.length
            ) {
                errors.push(
                    "Brak kategorii do przedstawienia."
                );
            }

            if (
                !Array.isArray(
                    chartData.datasets
                ) ||
                !chartData.datasets.length
            ) {
                errors.push(
                    "Brak serii wartości."
                );
            }
        }

        return {
            valid:
                errors.length === 0,
            errors
        };
    }

    function prepareChartData(
        sourceData,
        chartType
    ) {
        const originalLabels =
            Array.isArray(
                sourceData?.labels
            )
                ? sourceData.labels
                : [];

        const originalDatasets =
            Array.isArray(
                sourceData?.datasets
            )
                ? sourceData.datasets
                : [];

        const originalPointCount =
            originalLabels.length;

        const displayedPointCount =
            Math.min(
                originalPointCount,
                MAX_CHART_POINTS
            );

        const labels =
            originalLabels
                .slice(
                    0,
                    displayedPointCount
                )
                .map(
                    (label) =>
                        label === null ||
                        label === undefined ||
                        label === ""
                            ? "(puste)"
                            : String(label)
                );

        let datasets =
            originalDatasets.map(
                (dataset) => ({
                    label:
                        cleanText(
                            dataset.label
                        ) ||
                        "Wartość",

                    data:
                        Array.from(
                            {
                                length:
                                    displayedPointCount
                            },
                            (
                                _,
                                index
                            ) => {
                                const value =
                                    Number(
                                        dataset
                                            .data?.[
                                            index
                                        ]
                                    );

                                return Number.isFinite(
                                    value
                                )
                                    ? value
                                    : 0;
                            }
                        )
                })
            );

        if (
            [
                "pie",
                "doughnut"
            ].includes(
                chartType.id
            )
        ) {
            datasets =
                datasets.slice(0, 1);
        }

        return {
            labels,
            datasets,
            originalPointCount,
            displayedPointCount,
            truncated:
                displayedPointCount <
                originalPointCount
        };
    }

    function buildChartConfig({
        chartType,
        chartData,
        title
    }) {
        const circular =
            [
                "pie",
                "doughnut"
            ].includes(
                chartType.id
            );

        const horizontal =
            chartType.indexAxis ===
            "y";

        const datasets =
            circular
                ? buildCircularDatasets(
                    chartData.datasets,
                    chartData.labels.length
                )
                : buildCartesianDatasets(
                    chartData.datasets,
                    chartType
                );

        const config = {
            type:
                chartType.chartJsType,

            data: {
                labels: [
                    ...chartData.labels
                ],
                datasets
            },

            options: {
                responsive: true,
                maintainAspectRatio: false,
                indexAxis:
                    horizontal
                        ? "y"
                        : "x",

                animation: {
                    duration: 300
                },

                interaction: {
                    mode:
                        circular
                            ? "nearest"
                            : "index",
                    intersect: false
                },

                plugins: {
                    title: {
                        display:
                            Boolean(title),
                        text:
                            title || ""
                    },

                    legend: {
                        display:
                            circular ||
                            datasets.length > 1,
                        position:
                            circular
                                ? "right"
                                : "top"
                    },

                    tooltip: {
                        callbacks: {
                            label:
                                circular
                                    ? createCircularTooltip
                                    : createCartesianTooltip
                        }
                    }
                }
            }
        };

        if (!circular) {
            const valueScale = {
                beginAtZero: true,

                ticks: {
                    callback(value) {
                        return formatNumber(
                            value
                        );
                    }
                },

                grid: {
                    display: true
                }
            };

            const categoryScale = {
                ticks: {
                    autoSkip: true,
                    maxRotation:
                        horizontal
                            ? 0
                            : 45,
                    minRotation: 0
                },

                grid: {
                    display: false
                }
            };

            config.options.scales =
                horizontal
                    ? {
                        x:
                            valueScale,
                        y:
                            categoryScale
                    }
                    : {
                        x:
                            categoryScale,
                        y:
                            valueScale
                    };
        }

        return config;
    }

    function buildCartesianDatasets(
        datasets,
        chartType
    ) {
        return datasets.map(
            (dataset, index) => {
                const color =
                    COLOR_PALETTE[
                        index %
                        COLOR_PALETTE.length
                    ];

                const result = {
                    label:
                        dataset.label,
                    data: [
                        ...dataset.data
                    ],
                    borderColor:
                        color,
                    backgroundColor:
                        chartType.id ===
                        "line"
                            ? toRgba(
                                color,
                                0.16
                            )
                            : toRgba(
                                color,
                                0.72
                            ),
                    borderWidth:
                        chartType.id ===
                        "line"
                            ? 2
                            : 1
                };

                if (
                    chartType.id ===
                    "line"
                ) {
                    return {
                        ...result,
                        fill: false,
                        tension: 0.25,
                        pointRadius: 3,
                        pointHoverRadius: 5
                    };
                }

                return {
                    ...result,
                    borderRadius: 4,
                    borderSkipped: false
                };
            }
        );
    }

    function buildCircularDatasets(
        datasets,
        labelCount
    ) {
        const source =
            datasets[0] || {
                label:
                    "Wartość",
                data: []
            };

        return [
            {
                label:
                    source.label,
                data: [
                    ...source.data
                ],
                backgroundColor:
                    Array.from(
                        {
                            length:
                                labelCount
                        },
                        (
                            _,
                            index
                        ) =>
                            toRgba(
                                COLOR_PALETTE[
                                    index %
                                    COLOR_PALETTE
                                        .length
                                ],
                                0.82
                            )
                    ),
                borderColor:
                    "#ffffff",
                borderWidth: 2,
                hoverOffset: 7
            }
        ];
    }

    function createCartesianTooltip(
        context
    ) {
        const label =
            cleanText(
                context.dataset
                    ?.label
            );

        const horizontal =
            context.chart
                ?.options
                ?.indexAxis ===
            "y";

        const parsed =
            context.parsed || {};

        const value =
            Number(
                horizontal
                    ? parsed.x
                    : parsed.y
            );

        return (
            (
                label
                    ? `${label}: `
                    : ""
            ) +
            formatNumber(
                Number.isFinite(value)
                    ? value
                    : context.raw
            )
        );
    }

    function createCircularTooltip(
        context
    ) {
        const value =
            Number(
                context.raw
            ) || 0;

        const total =
            (
                context.dataset
                    ?.data ||
                []
            ).reduce(
                (
                    sum,
                    item
                ) =>
                    sum +
                    (
                        Number(item) ||
                        0
                    ),
                0
            );

        const percentage =
            total
                ? (
                    value /
                    total *
                    100
                )
                : 0;

        return (
            `${context.label}: ` +
            `${formatNumber(value)} ` +
            `(${percentage.toLocaleString(
                "pl-PL",
                {
                    maximumFractionDigits: 1
                }
            )}%)`
        );
    }

    function buildChartTitle(
        pivotResult
    ) {
        const configuration =
            pivotResult
                ?.configuration ||
            {};

        const labels = {
            sum: "Suma",
            average: "Średnia",
            count: "Liczba",
            min: "Minimum",
            max: "Maksimum"
        };

        return (
            `${labels[
                configuration.aggregation
            ] || "Wartość"} ` +
            `${configuration.values?.[0] || ""}` +
            (
                configuration.rows?.length
                    ? (
                        " według " +
                        configuration.rows
                            .join(" / ")
                    )
                    : ""
            )
        ).trim();
    }

    function buildChartDescription(
        chartData,
        chartType
    ) {
        const values =
            chartData.datasets
                .flatMap(
                    (dataset) =>
                        dataset.data
                )
                .map(Number)
                .filter(
                    Number.isFinite
                );

        const total =
            values.reduce(
                (
                    sum,
                    value
                ) =>
                    sum + value,
                0
            );

        return (
            `${chartType.label}: ` +
            `${formatInteger(
                chartData
                    .displayedPointCount
            )} kategorii, ` +
            `${formatInteger(
                chartData.datasets
                    .length
            )} serii. ` +
            `Łączna wartość punktów: ${formatNumber(total)}.`
        );
    }

    function createSerializableConfig(
        config
    ) {
        return {
            type:
                config.type,
            data:
                clonePlain(
                    config.data
                ),
            options: {
                responsive:
                    config.options
                        ?.responsive !==
                    false,
                maintainAspectRatio:
                    config.options
                        ?.maintainAspectRatio ===
                    true,
                indexAxis:
                    config.options
                        ?.indexAxis ||
                    "x",
                title:
                    config.options
                        ?.plugins
                        ?.title
                        ?.text || ""
            }
        };
    }

    function toRgba(
        hex,
        alpha
    ) {
        const normalized =
            String(hex)
                .replace("#", "");

        if (
            normalized.length !== 6
        ) {
            return hex;
        }

        const red =
            Number.parseInt(
                normalized.slice(0, 2),
                16
            );

        const green =
            Number.parseInt(
                normalized.slice(2, 4),
                16
            );

        const blue =
            Number.parseInt(
                normalized.slice(4, 6),
                16
            );

        return (
            `rgba(${red}, ${green}, ${blue}, ` +
            `${Math.min(
                1,
                Math.max(
                    0,
                    Number(alpha) || 0
                )
            )})`
        );
    }

    function assertChartJs() {
        if (
            typeof global.Chart !==
            "function"
        ) {
            throw new Error(
                "Biblioteka Chart.js nie została załadowana."
            );
        }
    }

    function destroyChart() {
        if (
            chartInstance &&
            typeof chartInstance
                .destroy ===
                "function"
        ) {
            chartInstance.destroy();
        }

        chartInstance = null;
    }

    function hasPivotChartData() {
        const chartData =
            state.get(
                "pivot.result.chart",
                null
            );

        return Boolean(
            chartData &&
            Array.isArray(
                chartData.labels
            ) &&
            chartData.labels.length &&
            Array.isArray(
                chartData.datasets
            ) &&
            chartData.datasets.length
        );
    }

    function syncAvailability() {
        dom.setDisabled(
            elements.renderChartButton,
            !hasPivotChartData()
        );
    }

    function reset() {
        renderToken += 1;
        destroyChart();

        const defaultType =
            normalizeChartType(
                "bar"
            );

        elements
            .chartTypeSelector
            .value =
            defaultType.id;

        state.setChartState({
            type:
                defaultType.id,
            title: "",
            description: "",
            rendered: false,
            config: null
        });

        dom.setText(
            elements.chartDescription,
            "Brak wykresu."
        );

        syncAvailability();
    }

    function handleChartError(error) {
        const normalized =
            normalizeError(
                error,
                "Tworzenie wykresu"
            );

        destroyChart();

        state.setError(
            error,
            "Tworzenie wykresu"
        );

        state.clearBusy(
            STATUS.ERROR
        );

        state.setChartState({
            type:
                getSelectedChartType()
                    .id,
            title: "",
            description:
                normalized.message,
            rendered: false,
            config: null
        });

        dom.setText(
            elements.chartDescription,
            normalized.message
        );

        dom.showError(
            normalized.message,
            "Wykres"
        );

        return null;
    }

    const api = Object.freeze({
        initialize,
        destroy,
        renderChart,
        renderChartTypeOptions,
        getSelectedChartType,
        normalizeChartType,
        validateChartData,
        prepareChartData,
        buildChartConfig,
        buildChartTitle,
        buildChartDescription,
        createSerializableConfig,
        destroyChart,
        syncAvailability,
        hasPivotChartData,
        reset,

        get instance() {
            return chartInstance;
        },

        get initialized() {
            return initialized;
        }
    });

    Object.defineProperty(
        EAT,
        "chartEngine",
        {
            value: api,
            writable: false,
            enumerable: true,
            configurable: false
        }
    );
})(window);
