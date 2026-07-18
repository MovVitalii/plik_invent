"use strict";

const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const APP_DIR = path.resolve(__dirname, "../apps/materials");
const INDEX_PATH = path.join(APP_DIR, "index.html");
const BASE_URL = "http://127.0.0.1:8804/index.html";
const POLYFILL_SCRIPT = `
<script>
window.URL.createObjectURL=window.URL.createObjectURL||function(){return "blob:stub"};
window.URL.revokeObjectURL=window.URL.revokeObjectURL||function(){};
window.print=window.print||function(){};
window.prompt=window.prompt||function(_,v){return v||""};
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

function loadHtml(){return fs.readFileSync(INDEX_PATH,"utf8").replace("<head>","<head>"+POLYFILL_SCRIPT)}
function waitFor(fn,timeout=15000){const start=Date.now();return new Promise((resolve,reject)=>{const tick=()=>{try{if(fn())return resolve()}catch(e){return reject(e)}if(Date.now()-start>timeout)return reject(new Error("waitFor timeout"));setTimeout(tick,25)};tick()})}
const results=[];
function check(label,condition,detail=""){const pass=Boolean(condition);results.push(pass);console.log(`${pass?"PASS":"FAIL"} — ${label}${detail?` (${detail})`:""}`)}
function click(node){node.dispatchEvent(new node.ownerDocument.defaultView.MouseEvent("click",{bubbles:true,cancelable:true}))}

async function main(){
 const errors=[];
 const dom=new JSDOM(loadHtml(),{url:BASE_URL,runScripts:"dangerously",resources:"usable",pretendToBeVisual:true});
 dom.window.addEventListener("error",e=>errors.push(e.error||e.message));
 dom.window.addEventListener("unhandledrejection",e=>errors.push(e.reason));
 const {window}=dom; await waitFor(()=>window.document.body.classList.contains("app-ready"),20000); const {PMA}=window;

 check("Workspace JSON input exists in the header",Boolean(window.document.getElementById("dataLabWorkspaceInput")));
 check("Removed value-normalization UI does not exist",!window.document.getElementById("technicalNormalizationElements"));
 check("Dedicated stock clear action exists",Boolean(window.document.getElementById("workspaceClearStockButton")));

 const analyzed=PMA.importEngine.buildSheetAnalysis([
  ["Data","Materiał","Ilość"],
  ["2026-01-01","A",1],
  ["","",""] ,
  ["2026-01-03","B",2]
 ],0);
 check("Source Excel row numbers survive empty rows",JSON.stringify(analyzed.sourceRowNumbers)==="[2,4]",JSON.stringify(analyzed.sourceRowNumbers));

 const headers=["Data","Materiał","Ilość","Cena"];
 const mapping={date:"Data",material:"Materiał",quantity:"Ilość",brand:"",stockLevel:"",unit:""};
 PMA.state.setSheetAnalysis({rawRows:[],headerRowIndex:0,headers,sourceHeaders:headers,dataRows:[],previewRows:[],detectedTypes:{Data:"date",Materiał:"text",Ilość:"number",Cena:"number"},emptyRowCount:0,sourceRowNumbers:[2,3],rowProvenance:[{fileName:"one.xlsx",sheetName:"Dane",sourceRow:2},{fileName:"two.xlsx",sheetName:"Arkusz",sourceRow:8}]});
 PMA.state.setMapping(mapping);
 const sourceRows=[["2026-01-01","A",10,2],["2026-01-02","B",20,3]];
 const normalized=sourceRows.map((values,index)=>{
  const sourceValues=Object.fromEntries(headers.map((h,c)=>[h,values[c]]));
  const base=Object.fromEntries(PMA.constants.SYSTEM_FIELDS.map(f=>[f.id,null]));
  const result=PMA.normalizationEngine.normalizeSingleRecord({...base,date:values[0],material:values[1],quantity:values[2]},{sourceRowNumber:index?8:2,sourceFile:index?"two.xlsx":"one.xlsx",sourceSheet:index?"Arkusz":"Dane",sourceValues,headers,sourceRow:values});
  if(!result.valid)throw new Error(JSON.stringify(result.errors)); return result.record;
 });
 const fields=PMA.normalizationEngine.buildDatasetFields(mapping,headers);
 PMA.state.setNormalizedDataset({normalizedRows:normalized,invalidRows:[],duplicateRows:[],fields,statistics:{}});
 await PMA.pivotEngine.prepareAnalysis({buildDefault:true});
 await waitFor(()=>window.document.querySelectorAll("#workspaceGridBody tr[data-row-id]").length===2);

 const boolFalse=PMA.formulaEngine.compile('IF("false", 1, 0)',PMA.state.get("dataset.fields")).evaluate({});
 check("Formula truthiness treats text false as false",boolFalse===0,String(boolFalse));
 const exponent=PMA.formulaEngine.compile("2^3^2",PMA.state.get("dataset.fields")).evaluate({});
 check("Exponentiation is right-associative like Excel",exponent===512,String(exponent));
 const unaryPower=PMA.formulaEngine.compile("-2^2",PMA.state.get("dataset.fields")).evaluate({});
 check("Exponentiation has precedence over unary minus",unaryPower===-4,String(unaryPower));
 const semicolon=PMA.formulaEngine.compile("IF(TRUE; 1; 0)",PMA.state.get("dataset.fields")).evaluate({});
 check("Formula functions accept Polish semicolon separators",semicolon===1,String(semicolon));
 const negativeRound=PMA.formulaEngine.compile("ROUND(-1.5; 0)",PMA.state.get("dataset.fields")).evaluate({});
 check("ROUND uses Excel-style half-away-from-zero for negatives",negativeRound===-2,String(negativeRound));
 const decimalRound=PMA.formulaEngine.compile("ROUND(1.005; 2)",PMA.state.get("dataset.fields")).evaluate({});
 check("ROUND handles decimal half values without binary drift",decimalRound===1.01,String(decimalRound));
 const tensRound=PMA.formulaEngine.compile("ROUND(149; -1)",PMA.state.get("dataset.fields")).evaluate({});
 check("ROUND supports negative digit positions",tensRound===150,String(tensRound));
 const lazyIf=PMA.formulaEngine.compile("IF(FALSE; UNKNOWN(); 7)",PMA.state.get("dataset.fields")).evaluate({});
 check("IF evaluates only the selected branch",lazyIf===7,String(lazyIf));
 const recoveredError=PMA.formulaEngine.compile('IFERROR(UNKNOWN(); "fallback")',PMA.state.get("dataset.fields")).evaluate({});
 check("IFERROR catches evaluation errors",recoveredError==="fallback",String(recoveredError));
 const minBlank=PMA.formulaEngine.compile("MIN(NULL; 5)",PMA.state.get("dataset.fields")).evaluate({});
 check("MIN ignores blank values instead of coercing them to zero",minBlank===5,String(minBlank));
 const dep=PMA.formulaEngine.compile("[quantity] * [source__3]",PMA.state.get("dataset.fields"));
 check("Formula engine exposes dependencies",dep.dependencies.includes("quantity")&&dep.dependencies.includes("source__3"),dep.dependencies.join(","));

 // Header sort must toggle ASC -> DESC without losing the sort.
 const quantitySource=PMA.state.get("dataset.fields").find(f=>f.source==="source"&&f.sourceColumn==="Ilość");
 const sortButton=window.document.querySelector(`[data-grid-sort="${quantitySource.id}"]`);
 click(sortButton); click(window.document.querySelector(`[data-grid-sort="${quantitySource.id}"]`));
 const runtimeSort=PMA.spreadsheetEngine.getRuntimeState().sorts;
 check("Clicking one header twice leaves one descending sort",runtimeSort.length===1&&runtimeSort[0].direction==="desc",JSON.stringify(runtimeSort));

 // Date comparison filters must compare dates, not fall back to text contains.
 window.document.getElementById("workspaceFilterField").value="date";
 window.document.getElementById("workspaceFilterOperator").value="greater-than";
 window.document.getElementById("workspaceFilterValue").value="2026-01-01";
 click(window.document.getElementById("workspaceAddFilterButton"));
 await waitFor(()=>window.document.querySelectorAll("#workspaceGridBody tr[data-row-id]").length===1);
 check("Date comparison filter uses chronological comparison",window.document.querySelectorAll("#workspaceGridBody tr[data-row-id]").length===1);
 click(window.document.querySelector("#workspaceActiveFilters button"));
 await waitFor(()=>window.document.querySelectorAll("#workspaceGridBody tr[data-row-id]").length===2);
 window.document.getElementById("workspaceFilterField").value=quantitySource.id;
 window.document.getElementById("workspaceFilterOperator").value="greater-than";
 window.document.getElementById("workspaceFilterValue").value="not-a-number";
 click(window.document.getElementById("workspaceAddFilterButton"));
 check("Invalid numeric comparison filter is rejected",PMA.spreadsheetEngine.getRuntimeState().filters.length===0);

 // Row delete redo used to depend on a cleared Set.
 const firstCheckbox=window.document.querySelector("#workspaceGridBody [data-select-row]");
 firstCheckbox.click();
 check("Row checkbox enables delete action",window.document.getElementById("workspaceDeleteRowsButton").disabled===false);
 click(window.document.getElementById("workspaceDeleteRowsButton"));
 await waitFor(()=>PMA.state.get("dataset.normalizedRows.length")===1);
 PMA.spreadsheetEngine.undo();
 check("Undo restores deleted rows",PMA.state.get("dataset.normalizedRows.length")===2);
 PMA.spreadsheetEngine.redo();
 check("Redo deletes the same rows again",PMA.state.get("dataset.normalizedRows.length")===1);
 PMA.spreadsheetEngine.undo();

 // Add a calculated column and verify multi-cell paste recalculates from the final row.
 window.document.getElementById("workspaceFormulaName").value="Wartość";
 window.document.getElementById("workspaceFormulaType").value="number";
 window.document.getElementById("workspaceFormulaExpression").value="[Ilość] * [Cena]";
 click(window.document.getElementById("workspaceAddFormulaButton"));
 await waitFor(()=>PMA.state.get("dataset.calculatedColumns.length")===1);
 const formulaId=PMA.state.get("dataset.calculatedColumns.0.id");
 const firstQuantityCell=window.document.querySelector(`#workspaceGridBody td[data-field-id="${quantitySource.id}"]`);
 const pastedRowId=firstQuantityCell.dataset.rowId;
 click(firstQuantityCell);
 const paste=new window.Event("paste",{bubbles:true,cancelable:true});
 Object.defineProperty(paste,"clipboardData",{value:{getData:()=>"30\t4"}});
 window.document.getElementById("workspaceGridViewport").dispatchEvent(paste);
 await waitFor(()=>PMA.state.get("dataset.normalizedRows").find(row=>row.id===pastedRowId)?.[formulaId]===120);
 check("Multi-cell paste recalculates formula from all pasted values",PMA.state.get("dataset.normalizedRows").find(row=>row.id===pastedRowId)?.[formulaId]===120,String(PMA.state.get("dataset.normalizedRows").find(row=>row.id===pastedRowId)?.[formulaId]));

 // Rename a referenced field; expression and values must survive.
 const priceSource=PMA.state.get("dataset.fields").find(f=>f.source==="source"&&f.sourceColumn==="Cena");
 window.document.getElementById("workspaceColumnSelector").value=priceSource.id;
 window.prompt=()=>"Cena jednostkowa";
 click(window.document.getElementById("workspaceRenameColumnButton"));
 check("Renaming a referenced column rewrites formulas",PMA.state.get("dataset.calculatedColumns.0.expression").includes("[Cena jednostkowa]"),PMA.state.get("dataset.calculatedColumns.0.expression"));
 check("Formula values remain valid after referenced-column rename",PMA.state.get("dataset.normalizedRows").find(row=>row.id===pastedRowId)?.[formulaId]===120);

 // Dependent source column cannot be deleted.
 window.document.getElementById("workspaceColumnSelector").value=priceSource.id;
 click(window.document.getElementById("workspaceDeleteColumnButton"));
 check("A column referenced by a formula is protected from deletion",Boolean(PMA.state.get("dataset.fields").find(f=>f.id===priceSource.id)));

 // Deleting a formula and undoing restores its definition.
 window.document.getElementById("workspaceColumnSelector").value=formulaId;
 click(window.document.getElementById("workspaceDeleteColumnButton"));
 check("Deleting a calculated column removes its definition",PMA.state.get("dataset.calculatedColumns.length")===0);
 PMA.spreadsheetEngine.undo();
 check("Undo restores calculated-column definition",PMA.state.get("dataset.calculatedColumns.length")===1&&PMA.state.get("dataset.normalizedRows").find(row=>row.id===pastedRowId)?.[formulaId]===120);

 // Workspace formulas are evaluated by dependency order, independent of JSON order.
 const dependencyWorkspace=PMA.spreadsheetEngine.serializeWorkspace();
 const baseFields=dependencyWorkspace.dataset.fields.filter(field=>field.source!=="calculated");
 const calcA={id:"calc_a",label:"A wynik",type:"number",expression:"[Ilość] * 2",createdAt:new Date().toISOString()};
 const calcB={id:"calc_b",label:"B wynik",type:"number",expression:"[A wynik] + 1",createdAt:new Date().toISOString()};
 dependencyWorkspace.dataset.fields=[...baseFields,{...calcB,source:"calculated"},{...calcA,source:"calculated"}];
 dependencyWorkspace.dataset.calculatedColumns=[calcB,calcA];
 dependencyWorkspace.dataset.normalizedRows=PMA.state.get("dataset.normalizedRows").map(row=>{const next={...row};delete next[formulaId];return next;});
 PMA.spreadsheetEngine.restoreWorkspace(dependencyWorkspace);
 const dependencyRow=PMA.state.get("dataset.normalizedRows").find(row=>row.id===pastedRowId);
 check("Calculated columns use topological dependency order",dependencyRow.calc_a===60&&dependencyRow.calc_b===61,`${dependencyRow.calc_a}/${dependencyRow.calc_b}`);
 const cyclic=structuredClone(dependencyWorkspace);
 cyclic.dataset.calculatedColumns=[{...calcA,expression:"[B wynik] + 1"},{...calcB,expression:"[A wynik] + 1"}];
 let cycleRejected=false;
 try{PMA.spreadsheetEngine.restoreWorkspace(cyclic)}catch(error){cycleRejected=/cykliczne/i.test(String(error.message));}
 check("Cyclic calculated-column dependencies are rejected",cycleRejected);
 check("Rejected workspace does not replace current rows",PMA.state.get("dataset.normalizedRows").find(row=>row.id===pastedRowId)?.calc_b===61);

 // Multi-year seasonal denominator, normalized material matching, MOQ and multiple order.
 const seasonal=[];
 [["2024-12-01","Zima 2024/2025"],["2024-12-02","Zima 2024/2025"],["2025-12-01","Zima 2025/2026"],["2025-12-02","Zima 2025/2026"]].forEach(([date,period],i)=>seasonal.push({id:`r${i}`,material:"Taśma",quantity:10,date,season:"Zima",seasonPeriod:period,year:Number(date.slice(0,4)),unit:"szt."}));
 PMA.state.setNormalizedDataset({normalizedRows:seasonal,invalidRows:[],duplicateRows:[],fields:PMA.state.get("dataset.fields"),statistics:{}});
 PMA.state.setFilteredDataset(seasonal,{});
 PMA.state.setStockDataset([{id:"s",material:"Tasma",stockLevel:1010,date:"2026-01-10",unit:"szt",minimumOrderQuantity:25,orderMultiple:20,openOrders:0,safetyStock:0}],[]);
 const forecast=PMA.decisionEngine.getForecastRows("Zima",seasonal)[0];
 check("Forecast sums calendar spans per season instead of spanning years",forecast.calendarDays===4,String(forecast.calendarDays));
 check("Stock material matching ignores case and Polish diacritics",forecast.stock===1010,String(forecast.stock));
 check("MOQ is applied before package multiple",forecast.toOrder===40,String(forecast.toOrder));

 PMA.state.setStockDataset([{id:"s2",material:"Taśma",stockLevel:10,date:"2026-01-10",unit:"kg"}],[]);
 const mismatched=PMA.decisionEngine.getForecastRows("Zima",seasonal)[0];
 check("Unit mismatch blocks invalid order calculations",Boolean(mismatched.dataIssue)&&mismatched.toOrder===0,mismatched.dataIssue||"");
 PMA.state.setStockDataset([{id:"s3",material:"Other",stockLevel:999,date:"2026-01-10",unit:"szt"},{id:"s4",material:"Taśma",stockLevel:10,date:"2026-01-10",unit:"szt"}],[]);
 check("Stock-only materials outside filtered usage are excluded",PMA.decisionEngine.getCoverageRows(seasonal).length===1);
 check("CSV export keeps negative numbers numeric",PMA.decisionEngine.csvCell(-5)==="-5",PMA.decisionEngine.csvCell(-5));
 check("CSV export neutralizes spreadsheet formulas in text",PMA.decisionEngine.csvCell("=HYPERLINK(\"x\")").replace(/^"/,"").startsWith("'="),PMA.decisionEngine.csvCell("=HYPERLINK(\"x\")"));

 const workspace=PMA.spreadsheetEngine.serializeWorkspace();
 check("Workspace schema is consistently v4",workspace.schemaVersion===4&&PMA.workspaceStorage.SCHEMA_VERSION===4);
 check("Workspace contains source provenance",Array.isArray(workspace.import.rowProvenance)&&Array.isArray(workspace.import.sourceRowNumbers));
 await PMA.workspaceStorage.saveAutosave({...workspace,name:"Audit",project:{name:"Audit"}});
 const autosave=await PMA.workspaceStorage.loadAutosave();
 check("Autosave preserves original project name",autosave.project.name==="Audit"&&autosave.name.includes("Audit"));
 await PMA.workspaceStorage.clearAutosave();
 check("Autosave can be cleared",(await PMA.workspaceStorage.loadAutosave())===null);

 check("No browser errors during audit scenarios",errors.length===0,errors.map(String).join(" | "));
 const passed=results.filter(Boolean).length; console.log(`\n${passed}/${results.length} checks passed.`); dom.window.close(); if(passed!==results.length)process.exitCode=1;
}
main().catch(error=>{console.error(error);process.exitCode=1});
