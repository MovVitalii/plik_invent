"use strict";

const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const APP_DIR = path.resolve(__dirname, "../apps/materials");
const INDEX_PATH = path.join(APP_DIR, "index.html");
const BASE_URL = "http://127.0.0.1:8804/index.html";
const ROW_COUNT = 50000;
const POLYFILL_SCRIPT = `
<script>
window.URL.createObjectURL=window.URL.createObjectURL||function(){return "blob:stub"};
window.URL.revokeObjectURL=window.URL.revokeObjectURL||function(){};
window.print=window.print||function(){};
window.prompt=function(_,v){return v||""};
window.confirm=function(){return true};
Element.prototype.scrollIntoView=Element.prototype.scrollIntoView||function(){};
window.MutationObserver=function(){this.observe=function(){};this.disconnect=function(){};this.takeRecords=function(){return[]}};
window.ResizeObserver=window.ResizeObserver||function(){this.observe=function(){};this.unobserve=function(){};this.disconnect=function(){}};
window.requestAnimationFrame=window.requestAnimationFrame||function(cb){return setTimeout(cb,0)};
window.cancelAnimationFrame=window.cancelAnimationFrame||function(id){clearTimeout(id)};
function ctx(){var n=function(){};return{canvas:null,save:n,restore:n,scale:n,rotate:n,translate:n,transform:n,setTransform:n,resetTransform:n,clearRect:n,fillRect:n,strokeRect:n,beginPath:n,closePath:n,moveTo:n,lineTo:n,bezierCurveTo:n,quadraticCurveTo:n,arc:n,arcTo:n,ellipse:n,rect:n,roundRect:n,fill:n,stroke:n,clip:n,drawImage:n,setLineDash:n,getLineDash:function(){return[]},measureText:function(){return{width:10}},fillText:n,strokeText:n,createLinearGradient:function(){return{addColorStop:n}},createRadialGradient:function(){return{addColorStop:n}},createPattern:function(){return{}},getTransform:function(){return{a:1,b:0,c:0,d:1,e:0,f:0}}}}
HTMLCanvasElement.prototype.getContext=function(t){if(t==="2d"){var c=ctx();c.canvas=this;return c}return null};
HTMLCanvasElement.prototype.getBoundingClientRect=function(){return{width:600,height:300,top:0,left:0,right:600,bottom:300,x:0,y:0,toJSON:function(){}}};
</script>`;

function waitFor(fn, timeout = 20000) {
    const start = Date.now();
    return new Promise((resolve, reject) => {
        const tick = () => {
            try { if (fn()) return resolve(); } catch (error) { return reject(error); }
            if (Date.now() - start > timeout) return reject(new Error("waitFor timeout"));
            setTimeout(tick, 25);
        };
        tick();
    });
}
const checks = [];
function check(label, condition, detail = "") {
    const pass = Boolean(condition); checks.push(pass);
    console.log(`${pass ? "PASS" : "FAIL"} — ${label}${detail ? ` (${detail})` : ""}`);
}

async function main() {
    const errors = [];
    const html = fs.readFileSync(INDEX_PATH, "utf8").replace("<head>", `<head>${POLYFILL_SCRIPT}`);
    const started = Date.now();
    const dom = new JSDOM(html, { url: BASE_URL, runScripts: "dangerously", resources: "usable", pretendToBeVisual: true });
    dom.window.addEventListener("error", (event) => errors.push(event.error || event.message));
    dom.window.addEventListener("unhandledrejection", (event) => errors.push(event.reason));
    await waitFor(() => dom.window.document.body.classList.contains("app-ready"));
    const { PMA } = dom.window;
    check("Performance fixture app booted", Boolean(PMA?.spreadsheetEngine));

    const fields = [
        { id: "date", label: "Data", type: "date", source: "mapped", hidden: false },
        { id: "material", label: "Materiał", type: "text", source: "mapped", hidden: false },
        { id: "quantity", label: "Zużycie", type: "number", source: "mapped", hidden: false },
        { id: "source__0", label: "Notatka", type: "text", source: "source", sourceColumn: "Notatka", hidden: false }
    ];
    const rows = Array.from({ length: ROW_COUNT }, (_, index) => ({
        id: `perf-${index}`,
        date: `2026-01-${String(index % 28 + 1).padStart(2, "0")}`,
        material: `Materiał ${index % 100}`,
        quantity: index % 25 + 1,
        source__0: `Wiersz ${index}`,
        season: "Zima",
        seasonPeriod: "Zima 2025/2026",
        year: 2026,
        unit: "szt."
    }));
    PMA.state.setNormalizedDataset({ normalizedRows: rows, invalidRows: [], duplicateRows: [], fields, statistics: {} });
    await waitFor(() => PMA.state.get("dataset.normalizedRows.length") === ROW_COUNT);
    await waitFor(() => dom.window.document.querySelectorAll("#workspaceGridBody tr[data-row-id]").length > 0);
    check("50k rows load into the workspace", PMA.state.get("dataset.normalizedRows.length") === ROW_COUNT);
    const rendered = dom.window.document.querySelectorAll("#workspaceGridBody tr[data-row-id]").length;
    check("Virtual grid renders a bounded DOM window", rendered > 0 && rendered < 100, String(rendered));

    const pareto = PMA.decisionEngine.getParetoResult(rows);
    check("Decision aggregation handles 50k rows", pareto.rows.length === 100 && pareto.total > 0, `${pareto.rows.length}/${pareto.total}`);

    const compiled = PMA.formulaEngine.compile("ROUND([Zużycie] * 1.15; 2)", fields);
    const formulaValues = rows.map((row) => compiled.evaluate(row));
    check("Formula evaluation handles 50k rows", formulaValues.length === ROW_COUNT && formulaValues[0] === 1.15 && formulaValues.at(-1) > 0);

    const workspace = PMA.spreadsheetEngine.serializeWorkspace();
    check("Workspace serialization preserves 50k rows", workspace.dataset.normalizedRows.length === ROW_COUNT);
    const elapsed = Date.now() - started;
    check("50k-row smoke test completes within the safety budget", elapsed < 20000, `${elapsed} ms`);
    check("No browser errors during 50k-row smoke test", errors.length === 0, errors.map(String).join(" | "));

    const passed = checks.filter(Boolean).length;
    console.log(`\n${passed}/${checks.length} checks passed. (${elapsed} ms)`);
    dom.window.close();
    if (passed !== checks.length) process.exitCode = 1;
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
