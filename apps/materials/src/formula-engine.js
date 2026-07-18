/* ==========================================================
   Materials Analytics
   src/formula-engine.js
   Safe calculated-column expression parser. No eval/Function.
========================================================== */
(function initializeFormulaEngine(global) {
    "use strict";

    const PMA = global.PMA || (global.PMA = {});
    if (!PMA.utils) throw new Error("PMA.utils must be loaded before formula-engine.js.");

    const { parseNumber, parseDate, cleanText, normalizeComparableText, round: roundNumber } = PMA.utils;

    class FormulaError extends Error {
        constructor(message, position = null) {
            super(position === null ? message : `${message} (pozycja ${position + 1})`);
            this.name = "FormulaError";
            this.position = position;
        }
    }

    function tokenize(source) {
        const text = String(source || "").trim().replace(/^=/, "");
        const tokens = [];
        let index = 0;
        while (index < text.length) {
            const char = text[index];
            if (/\s/.test(char)) { index += 1; continue; }
            if (char === "[") {
                const end = text.indexOf("]", index + 1);
                if (end < 0) throw new FormulaError("Brak zamykającego nawiasu ]", index);
                tokens.push({ type: "field", value: text.slice(index + 1, end).trim(), position: index });
                index = end + 1;
                continue;
            }
            if (char === '"' || char === "'") {
                const quote = char;
                const start = index;
                index += 1;
                let value = "";
                while (index < text.length) {
                    if (text[index] === "\\" && index + 1 < text.length) {
                        value += text[index + 1]; index += 2; continue;
                    }
                    if (text[index] === quote) break;
                    value += text[index++];
                }
                if (text[index] !== quote) throw new FormulaError("Brak zamykającego cudzysłowu", start);
                index += 1;
                tokens.push({ type: "literal", value, position: start });
                continue;
            }
            const numberMatch = text.slice(index).match(/^(?:\d+(?:[.,]\d+)?|[.,]\d+)/);
            if (numberMatch) {
                tokens.push({ type: "literal", value: Number(numberMatch[0].replace(",", ".")), position: index });
                index += numberMatch[0].length;
                continue;
            }
            const identifierMatch = text.slice(index).match(/^[A-Za-z_ĄĆĘŁŃÓŚŹŻąćęłńóśźż][A-Za-z0-9_ĄĆĘŁŃÓŚŹŻąćęłńóśźż]*/);
            if (identifierMatch) {
                const raw = identifierMatch[0];
                const upper = raw.toUpperCase();
                if (upper === "TRUE" || upper === "PRAWDA") tokens.push({ type: "literal", value: true, position: index });
                else if (upper === "FALSE" || upper === "FAŁSZ" || upper === "FALSZ") tokens.push({ type: "literal", value: false, position: index });
                else if (upper === "NULL" || upper === "PUSTE") tokens.push({ type: "literal", value: null, position: index });
                else if (["AND", "OR", "NOT"].includes(upper)) tokens.push({ type: "operator", value: upper, position: index });
                else tokens.push({ type: "identifier", value: upper, position: index });
                index += raw.length;
                continue;
            }
            const pair = text.slice(index, index + 2);
            if ([">=", "<=", "!=", "<>", "=="].includes(pair)) {
                tokens.push({ type: "operator", value: pair === "<>" ? "!=" : pair, position: index });
                index += 2; continue;
            }
            if ("+-*/^><=(),;".includes(char)) {
                const punctuation = char === ";" ? "," : char;
                const type = punctuation === "(" || punctuation === ")" || punctuation === "," ? "punctuation" : "operator";
                tokens.push({ type, value: punctuation, position: index });
                index += 1; continue;
            }
            throw new FormulaError(`Nieobsługiwany znak „${char}”`, index);
        }
        tokens.push({ type: "eof", value: "", position: text.length });
        return tokens;
    }

    function parse(source, fields = []) {
        const tokens = tokenize(source);
        let cursor = 0;
        const fieldByLabel = new Map();
        const ambiguousLabels = new Set();
        const registerFieldAlias = (alias, field) => {
            const key = normalizeComparableText(alias);
            if (!key) return;
            const existing = fieldByLabel.get(key);
            if (existing && existing.id !== field.id) {
                const existingIsRawSource = existing.source === "source";
                const incomingIsRawSource = field.source === "source";
                if (existingIsRawSource && !incomingIsRawSource) {
                    fieldByLabel.set(key, field);
                    ambiguousLabels.delete(key);
                    return;
                }
                if (!existingIsRawSource && incomingIsRawSource) return;
                ambiguousLabels.add(key);
                return;
            }
            fieldByLabel.set(key, field);
        };
        fields.forEach((field) => {
            registerFieldAlias(field.label, field);
            registerFieldAlias(field.id, field);
            if (field.sourceColumn) registerFieldAlias(field.sourceColumn, field);
        });
        const peek = () => tokens[cursor];
        const take = () => tokens[cursor++];
        const match = (value) => peek().value === value;
        const expect = (value) => {
            if (!match(value)) throw new FormulaError(`Oczekiwano „${value}”`, peek().position);
            return take();
        };

        function parseExpression() { return parseOr(); }
        function parseOr() {
            let node = parseAnd();
            while (match("OR")) { const op = take(); node = { type: "binary", op: op.value, left: node, right: parseAnd() }; }
            return node;
        }
        function parseAnd() {
            let node = parseComparison();
            while (match("AND")) { const op = take(); node = { type: "binary", op: op.value, left: node, right: parseComparison() }; }
            return node;
        }
        function parseComparison() {
            let node = parseAdditive();
            while ([">", ">=", "<", "<=", "=", "==", "!="].includes(peek().value)) {
                const op = take(); node = { type: "binary", op: op.value, left: node, right: parseAdditive() };
            }
            return node;
        }
        function parseAdditive() {
            let node = parseMultiplicative();
            while (["+", "-"].includes(peek().value)) {
                const op = take(); node = { type: "binary", op: op.value, left: node, right: parseMultiplicative() };
            }
            return node;
        }
        function parseMultiplicative() {
            let node = parseUnary();
            while (["*", "/"].includes(peek().value)) {
                const op = take(); node = { type: "binary", op: op.value, left: node, right: parseUnary() };
            }
            return node;
        }
        function parseUnary() {
            if (["+", "-", "NOT"].includes(peek().value)) {
                const op = take(); return { type: "unary", op: op.value, value: parseUnary() };
            }
            return parsePower();
        }
        function parsePower() {
            const node = parsePrimary();
            if (!match("^")) return node;
            take();
            return { type: "binary", op: "^", left: node, right: parseUnary() };
        }
        function parsePrimary() {
            const token = peek();
            if (token.type === "literal") { take(); return { type: "literal", value: token.value }; }
            if (token.type === "field") {
                take();
                const key = normalizeComparableText(token.value);
                if (ambiguousLabels.has(key)) throw new FormulaError(`Nazwa kolumny „${token.value}” jest niejednoznaczna. Użyj unikalnej nazwy albo identyfikatora kolumny.`, token.position);
                const field = fieldByLabel.get(key);
                if (!field) throw new FormulaError(`Nie znaleziono kolumny „${token.value}”`, token.position);
                return { type: "field", fieldId: field.id, label: field.label };
            }
            if (token.type === "identifier") {
                const name = take().value;
                expect("(");
                const args = [];
                if (!match(")")) {
                    do {
                        args.push(parseExpression());
                        if (!match(",")) break;
                        take();
                    } while (!match(")"));
                }
                expect(")");
                return { type: "call", name, args };
            }
            if (match("(")) {
                take(); const node = parseExpression(); expect(")"); return node;
            }
            throw new FormulaError("Nieprawidłowy fragment formuły", token.position);
        }

        const ast = parseExpression();
        if (peek().type !== "eof") throw new FormulaError("Nieoczekiwany fragment formuły", peek().position);
        return ast;
    }

    function numeric(value) {
        const parsed = parseNumber(value);
        return parsed === null ? 0 : parsed;
    }
    function comparable(value) {
        const number = parseNumber(value);
        if (number !== null) return number;
        const date = parseDate(value, { allowExcelSerial: true, allowNumericStringExcelSerial: true });
        if (date) return date.getTime();
        return normalizeComparableText(value);
    }
    function truthy(value) {
        if (value === null || value === undefined || value === "" || value === 0 || value === false) return false;
        if (typeof value === "string") {
            const normalized = normalizeComparableText(value);
            if (["0", "false", "fałsz", "falsz", "nie", "no"].includes(normalized)) return false;
        }
        return true;
    }

    const FUNCTIONS = Object.freeze({
        IF: (condition, whenTrue, whenFalse = null) => truthy(condition) ? whenTrue : whenFalse,
        ROUND: (value, digits = 0) => roundNumber(numeric(value), numeric(digits)),
        ABS: (value) => Math.abs(numeric(value)),
        COALESCE: (...values) => values.find((value) => value !== null && value !== undefined && value !== "") ?? null,
        CONCAT: (...values) => values.filter((value) => value !== null && value !== undefined).join(""),
        UPPER: (value) => cleanText(value).toLocaleUpperCase("pl-PL"),
        LOWER: (value) => cleanText(value).toLocaleLowerCase("pl-PL"),
        LEN: (value) => String(value ?? "").length,
        MIN: (...values) => {
            const numbers = values.map(parseNumber).filter((value) => value !== null);
            return numbers.length ? numbers.reduce((minimum, value) => Math.min(minimum, value), Infinity) : null;
        },
        MAX: (...values) => {
            const numbers = values.map(parseNumber).filter((value) => value !== null);
            return numbers.length ? numbers.reduce((maximum, value) => Math.max(maximum, value), -Infinity) : null;
        },
        IFERROR: (value, fallback = null) => value === null || value === undefined || Number.isNaN(value) ? fallback : value,
        ISBLANK: (value) => value === null || value === undefined || value === "",
        DATE_DIFF_DAYS: (left, right) => {
            const a = parseDate(left, { allowExcelSerial: true, allowNumericStringExcelSerial: true });
            const b = parseDate(right, { allowExcelSerial: true, allowNumericStringExcelSerial: true });
            if (!a || !b) return null;
            return Math.round((a.getTime() - b.getTime()) / 86400000);
        }
    });

    function evaluate(ast, row) {
        if (!ast) return null;
        if (ast.type === "literal") return ast.value;
        if (ast.type === "field") return row?.[ast.fieldId] ?? null;
        if (ast.type === "unary") {
            const value = evaluate(ast.value, row);
            if (ast.op === "-") return -numeric(value);
            if (ast.op === "+") return numeric(value);
            if (ast.op === "NOT") return !truthy(value);
        }
        if (ast.type === "binary") {
            const left = evaluate(ast.left, row);
            if (ast.op === "AND") return truthy(left) && truthy(evaluate(ast.right, row));
            if (ast.op === "OR") return truthy(left) || truthy(evaluate(ast.right, row));
            const right = evaluate(ast.right, row);
            if (ast.op === "+") {
                if (typeof left === "string" || typeof right === "string") return `${left ?? ""}${right ?? ""}`;
                return numeric(left) + numeric(right);
            }
            if (ast.op === "-") return numeric(left) - numeric(right);
            if (ast.op === "*") return numeric(left) * numeric(right);
            if (ast.op === "/") return numeric(right) === 0 ? null : numeric(left) / numeric(right);
            if (ast.op === "^") return numeric(left) ** numeric(right);
            const a = comparable(left); const b = comparable(right);
            if (ast.op === "=" || ast.op === "==") return a === b;
            if (ast.op === "!=") return a !== b;
            if (ast.op === ">") return a > b;
            if (ast.op === ">=") return a >= b;
            if (ast.op === "<") return a < b;
            if (ast.op === "<=") return a <= b;
        }
        if (ast.type === "call") {
            if (ast.name === "IF") {
                const condition = ast.args.length ? evaluate(ast.args[0], row) : null;
                const branch = truthy(condition) ? ast.args[1] : ast.args[2];
                return branch ? evaluate(branch, row) : null;
            }
            if (ast.name === "IFERROR") {
                try {
                    const value = ast.args.length ? evaluate(ast.args[0], row) : null;
                    if (value !== null && value !== undefined && !Number.isNaN(value)) return value;
                } catch {
                    // The fallback below mirrors Excel's error-handling behavior.
                }
                return ast.args[1] ? evaluate(ast.args[1], row) : null;
            }
            const fn = FUNCTIONS[ast.name];
            if (!fn) throw new FormulaError(`Nieobsługiwana funkcja ${ast.name}`);
            return fn(...ast.args.map((arg) => evaluate(arg, row)));
        }
        return null;
    }

    function collectDependencies(ast, target = new Set()) {
        if (!ast) return target;
        if (ast.type === "field") target.add(ast.fieldId);
        if (ast.type === "unary") collectDependencies(ast.value, target);
        if (ast.type === "binary") {
            collectDependencies(ast.left, target);
            collectDependencies(ast.right, target);
        }
        if (ast.type === "call") ast.args.forEach((arg) => collectDependencies(arg, target));
        return target;
    }

    function compile(expression, fields) {
        const ast = parse(expression, fields);
        return { ast, dependencies: [...collectDependencies(ast)], evaluate: (row) => evaluate(ast, row) };
    }

    const api = Object.freeze({ FormulaError, tokenize, parse, evaluate, compile, collectDependencies, functions: Object.keys(FUNCTIONS) });
    Object.defineProperty(PMA, "formulaEngine", { value: api, writable: false, enumerable: true, configurable: false });
}(window));
