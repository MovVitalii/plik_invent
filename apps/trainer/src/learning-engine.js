/* ==========================================================
   Excel Analytics Trainer
   src/learning-engine.js
========================================================== */

(function initializeLearningEngine(global) {
    "use strict";

    const EAT = global.EAT || (global.EAT = {});

    if (
        !EAT.constants ||
        !EAT.state ||
        !EAT.utils ||
        !EAT.dom
    ) {
        throw new Error(
            "EAT core modules must be loaded before src/learning-engine.js."
        );
    }

    const {
        SECTIONS,
        EVENTS,
        LEARNING_CONTENT
    } = EAT.constants;

    const {
        cleanText,
        formatNumber,
        formatInteger,
        formatDateTime
    } = EAT.utils;

    const state = EAT.state;
    const dom = EAT.dom;
    const elements = dom.elements;

    const SECTION_TOPIC_MAP = Object.freeze({
        [SECTIONS.IMPORT]: "import",
        [SECTIONS.PREVIEW]: "preview",
        [SECTIONS.QUALITY]: "quality",
        [SECTIONS.CLEANING]: "cleaning",
        [SECTIONS.CALCULATION]: "calculation",
        [SECTIONS.PIVOT]: "pivot",
        [SECTIONS.REPORT]: "report"
    });

    const handlers = [];

    let initialized = false;
    let unsubscribeState = null;
    let lastActiveSection = "";

    function initialize() {
        if (initialized) {
            return api;
        }

        bind(
            elements.learningPanelToggle,
            "click",
            togglePanel
        );

        unsubscribeState =
            state.subscribe(
                handleStateNotification
            );

        lastActiveSection =
            state.get(
                "workflow.activeSection",
                SECTIONS.IMPORT
            );

        activateTopicForSection(
            lastActiveSection
        );

        renderPanelState();

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

        unsubscribeState?.();
        unsubscribeState = null;
        lastActiveSection = "";
        initialized = false;
    }

    function bind(
        element,
        eventName,
        handler
    ) {
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

    function togglePanel() {
        const expanded =
            state.get(
                "learning.panelExpanded",
                true
            );

        state.setLearningPanelExpanded(
            !expanded
        );

        renderPanelState();
    }

    function renderPanelState() {
        const learning =
            state.get(
                "learning",
                {}
            );

        dom.renderLearningContext(
            learning
        );

        elements.learningPanel
            .classList.toggle(
                "is-collapsed",
                learning.panelExpanded ===
                    false
            );
    }

    function getTopicForSection(
        sectionId
    ) {
        return (
            SECTION_TOPIC_MAP[
                sectionId
            ] || "import"
        );
    }

    function activateTopicForSection(
        sectionId
    ) {
        return activateTopic(
            getTopicForSection(
                sectionId
            )
        );
    }

    function activateTopic(
        topic,
        overrides = {}
    ) {
        const topicId =
            cleanText(topic) ||
            "import";

        const base =
            LEARNING_CONTENT[
                topicId
            ] ||
            LEARNING_CONTENT.import;

        const dynamic =
            buildDynamicContent(
                topicId
            );

        const content = {
            context:
                overrides.context ??
                dynamic.context ??
                base.explanation,

            excelEquivalent:
                overrides.excelEquivalent ??
                dynamic.excelEquivalent ??
                base.excelEquivalent,

            verificationTip:
                overrides.verificationTip ??
                dynamic.verificationTip ??
                base.verificationTip
        };

        state.setLearningContext(
            topicId,
            content
        );

        dom.renderLearningContext(
            state.get(
                "learning",
                {}
            )
        );

        return {
            topic:
                topicId,
            ...content
        };
    }

    function buildDynamicContent(
        topic
    ) {
        switch (topic) {
            case "import":
                return buildImportContent();

            case "preview":
                return buildPreviewContent();

            case "quality":
                return buildQualityContent();

            case "cleaning":
                return buildCleaningContent();

            case "calculation":
                return buildCalculationContent();

            case "pivot":
                return buildPivotContent();

            case "report":
                return buildReportContent();

            default:
                return {};
        }
    }

    function buildImportContent() {
        const fileMeta =
            state.get(
                "import.fileMeta",
                {}
            );

        const sheetNames =
            state.get(
                "import.sheetNames",
                []
            );

        if (!fileMeta.name) {
            return {};
        }

        return {
            context:
                `Wczytano plik „${fileMeta.name}”. ` +
                `Arkusze: ${formatInteger(
                    sheetNames.length
                )}. Wybierz arkusz i rozpocznij analizę.`
        };
    }

    function buildPreviewContent() {
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

        if (!headers.length) {
            return {};
        }

        return {
            context:
                `Tabela zawiera ${formatInteger(
                    rows.length
                )} wierszy i ${formatInteger(
                    headers.length
                )} kolumn.`
        };
    }

    function buildQualityContent() {
        const quality =
            state.get(
                "quality",
                {}
            );

        if (!quality.completed) {
            return {};
        }

        return {
            context:
                `Puste komórki: ${formatInteger(
                    quality.emptyCellCount
                )}, duplikaty: ${formatInteger(
                    quality.duplicateRowCount
                )}, błędy typów: ${formatInteger(
                    quality.typeErrorCount
                )}.`
        };
    }

    function buildCleaningContent() {
        const history =
            state.get(
                "cleaning.history",
                []
            );

        const last =
            history.at(-1);

        if (!last) {
            return {};
        }

        return {
            context:
                `Ostatnia operacja: „${last.label}”. ` +
                `Zmienione wiersze: ${formatInteger(
                    last.changedRows
                )}.`
        };
    }

    function buildCalculationContent() {
        const calculation =
            state.get(
                "calculation",
                {}
            );

        if (
            calculation.result ===
                null ||
            calculation.result ===
                undefined
        ) {
            return {};
        }

        return {
            context:
                `Wynik ${String(
                    calculation.functionId
                ).toLocaleUpperCase(
                    "pl-PL"
                )}: ${
                    typeof calculation.result ===
                        "number"
                        ? formatNumber(
                            calculation.result
                        )
                        : calculation.result
                }.`,

            excelEquivalent:
                calculation.formula ||
                String(
                    calculation.functionId
                ).toLocaleUpperCase(
                    "pl-PL"
                )
        };
    }

    function buildPivotContent() {
        const pivot =
            state.get(
                "pivot",
                {}
            );

        if (!pivot.result) {
            return {};
        }

        return {
            context:
                `Tabela Pivot zawiera ${formatInteger(
                    pivot.statistics
                        ?.groupCount || 0
                )} grup i wykorzystuje ${formatInteger(
                    pivot.statistics
                        ?.sourceRows || 0
                )} wierszy źródłowych.`
        };
    }

    function buildReportContent() {
        const exported =
            state.get(
                "export",
                {}
            );

        if (exported.exportedAt) {
            return {
                context:
                    `Ostatni eksport: „${exported.lastFileName}”, ` +
                    `${formatDateTime(
                        exported.exportedAt
                    )}.`
            };
        }

        const chart =
            state.get(
                "chart",
                {}
            );

        if (chart.rendered) {
            return {
                context:
                    chart.description
            };
        }

        return {};
    }

    function handleStateNotification(
        payload
    ) {
        if (
            payload?.eventName ===
            EVENTS.WORKSPACE_RESET
        ) {
            lastActiveSection =
                SECTIONS.IMPORT;

            activateTopic(
                "import"
            );

            renderPanelState();

            return;
        }

        const activeSection =
            state.get(
                "workflow.activeSection",
                SECTIONS.IMPORT
            );

        if (
            activeSection !==
            lastActiveSection
        ) {
            lastActiveSection =
                activeSection;

            activateTopicForSection(
                activeSection
            );

            return;
        }

        renderPanelState();
    }

    function reset() {
        lastActiveSection =
            SECTIONS.IMPORT;

        activateTopic(
            "import"
        );

        renderPanelState();
    }

    const api = Object.freeze({
        initialize,
        destroy,
        togglePanel,
        renderPanelState,
        getTopicForSection,
        activateTopicForSection,
        activateTopic,
        buildDynamicContent,
        reset,

        get initialized() {
            return initialized;
        }
    });

    Object.defineProperty(
        EAT,
        "learningEngine",
        {
            value: api,
            writable: false,
            enumerable: true,
            configurable: false
        }
    );
})(window);
