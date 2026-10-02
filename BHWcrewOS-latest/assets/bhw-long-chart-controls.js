(function(){
  "use strict";

  const INSTALLED = new WeakSet();
  const MIN_ROWS = 8;
  const MIN_COLUMNS = 7;
  const STYLE_ID = "bhw-long-chart-controls-style";

  function addStyles(doc){
    if(doc.getElementById(STYLE_ID)) return;
    const style = doc.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      .bhw-long-chart{min-width:0}
      .bhw-long-chart-toolbar{display:flex;align-items:center;justify-content:flex-end;gap:8px;margin:0 0 8px}
      .bhw-long-chart-toggle{appearance:none;border:1px solid #d9c7b2;border-radius:999px;background:#fff;color:#26383f;cursor:pointer;font:700 11px/1.2 Montserrat,Arial,sans-serif;padding:7px 11px;white-space:nowrap}
      .bhw-long-chart-toggle:hover{border-color:#80abbd;background:#f4f8f8}
      .bhw-long-chart-toggle:focus-visible{outline:3px solid rgba(128,171,189,.4);outline-offset:2px}
      .bhw-long-chart.is-expanded{position:fixed!important;inset:10px!important;z-index:2147482600!important;display:flex!important;flex-direction:column!important;min-height:0!important;margin:0!important;padding:12px!important;background:#f7f4ef!important;border:1px solid #dcc8b1!important;border-radius:14px!important;box-shadow:0 24px 80px rgba(20,32,38,.32)!important}
      .bhw-long-chart.is-expanded .bhw-long-chart-toolbar{flex:none;margin-bottom:10px}
      .bhw-long-chart.is-expanded .bhw-long-chart-body{display:block!important;flex:1!important;min-height:0!important;max-height:none!important;height:auto!important;overflow:auto!important;background:#fff}
      .bhw-long-chart.is-expanded table{width:100%!important}
      .bhw-long-chart.is-expanded thead th{position:sticky;top:0;z-index:2;background:#f7f4ef}
      body.bhw-long-chart-open{overflow:hidden!important}
      @media(max-width:700px){.bhw-long-chart.is-expanded{inset:4px!important;padding:8px!important;border-radius:10px!important}}
    `;
    (doc.head || doc.documentElement).appendChild(style);
  }

  function rowCount(table){
    return table.tBodies ? [...table.tBodies].reduce((sum,body)=>sum+body.rows.length,0) : table.querySelectorAll("tbody tr").length;
  }

  function isLong(element){
    if(element.hasAttribute("data-no-expand")) return false;
    if(element.hasAttribute("data-long-chart")) return true;
    if(element.tagName!=="TABLE") return false;
    return rowCount(element) >= MIN_ROWS || element.querySelectorAll("thead th").length >= MIN_COLUMNS;
  }

  function closeChart(shell,button,doc,restoreFocus){
    shell.classList.remove("is-expanded");
    button.textContent = "Expand chart";
    button.setAttribute("aria-expanded","false");
    if(!doc.querySelector(".bhw-long-chart.is-expanded")) doc.body.classList.remove("bhw-long-chart-open");
    if(restoreFocus) button.focus();
  }

  function expandChart(shell,button,doc){
    doc.querySelectorAll(".bhw-long-chart.is-expanded").forEach(open=>{
      if(open===shell) return;
      const openButton=open.querySelector(".bhw-long-chart-toggle");
      if(openButton) closeChart(open,openButton,doc,false);
    });
    shell.classList.add("is-expanded");
    button.textContent = "Condense chart";
    button.setAttribute("aria-expanded","true");
    doc.body.classList.add("bhw-long-chart-open");
  }

  function enhance(element,doc){
    if(element.dataset.bhwLongChartReady==="1" || !isLong(element)) return;
    const existingBody = element.tagName==="TABLE" ? element.closest(".tbl-wrap,.tablewrap,.table-wrap,.table-container,.table-scroll") : null;
    const body = existingBody || element;
    if(body.closest(".bhw-long-chart")){
      element.dataset.bhwLongChartReady="1";
      return;
    }

    const shell = doc.createElement("section");
    shell.className = "bhw-long-chart";
    shell.dataset.bhwLongChart = "1";
    const toolbar = doc.createElement("div");
    toolbar.className = "bhw-long-chart-toolbar";
    const button = doc.createElement("button");
    let suffix=1;
    while(doc.getElementById(`bhw-long-chart-${suffix}`)) suffix++;
    const controlId = `bhw-long-chart-${suffix}`;
    body.id = body.id || controlId;
    button.type = "button";
    button.className = "bhw-long-chart-toggle";
    button.textContent = "Expand chart";
    button.setAttribute("aria-expanded","false");
    button.setAttribute("aria-controls",body.id);
    button.addEventListener("click",()=>{
      if(shell.classList.contains("is-expanded")) closeChart(shell,button,doc,true);
      else expandChart(shell,button,doc);
    });
    toolbar.appendChild(button);
    body.parentNode.insertBefore(shell,body);
    shell.appendChild(toolbar);
    shell.appendChild(body);
    body.classList.add("bhw-long-chart-body");
    element.dataset.bhwLongChartReady="1";
  }

  function scan(doc){
    [...doc.querySelectorAll("table,[data-long-chart]")].forEach(element=>enhance(element,doc));
  }

  function install(doc){
    if(!doc || !doc.documentElement) return;
    addStyles(doc);
    scan(doc);
    if(INSTALLED.has(doc) || !doc.body || typeof MutationObserver==="undefined") return;
    INSTALLED.add(doc);
    let scheduled=false;
    const observer = new MutationObserver(()=>{
      if(scheduled) return;
      scheduled=true;
      Promise.resolve().then(()=>{ scheduled=false; scan(doc); });
    });
    observer.observe(doc.body,{childList:true,subtree:true});
    doc.addEventListener("keydown",event=>{
      if(event.key!=="Escape") return;
      const shell=doc.querySelector(".bhw-long-chart.is-expanded");
      const button=shell&&shell.querySelector(".bhw-long-chart-toggle");
      if(shell&&button) closeChart(shell,button,doc,true);
    });
  }

  window.BHWLongCharts = { install, isLong };
  if(document.readyState==="loading") document.addEventListener("DOMContentLoaded",()=>install(document),{once:true});
  else install(document);
})();
