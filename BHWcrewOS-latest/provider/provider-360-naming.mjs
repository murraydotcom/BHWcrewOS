export const PROVIDER_360_TITLE = "BHW Provider 360";
export const PROVIDER_360_SHORT_TITLE = "Provider 360";
export const PROVIDER_360_SUBTITLE = "PSCM longitudinal synthesis, body-system mapping, and feasible care planning";
export const PROVIDER_360_BOUNDARY = "Provider 360 is the synthesis workspace. Health Core remains the canonical record.";
export const PROVIDER_360_LEGACY_ALIASES = Object.freeze([
  "PSCM Complex Patient Navigator",
  "Complex Patient Navigator",
  "BHW Whole-Person Clinical Map",
  "Whole-Person Clinical Map",
  "Clinical Map",
  "Patient 360",
]);

const TEXT_REPLACEMENTS = Object.freeze([
  [/BHW Whole-Person Clinical Map/g, PROVIDER_360_TITLE],
  [/Whole-Person Clinical Map/g, PROVIDER_360_SHORT_TITLE],
  [/PSCM Complex Patient Navigator/g, PROVIDER_360_TITLE],
  [/Complex Patient Navigator/g, PROVIDER_360_SHORT_TITLE],
  [/Patient 360/g, PROVIDER_360_SHORT_TITLE],
  [/Open Clinical Map/g, `Open ${PROVIDER_360_SHORT_TITLE}`],
  [/Clinical Map provides synthesis/g, `${PROVIDER_360_SHORT_TITLE} provides synthesis`],
  [/Clinical Map is the synthesis workspace/g, `${PROVIDER_360_SHORT_TITLE} is the synthesis workspace`],
  [/◉ Clinical Map/g, `◉ ${PROVIDER_360_SHORT_TITLE}`],
]);

function renameText(value) {
  return TEXT_REPLACEMENTS.reduce(
    (current, [pattern, replacement]) => current.replace(pattern, replacement),
    String(value ?? ""),
  );
}

function renameAttributes(root) {
  for (const element of root.querySelectorAll?.("[aria-label],[title],[data-provider-workspace-label]") || []) {
    for (const attribute of ["aria-label", "title", "data-provider-workspace-label"]) {
      if (!element.hasAttribute(attribute)) continue;
      const prior = element.getAttribute(attribute);
      const next = renameText(prior);
      if (next !== prior) element.setAttribute(attribute, next);
    }
  }
}

function renameVisibleText(root) {
  if (!root || typeof document === "undefined") return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent || ["SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA"].includes(parent.tagName)) {
        return NodeFilter.FILTER_REJECT;
      }
      return PROVIDER_360_LEGACY_ALIASES.some((alias) => node.nodeValue?.includes(alias))
        || node.nodeValue?.includes("Open Clinical Map")
        || node.nodeValue?.includes("Clinical Map provides synthesis")
        || node.nodeValue?.includes("Clinical Map is the synthesis workspace")
        || node.nodeValue?.includes("◉ Clinical Map")
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_REJECT;
    },
  });
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const node of nodes) node.nodeValue = renameText(node.nodeValue);
}

export function applyProvider360Naming(root = document) {
  if (typeof document === "undefined") return;
  document.title = renameText(document.title);
  renameVisibleText(root);
  renameAttributes(root);

  const brand = document.querySelector(".brand h1");
  if (brand) brand.textContent = PROVIDER_360_TITLE;

  const brandDetail = document.querySelector(".brand div");
  if (brandDetail && /PSCM|clinical synthesis|longitudinal synthesis/i.test(brandDetail.textContent || "")) {
    brandDetail.textContent = "PSCM longitudinal synthesis";
  }

  const pageName = document.getElementById("page-name")?.textContent?.trim();
  const crumb = document.querySelector(".crumb");
  if (crumb && pageName && /Provider 360|Clinical Map|Whole-Person|Patient 360/i.test(crumb.textContent || "")) {
    crumb.innerHTML = `${PROVIDER_360_SHORT_TITLE} · <b id="page-name"></b>`;
    crumb.querySelector("#page-name").textContent = pageName;
  }
}

export function observeProvider360Naming(root = document.body) {
  if (typeof MutationObserver === "undefined" || !root) return () => {};
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType === Node.ELEMENT_NODE) applyProvider360Naming(node);
        if (node.nodeType === Node.TEXT_NODE && node.parentElement) applyProvider360Naming(node.parentElement);
      }
    }
  });
  observer.observe(root, { childList: true, subtree: true });
  return () => observer.disconnect();
}
