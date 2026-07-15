/* ==========================================================
   Excel Analytics Trainer
   src/pivot-engine.js
========================================================== */

(function initializePivotEngine(global) {
    "use strict";

    const EAT = global.EAT || (global.EAT = {});

    if (
        !EAT.constants ||
        !EAT.state ||
        !EAT.utils ||
        !EAT.dom
    ) {
        throw new Error(
            "EAT core modules must be loaded before src/pivot-engine.js."
        );
    }

    const {
        STATUS,
        SECTIONS,
        EVENTS,
        DATA_TYPES,
        AGGREGATIONS,
        LEARNING_CONTENT
    } = EAT.constants;

    const {
        isBlank,
        normalizeComparableText,
        parseNumber,
        parseDate,
        formatDate,
        clonePlain,
        formatInteger,
        yieldToBrowser,
        normalizeError
    } = EAT.utils;

    const state = EAT.state;
    const dom = EAT.dom;
    const elements = dom.elements;

    const handlers = [];

    const ZONES = Object.freeze({
        rows: "pivotRowsZone",
        columns: "pivotColumnsZone",
        values: "pivotValuesZone",
        filters: "pivotFiltersZone"
    });

    const ZONE_LIMITS = Object.freeze({
        rows: 3,
        columns: 1,
        values: 1,
        filters: 3
    });

    const ALL_FILTER_VALUES =
        "__EAT_ALL_VALUES__";

    const EMPTY_VALUE =
        "__EAT_EMPTY_VALUE__";

    const SINGLE_COLUMN_KEY =
        "__EAT_SINGLE_COLUMN__";

    let initialized = false;
    let buildToken = 0;
    let draggedField = "";

    function initialize() {
        if (initialized) {
            return api;
        }

        renderAggregationOptions();
        renderAvailableFields();
        renderConfiguration();

        bind(
            elements.pivotFieldsList,
            "dragstart",
            handleFieldDragStart
        );

        bind(
            elements.pivotFieldsList,
            "dragend",
            handleFieldDragEnd
        );

        bind(
            elements.pivotFieldsList,
            "click",
            handleAvailableFieldClick
        );

        bind(
            elements.pivotFieldSearchInput,
            "input",
            handleFieldSearch
        );

        Object.entries(ZONES)
            .forEach(
                ([zoneName, elementId]) => {
                    const zone =
                        elements[elementId];

                    bind(
                        zone,
                        "dragover",
                        (
                            event
                        ) =>
                            handleZoneDragOver(
                                event,
                                zoneName
                            )
                    );

                    bind(
                        zone,
                        "dragleave",
                        handleZoneDragLeave
                    );

                    bind(
                        zone,
                        "drop",
                        (
                            event
                        ) =>
                            handleZoneDrop(
                                event,
                                zoneName
                            )
                    );

                    bind(
                        zone,
                        "click",
                        (
                            event
                        ) =>
                            handleZoneClick(
                                event,
                                zoneName
                            )
                    );

                    bind(
                        zone,
                        "change",
                        (
                            event
                        ) =>
                            handleZoneChange(
                                event,
                                zoneName
                            )
                    );
                }
            );

        bind(
            elements.pivotAggregationSelector,
            "change",
            handleAggregationChange
        );

        bind(
            elements.buildPivotButton,
            "click",
            handleBuildPivot
        );

        bind(
            global,
            EVENTS.DATA_READY,
            handleDataChanged
        );

        bind(
            global,
            EVENTS.CLEANING_APPLIED,
            handleDataChanged
        );

        bind(
            global,
            EVENTS.CLEANING_UNDONE,
            handleDataChanged
        );

        bind(
            global,
            EVENTS.WORKSPACE_RESET,
            reset
        );

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
        buildToken += 1;
        draggedField = "";
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

    function handleDataChanged() {
        renderAvailableFields(
            elements
                .pivotFieldSearchInput
                .value
        );

        renderConfiguration();
        invalidateResult();
    }

    function renderAvailableFields(
        searchText = ""
    ) {
        const headers =
            state.get(
                "import.headers",
                []
            );

        const normalizedSearch =
            normalizeComparableText(
                searchText
            );

        const fields =
            headers
                .filter((header) => {
                    return (
                        !normalizedSearch ||
                        normalizeComparableText(
                            header
                        ).includes(
                            normalizedSearch
                        )
                    );
                })
                .map((header) => ({
                    id: header,
                    name: header,
                    label: header,
                    type:
                        getDetectedFieldType(
                            header
                        )
                }));

        dom.renderPivotFields(
            fields
        );

        return fields;
    }

    function handleFieldSearch(event) {
        renderAvailableFields(
            event.target.value
        );
    }

    function handleAvailableFieldClick(
        event
    ) {
        const button =
            event.target.closest(
                ".field-chip[data-field]"
            );

        if (!button) {
            return;
        }

        const fieldName =
            button.dataset.field;

        const type =
            getDetectedFieldType(
                fieldName
            );

        const configuration =
            getConfiguration();

        let targetZone =
            "rows";

        if (
            (
                type ===
                    DATA_TYPES.NUMBER ||
                type ===
                    DATA_TYPES.MIXED
            ) &&
            !configuration.values.length
        ) {
            targetZone = "values";
        } else if (
            configuration.rows.length >=
                ZONE_LIMITS.rows &&
            configuration.filters.length <
                ZONE_LIMITS.filters
        ) {
            targetZone = "filters";
        }

        addFieldToZone(
            fieldName,
            targetZone
        );
    }

    function handleFieldDragStart(
        event
    ) {
        const button =
            event.target.closest(
                ".field-chip[data-field]"
            );

        if (!button) {
            return;
        }

        draggedField =
            button.dataset.field || "";

        button.classList.add(
            "is-dragging"
        );

        if (event.dataTransfer) {
            event.dataTransfer.setData(
                "text/plain",
                draggedField
            );

            event.dataTransfer.effectAllowed =
                "move";
        }
    }

    function handleFieldDragEnd(
        event
    ) {
        event.target
            .closest(".field-chip")
            ?.classList.remove(
                "is-dragging"
            );

        draggedField = "";
        clearZoneHighlights();
    }

    function handleZoneDragOver(
        event
    ) {
        event.preventDefault();

        event.currentTarget
            .classList.add(
                "is-over"
            );
    }

    function handleZoneDragLeave(
        event
    ) {
        if (
            !event.currentTarget.contains(
                event.relatedTarget
            )
        ) {
            event.currentTarget
                .classList.remove(
                    "is-over"
                );
        }
    }

    function handleZoneDrop(
        event,
        zoneName
    ) {
        event.preventDefault();

        event.currentTarget
            .classList.remove(
                "is-over"
            );

        const fieldName =
            event.dataTransfer
                ?.getData(
                    "text/plain"
                ) ||
            draggedField;

        if (fieldName) {
            addFieldToZone(
                fieldName,
                zoneName
            );
        }

        draggedField = "";
    }

    function clearZoneHighlights() {
        Object.values(ZONES)
            .forEach((elementId) => {
                elements[elementId]
                    ?.classList.remove(
                        "is-over"
                    );
            });
    }

    function getConfiguration() {
        return {
            rows: [
                ...state.get(
                    "pivot.rows",
                    []
                )
            ],

            columns: [
                ...state.get(
                    "pivot.columns",
                    []
                )
            ],

            values: [
                ...state.get(
                    "pivot.values",
                    []
                )
            ],

            filters: [
                ...state.get(
                    "pivot.filters",
                    []
                )
            ],

            aggregation:
                state.get(
                    "pivot.aggregation",
                    "sum"
                ),

            filterValues:
                clonePlain(
                    state.get(
                        "pivot.filterValues",
                        {}
                    )
                )
        };
    }

    function saveConfiguration(
        configuration
    ) {
        state.setPivotConfiguration(
            configuration
        );
    }

    function addFieldToZone(
        fieldName,
        zoneName
    ) {
        const headers =
            state.get(
                "import.headers",
                []
            );

        if (
            !headers.includes(
                fieldName
            )
        ) {
            dom.showWarning(
                "Wybrane pole nie istnieje.",
                "Tabela przestawna"
            );

            return false;
        }

        if (
            !Object.prototype
                .hasOwnProperty.call(
                    ZONES,
                    zoneName
                )
        ) {
            return false;
        }

        const configuration =
            getConfiguration();

        const existingZone =
            findFieldZone(
                configuration,
                fieldName
            );

        if (
            existingZone === zoneName
        ) {
            return false;
        }

        if (
            configuration[
                zoneName
            ].length >=
                ZONE_LIMITS[
                    zoneName
                ]
        ) {
            dom.showWarning(
                `Obszar może zawierać maksymalnie ${ZONE_LIMITS[zoneName]} pola.`,

                "Tabela przestawna"
            );

            return false;
        }

        if (
            zoneName === "values"
        ) {
            const type =
                getDetectedFieldType(
                    fieldName
                );

            if (
                configuration
                    .aggregation !==
                    "count" &&
                type !==
                    DATA_TYPES.NUMBER &&
                type !==
                    DATA_TYPES.MIXED
            ) {
                dom.showWarning(
                    "Pole tekstowe może być użyte jako wartość tylko z agregacją Liczba.",

                    "Pole wartości"
                );

                return false;
            }
        }

        removeFieldFromAllZones(
            configuration,
            fieldName
        );

        configuration[
            zoneName
        ].push(
            fieldName
        );

        if (
            zoneName === "filters"
        ) {
            configuration
                .filterValues[
                fieldName
            ] =
                ALL_FILTER_VALUES;
        }

        saveConfiguration(
            configuration
        );

        invalidateResult();
        renderConfiguration();

        return true;
    }

    function findFieldZone(
        configuration,
        fieldName
    ) {
        return [
            "rows",
            "columns",
            "values",
            "filters"
        ].find(
            (zoneName) =>
                configuration[
                    zoneName
                ].includes(
                    fieldName
                )
        ) || "";
    }

    function removeFieldFromAllZones(
        configuration,
        fieldName
    ) {
        [
            "rows",
            "columns",
            "values",
            "filters"
        ].forEach((zoneName) => {
            configuration[
                zoneName
            ] =
                configuration[
                    zoneName
                ].filter(
                    (field) =>
                        field !==
                        fieldName
                );
        });

        delete configuration
            .filterValues[
                fieldName
            ];
    }

    function removeFieldFromZone(
        fieldName,
        zoneName
    ) {
        const configuration =
            getConfiguration();

        configuration[
            zoneName
        ] =
            configuration[
                zoneName
            ].filter(
                (field) =>
                    field !==
                    fieldName
            );

        if (
            zoneName === "filters"
        ) {
            delete configuration
                .filterValues[
                    fieldName
                ];
        }

        saveConfiguration(
            configuration
        );

        invalidateResult();
        renderConfiguration();

        return true;
    }

    function renderConfiguration() {
        const configuration =
            getConfiguration();

        renderRegularZone(
            "rows",
            configuration.rows,
            "Przeciągnij pole"
        );

        renderRegularZone(
            "columns",
            configuration.columns,
            "Opcjonalnie"
        );

        renderRegularZone(
            "values",
            configuration.values,
            "Przeciągnij pole wartości"
        );

        renderFilterZone(
            configuration.filters,
            configuration.filterValues
        );

        elements
            .pivotAggregationSelector
            .value =
            configuration.aggregation;
    }

    function renderRegularZone(
        zoneName,
        fields,
        placeholder
    ) {
        const zone =
            elements[
                ZONES[zoneName]
            ];

        dom.renderPivotZone(
            zone,
            fields,
            placeholder
        );

        zone.querySelectorAll(
            '[data-action="remove-pivot-field"]'
        ).forEach((button) => {
            button.dataset.zone =
                zoneName;
        });
    }

    function renderFilterZone(
        fields,
        filterValues
    ) {
        const zone =
            elements.pivotFiltersZone;

        dom.clearElement(zone);

        if (!fields.length) {
            zone.appendChild(
                dom.createElement(
                    "span",
                    {
                        text: "Opcjonalnie",
                        className:
                            "drop-target-placeholder"
                    }
                )
            );

            return;
        }

        fields.forEach((fieldName) => {
            const wrapper =
                dom.createElement(
                    "div",
                    {
                        className:
                            "pivot-filter-control"
                    }
                );

            const heading =
                dom.createElement(
                    "div",
                    {
                        className:
                            "pivot-filter-heading"
                    }
                );

            heading.append(
                dom.createElement(
                    "strong",
                    {
                        text:
                            fieldName
                    }
                ),
                dom.createElement(
                    "button",
                    {
                        text: "×",
                        className:
                            "pivot-filter-remove",

                        attributes: {
                            type: "button",
                            "aria-label":
                                `Usuń filtr ${fieldName}`
                        },

                        dataset: {
                            action:
                                "remove-pivot-field",

                            field:
                                fieldName,

                            zone:
                                "filters"
                        }
                    }
                )
            );

            wrapper.append(
                heading,
                createFilterSelect(
                    fieldName,
                    filterValues[
                        fieldName
                    ]
                )
            );

            zone.appendChild(wrapper);
        });
    }

    function createFilterSelect(
        fieldName,
        selectedValue
    ) {
        const select =
            dom.createElement(
                "select",
                {
                    className:
                        "pivot-filter-select",

                    dataset: {
                        filterField:
                            fieldName
                    }
                }
            );

        const values =
            getUniqueFieldValues(
                fieldName
            );

        const options = [
            {
                value:
                    ALL_FILTER_VALUES,

                label:
                    "Wszystkie"
            },

            ...values.map((item) => ({
                value:
                    item.encodedValue,

                label:
                    item.label
            }))
        ];

        dom.renderSelectOptions(
            select,
            options,
            {
                value:
                    options.some(
                        (item) =>
                            item.value ===
                            selectedValue
                    )
                        ? selectedValue
                        : ALL_FILTER_VALUES
            }
        );

        return select;
    }

    function getUniqueFieldValues(
        fieldName
    ) {
        const rows =
            state.get(
                "table.workingRows",
                []
            );

        const map =
            new Map();

        rows.forEach((row) => {
            const value =
                row?.[fieldName];

            const encodedValue =
                encodeValue(value);

            if (
                !map.has(
                    encodedValue
                )
            ) {
                map.set(
                    encodedValue,
                    {
                        encodedValue,
                        rawValue: value,
                        label:
                            formatGroupValue(
                                value
                            )
                    }
                );
            }
        });

        return [
            ...map.values()
        ].sort(
            (left, right) =>
                compareGroupValues(
                    left.rawValue,
                    right.rawValue
                )
        );
    }

    function handleZoneClick(
        event,
        defaultZone
    ) {
        const button =
            event.target.closest(
                '[data-action="remove-pivot-field"]'
            );

        if (!button) {
            return;
        }

        removeFieldFromZone(
            button.dataset.field,
            button.dataset.zone ||
            defaultZone
        );
    }

    function handleZoneChange(
        event,
        zoneName
    ) {
        if (
            zoneName !== "filters"
        ) {
            return;
        }

        const select =
            event.target.closest(
                ".pivot-filter-select"
            );

        if (!select) {
            return;
        }

        const configuration =
            getConfiguration();

        configuration
            .filterValues[
            select.dataset
                .filterField
        ] =
            select.value;

        saveConfiguration(
            configuration
        );

        invalidateResult();
    }

    function renderAggregationOptions() {
        const current =
            state.get(
                "pivot.aggregation",
                "sum"
            );

        dom.renderSelectOptions(
            elements
                .pivotAggregationSelector,

            AGGREGATIONS.map(
                (aggregation) => ({
                    value:
                        aggregation.id,

                    label:
                        aggregation.label
                })
            ),

            {
                value:
                    AGGREGATIONS.some(
                        (item) =>
                            item.id ===
                            current
                    )
                        ? current
                        : "sum"
            }
        );
    }

    function handleAggregationChange(
        event
    ) {
        const configuration =
            getConfiguration();

        configuration.aggregation =
            event.target.value;

        const valueField =
            configuration.values[0];

        if (
            valueField &&
            configuration.aggregation !==
                "count"
        ) {
            const type =
                getDetectedFieldType(
                    valueField
                );

            if (
                type !==
                    DATA_TYPES.NUMBER &&
                type !==
                    DATA_TYPES.MIXED
            ) {
                configuration.aggregation =
                    "count";

                event.target.value =
                    "count";

                dom.showWarning(
                    "Dla pola tekstowego ustawiono agregację Liczba.",

                    "Agregacja"
                );
            }
        }

        saveConfiguration(
            configuration
        );

        invalidateResult();
    }

    async function handleBuildPivot() {
        await buildPivot();
    }

    async function buildPivot(
        customConfiguration = null
    ) {
        const token =
            ++buildToken;

        const configuration =
            customConfiguration
                ? normalizeConfiguration(
                    customConfiguration
                )
                : getConfiguration();

        const validation =
            validateConfiguration(
                configuration
            );

        if (!validation.valid) {
            dom.showWarning(
                validation.errors.join(" "),
                "Tabela przestawna"
            );

            return null;
        }

        try {
            state.clearError();

            state.setBusy({
                title:
                    "Budowanie tabeli przestawnej",

                message:
                    "Filtrowanie danych...",

                progress: 15
            });

            await yieldToBrowser();

            const sourceRows =
                state.get(
                    "table.workingRows",
                    []
                );

            const filteredRows =
                applyPivotFilters(
                    sourceRows,
                    configuration
                );

            if (
                token !== buildToken
            ) {
                return null;
            }

            state.updateBusy({
                message:
                    "Grupowanie i agregowanie...",

                progress: 50
            });

            const result =
                createPivotResult(
                    filteredRows,
                    configuration
                );

            const statistics =
                calculatePivotStatistics(
                    filteredRows,
                    configuration
                );

            if (
                token !== buildToken
            ) {
                return null;
            }

            const stateResult = {
                configuration:
                    clonePlain(
                        configuration
                    ),

                columns:
                    result.columns,

                rows:
                    result.rows,

                footer:
                    result.footer,

                chart:
                    result.chart,

                groupCount:
                    result.groupCount
            };

            saveConfiguration(
                configuration
            );

            state.setPivotResult(
                stateResult,
                statistics
            );

            state.completeSection(
                SECTIONS.PIVOT
            );

            dom.renderPivotTable(
                stateResult
            );

            dom.renderPivotStatistics(
                statistics
            );

            const learning =
                LEARNING_CONTENT.pivot;

            state.setLearningContext(
                "pivot",
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

            dom.showSuccess(
                `Utworzono ${formatInteger(
                    result.groupCount
                )} grup na podstawie ${formatInteger(
                    filteredRows.length
                )} wierszy.`,

                "Tabela przestawna"
            );

            return {
                ...stateResult,
                statistics
            };
        } catch (error) {
            return handlePivotError(
                error
            );
        }
    }

    function normalizeConfiguration(
        configuration = {}
    ) {
        return {
            rows:
                Array.isArray(
                    configuration.rows
                )
                    ? [
                        ...configuration.rows
                    ]
                    : [],

            columns:
                Array.isArray(
                    configuration.columns
                )
                    ? [
                        ...configuration.columns
                    ]
                    : [],

            values:
                Array.isArray(
                    configuration.values
                )
                    ? [
                        ...configuration.values
                    ]
                    : [],

            filters:
                Array.isArray(
                    configuration.filters
                )
                    ? [
                        ...configuration.filters
                    ]
                    : [],

            aggregation:
                configuration.aggregation ||
                "sum",

            filterValues:
                clonePlain(
                    configuration.filterValues ||
                    {}
                )
        };
    }

    function validateConfiguration(
        configuration
    ) {
        const errors = [];

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

        if (!rows.length) {
            errors.push(
                "Brak danych źródłowych."
            );
        }

        if (
            !configuration.rows.length
        ) {
            errors.push(
                "Dodaj pole do obszaru Wiersze."
            );
        }

        if (
            !configuration.values.length
        ) {
            errors.push(
                "Dodaj pole do obszaru Wartości."
            );
        }

        const configuredFields = [
            ...configuration.rows,
            ...configuration.columns,
            ...configuration.values,
            ...configuration.filters
        ];

        configuredFields
            .forEach((fieldName) => {
                if (
                    !headers.includes(
                        fieldName
                    )
                ) {
                    errors.push(
                        `Pole „${fieldName}” nie istnieje.`
                    );
                }
            });

        if (
            new Set(
                configuredFields
            ).size !==
            configuredFields.length
        ) {
            errors.push(
                "Jedno pole nie może znajdować się w kilku obszarach."
            );
        }

        const valueField =
            configuration.values[0];

        if (
            valueField &&
            configuration.aggregation !==
                "count"
        ) {
            const type =
                getDetectedFieldType(
                    valueField
                );

            if (
                type !==
                    DATA_TYPES.NUMBER &&
                type !==
                    DATA_TYPES.MIXED
            ) {
                errors.push(
                    "Dla pola tekstowego wybierz agregację Liczba."
                );
            }
        }

        return {
            valid:
                errors.length === 0,

            errors
        };
    }

    function applyPivotFilters(
        rows,
        configuration
    ) {
        if (
            !configuration.filters.length
        ) {
            return [
                ...rows
            ];
        }

        return rows.filter((row) => {
            return configuration.filters
                .every((fieldName) => {
                    const expected =
                        configuration
                            .filterValues[
                            fieldName
                        ];

                    return (
                        !expected ||
                        expected ===
                            ALL_FILTER_VALUES ||
                        encodeValue(
                            row?.[fieldName]
                        ) ===
                            expected
                    );
                });
        });
    }

    function createPivotResult(
        rows,
        configuration
    ) {
        const rowFields =
            configuration.rows;

        const columnField =
            configuration.columns[0] ||
            "";

        const valueField =
            configuration.values[0];

        const aggregation =
            configuration.aggregation;

        const rowGroups =
            new Map();

        const columnValues =
            new Map();

        const columnBuckets =
            new Map();

        rows.forEach((row) => {
            const rowParts =
                rowFields.map(
                    (fieldName) =>
                        row?.[fieldName]
                );

            const rowKey =
                createGroupKey(
                    rowParts
                );

            if (
                !rowGroups.has(
                    rowKey
                )
            ) {
                rowGroups.set(
                    rowKey,
                    {
                        rowParts,
                        cells:
                            new Map()
                    }
                );
            }

            const rawColumnValue =
                columnField
                    ? row?.[columnField]
                    : valueField;

            const columnKey =
                columnField
                    ? encodeValue(
                        rawColumnValue
                    )
                    : SINGLE_COLUMN_KEY;

            if (
                !columnValues.has(
                    columnKey
                )
            ) {
                columnValues.set(
                    columnKey,
                    rawColumnValue
                );
            }

            if (
                !columnBuckets.has(
                    columnKey
                )
            ) {
                columnBuckets.set(
                    columnKey,
                    []
                );
            }

            const rawValue =
                row?.[valueField];

            columnBuckets
                .get(columnKey)
                .push(rawValue);

            const group =
                rowGroups.get(rowKey);

            if (
                !group.cells.has(
                    columnKey
                )
            ) {
                group.cells.set(
                    columnKey,
                    []
                );
            }

            group.cells
                .get(columnKey)
                .push(rawValue);
        });

        if (
            !columnField &&
            !columnValues.has(
                SINGLE_COLUMN_KEY
            )
        ) {
            columnValues.set(
                SINGLE_COLUMN_KEY,
                valueField
            );

            columnBuckets.set(
                SINGLE_COLUMN_KEY,
                []
            );
        }

        const orderedColumns =
            [
                ...columnValues.entries()
            ].sort(
                (left, right) =>
                    columnField
                        ? compareGroupValues(
                            left[1],
                            right[1]
                        )
                        : 0
            );

        const columns = [
            ...rowFields.map(
                (fieldName, index) => ({
                    key:
                        `row_${index}`,

                    sourceField:
                        fieldName,

                    label:
                        fieldName,

                    type:
                        getDetectedFieldType(
                            fieldName
                        )
                })
            ),

            ...orderedColumns.map(
                (
                    [
                        columnKey,
                        columnValue
                    ],
                    index
                ) => ({
                    key:
                        `value_${index}`,

                    sourceKey:
                        columnKey,

                    label:
                        columnField
                            ? formatGroupValue(
                                columnValue
                            )
                            : buildValueColumnLabel(
                                aggregation,
                                valueField
                            ),

                    type:
                        DATA_TYPES.NUMBER
                })
            )
        ];

        const resultRows = [];

        [
            ...rowGroups.values()
        ]
            .sort(
                (left, right) =>
                    compareRowParts(
                        left.rowParts,
                        right.rowParts
                    )
            )
            .forEach((group) => {
                const output = {};

                rowFields.forEach(
                    (
                        fieldName,
                        index
                    ) => {
                        output[
                            `row_${index}`
                        ] =
                            group.rowParts[
                                index
                            ];
                    }
                );

                orderedColumns
                    .forEach(
                        (
                            [columnKey],
                            index
                        ) => {
                            output[
                                `value_${index}`
                            ] =
                                aggregateValues(
                                    group.cells.get(
                                        columnKey
                                    ) || [],
                                    aggregation
                                );
                        }
                    );

                resultRows.push(output);
            });

        const footer =
            createPivotFooter({
                columns,
                rowFieldCount:
                    rowFields.length,

                orderedColumns,
                columnBuckets,
                aggregation
            });

        return {
            columns,
            rows:
                resultRows,
            footer,
            chart:
                createChartData(
                    columns,
                    resultRows,
                    rowFields.length
                ),
            groupCount:
                rowGroups.size
        };
    }

    function aggregateValues(
        values,
        aggregation
    ) {
        if (
            aggregation === "count"
        ) {
            return values.reduce(
                (
                    total,
                    value
                ) =>
                    total +
                    (
                        isBlank(value)
                            ? 0
                            : 1
                    ),
                0
            );
        }

        const numbers =
            values
                .map(parseNumber)
                .filter(
                    (value) =>
                        value !== null &&
                        Number.isFinite(
                            value
                        )
                );

        if (!numbers.length) {
            return null;
        }

        switch (aggregation) {
            case "sum":
                return sumValues(numbers);

            case "average":
                return (
                    sumValues(numbers) /
                    numbers.length
                );

            case "min":
                return findMinimum(
                    numbers
                );

            case "max":
                return findMaximum(
                    numbers
                );

            default:
                throw new Error(
                    "Nieobsługiwana agregacja."
                );
        }
    }

    function createPivotFooter({
        columns,
        rowFieldCount,
        orderedColumns,
        columnBuckets,
        aggregation
    }) {
        const footer = {};

        columns
            .slice(
                0,
                rowFieldCount
            )
            .forEach(
                (column, index) => {
                    footer[column.key] =
                        index === 0
                            ? "Razem"
                            : "";
                }
            );

        orderedColumns
            .forEach(
                (
                    [columnKey],
                    index
                ) => {
                    footer[
                        columns[
                            rowFieldCount +
                            index
                        ].key
                    ] =
                        aggregateValues(
                            columnBuckets.get(
                                columnKey
                            ) || [],
                            aggregation
                        );
                }
            );

        return footer;
    }

    function createChartData(
        columns,
        rows,
        rowFieldCount
    ) {
        const rowColumns =
            columns.slice(
                0,
                rowFieldCount
            );

        const valueColumns =
            columns.slice(
                rowFieldCount
            );

        return {
            labels:
                rows.map((row) => {
                    return (
                        rowColumns
                            .map(
                                (column) =>
                                    formatGroupValue(
                                        row[
                                            column.key
                                        ]
                                    )
                            )
                            .join(" / ") ||
                        "(puste)"
                    );
                }),

            datasets:
                valueColumns.map(
                    (column) => ({
                        label:
                            column.label,

                        data:
                            rows.map((row) => {
                                const value =
                                    parseNumber(
                                        row[
                                            column.key
                                        ]
                                    );

                                return value ===
                                    null
                                    ? 0
                                    : value;
                            })
                    })
                )
        };
    }

    function calculatePivotStatistics(
        rows,
        configuration
    ) {
        const valueField =
            configuration.values[0];

        const numbers =
            configuration.aggregation ===
                "count"
                ? rows
                    .filter(
                        (row) =>
                            !isBlank(
                                row?.[valueField]
                            )
                    )
                    .map(() => 1)
                : rows
                    .map(
                        (row) =>
                            parseNumber(
                                row?.[valueField]
                            )
                    )
                    .filter(
                        (value) =>
                            value !== null &&
                            Number.isFinite(
                                value
                            )
                    );

        const total =
            sumValues(numbers);

        const groups =
            new Set(
                rows.map((row) =>
                    createGroupKey(
                        configuration.rows
                            .map(
                                (fieldName) =>
                                    row?.[fieldName]
                            )
                    )
                )
            );

        return {
            sourceRows:
                rows.length,

            groupCount:
                groups.size,

            total,

            average:
                numbers.length
                    ? total /
                        numbers.length
                    : 0,

            minimum:
                numbers.length
                    ? findMinimum(numbers)
                    : null,

            maximum:
                numbers.length
                    ? findMaximum(numbers)
                    : null
        };
    }

    function getDetectedFieldType(
        fieldName
    ) {
        const types =
            state.get(
                "import.detectedTypes",
                {}
            );

        return (
            types[fieldName] ||
            DATA_TYPES.TEXT
        );
    }

    function encodeValue(value) {
        if (isBlank(value)) {
            return EMPTY_VALUE;
        }

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
            String(value)
        );
    }

    function createGroupKey(values) {
        return values
            .map(encodeValue)
            .join("\u241F");
    }

    function compareRowParts(
        left,
        right
    ) {
        const length =
            Math.max(
                left.length,
                right.length
            );

        for (
            let index = 0;
            index < length;
            index += 1
        ) {
            const comparison =
                compareGroupValues(
                    left[index],
                    right[index]
                );

            if (comparison !== 0) {
                return comparison;
            }
        }

        return 0;
    }

    function compareGroupValues(
        left,
        right
    ) {
        if (
            isBlank(left) &&
            isBlank(right)
        ) {
            return 0;
        }

        if (isBlank(left)) {
            return 1;
        }

        if (isBlank(right)) {
            return -1;
        }

        const leftNumber =
            parseNumber(left);

        const rightNumber =
            parseNumber(right);

        if (
            leftNumber !== null &&
            rightNumber !== null
        ) {
            return (
                leftNumber -
                rightNumber
            );
        }

        const leftDate =
            parseDate(left);

        const rightDate =
            parseDate(right);

        if (
            leftDate &&
            rightDate
        ) {
            return (
                leftDate.getTime() -
                rightDate.getTime()
            );
        }

        return String(left)
            .localeCompare(
                String(right),
                "pl-PL",
                {
                    numeric: true,
                    sensitivity: "base"
                }
            );
    }

    function formatGroupValue(value) {
        if (isBlank(value)) {
            return "(puste)";
        }

        if (
            value instanceof Date &&
            !Number.isNaN(
                value.getTime()
            )
        ) {
            return formatDate(value);
        }

        if (
            typeof value ===
            "boolean"
        ) {
            return value
                ? "TAK"
                : "NIE";
        }

        return String(value);
    }

    function buildValueColumnLabel(
        aggregation,
        valueField
    ) {
        const labels = {
            sum: "Suma",
            average: "Średnia",
            count: "Liczba",
            min: "Minimum",
            max: "Maksimum"
        };

        return (
            `${labels[aggregation] || aggregation} ` +
            `${valueField}`
        );
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

    function invalidateResult() {
        buildToken += 1;

        state.set(
            "pivot.result",
            null,
            {
                notify: false
            }
        );

        state.set(
            "pivot.statistics",
            {
                sourceRows: 0,
                groupCount: 0,
                total: 0,
                average: 0,
                minimum: null,
                maximum: null
            },
            {
                notify: false
            }
        );

        state.set(
            "pivot.completedAt",
            null,
            {
                notify: false
            }
        );

        state.set(
            "chart",
            {
                type:
                    state.get(
                        "chart.type",
                        "bar"
                    ),
                title: "",
                description: "",
                rendered: false,
                config: null,
                renderedAt: null
            },
            {
                notify: false
            }
        );

        EAT.chartEngine
            ?.destroyChart?.();

        dom.renderPivotTable({});
        dom.renderPivotStatistics({});

        dom.setText(
            elements.chartDescription,
            "Brak wykresu."
        );

        EAT.chartEngine
            ?.syncAvailability?.();

        EAT.exportEngine
            ?.syncAvailability?.();
    }

    function reset() {
        buildToken += 1;
        draggedField = "";

        state.setPivotConfiguration({
            rows: [],
            columns: [],
            values: [],
            filters: [],
            aggregation: "sum",
            filterValues: {}
        });

        elements
            .pivotFieldSearchInput
            .value = "";

        elements
            .pivotAggregationSelector
            .value = "sum";

        renderAvailableFields();
        renderConfiguration();
        invalidateResult();
    }

    function handlePivotError(error) {
        const normalized =
            normalizeError(
                error,
                "Tabela przestawna"
            );

        state.setError(
            error,
            "Tabela przestawna"
        );

        state.clearBusy(
            STATUS.ERROR
        );

        dom.showError(
            normalized.message,
            "Tabela przestawna"
        );

        return null;
    }

    const api = Object.freeze({
        initialize,
        destroy,

        renderAvailableFields,
        renderConfiguration,
        renderAggregationOptions,

        getConfiguration,
        saveConfiguration,

        addFieldToZone,
        removeFieldFromZone,

        buildPivot,
        validateConfiguration,

        applyPivotFilters,
        createPivotResult,
        aggregateValues,
        calculatePivotStatistics,

        createChartData,
        createPivotFooter,

        getDetectedFieldType,
        encodeValue,

        findMinimum,
        findMaximum,

        invalidateResult,
        reset,

        get initialized() {
            return initialized;
        }
    });

    Object.defineProperty(
        EAT,
        "pivotEngine",
        {
            value: api,
            writable: false,
            enumerable: true,
            configurable: false
        }
    );
})(window);
