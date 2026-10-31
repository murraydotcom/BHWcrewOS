/* @ds-bundle: {"format":4,"namespace":"BHWMedicalGroupDesignSystem_8f7981","components":[{"name":"BulletList","sourcePath":"components/content/BulletList.jsx"},{"name":"DataTable","sourcePath":"components/content/DataTable.jsx"},{"name":"InfoBox","sourcePath":"components/content/InfoBox.jsx"},{"name":"SectionHeader","sourcePath":"components/content/SectionHeader.jsx"},{"name":"Badge","sourcePath":"components/core/Badge.jsx"},{"name":"DocFooter","sourcePath":"components/layout/DocFooter.jsx"},{"name":"PageHeader","sourcePath":"components/layout/PageHeader.jsx"}],"sourceHashes":{"components/content/BulletList.jsx":"3c9752525853","components/content/DataTable.jsx":"4cee2c296428","components/content/InfoBox.jsx":"885a5aab4244","components/content/SectionHeader.jsx":"c307d486784a","components/core/Badge.jsx":"4ca3ac79f7c1","components/layout/DocFooter.jsx":"fc7fbb333a60","components/layout/PageHeader.jsx":"335d948a27cf"},"inlinedExternals":[],"unexposedExports":[]} */

(() => {

const __ds_ns = (window.BHWMedicalGroupDesignSystem_8f7981 = window.BHWMedicalGroupDesignSystem_8f7981 || {});

const __ds_scope = {};

(__ds_ns.__errors = __ds_ns.__errors || []);

// components/content/BulletList.jsx
try { (() => {
/**
 * BulletList — bulleted items with optional bold lead-in.
 * items: array of strings, or { lead, text } for "Bold lead. explanation".
 * ordered=true renders a numbered list. Supports nested arrays via `children`.
 */
function BulletList({
  items = [],
  ordered = false,
  style
}) {
  const Tag = ordered ? 'ol' : 'ul';
  return /*#__PURE__*/React.createElement(Tag, {
    style: {
      listStyle: ordered ? 'decimal' : 'disc',
      margin: 0,
      paddingLeft: 'var(--bullet-indent)',
      fontFamily: 'var(--font-sans)',
      fontSize: 'var(--fs-body)',
      lineHeight: 'var(--lh-body)',
      color: 'var(--text-body)',
      ...style
    }
  }, items.map((item, i) => {
    const obj = typeof item === 'string' ? {
      text: item
    } : item;
    return /*#__PURE__*/React.createElement("li", {
      key: i,
      style: {
        marginBottom: 'var(--bullet-gap)'
      }
    }, obj.lead && /*#__PURE__*/React.createElement("strong", {
      style: {
        fontWeight: 'var(--fw-bold)'
      }
    }, obj.lead, " "), obj.text, obj.children && /*#__PURE__*/React.createElement(BulletList, {
      items: obj.children,
      style: {
        marginTop: 'var(--bullet-gap)',
        paddingLeft: 'var(--bullet-indent)'
      }
    }));
  }));
}
Object.assign(__ds_scope, { BulletList });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/content/BulletList.jsx", error: String((e && e.message) || e) }); }

// components/content/DataTable.jsx
try { (() => {
const HEADER_COLOR = {
  info: 'var(--box-info)',
  warn: 'var(--box-warn)',
  tip: 'var(--box-tip)'
};

/**
 * DataTable — structured data with a colored header and alternating cream rows.
 * columns: array of strings (or {label, width}); rows: array of cell arrays.
 */
function DataTable({
  columns = [],
  rows = [],
  headerIntent = 'info',
  style
}) {
  const cols = columns.map(c => typeof c === 'string' ? {
    label: c
  } : c);
  return /*#__PURE__*/React.createElement("table", {
    style: {
      fontFamily: 'var(--font-sans)',
      width: '100%',
      borderCollapse: 'collapse',
      borderRadius: 'var(--radius-sm)',
      overflow: 'hidden',
      ...style
    }
  }, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", null, cols.map((c, i) => /*#__PURE__*/React.createElement("th", {
    key: i,
    style: {
      background: HEADER_COLOR[headerIntent] || HEADER_COLOR.info,
      color: 'var(--text-on-color)',
      fontSize: 'var(--fs-table)',
      fontWeight: 'var(--fw-semibold)',
      textAlign: 'left',
      padding: 'var(--table-pad-y) var(--table-pad-x)',
      width: c.width
    }
  }, c.label)))), /*#__PURE__*/React.createElement("tbody", null, rows.map((row, ri) => /*#__PURE__*/React.createElement("tr", {
    key: ri,
    style: {
      background: ri % 2 === 1 ? 'var(--surface-table-alt)' : 'var(--surface-page)'
    }
  }, row.map((cell, ci) => /*#__PURE__*/React.createElement("td", {
    key: ci,
    style: {
      fontSize: 'var(--fs-table)',
      color: 'var(--text-body)',
      lineHeight: 'var(--lh-tight)',
      padding: 'var(--table-pad-y) var(--table-pad-x)',
      borderBottom: 'var(--line-thin) solid var(--border-subtle)'
    }
  }, cell))))));
}
Object.assign(__ds_scope, { DataTable });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/content/DataTable.jsx", error: String((e && e.message) || e) }); }

// components/content/InfoBox.jsx
try { (() => {
const HEADER_COLOR = {
  info: 'var(--box-info)',
  warn: 'var(--box-warn)',
  tip: 'var(--box-tip)'
};

/**
 * InfoBox — colored-header callout over a cream body.
 * intent picks the header color: info (teal dark), warn (rust), tip (sage).
 */
function InfoBox({
  title,
  intent = 'info',
  children,
  style
}) {
  return /*#__PURE__*/React.createElement("section", {
    style: {
      fontFamily: 'var(--font-sans)',
      borderRadius: 'var(--radius-sm)',
      overflow: 'hidden',
      ...style
    }
  }, title && /*#__PURE__*/React.createElement("div", {
    style: {
      background: HEADER_COLOR[intent] || HEADER_COLOR.info,
      color: 'var(--text-on-color)',
      font: 'var(--type-box-header)',
      letterSpacing: '.03em',
      padding: '7px var(--box-padding)'
    }
  }, title), /*#__PURE__*/React.createElement("div", {
    style: {
      background: 'var(--surface-content)',
      color: 'var(--text-body)',
      fontSize: 'var(--fs-body)',
      lineHeight: 'var(--lh-body)',
      padding: 'var(--box-padding)'
    }
  }, children));
}
Object.assign(__ds_scope, { InfoBox });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/content/InfoBox.jsx", error: String((e && e.message) || e) }); }

// components/content/SectionHeader.jsx
try { (() => {
/**
 * SectionHeader — H2 that introduces a content section.
 * Teal Dark, Montserrat Bold, sentence case, no background.
 */
function SectionHeader({
  children,
  as = 'h2',
  style
}) {
  const Tag = as;
  return /*#__PURE__*/React.createElement(Tag, {
    style: {
      fontFamily: 'var(--font-sans)',
      font: 'var(--type-h2)',
      color: 'var(--text-heading)',
      margin: 'var(--section-space-before) 0 var(--section-space-after)',
      ...style
    }
  }, children);
}
Object.assign(__ds_scope, { SectionHeader });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/content/SectionHeader.jsx", error: String((e && e.message) || e) }); }

// components/core/Badge.jsx
try { (() => {
const TONE = {
  teal: {
    bg: 'var(--bhw-teal-tint)',
    fg: 'var(--bhw-teal-dark)'
  },
  rust: {
    bg: 'var(--bhw-rust-tint)',
    fg: 'var(--bhw-rust)'
  },
  sage: {
    bg: 'var(--bhw-sage-tint)',
    fg: '#5d6b51'
  },
  solid: {
    bg: 'var(--bhw-teal-dark)',
    fg: 'var(--text-on-color)'
  }
};

/**
 * Badge — small status / category pill for tagging items
 * (e.g. "New", "Stop", "Continue" in medication tables).
 */
function Badge({
  children,
  tone = 'teal',
  style
}) {
  const t = TONE[tone] || TONE.teal;
  return /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-block',
      fontFamily: 'var(--font-sans)',
      fontSize: '8pt',
      fontWeight: 'var(--fw-semibold)',
      letterSpacing: '.03em',
      lineHeight: 1,
      padding: '3px 8px',
      borderRadius: '999px',
      background: t.bg,
      color: t.fg,
      ...style
    }
  }, children);
}
Object.assign(__ds_scope, { Badge });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Badge.jsx", error: String((e && e.message) || e) }); }

// components/layout/DocFooter.jsx
try { (() => {
/**
 * DocFooter — cream page footer with clinic info, optional page number,
 * and a small disclaimer. Topped by a sage divider.
 */
function DocFooter({
  orgLine = 'Baltimore Healthcare and Wellness · BHW MG',
  addressLine = '2131 Maryland Ave, Baltimore, MD 21218',
  disclaimer = 'For education only. Not a substitute for medical advice.',
  pageNumber
}) {
  return /*#__PURE__*/React.createElement("footer", {
    style: {
      fontFamily: 'var(--font-sans)',
      background: 'var(--surface-content)',
      borderTop: 'var(--line-footer) solid var(--border-footer)',
      padding: '8px 24px',
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'flex-end',
      gap: '16px',
      color: 'var(--text-body)'
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 'var(--fs-footer)',
      fontWeight: 'var(--fw-semibold)'
    }
  }, orgLine), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 'var(--fs-footer)',
      fontWeight: 'var(--fw-regular)',
      marginTop: '1px'
    }
  }, addressLine)), /*#__PURE__*/React.createElement("div", {
    style: {
      textAlign: 'right'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 'var(--fs-fineprint)',
      fontStyle: 'italic',
      color: 'var(--text-muted)'
    }
  }, disclaimer), pageNumber != null && /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 'var(--fs-footer)',
      fontWeight: 'var(--fw-semibold)',
      marginTop: '2px'
    }
  }, pageNumber)));
}
Object.assign(__ds_scope, { DocFooter });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/layout/DocFooter.jsx", error: String((e && e.message) || e) }); }

// components/layout/PageHeader.jsx
try { (() => {
/**
 * PageHeader — the teal header band at the top of every BHW document.
 * Clinic wordmark + document title, closed by a rust accent stripe.
 */
function PageHeader({
  clinicName = 'BHW MEDICAL GROUP',
  orgName = 'Baltimore Healthcare and Wellness',
  title,
  subtitle,
  patientName,
  variant = 'standard'
}) {
  return /*#__PURE__*/React.createElement("header", {
    style: {
      fontFamily: 'var(--font-sans)',
      overflow: 'hidden'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      background: 'var(--surface-header)',
      color: 'var(--text-on-color)',
      padding: '18px 24px 20px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: '10pt',
      fontWeight: 'var(--fw-semibold)',
      letterSpacing: '.04em'
    }
  }, clinicName), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: '8pt',
      fontWeight: 'var(--fw-regular)',
      opacity: 0.92,
      marginTop: '2px'
    }
  }, orgName), variant !== 'minimal' && /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: '14px'
    }
  }, title && /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 'var(--fs-h1)',
      fontWeight: 'var(--fw-bold)',
      lineHeight: 'var(--lh-heading)'
    }
  }, title), variant === 'patientId' && patientName && /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: '12pt',
      fontWeight: 'var(--fw-semibold)',
      marginTop: '4px'
    }
  }, patientName), subtitle && /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 'var(--fs-subtitle)',
      fontWeight: 'var(--fw-medium)',
      marginTop: '3px',
      opacity: 0.96
    }
  }, subtitle))), /*#__PURE__*/React.createElement("div", {
    style: {
      height: 'var(--line-stripe)',
      background: 'var(--accent-stripe)'
    }
  }));
}
Object.assign(__ds_scope, { PageHeader });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/layout/PageHeader.jsx", error: String((e && e.message) || e) }); }

__ds_ns.BulletList = __ds_scope.BulletList;

__ds_ns.DataTable = __ds_scope.DataTable;

__ds_ns.InfoBox = __ds_scope.InfoBox;

__ds_ns.SectionHeader = __ds_scope.SectionHeader;

__ds_ns.Badge = __ds_scope.Badge;

__ds_ns.DocFooter = __ds_scope.DocFooter;

__ds_ns.PageHeader = __ds_scope.PageHeader;

})();
