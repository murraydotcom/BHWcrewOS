/* @ds-bundle: {"format":4,"namespace":"CharmEdMindsDesignSystem_3ab9ff","components":[{"name":"Filament","sourcePath":"components/brand/Filament.jsx"},{"name":"Logo","sourcePath":"components/brand/Logo.jsx"},{"name":"SynapseField","sourcePath":"components/brand/SynapseField.jsx"},{"name":"Badge","sourcePath":"components/core/Badge.jsx"},{"name":"Button","sourcePath":"components/core/Button.jsx"},{"name":"Card","sourcePath":"components/core/Card.jsx"},{"name":"Eyebrow","sourcePath":"components/core/Eyebrow.jsx"},{"name":"IconButton","sourcePath":"components/core/IconButton.jsx"},{"name":"DataTable","sourcePath":"components/data/DataTable.jsx"},{"name":"StatBlock","sourcePath":"components/data/StatBlock.jsx"},{"name":"Timeline","sourcePath":"components/data/Timeline.jsx"},{"name":"Alert","sourcePath":"components/feedback/Alert.jsx"},{"name":"Dialog","sourcePath":"components/feedback/Dialog.jsx"},{"name":"ProgressMeter","sourcePath":"components/feedback/ProgressMeter.jsx"},{"name":"Checkbox","sourcePath":"components/forms/Checkbox.jsx"},{"name":"Input","sourcePath":"components/forms/Input.jsx"},{"name":"Radio","sourcePath":"components/forms/Radio.jsx"},{"name":"Select","sourcePath":"components/forms/Select.jsx"},{"name":"Switch","sourcePath":"components/forms/Switch.jsx"},{"name":"Textarea","sourcePath":"components/forms/Textarea.jsx"},{"name":"NavBar","sourcePath":"components/navigation/NavBar.jsx"},{"name":"SideNav","sourcePath":"components/navigation/SideNav.jsx"},{"name":"Tabs","sourcePath":"components/navigation/Tabs.jsx"}],"sourceHashes":{"components/brand/Filament.jsx":"1decb478b54f","components/brand/Logo.jsx":"9ecef49fcb32","components/brand/SynapseField.jsx":"b66cbae44fad","components/core/Badge.jsx":"fef556394173","components/core/Button.jsx":"7e630451afa1","components/core/Card.jsx":"d7f4d26f214a","components/core/Eyebrow.jsx":"746caa0e1939","components/core/IconButton.jsx":"e75d57018c8a","components/data/DataTable.jsx":"2a94fc5230bf","components/data/StatBlock.jsx":"2a4a92884c31","components/data/Timeline.jsx":"343dcfbc1e8a","components/feedback/Alert.jsx":"ef348b606b7c","components/feedback/Dialog.jsx":"3c53c733a3b3","components/feedback/ProgressMeter.jsx":"dbacedfa8bb5","components/forms/Checkbox.jsx":"b333c32be315","components/forms/Input.jsx":"acbedd91590a","components/forms/Radio.jsx":"d9360fcd5d73","components/forms/Select.jsx":"66119373a911","components/forms/Switch.jsx":"7a4041e24940","components/forms/Textarea.jsx":"03e63c031154","components/navigation/NavBar.jsx":"5d100610ca8b","components/navigation/SideNav.jsx":"038cb3279f55","components/navigation/Tabs.jsx":"98b66f1ccbb3","ui_kits/portal/ChartDetail.jsx":"fc5ccafe1f44","ui_kits/portal/ChartQueue.jsx":"b40972cd7a4e","ui_kits/portal/Dashboard.jsx":"496bd582c196","ui_kits/portal/PortalShell.jsx":"e6fd4a5e1e4c","ui_kits/website/Home.jsx":"adfad896bc86","ui_kits/website/Program.jsx":"24f0a5b76f00","ui_kits/website/Referral.jsx":"b98113e56fa9","ui_kits/website/Shell.jsx":"8128d4078584"},"inlinedExternals":[],"unexposedExports":[]} */

(() => {

const __ds_ns = (window.CharmEdMindsDesignSystem_3ab9ff = window.CharmEdMindsDesignSystem_3ab9ff || {});

const __ds_scope = {};

(__ds_ns.__errors = __ds_ns.__errors || []);

// components/brand/Filament.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function Filament({
  orientation = "horizontal",
  animated = true,
  thickness = 2,
  length = "100%",
  style,
  ...rest
}) {
  const horizontal = orientation === "horizontal";
  return /*#__PURE__*/React.createElement("div", _extends({
    "aria-hidden": "true",
    style: {
      width: horizontal ? length : thickness,
      height: horizontal ? thickness : length,
      borderRadius: 999,
      backgroundImage: "linear-gradient(" + (horizontal ? "90deg" : "180deg") + ",rgba(31,153,162,0) 0%,var(--teal-400) 22%,var(--gold-500) 62%,rgba(240,168,40,0) 100%)",
      backgroundSize: horizontal ? "200% 100%" : "100% 200%",
      animation: animated ? "charmed-travel var(--dur-signal) linear infinite" : "none",
      opacity: 0.9,
      ...style
    }
  }, rest));
}
Object.assign(__ds_scope, { Filament });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/brand/Filament.jsx", error: String((e && e.message) || e) }); }

// components/brand/Logo.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function Logo({
  variant = "lockup",
  size = 120,
  showTagline = false,
  src = "assets/logo-lockup.png",
  style,
  ...rest
}) {
  if (variant === "image") {
    return /*#__PURE__*/React.createElement("img", _extends({
      src: src,
      alt: "CharmEd Minds",
      style: {
        width: size,
        display: "block",
        borderRadius: "var(--radius-md)",
        ...style
      }
    }, rest));
  }
  const stacked = variant === "stacked";
  return /*#__PURE__*/React.createElement("div", _extends({
    style: {
      display: "inline-flex",
      flexDirection: "column",
      gap: showTagline ? "var(--sp-3)" : 0,
      ...style
    }
  }, rest), /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: "var(--font-display)",
      fontWeight: "var(--fw-thin)",
      textTransform: "uppercase",
      letterSpacing: "var(--ls-lockup)",
      color: "var(--text-display)",
      fontSize: size / (stacked ? 7 : 11),
      lineHeight: 1.25,
      display: stacked ? "block" : "flex",
      gap: "0.34em",
      whiteSpace: stacked ? "normal" : "nowrap"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      display: stacked ? "block" : "inline"
    }
  }, "Charmed"), /*#__PURE__*/React.createElement("span", {
    style: {
      display: stacked ? "block" : "inline"
    }
  }, "Minds")), showTagline && /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: "var(--font-display)",
      fontSize: 10,
      fontWeight: "var(--fw-semibold)",
      letterSpacing: "var(--ls-eyebrow)",
      textTransform: "uppercase",
      color: "var(--accent-primary)"
    }
  }, "Understand the brain. Build the strategy. Grow the confidence."));
}
Object.assign(__ds_scope, { Logo });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/brand/Logo.jsx", error: String((e && e.message) || e) }); }

// components/brand/SynapseField.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function SynapseField({
  children,
  intensity = "medium",
  grid = true,
  style,
  ...rest
}) {
  const alpha = {
    low: 0.5,
    medium: 1,
    high: 1.5
  }[intensity] || 1;
  return /*#__PURE__*/React.createElement("div", _extends({
    style: {
      position: "relative",
      isolation: "isolate",
      background: "var(--surface-base)",
      overflow: "hidden",
      ...style
    }
  }, rest), /*#__PURE__*/React.createElement("div", {
    "aria-hidden": "true",
    style: {
      position: "absolute",
      inset: 0,
      zIndex: 0,
      backgroundImage: "var(--gradient-synapse)",
      opacity: alpha
    }
  }), grid && /*#__PURE__*/React.createElement("div", {
    "aria-hidden": "true",
    style: {
      position: "absolute",
      inset: 0,
      zIndex: 0,
      opacity: 0.5,
      backgroundImage: "linear-gradient(rgba(254,252,247,.045) 1px,transparent 1px),linear-gradient(90deg,rgba(254,252,247,.045) 1px,transparent 1px)",
      backgroundSize: "64px 64px",
      maskImage: "radial-gradient(120% 90% at 50% 0%,#000 20%,transparent 80%)",
      WebkitMaskImage: "radial-gradient(120% 90% at 50% 0%,#000 20%,transparent 80%)"
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      position: "relative",
      zIndex: 1
    }
  }, children));
}
Object.assign(__ds_scope, { SynapseField });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/brand/SynapseField.jsx", error: String((e && e.message) || e) }); }

// components/core/Badge.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const tones = {
  gold: {
    color: "var(--gold-400)",
    border: "rgba(240,168,40,.45)",
    bg: "rgba(240,168,40,.12)"
  },
  teal: {
    color: "var(--teal-300)",
    border: "rgba(31,153,162,.45)",
    bg: "rgba(31,153,162,.14)"
  },
  neutral: {
    color: "var(--text-muted)",
    border: "var(--border-hairline)",
    bg: "rgba(254,252,247,.05)"
  },
  success: {
    color: "#7fe0b6",
    border: "rgba(58,166,117,.45)",
    bg: "rgba(58,166,117,.14)"
  },
  alert: {
    color: "#ff9b9e",
    border: "rgba(229,72,77,.45)",
    bg: "rgba(229,72,77,.14)"
  }
};
function Badge({
  children,
  tone = "neutral",
  dot = false,
  style,
  ...rest
}) {
  const t = tones[tone] || tones.neutral;
  return /*#__PURE__*/React.createElement("span", _extends({
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: "var(--sp-2)",
      padding: "5px 12px",
      borderRadius: "var(--radius-pill)",
      background: t.bg,
      border: "1px solid " + t.border,
      color: t.color,
      fontFamily: "var(--font-display)",
      fontSize: "var(--fs-eyebrow)",
      fontWeight: "var(--fw-semibold)",
      letterSpacing: "var(--ls-caps)",
      textTransform: "uppercase",
      ...style
    }
  }, rest), dot && /*#__PURE__*/React.createElement("span", {
    style: {
      width: 6,
      height: 6,
      borderRadius: 999,
      background: "currentColor",
      boxShadow: "0 0 8px currentColor"
    }
  }), children);
}
Object.assign(__ds_scope, { Badge });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Badge.jsx", error: String((e && e.message) || e) }); }

// components/core/Button.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const sizes = {
  sm: {
    height: "var(--control-h-sm)",
    padding: "0 16px",
    fontSize: "var(--fs-sm)"
  },
  md: {
    height: "var(--control-h-md)",
    padding: "0 24px",
    fontSize: "var(--fs-body)"
  },
  lg: {
    height: "var(--control-h-lg)",
    padding: "0 34px",
    fontSize: "var(--fs-lead)"
  }
};
const variants = {
  primary: {
    background: "var(--accent-primary)",
    color: "var(--navy-900)",
    border: "1px solid transparent",
    boxShadow: "var(--glow-gold-sm)"
  },
  secondary: {
    background: "transparent",
    color: "var(--teal-300)",
    border: "1px solid rgba(31,153,162,.55)",
    boxShadow: "none"
  },
  ghost: {
    background: "transparent",
    color: "var(--text-body)",
    border: "1px solid transparent",
    boxShadow: "none"
  },
  onLight: {
    background: "var(--navy-800)",
    color: "var(--cream-100)",
    border: "1px solid transparent",
    boxShadow: "var(--shadow-sm)"
  }
};
function Button({
  children,
  variant = "primary",
  size = "md",
  disabled = false,
  fullWidth = false,
  iconLeft = null,
  iconRight = null,
  onClick,
  type = "button",
  style,
  ...rest
}) {
  const [hover, setHover] = React.useState(false);
  const [press, setPress] = React.useState(false);
  const v = variants[variant] || variants.primary;
  const s = sizes[size] || sizes.md;
  const hoverStyle = !disabled && hover ? variant === "primary" ? {
    background: "var(--gold-400)",
    boxShadow: "var(--glow-gold-lg)"
  } : variant === "secondary" ? {
    background: "rgba(31,153,162,.14)",
    boxShadow: "var(--glow-teal-sm)",
    color: "var(--teal-200)"
  } : variant === "ghost" ? {
    background: "rgba(254,252,247,.07)",
    color: "var(--text-display)"
  } : {
    background: "var(--navy-700)"
  } : null;
  return /*#__PURE__*/React.createElement("button", _extends({
    type: type,
    disabled: disabled,
    onClick: onClick,
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => {
      setHover(false);
      setPress(false);
    },
    onMouseDown: () => setPress(true),
    onMouseUp: () => setPress(false),
    style: {
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      gap: "var(--sp-2)",
      width: fullWidth ? "100%" : undefined,
      fontFamily: "var(--font-display)",
      fontWeight: "var(--fw-semibold)",
      letterSpacing: "var(--ls-caps)",
      textTransform: "uppercase",
      borderRadius: "var(--radius-pill)",
      cursor: disabled ? "not-allowed" : "pointer",
      opacity: disabled ? 0.4 : 1,
      transition: "background var(--dur-fast) var(--ease-standard),box-shadow var(--dur-base) var(--ease-standard),transform var(--dur-instant) var(--ease-standard),color var(--dur-fast) var(--ease-standard)",
      transform: press && !disabled ? "translateY(1px) scale(.985)" : "none",
      ...s,
      ...v,
      ...hoverStyle,
      ...style
    }
  }, rest), iconLeft, children, iconRight);
}
Object.assign(__ds_scope, { Button });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Button.jsx", error: String((e && e.message) || e) }); }

// components/core/Card.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function Card({
  children,
  tone = "default",
  glow = "none",
  padding = "var(--sp-6)",
  interactive = false,
  onClick,
  style,
  ...rest
}) {
  const [hover, setHover] = React.useState(false);
  const tones = {
    default: {
      background: "var(--surface-card)",
      border: "1px solid var(--border-hairline)",
      color: "var(--text-body)"
    },
    raised: {
      background: "var(--surface-raised)",
      border: "1px solid var(--border-hairline)",
      color: "var(--text-body)",
      boxShadow: "var(--shadow-md)"
    },
    light: {
      background: "var(--surface-light)",
      border: "1px solid var(--border-on-light)",
      color: "var(--text-on-light)"
    },
    inset: {
      background: "var(--surface-inset)",
      border: "1px solid var(--border-hairline)",
      color: "var(--text-body)"
    }
  };
  const glows = {
    none: null,
    teal: "var(--glow-teal-sm)",
    gold: "var(--glow-gold-sm)"
  };
  const t = tones[tone] || tones.default;
  return /*#__PURE__*/React.createElement("div", _extends({
    onClick: onClick,
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    style: {
      position: "relative",
      borderRadius: "var(--radius-lg)",
      padding,
      cursor: interactive ? "pointer" : undefined,
      transition: "background var(--dur-base) var(--ease-standard),box-shadow var(--dur-base) var(--ease-standard),transform var(--dur-base) var(--ease-out)",
      ...t,
      boxShadow: [t.boxShadow, glows[glow]].filter(Boolean).join(",") || undefined,
      ...(interactive && hover ? {
        background: tone === "light" ? "var(--cream-200)" : "var(--surface-card-hover)",
        transform: "translateY(-2px)",
        boxShadow: [t.boxShadow, glows[glow] || "var(--glow-teal-sm)"].filter(Boolean).join(",")
      } : null),
      ...style
    }
  }, rest), children);
}
Object.assign(__ds_scope, { Card });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Card.jsx", error: String((e && e.message) || e) }); }

// components/core/Eyebrow.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function Eyebrow({
  children,
  tone = "gold",
  style,
  ...rest
}) {
  return /*#__PURE__*/React.createElement("div", _extends({
    style: {
      display: "flex",
      alignItems: "center",
      gap: "var(--sp-3)",
      fontFamily: "var(--font-display)",
      fontSize: "var(--fs-eyebrow)",
      fontWeight: "var(--fw-semibold)",
      letterSpacing: "var(--ls-eyebrow)",
      textTransform: "uppercase",
      color: tone === "teal" ? "var(--teal-300)" : tone === "muted" ? "var(--text-muted)" : "var(--accent-primary)",
      ...style
    }
  }, rest), /*#__PURE__*/React.createElement("span", {
    style: {
      width: 26,
      height: 1,
      background: "currentColor",
      opacity: 0.6
    }
  }), children);
}
Object.assign(__ds_scope, { Eyebrow });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Eyebrow.jsx", error: String((e && e.message) || e) }); }

// components/core/IconButton.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function IconButton({
  icon,
  label,
  size = "md",
  variant = "ghost",
  onClick,
  style,
  ...rest
}) {
  const [hover, setHover] = React.useState(false);
  const dim = size === "sm" ? 34 : size === "lg" ? 54 : 44;
  const bg = variant === "solid" ? "rgba(254,252,247,.08)" : "transparent";
  return /*#__PURE__*/React.createElement("button", _extends({
    type: "button",
    "aria-label": label,
    title: label,
    onClick: onClick,
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    style: {
      width: dim,
      height: dim,
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      borderRadius: "var(--radius-pill)",
      cursor: "pointer",
      border: "1px solid " + (variant === "outline" ? "var(--border-hairline)" : "transparent"),
      background: hover ? "rgba(254,252,247,.10)" : bg,
      color: hover ? "var(--teal-300)" : "var(--text-body)",
      transition: "background var(--dur-fast) var(--ease-standard),color var(--dur-fast) var(--ease-standard)",
      ...style
    }
  }, rest), icon);
}
Object.assign(__ds_scope, { IconButton });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/IconButton.jsx", error: String((e && e.message) || e) }); }

// components/data/DataTable.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function DataTable({
  columns = [],
  rows = [],
  onRowClick,
  dense = false,
  style,
  ...rest
}) {
  const [hover, setHover] = React.useState(-1);
  const pad = dense ? "10px 14px" : "16px 18px";
  return /*#__PURE__*/React.createElement("div", _extends({
    style: {
      border: "1px solid var(--border-hairline)",
      borderRadius: "var(--radius-md)",
      overflow: "hidden",
      ...style
    }
  }, rest), /*#__PURE__*/React.createElement("table", {
    style: {
      width: "100%",
      borderCollapse: "collapse",
      fontSize: "var(--fs-sm)"
    }
  }, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", null, columns.map(c => /*#__PURE__*/React.createElement("th", {
    key: c.key,
    style: {
      textAlign: c.align || "left",
      padding: pad,
      background: "rgba(2,9,28,.5)",
      borderBottom: "1px solid var(--border-hairline)",
      fontFamily: "var(--font-display)",
      fontSize: "var(--fs-xs)",
      fontWeight: "var(--fw-semibold)",
      letterSpacing: "var(--ls-caps)",
      textTransform: "uppercase",
      color: "var(--text-muted)",
      whiteSpace: "nowrap"
    }
  }, c.label)))), /*#__PURE__*/React.createElement("tbody", null, rows.map((r, i) => /*#__PURE__*/React.createElement("tr", {
    key: r.id || i,
    onClick: () => onRowClick && onRowClick(r),
    onMouseEnter: () => setHover(i),
    onMouseLeave: () => setHover(-1),
    style: {
      cursor: onRowClick ? "pointer" : undefined,
      background: hover === i ? "rgba(254,252,247,.05)" : "transparent",
      transition: "background var(--dur-fast) var(--ease-standard)"
    }
  }, columns.map(c => /*#__PURE__*/React.createElement("td", {
    key: c.key,
    style: {
      textAlign: c.align || "left",
      padding: pad,
      borderBottom: "1px solid rgba(254,252,247,.07)",
      color: "var(--text-body)",
      fontFamily: c.mono ? "var(--font-mono)" : "var(--font-body)"
    }
  }, c.render ? c.render(r) : r[c.key])))))));
}
Object.assign(__ds_scope, { DataTable });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/data/DataTable.jsx", error: String((e && e.message) || e) }); }

// components/data/StatBlock.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function StatBlock({
  value,
  label,
  caption,
  tone = "gold",
  align = "left",
  style,
  ...rest
}) {
  const color = tone === "teal" ? "var(--teal-300)" : tone === "plain" ? "var(--text-display)" : "var(--gold-500)";
  return /*#__PURE__*/React.createElement("div", _extends({
    style: {
      textAlign: align,
      ...style
    }
  }, rest), /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: "var(--font-display)",
      fontWeight: "var(--fw-thin)",
      fontSize: "var(--fs-h1)",
      lineHeight: "var(--lh-tight)",
      letterSpacing: "var(--ls-display)",
      color
    }
  }, value), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: "var(--sp-2)",
      fontFamily: "var(--font-display)",
      fontSize: "var(--fs-xs)",
      fontWeight: "var(--fw-semibold)",
      letterSpacing: "var(--ls-caps)",
      textTransform: "uppercase",
      color: "var(--text-display)"
    }
  }, label), caption && /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: "var(--sp-1)",
      fontSize: "var(--fs-xs)",
      color: "var(--text-muted)"
    }
  }, caption));
}
Object.assign(__ds_scope, { StatBlock });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/data/StatBlock.jsx", error: String((e && e.message) || e) }); }

// components/data/Timeline.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function Timeline({
  items = [],
  style,
  ...rest
}) {
  return /*#__PURE__*/React.createElement("ol", _extends({
    style: {
      listStyle: "none",
      margin: 0,
      padding: 0,
      position: "relative",
      ...style
    }
  }, rest), items.map((it, i) => {
    const done = it.state === "done";
    const now = it.state === "current";
    return /*#__PURE__*/React.createElement("li", {
      key: i,
      style: {
        display: "flex",
        gap: "var(--sp-4)",
        paddingBottom: i === items.length - 1 ? 0 : "var(--sp-6)"
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        flex: "0 0 auto"
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        width: 12,
        height: 12,
        borderRadius: 999,
        background: now ? "var(--gold-500)" : done ? "var(--teal-500)" : "transparent",
        border: "1px solid " + (now ? "var(--gold-400)" : done ? "var(--teal-400)" : "var(--border-strong)"),
        boxShadow: now ? "var(--glow-gold-sm)" : done ? "var(--glow-teal-sm)" : "none",
        animation: now ? "charmed-pulse 2.4s ease-in-out infinite" : "none"
      }
    }), i < items.length - 1 && /*#__PURE__*/React.createElement("span", {
      style: {
        flex: 1,
        width: 1,
        background: "var(--border-hairline)",
        marginTop: 4
      }
    })), /*#__PURE__*/React.createElement("div", {
      style: {
        paddingTop: 0
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontFamily: "var(--font-display)",
        fontSize: "var(--fs-sm)",
        fontWeight: "var(--fw-semibold)",
        letterSpacing: "var(--ls-caps)",
        textTransform: "uppercase",
        color: now ? "var(--gold-400)" : "var(--text-display)"
      }
    }, it.title), it.meta && /*#__PURE__*/React.createElement("div", {
      style: {
        fontFamily: "var(--font-mono)",
        fontSize: "var(--fs-xs)",
        color: "var(--text-muted)",
        marginTop: 2
      }
    }, it.meta), it.body && /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: "var(--fs-sm)",
        color: "var(--text-body)",
        marginTop: 6,
        maxWidth: "56ch"
      }
    }, it.body)));
  }));
}
Object.assign(__ds_scope, { Timeline });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/data/Timeline.jsx", error: String((e && e.message) || e) }); }

// components/feedback/Alert.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const tones = {
  info: {
    color: "var(--teal-300)",
    border: "rgba(31,153,162,.45)",
    bg: "rgba(31,153,162,.10)"
  },
  success: {
    color: "#7fe0b6",
    border: "rgba(58,166,117,.45)",
    bg: "rgba(58,166,117,.10)"
  },
  warning: {
    color: "var(--gold-400)",
    border: "rgba(240,168,40,.45)",
    bg: "rgba(240,168,40,.10)"
  },
  danger: {
    color: "#ff9b9e",
    border: "rgba(229,72,77,.45)",
    bg: "rgba(229,72,77,.10)"
  }
};
function Alert({
  title,
  children,
  tone = "info",
  icon,
  onDismiss,
  style,
  ...rest
}) {
  const t = tones[tone] || tones.info;
  return /*#__PURE__*/React.createElement("div", _extends({
    role: "status",
    style: {
      display: "flex",
      gap: "var(--sp-4)",
      padding: "var(--sp-4) var(--sp-5)",
      background: t.bg,
      border: "1px solid " + t.border,
      borderRadius: "var(--radius-md)",
      ...style
    }
  }, rest), /*#__PURE__*/React.createElement("span", {
    style: {
      width: 8,
      height: 8,
      borderRadius: 999,
      marginTop: 7,
      background: t.color,
      boxShadow: "0 0 10px " + t.color,
      flex: "0 0 8px"
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }, title && /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: "var(--font-display)",
      fontWeight: "var(--fw-semibold)",
      fontSize: "var(--fs-sm)",
      letterSpacing: "var(--ls-caps)",
      textTransform: "uppercase",
      color: t.color,
      marginBottom: 4
    }
  }, title), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: "var(--fs-sm)",
      color: "var(--text-body)"
    }
  }, children)), icon, onDismiss && /*#__PURE__*/React.createElement("button", {
    onClick: onDismiss,
    "aria-label": "Dismiss",
    style: {
      background: "none",
      border: "none",
      color: "var(--text-muted)",
      cursor: "pointer",
      fontSize: 18,
      lineHeight: 1
    }
  }, "\xD7"));
}
Object.assign(__ds_scope, { Alert });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/Alert.jsx", error: String((e && e.message) || e) }); }

// components/feedback/Dialog.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function Dialog({
  open = true,
  title,
  children,
  footer,
  onClose,
  width = 520,
  style,
  ...rest
}) {
  if (!open) return null;
  return /*#__PURE__*/React.createElement("div", {
    role: "dialog",
    "aria-modal": "true",
    "aria-label": title,
    style: {
      position: "fixed",
      inset: 0,
      zIndex: 60,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: "var(--sp-6)",
      background: "rgba(2,9,28,.72)",
      backdropFilter: "var(--blur-veil)",
      WebkitBackdropFilter: "var(--blur-veil)"
    },
    onClick: onClose
  }, /*#__PURE__*/React.createElement("div", _extends({
    onClick: e => e.stopPropagation(),
    style: {
      width: "100%",
      maxWidth: width,
      background: "var(--navy-700)",
      border: "1px solid var(--border-hairline)",
      borderRadius: "var(--radius-lg)",
      boxShadow: "var(--shadow-lg),var(--glow-teal-sm)",
      overflow: "hidden",
      animation: "charmed-rise var(--dur-base) var(--ease-out)",
      ...style
    }
  }, rest), /*#__PURE__*/React.createElement("div", {
    style: {
      height: 2,
      background: "var(--gradient-filament)"
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "var(--sp-6)"
    }
  }, title && /*#__PURE__*/React.createElement("h3", {
    style: {
      fontFamily: "var(--font-display)",
      fontWeight: "var(--fw-light)",
      fontSize: "var(--fs-h4)",
      color: "var(--text-display)",
      margin: "0 0 var(--sp-3)"
    }
  }, title), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: "var(--fs-sm)",
      color: "var(--text-body)"
    }
  }, children)), footer && /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "flex-end",
      gap: "var(--sp-3)",
      padding: "var(--sp-4) var(--sp-6)",
      borderTop: "1px solid var(--border-hairline)"
    }
  }, footer)));
}
Object.assign(__ds_scope, { Dialog });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/Dialog.jsx", error: String((e && e.message) || e) }); }

// components/feedback/ProgressMeter.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function ProgressMeter({
  value = 0,
  label,
  caption,
  showValue = true,
  tone = "filament",
  style,
  ...rest
}) {
  const pct = Math.max(0, Math.min(100, value));
  const fill = tone === "teal" ? "var(--teal-500)" : tone === "gold" ? "var(--gold-500)" : "var(--gradient-filament)";
  return /*#__PURE__*/React.createElement("div", _extends({
    style: style
  }, rest), (label || showValue) && /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "baseline",
      marginBottom: "var(--sp-2)"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--font-display)",
      fontSize: "var(--fs-xs)",
      letterSpacing: "var(--ls-caps)",
      textTransform: "uppercase",
      color: "var(--text-muted)"
    }
  }, label), showValue && /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--font-mono)",
      fontSize: "var(--fs-sm)",
      color: "var(--text-display)"
    }
  }, pct, "%")), /*#__PURE__*/React.createElement("div", {
    style: {
      height: 6,
      borderRadius: 999,
      background: "rgba(254,252,247,.08)",
      overflow: "hidden"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: pct + "%",
      height: "100%",
      borderRadius: 999,
      background: fill,
      boxShadow: "var(--glow-teal-sm)",
      transition: "width var(--dur-slow) var(--ease-out)"
    }
  })), caption && /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: "var(--sp-2)",
      fontSize: "var(--fs-xs)",
      color: "var(--text-muted)"
    }
  }, caption));
}
Object.assign(__ds_scope, { ProgressMeter });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/ProgressMeter.jsx", error: String((e && e.message) || e) }); }

// components/forms/Checkbox.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function Checkbox({
  label,
  description,
  checked,
  defaultChecked,
  onChange,
  disabled,
  style,
  ...rest
}) {
  const [internal, setInternal] = React.useState(!!defaultChecked);
  const isOn = checked === undefined ? internal : checked;
  return /*#__PURE__*/React.createElement("label", {
    style: {
      display: "flex",
      gap: "var(--sp-3)",
      alignItems: "flex-start",
      cursor: disabled ? "not-allowed" : "pointer",
      opacity: disabled ? 0.45 : 1,
      ...style
    }
  }, /*#__PURE__*/React.createElement("input", _extends({
    type: "checkbox",
    checked: isOn,
    disabled: disabled,
    onChange: e => {
      if (checked === undefined) setInternal(e.target.checked);
      onChange && onChange(e);
    },
    style: {
      position: "absolute",
      opacity: 0,
      width: 0,
      height: 0
    }
  }, rest)), /*#__PURE__*/React.createElement("span", {
    "aria-hidden": "true",
    style: {
      width: 20,
      height: 20,
      flex: "0 0 20px",
      marginTop: 2,
      borderRadius: "var(--radius-xs)",
      border: "1px solid " + (isOn ? "var(--teal-400)" : "var(--border-strong)"),
      background: isOn ? "var(--teal-500)" : "var(--surface-inset)",
      boxShadow: isOn ? "var(--glow-teal-sm)" : "none",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      transition: "all var(--dur-fast) var(--ease-standard)"
    }
  }, isOn && /*#__PURE__*/React.createElement("span", {
    style: {
      width: 5,
      height: 9,
      borderRight: "2px solid var(--navy-900)",
      borderBottom: "2px solid var(--navy-900)",
      transform: "rotate(45deg) translate(-1px,-1px)"
    }
  })), /*#__PURE__*/React.createElement("span", null, /*#__PURE__*/React.createElement("span", {
    style: {
      display: "block",
      color: "var(--text-display)",
      fontSize: "var(--fs-sm)"
    }
  }, label), description && /*#__PURE__*/React.createElement("span", {
    style: {
      display: "block",
      color: "var(--text-muted)",
      fontSize: "var(--fs-xs)"
    }
  }, description)));
}
Object.assign(__ds_scope, { Checkbox });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Checkbox.jsx", error: String((e && e.message) || e) }); }

// components/forms/Input.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function Input({
  label,
  hint,
  error,
  type = "text",
  value,
  defaultValue,
  onChange,
  placeholder,
  iconLeft,
  disabled,
  id,
  style,
  ...rest
}) {
  const [focus, setFocus] = React.useState(false);
  const inputId = id || React.useId();
  return /*#__PURE__*/React.createElement("label", {
    htmlFor: inputId,
    style: {
      display: "block",
      ...style
    }
  }, label && /*#__PURE__*/React.createElement("span", {
    style: {
      display: "block",
      marginBottom: "var(--sp-2)",
      fontFamily: "var(--font-display)",
      fontSize: "var(--fs-xs)",
      fontWeight: "var(--fw-semibold)",
      letterSpacing: "var(--ls-caps)",
      textTransform: "uppercase",
      color: "var(--text-muted)"
    }
  }, label), /*#__PURE__*/React.createElement("span", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: "var(--sp-3)",
      height: "var(--control-h-md)",
      padding: "0 16px",
      background: "var(--surface-inset)",
      border: "1px solid " + (error ? "rgba(229,72,77,.7)" : focus ? "var(--teal-400)" : "var(--border-hairline)"),
      borderRadius: "var(--radius-sm)",
      boxShadow: focus ? "var(--glow-teal-sm)" : "none",
      transition: "border-color var(--dur-fast) var(--ease-standard),box-shadow var(--dur-base) var(--ease-standard)",
      opacity: disabled ? 0.45 : 1
    }
  }, iconLeft && /*#__PURE__*/React.createElement("span", {
    style: {
      color: "var(--text-muted)",
      display: "flex"
    }
  }, iconLeft), /*#__PURE__*/React.createElement("input", _extends({
    id: inputId,
    type: type,
    value: value,
    defaultValue: defaultValue,
    onChange: onChange,
    placeholder: placeholder,
    disabled: disabled,
    onFocus: () => setFocus(true),
    onBlur: () => setFocus(false),
    style: {
      flex: 1,
      minWidth: 0,
      background: "transparent",
      border: "none",
      outline: "none",
      color: "var(--text-display)",
      fontFamily: "var(--font-body)",
      fontSize: "var(--fs-body)"
    }
  }, rest))), (hint || error) && /*#__PURE__*/React.createElement("span", {
    style: {
      display: "block",
      marginTop: "var(--sp-2)",
      fontSize: "var(--fs-xs)",
      color: error ? "#ff9b9e" : "var(--text-muted)"
    }
  }, error || hint));
}
Object.assign(__ds_scope, { Input });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Input.jsx", error: String((e && e.message) || e) }); }

// components/forms/Radio.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function Radio({
  label,
  description,
  name,
  value,
  checked,
  onChange,
  disabled,
  style,
  ...rest
}) {
  return /*#__PURE__*/React.createElement("label", {
    style: {
      display: "flex",
      gap: "var(--sp-3)",
      alignItems: "flex-start",
      cursor: disabled ? "not-allowed" : "pointer",
      opacity: disabled ? 0.45 : 1,
      ...style
    }
  }, /*#__PURE__*/React.createElement("input", _extends({
    type: "radio",
    name: name,
    value: value,
    checked: checked,
    onChange: onChange,
    disabled: disabled,
    style: {
      position: "absolute",
      opacity: 0,
      width: 0,
      height: 0
    }
  }, rest)), /*#__PURE__*/React.createElement("span", {
    "aria-hidden": "true",
    style: {
      width: 20,
      height: 20,
      flex: "0 0 20px",
      marginTop: 2,
      borderRadius: 999,
      border: "1px solid " + (checked ? "var(--teal-400)" : "var(--border-strong)"),
      background: "var(--surface-inset)",
      boxShadow: checked ? "var(--glow-teal-sm)" : "none",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      transition: "all var(--dur-fast) var(--ease-standard)"
    }
  }, checked && /*#__PURE__*/React.createElement("span", {
    style: {
      width: 9,
      height: 9,
      borderRadius: 999,
      background: "var(--teal-400)"
    }
  })), /*#__PURE__*/React.createElement("span", null, /*#__PURE__*/React.createElement("span", {
    style: {
      display: "block",
      color: "var(--text-display)",
      fontSize: "var(--fs-sm)"
    }
  }, label), description && /*#__PURE__*/React.createElement("span", {
    style: {
      display: "block",
      color: "var(--text-muted)",
      fontSize: "var(--fs-xs)"
    }
  }, description)));
}
Object.assign(__ds_scope, { Radio });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Radio.jsx", error: String((e && e.message) || e) }); }

// components/forms/Select.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function Select({
  label,
  options = [],
  value,
  onChange,
  disabled,
  id,
  style,
  ...rest
}) {
  const [focus, setFocus] = React.useState(false);
  const sId = id || React.useId();
  return /*#__PURE__*/React.createElement("label", {
    htmlFor: sId,
    style: {
      display: "block",
      ...style
    }
  }, label && /*#__PURE__*/React.createElement("span", {
    style: {
      display: "block",
      marginBottom: "var(--sp-2)",
      fontFamily: "var(--font-display)",
      fontSize: "var(--fs-xs)",
      fontWeight: "var(--fw-semibold)",
      letterSpacing: "var(--ls-caps)",
      textTransform: "uppercase",
      color: "var(--text-muted)"
    }
  }, label), /*#__PURE__*/React.createElement("div", {
    style: {
      position: "relative"
    }
  }, /*#__PURE__*/React.createElement("select", _extends({
    id: sId,
    value: value,
    onChange: onChange,
    disabled: disabled,
    onFocus: () => setFocus(true),
    onBlur: () => setFocus(false),
    style: {
      width: "100%",
      height: "var(--control-h-md)",
      padding: "0 40px 0 16px",
      appearance: "none",
      background: "var(--surface-inset)",
      color: "var(--text-display)",
      border: "1px solid " + (focus ? "var(--teal-400)" : "var(--border-hairline)"),
      boxShadow: focus ? "var(--glow-teal-sm)" : "none",
      borderRadius: "var(--radius-sm)",
      outline: "none",
      fontFamily: "var(--font-body)",
      fontSize: "var(--fs-body)",
      opacity: disabled ? 0.45 : 1,
      transition: "border-color var(--dur-fast) var(--ease-standard),box-shadow var(--dur-base) var(--ease-standard)"
    }
  }, rest), options.map(o => {
    const opt = typeof o === "string" ? {
      value: o,
      label: o
    } : o;
    return /*#__PURE__*/React.createElement("option", {
      key: opt.value,
      value: opt.value,
      style: {
        background: "var(--navy-700)"
      }
    }, opt.label);
  })), /*#__PURE__*/React.createElement("span", {
    "aria-hidden": "true",
    style: {
      position: "absolute",
      right: 16,
      top: "50%",
      transform: "translateY(-60%) rotate(45deg)",
      width: 7,
      height: 7,
      borderRight: "1.5px solid var(--teal-300)",
      borderBottom: "1.5px solid var(--teal-300)",
      pointerEvents: "none"
    }
  })));
}
Object.assign(__ds_scope, { Select });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Select.jsx", error: String((e && e.message) || e) }); }

// components/forms/Switch.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function Switch({
  label,
  checked,
  defaultChecked,
  onChange,
  disabled,
  style,
  ...rest
}) {
  const [internal, setInternal] = React.useState(!!defaultChecked);
  const isOn = checked === undefined ? internal : checked;
  return /*#__PURE__*/React.createElement("label", {
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: "var(--sp-3)",
      cursor: disabled ? "not-allowed" : "pointer",
      opacity: disabled ? 0.45 : 1,
      ...style
    }
  }, /*#__PURE__*/React.createElement("input", _extends({
    type: "checkbox",
    role: "switch",
    checked: isOn,
    disabled: disabled,
    onChange: e => {
      if (checked === undefined) setInternal(e.target.checked);
      onChange && onChange(e);
    },
    style: {
      position: "absolute",
      opacity: 0,
      width: 0,
      height: 0
    }
  }, rest)), /*#__PURE__*/React.createElement("span", {
    "aria-hidden": "true",
    style: {
      width: 46,
      height: 26,
      borderRadius: 999,
      padding: 3,
      boxSizing: "border-box",
      background: isOn ? "var(--teal-500)" : "rgba(254,252,247,.10)",
      border: "1px solid " + (isOn ? "var(--teal-400)" : "var(--border-hairline)"),
      boxShadow: isOn ? "var(--glow-teal-sm)" : "none",
      display: "flex",
      justifyContent: isOn ? "flex-end" : "flex-start",
      transition: "all var(--dur-base) var(--ease-standard)"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 18,
      height: 18,
      borderRadius: 999,
      background: isOn ? "var(--navy-900)" : "var(--text-muted)",
      transition: "all var(--dur-base) var(--ease-out)"
    }
  })), label && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: "var(--fs-sm)",
      color: "var(--text-body)"
    }
  }, label));
}
Object.assign(__ds_scope, { Switch });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Switch.jsx", error: String((e && e.message) || e) }); }

// components/forms/Textarea.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function Textarea({
  label,
  hint,
  rows = 4,
  value,
  defaultValue,
  onChange,
  placeholder,
  disabled,
  id,
  style,
  ...rest
}) {
  const [focus, setFocus] = React.useState(false);
  const tId = id || React.useId();
  return /*#__PURE__*/React.createElement("label", {
    htmlFor: tId,
    style: {
      display: "block",
      ...style
    }
  }, label && /*#__PURE__*/React.createElement("span", {
    style: {
      display: "block",
      marginBottom: "var(--sp-2)",
      fontFamily: "var(--font-display)",
      fontSize: "var(--fs-xs)",
      fontWeight: "var(--fw-semibold)",
      letterSpacing: "var(--ls-caps)",
      textTransform: "uppercase",
      color: "var(--text-muted)"
    }
  }, label), /*#__PURE__*/React.createElement("textarea", _extends({
    id: tId,
    rows: rows,
    value: value,
    defaultValue: defaultValue,
    onChange: onChange,
    placeholder: placeholder,
    disabled: disabled,
    onFocus: () => setFocus(true),
    onBlur: () => setFocus(false),
    style: {
      width: "100%",
      boxSizing: "border-box",
      padding: "12px 16px",
      resize: "vertical",
      background: "var(--surface-inset)",
      color: "var(--text-display)",
      border: "1px solid " + (focus ? "var(--teal-400)" : "var(--border-hairline)"),
      boxShadow: focus ? "var(--glow-teal-sm)" : "none",
      borderRadius: "var(--radius-sm)",
      outline: "none",
      fontFamily: "var(--font-body)",
      fontSize: "var(--fs-body)",
      lineHeight: "var(--lh-body)",
      transition: "border-color var(--dur-fast) var(--ease-standard),box-shadow var(--dur-base) var(--ease-standard)",
      opacity: disabled ? 0.45 : 1
    }
  }, rest)), hint && /*#__PURE__*/React.createElement("span", {
    style: {
      display: "block",
      marginTop: "var(--sp-2)",
      fontSize: "var(--fs-xs)",
      color: "var(--text-muted)"
    }
  }, hint));
}
Object.assign(__ds_scope, { Textarea });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Textarea.jsx", error: String((e && e.message) || e) }); }

// components/navigation/NavBar.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function NavBar({
  links = [],
  active,
  action,
  onNavigate,
  transparent = true,
  style,
  ...rest
}) {
  return /*#__PURE__*/React.createElement("header", _extends({
    style: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: "var(--sp-8)",
      padding: "18px var(--sp-8)",
      background: transparent ? "rgba(4,18,45,.62)" : "var(--navy-800)",
      backdropFilter: "var(--blur-veil)",
      WebkitBackdropFilter: "var(--blur-veil)",
      borderBottom: "1px solid var(--border-hairline)",
      ...style
    }
  }, rest), /*#__PURE__*/React.createElement(__ds_scope.Logo, {
    variant: "lockup",
    size: 200
  }), /*#__PURE__*/React.createElement("nav", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: "var(--sp-6)"
    }
  }, links.map(raw => {
    const l = typeof raw === "string" ? {
      value: raw,
      label: raw
    } : raw;
    const on = l.value === active;
    return /*#__PURE__*/React.createElement("button", {
      key: l.value,
      onClick: () => onNavigate && onNavigate(l.value),
      style: {
        background: "none",
        border: "none",
        cursor: "pointer",
        padding: "6px 0",
        fontFamily: "var(--font-display)",
        fontSize: "var(--fs-xs)",
        fontWeight: "var(--fw-semibold)",
        letterSpacing: "var(--ls-caps)",
        textTransform: "uppercase",
        color: on ? "var(--gold-400)" : "var(--text-body)",
        borderBottom: "1px solid " + (on ? "var(--gold-500)" : "transparent"),
        transition: "color var(--dur-fast) var(--ease-standard)"
      }
    }, l.label);
  }), action));
}
Object.assign(__ds_scope, { NavBar });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/navigation/NavBar.jsx", error: String((e && e.message) || e) }); }

// components/navigation/SideNav.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function SideNav({
  items = [],
  active,
  onNavigate,
  footer,
  width = 248,
  style,
  ...rest
}) {
  return /*#__PURE__*/React.createElement("aside", _extends({
    style: {
      width,
      flex: "0 0 " + width + "px",
      boxSizing: "border-box",
      display: "flex",
      flexDirection: "column",
      justifyContent: "space-between",
      padding: "var(--sp-6) var(--sp-4)",
      background: "rgba(2,9,28,.45)",
      borderRight: "1px solid var(--border-hairline)",
      ...style
    }
  }, rest), /*#__PURE__*/React.createElement("nav", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 2
    }
  }, items.map(raw => {
    const it = typeof raw === "string" ? {
      value: raw,
      label: raw
    } : raw;
    if (it.section) return /*#__PURE__*/React.createElement("div", {
      key: it.section,
      style: {
        margin: "var(--sp-5) var(--sp-3) var(--sp-2)",
        fontFamily: "var(--font-display)",
        fontSize: 10,
        letterSpacing: "var(--ls-eyebrow)",
        textTransform: "uppercase",
        color: "var(--text-muted)"
      }
    }, it.section);
    const on = it.value === active;
    return /*#__PURE__*/React.createElement("button", {
      key: it.value,
      onClick: () => onNavigate && onNavigate(it.value),
      style: {
        position: "relative",
        textAlign: "left",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        gap: "var(--sp-3)",
        minHeight: 42,
        padding: "0 var(--sp-3)",
        borderRadius: "var(--radius-sm)",
        border: "1px solid " + (on ? "rgba(31,153,162,.35)" : "transparent"),
        background: on ? "rgba(31,153,162,.12)" : "transparent",
        color: on ? "var(--text-display)" : "var(--text-body)",
        fontFamily: "var(--font-body)",
        fontSize: "var(--fs-sm)",
        transition: "background var(--dur-fast) var(--ease-standard),color var(--dur-fast) var(--ease-standard)"
      }
    }, on && /*#__PURE__*/React.createElement("span", {
      style: {
        position: "absolute",
        left: 0,
        top: 10,
        bottom: 10,
        width: 2,
        borderRadius: 999,
        background: "var(--teal-400)",
        boxShadow: "var(--glow-teal-sm)"
      }
    }), it.icon, /*#__PURE__*/React.createElement("span", {
      style: {
        flex: 1
      }
    }, it.label), it.count !== undefined && /*#__PURE__*/React.createElement("span", {
      style: {
        fontFamily: "var(--font-mono)",
        fontSize: "var(--fs-xs)",
        color: "var(--gold-400)"
      }
    }, it.count));
  })), footer);
}
Object.assign(__ds_scope, { SideNav });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/navigation/SideNav.jsx", error: String((e && e.message) || e) }); }

// components/navigation/Tabs.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function Tabs({
  tabs = [],
  value,
  defaultValue,
  onChange,
  style,
  ...rest
}) {
  const first = typeof tabs[0] === "string" ? tabs[0] : tabs[0] && tabs[0].value;
  const [internal, setInternal] = React.useState(defaultValue || first);
  const active = value === undefined ? internal : value;
  return /*#__PURE__*/React.createElement("div", _extends({
    role: "tablist",
    style: {
      display: "flex",
      gap: "var(--sp-6)",
      borderBottom: "1px solid var(--border-hairline)",
      ...style
    }
  }, rest), tabs.map(raw => {
    const t = typeof raw === "string" ? {
      value: raw,
      label: raw
    } : raw;
    const on = t.value === active;
    return /*#__PURE__*/React.createElement("button", {
      key: t.value,
      role: "tab",
      "aria-selected": on,
      onClick: () => {
        if (value === undefined) setInternal(t.value);
        onChange && onChange(t.value);
      },
      style: {
        position: "relative",
        background: "none",
        border: "none",
        cursor: "pointer",
        padding: "0 0 12px",
        display: "flex",
        alignItems: "center",
        gap: "var(--sp-2)",
        fontFamily: "var(--font-display)",
        fontSize: "var(--fs-sm)",
        fontWeight: "var(--fw-semibold)",
        letterSpacing: "var(--ls-caps)",
        textTransform: "uppercase",
        color: on ? "var(--text-display)" : "var(--text-muted)",
        transition: "color var(--dur-fast) var(--ease-standard)"
      }
    }, t.label, t.count !== undefined && /*#__PURE__*/React.createElement("span", {
      style: {
        fontFamily: "var(--font-mono)",
        fontSize: "var(--fs-xs)",
        color: "var(--teal-300)"
      }
    }, t.count), /*#__PURE__*/React.createElement("span", {
      style: {
        position: "absolute",
        left: 0,
        right: 0,
        bottom: -1,
        height: 2,
        borderRadius: 999,
        background: on ? "var(--gradient-filament)" : "transparent",
        boxShadow: on ? "var(--glow-teal-sm)" : "none"
      }
    }));
  }));
}
Object.assign(__ds_scope, { Tabs });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/navigation/Tabs.jsx", error: String((e && e.message) || e) }); }

// ui_kits/portal/ChartDetail.jsx
try { (() => {
const {
  Card,
  Badge,
  Button,
  Alert,
  Checkbox,
  Textarea,
  Tabs,
  Timeline,
  ProgressMeter,
  Dialog,
  Filament
} = window.CharmEdMindsDesignSystem_3ab9ff;
function ChartDetail({
  onBack
}) {
  const [tab, setTab] = React.useState("audit");
  const [confirm, setConfirm] = React.useState(false);
  const [closed, setClosed] = React.useState(false);
  const findings = [["Time statement present", true], ["MDM level supports 99214", true], ["Assessment ties to each tested domain", false], ["Plan states next visit and interval", true], ["Consent on file for records release", false]];
  const resolved = findings.filter(([, ok]) => ok).length;
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(TopBar, {
    title: "R. Alvarez",
    meta: "DOB 04/17/1998 \xB7 MRN 88214 \xB7 Feedback session, 11 Aug \xB7 Dr. Bello",
    right: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Badge, {
      tone: closed ? "success" : "alert",
      dot: true
    }, closed ? "Closed" : "Overdue · 31 hrs"), /*#__PURE__*/React.createElement(Button, {
      size: "sm",
      variant: "ghost",
      onClick: onBack
    }, "Back to queue"), /*#__PURE__*/React.createElement(Button, {
      size: "sm",
      onClick: () => setConfirm(true),
      disabled: closed
    }, "Close chart"))
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "var(--sp-8)",
      display: "grid",
      gridTemplateColumns: "1.5fr .8fr",
      gap: "var(--sp-6)",
      alignItems: "start"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gap: "var(--sp-6)"
    }
  }, /*#__PURE__*/React.createElement(Tabs, {
    value: tab,
    onChange: setTab,
    tabs: [{
      value: "audit",
      label: "Audit",
      count: 2
    }, {
      value: "note",
      label: "Note"
    }, {
      value: "history",
      label: "History"
    }]
  }), tab === "audit" && /*#__PURE__*/React.createElement(Card, {
    tone: "raised",
    padding: "var(--sp-6)"
  }, /*#__PURE__*/React.createElement(Filament, null), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: "var(--sp-5)",
      marginBottom: "var(--sp-5)"
    }
  }, /*#__PURE__*/React.createElement(ProgressMeter, {
    label: "Audit complete",
    value: Math.round(resolved / findings.length * 100),
    caption: resolved + " of " + findings.length + " checks pass"
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gap: "var(--sp-4)"
    }
  }, findings.map(([label, ok]) => /*#__PURE__*/React.createElement("div", {
    key: label,
    style: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      gap: "var(--sp-4)",
      paddingBottom: "var(--sp-4)",
      borderBottom: "1px solid rgba(254,252,247,.07)"
    }
  }, /*#__PURE__*/React.createElement(Checkbox, {
    label: label,
    defaultChecked: ok
  }), /*#__PURE__*/React.createElement(Badge, {
    tone: ok ? "success" : "alert"
  }, ok ? "Pass" : "Gap")))), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: "var(--sp-6)"
    }
  }, /*#__PURE__*/React.createElement(Alert, {
    tone: "warning",
    title: "Two gaps"
  }, "Assessment does not tie to the executive-function battery, and the release consent is unsigned."))), tab === "note" && /*#__PURE__*/React.createElement(Card, {
    tone: "raised",
    padding: "var(--sp-6)"
  }, /*#__PURE__*/React.createElement("div", {
    className: "cm-eyebrow"
  }, "Visit note"), /*#__PURE__*/React.createElement("p", {
    style: {
      color: "var(--text-body)",
      fontSize: "var(--fs-sm)",
      lineHeight: 1.7
    }
  }, "Patient returns for feedback following a four-hour neurocognitive battery. Attention and processing speed fall in the low-average range; verbal memory is intact. Reviewed results with patient and partner in plain language, provided written strategy sheet and a workplace accommodation letter."), /*#__PURE__*/React.createElement(Textarea, {
    label: "Addendum",
    rows: 4,
    placeholder: "Add the missing assessment language here."
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: "var(--sp-5)",
      display: "flex",
      gap: "var(--sp-3)"
    }
  }, /*#__PURE__*/React.createElement(Button, {
    size: "sm"
  }, "Save addendum"), /*#__PURE__*/React.createElement(Button, {
    size: "sm",
    variant: "ghost"
  }, "Discard"))), tab === "history" && /*#__PURE__*/React.createElement(Card, {
    tone: "raised",
    padding: "var(--sp-6)"
  }, /*#__PURE__*/React.createElement(Timeline, {
    items: [{
      title: "Intake",
      meta: "04 Mar · Dr. Bello",
      body: "Referred by primary care for attention complaints after a return to graduate school.",
      state: "done"
    }, {
      title: "Testing day",
      meta: "18 Mar · Technician R. Lee",
      body: "Full battery, four hours. No invalid performance indicators.",
      state: "done"
    }, {
      title: "Feedback session",
      meta: "11 Aug · Dr. Bello",
      body: "Results reviewed. Coaching block recommended.",
      state: "current"
    }, {
      title: "Coaching 1/8",
      meta: "Scheduled 25 Aug",
      state: "upcoming"
    }]
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gap: "var(--sp-5)"
    }
  }, /*#__PURE__*/React.createElement(Card, null, /*#__PURE__*/React.createElement("div", {
    className: "cm-eyebrow"
  }, "Coding"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: "var(--font-mono)",
      fontSize: "var(--fs-sm)",
      color: "var(--text-body)",
      lineHeight: 2,
      marginTop: "var(--sp-4)"
    }
  }, "99214 \xB7 Established, moderate", /*#__PURE__*/React.createElement("br", null), "96132 \xB7 Neuropsych eval, first hr", /*#__PURE__*/React.createElement("br", null), "F90.0 \xB7 ADHD, inattentive")), /*#__PURE__*/React.createElement(Card, {
    tone: "inset"
  }, /*#__PURE__*/React.createElement("div", {
    className: "cm-eyebrow"
  }, "Attachments"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gap: "var(--sp-3)",
      marginTop: "var(--sp-4)",
      fontSize: "var(--fs-sm)",
      color: "var(--text-body)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: "var(--sp-3)",
      alignItems: "center"
    }
  }, /*#__PURE__*/React.createElement(PortalIcon, {
    name: "file-text"
  }), " Battery score report.pdf"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: "var(--sp-3)",
      alignItems: "center"
    }
  }, /*#__PURE__*/React.createElement(PortalIcon, {
    name: "file-text"
  }), " Accommodation letter.pdf"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: "var(--sp-3)",
      alignItems: "center",
      color: "var(--text-muted)"
    }
  }, /*#__PURE__*/React.createElement(PortalIcon, {
    name: "file-plus"
  }), " Release consent \u2014 missing"))))), /*#__PURE__*/React.createElement(Dialog, {
    open: confirm,
    title: "Close this chart?",
    onClose: () => setConfirm(false),
    footer: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Button, {
      size: "sm",
      variant: "ghost",
      onClick: () => setConfirm(false)
    }, "Cancel"), /*#__PURE__*/React.createElement(Button, {
      size: "sm",
      onClick: () => {
        setClosed(true);
        setConfirm(false);
      }
    }, "Close chart"))
  }, "Two audit findings are unresolved. Closing now records an exception against this visit."));
}
Object.assign(window, {
  ChartDetail
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/portal/ChartDetail.jsx", error: String((e && e.message) || e) }); }

// ui_kits/portal/ChartQueue.jsx
try { (() => {
const {
  Card,
  Tabs,
  Badge,
  Button,
  DataTable,
  Input,
  Select,
  IconButton
} = window.CharmEdMindsDesignSystem_3ab9ff;
const ALL = [{
  id: 1,
  patient: "R. Alvarez",
  clinician: "Bello",
  visit: "Feedback session",
  code: "99214",
  age: "31 hrs",
  status: "Overdue",
  tone: "alert",
  bucket: "open"
}, {
  id: 2,
  patient: "M. Okafor",
  clinician: "Bello",
  visit: "Testing day",
  code: "96132",
  age: "26 hrs",
  status: "Overdue",
  tone: "alert",
  bucket: "open"
}, {
  id: 3,
  patient: "T. Brooks",
  clinician: "Ruiz",
  visit: "Coaching 4/8",
  code: "97129",
  age: "9 hrs",
  status: "Open",
  tone: "gold",
  bucket: "open"
}, {
  id: 4,
  patient: "S. Whitfield",
  clinician: "Bello",
  visit: "Intake",
  code: "99204",
  age: "4 hrs",
  status: "Open",
  tone: "gold",
  bucket: "open"
}, {
  id: 5,
  patient: "J. Park",
  clinician: "Ruiz",
  visit: "Re-test",
  code: "96136",
  age: "2 hrs",
  status: "Draft",
  tone: "neutral",
  bucket: "open"
}, {
  id: 6,
  patient: "D. Nguyen",
  clinician: "Bello",
  visit: "Feedback session",
  code: "99215",
  age: "6 hrs",
  status: "Charted",
  tone: "success",
  bucket: "signed"
}, {
  id: 7,
  patient: "L. Freeman",
  clinician: "Ruiz",
  visit: "Coaching 8/8",
  code: "97130",
  age: "14 hrs",
  status: "Charted",
  tone: "success",
  bucket: "signed"
}];
function ChartQueue({
  onOpenChart
}) {
  const [tab, setTab] = React.useState("open");
  const [q, setQ] = React.useState("");
  const rows = ALL.filter(r => (tab === "all" || r.bucket === tab) && r.patient.toLowerCase().includes(q.toLowerCase()));
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(TopBar, {
    title: "Chart queue",
    meta: rows.length + " charts · median close 24 hrs",
    right: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Badge, {
      tone: "alert",
      dot: true
    }, "2 overdue"), /*#__PURE__*/React.createElement(Button, {
      size: "sm",
      variant: "secondary"
    }, "Export"))
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "var(--sp-8)",
      display: "grid",
      gap: "var(--sp-6)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: "var(--sp-4)",
      alignItems: "flex-end"
    }
  }, /*#__PURE__*/React.createElement(Input, {
    label: "Search",
    placeholder: "Patient name",
    value: q,
    onChange: e => setQ(e.target.value),
    iconLeft: /*#__PURE__*/React.createElement(PortalIcon, {
      name: "search",
      size: 15
    }),
    style: {
      width: 280
    }
  }), /*#__PURE__*/React.createElement(Select, {
    label: "Clinician",
    options: ["All clinicians", "Bello", "Ruiz"],
    style: {
      width: 200
    }
  }), /*#__PURE__*/React.createElement(Select, {
    label: "Visit type",
    options: ["All visits", "Intake", "Testing day", "Feedback session", "Coaching"],
    style: {
      width: 200
    }
  })), /*#__PURE__*/React.createElement(Tabs, {
    value: tab,
    onChange: setTab,
    tabs: [{
      value: "open",
      label: "Open",
      count: 5
    }, {
      value: "signed",
      label: "Signed",
      count: 2
    }, {
      value: "all",
      label: "All"
    }]
  }), /*#__PURE__*/React.createElement(Card, {
    padding: "0",
    tone: "raised"
  }, /*#__PURE__*/React.createElement(DataTable, {
    onRowClick: onOpenChart,
    columns: [{
      key: "patient",
      label: "Patient"
    }, {
      key: "clinician",
      label: "Clinician"
    }, {
      key: "visit",
      label: "Visit"
    }, {
      key: "code",
      label: "Code",
      mono: true
    }, {
      key: "age",
      label: "Open for",
      mono: true,
      align: "right"
    }, {
      key: "status",
      label: "Status",
      align: "right",
      render: r => /*#__PURE__*/React.createElement(Badge, {
        tone: r.tone
      }, r.status)
    }],
    rows: rows,
    style: {
      border: "none"
    }
  }))));
}
Object.assign(window, {
  ChartQueue
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/portal/ChartQueue.jsx", error: String((e && e.message) || e) }); }

// ui_kits/portal/Dashboard.jsx
try { (() => {
const {
  Card,
  StatBlock,
  Badge,
  Button,
  ProgressMeter,
  Alert,
  Timeline,
  Filament,
  DataTable
} = window.CharmEdMindsDesignSystem_3ab9ff;
function Dashboard({
  onOpenChart
}) {
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(TopBar, {
    title: "Wednesday, 12 August",
    meta: "6 visits \xB7 12 charts open \xB7 2 overdue",
    right: /*#__PURE__*/React.createElement(Button, {
      size: "sm",
      onClick: () => onOpenChart()
    }, "Start audit")
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "var(--sp-8)",
      display: "grid",
      gap: "var(--sp-6)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "repeat(4,1fr)",
      gap: "var(--sp-5)"
    }
  }, [["12", "Charts open", "gold", "2 past 24 hrs"], ["88%", "Closed in 24 hrs", "teal", "Last 30 days"], ["6", "Visits today", "plain", "3 telehealth"], ["1,240", "Evaluations", "plain", "Program to date"]].map(([v, l, t, c]) => /*#__PURE__*/React.createElement(Card, {
    key: l
  }, /*#__PURE__*/React.createElement(StatBlock, {
    value: v,
    label: l,
    tone: t,
    caption: c
  })))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "1.5fr 1fr",
      gap: "var(--sp-6)",
      alignItems: "start"
    }
  }, /*#__PURE__*/React.createElement(Card, {
    tone: "raised",
    padding: "var(--sp-6)"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: "var(--sp-5)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "cm-eyebrow"
  }, "Needs you first"), /*#__PURE__*/React.createElement(Badge, {
    tone: "alert",
    dot: true
  }, "2 overdue")), /*#__PURE__*/React.createElement(DataTable, {
    dense: true,
    onRowClick: onOpenChart,
    columns: [{
      key: "patient",
      label: "Patient"
    }, {
      key: "visit",
      label: "Visit"
    }, {
      key: "code",
      label: "Code",
      mono: true
    }, {
      key: "age",
      label: "Open",
      mono: true,
      align: "right"
    }, {
      key: "status",
      label: "",
      align: "right",
      render: r => /*#__PURE__*/React.createElement(Badge, {
        tone: r.tone
      }, r.status)
    }],
    rows: [{
      patient: "R. Alvarez",
      visit: "Feedback session",
      code: "99214",
      age: "31 hrs",
      status: "Overdue",
      tone: "alert"
    }, {
      patient: "M. Okafor",
      visit: "Testing day",
      code: "96132",
      age: "26 hrs",
      status: "Overdue",
      tone: "alert"
    }, {
      patient: "T. Brooks",
      visit: "Coaching 4/8",
      code: "97129",
      age: "9 hrs",
      status: "Open",
      tone: "gold"
    }, {
      patient: "S. Whitfield",
      visit: "Intake",
      code: "99204",
      age: "4 hrs",
      status: "Open",
      tone: "gold"
    }, {
      patient: "J. Park",
      visit: "Re-test",
      code: "96136",
      age: "2 hrs",
      status: "Draft",
      tone: "neutral"
    }]
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gap: "var(--sp-5)"
    }
  }, /*#__PURE__*/React.createElement(Alert, {
    tone: "warning",
    title: "Coding check"
  }, "Three charts carry a 99214 without a time or MDM statement."), /*#__PURE__*/React.createElement(Card, null, /*#__PURE__*/React.createElement("div", {
    className: "cm-eyebrow"
  }, "Closure rate"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gap: "var(--sp-4)",
      marginTop: "var(--sp-5)"
    }
  }, /*#__PURE__*/React.createElement(ProgressMeter, {
    label: "This week",
    value: 88
  }), /*#__PURE__*/React.createElement(ProgressMeter, {
    label: "Last week",
    value: 74,
    tone: "teal"
  }), /*#__PURE__*/React.createElement(ProgressMeter, {
    label: "Target",
    value: 95,
    tone: "gold"
  }))), /*#__PURE__*/React.createElement(Card, {
    tone: "inset"
  }, /*#__PURE__*/React.createElement("div", {
    className: "cm-eyebrow"
  }, "Today"), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: "var(--sp-5)"
    }
  }, /*#__PURE__*/React.createElement(Timeline, {
    items: [{
      title: "R. Alvarez",
      meta: "08:30 · Feedback",
      state: "done"
    }, {
      title: "T. Brooks",
      meta: "10:00 · Coaching",
      state: "current"
    }, {
      title: "S. Whitfield",
      meta: "13:15 · Intake",
      state: "upcoming"
    }]
  })))))));
}
Object.assign(window, {
  Dashboard
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/portal/Dashboard.jsx", error: String((e && e.message) || e) }); }

// ui_kits/portal/PortalShell.jsx
try { (() => {
const {
  SideNav,
  Logo,
  Badge,
  IconButton,
  Filament
} = window.CharmEdMindsDesignSystem_3ab9ff;
function PortalIcon({
  name,
  size = 17
}) {
  const ref = React.useRef(null);
  React.useEffect(() => {
    if (ref.current && window.lucide) {
      ref.current.innerHTML = "";
      const el = document.createElement("i");
      el.setAttribute("data-lucide", name);
      ref.current.appendChild(el);
      window.lucide.createIcons({
        attrs: {
          width: size,
          height: size,
          "stroke-width": 1.5
        }
      });
    }
  }, [name, size]);
  return /*#__PURE__*/React.createElement("span", {
    ref: ref,
    style: {
      display: "inline-flex",
      lineHeight: 0,
      color: "currentColor"
    }
  });
}
function TopBar({
  title,
  meta,
  right
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: "var(--sp-6)",
      padding: "var(--sp-5) var(--sp-8)",
      borderBottom: "1px solid var(--border-hairline)",
      background: "rgba(4,18,45,.7)",
      backdropFilter: "var(--blur-veil)",
      position: "sticky",
      top: 0,
      zIndex: 10
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("h1", {
    style: {
      fontSize: "var(--fs-h3)"
    }
  }, title), meta && /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: "var(--font-mono)",
      fontSize: "var(--fs-xs)",
      color: "var(--text-muted)",
      marginTop: 4
    }
  }, meta)), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: "var(--sp-3)"
    }
  }, right));
}
function PortalShell({
  page,
  onNavigate,
  children
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      minHeight: "100vh",
      background: "var(--surface-base)",
      backgroundImage: "var(--gradient-synapse)"
    }
  }, /*#__PURE__*/React.createElement(SideNav, {
    active: page,
    onNavigate: onNavigate,
    style: {
      minHeight: "100vh"
    },
    items: [{
      section: "Today"
    }, {
      value: "dashboard",
      label: "Dashboard",
      icon: /*#__PURE__*/React.createElement(PortalIcon, {
        name: "layout-dashboard"
      })
    }, {
      value: "queue",
      label: "Chart queue",
      icon: /*#__PURE__*/React.createElement(PortalIcon, {
        name: "clipboard-list"
      }),
      count: 12
    }, {
      value: "schedule",
      label: "Schedule",
      icon: /*#__PURE__*/React.createElement(PortalIcon, {
        name: "calendar"
      })
    }, {
      section: "Program"
    }, {
      value: "patient",
      label: "Patients",
      icon: /*#__PURE__*/React.createElement(PortalIcon, {
        name: "users"
      })
    }, {
      value: "outcomes",
      label: "Outcomes",
      icon: /*#__PURE__*/React.createElement(PortalIcon, {
        name: "trending-up"
      })
    }],
    footer: /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(Filament, {
      animated: false
    }), /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        alignItems: "center",
        gap: "var(--sp-3)",
        marginTop: "var(--sp-5)"
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        width: 34,
        height: 34,
        borderRadius: 999,
        background: "rgba(31,153,162,.18)",
        border: "1px solid rgba(31,153,162,.4)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "var(--font-display)",
        fontSize: 12,
        color: "var(--teal-300)"
      }
    }, "AB"), /*#__PURE__*/React.createElement("div", {
      style: {
        lineHeight: 1.3
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: "var(--fs-sm)",
        color: "var(--text-display)"
      }
    }, "Dr. A. Bello"), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 11,
        color: "var(--text-muted)"
      }
    }, "Neuropsychology"))))
  }), /*#__PURE__*/React.createElement("main", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "var(--sp-6) var(--sp-8) 0"
    }
  }, /*#__PURE__*/React.createElement(Logo, {
    variant: "lockup",
    size: 190
  })), children));
}
Object.assign(window, {
  PortalShell,
  TopBar,
  PortalIcon
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/portal/PortalShell.jsx", error: String((e && e.message) || e) }); }

// ui_kits/website/Home.jsx
try { (() => {
const {
  Button,
  Card,
  Badge,
  StatBlock,
  Filament,
  SynapseField,
  Eyebrow,
  Timeline
} = window.CharmEdMindsDesignSystem_3ab9ff;
function Hero({
  onNav
}) {
  return /*#__PURE__*/React.createElement(SynapseField, {
    intensity: "high",
    style: {
      padding: "clamp(80px,10vw,150px) var(--sp-8) var(--section-y)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: "var(--container)",
      margin: "0 auto",
      display: "grid",
      gridTemplateColumns: "1.25fr .85fr",
      gap: "var(--sp-16)",
      alignItems: "center"
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(Badge, {
    tone: "teal",
    dot: true
  }, "Now accepting referrals"), /*#__PURE__*/React.createElement("h1", {
    style: {
      fontSize: "var(--fs-hero)",
      fontWeight: "var(--fw-thin)",
      marginTop: "var(--sp-5)",
      lineHeight: "var(--lh-tight)"
    }
  }, "Understand the brain.", /*#__PURE__*/React.createElement("br", null), "Build the strategy.", /*#__PURE__*/React.createElement("br", null), /*#__PURE__*/React.createElement("span", {
    style: {
      color: "var(--accent-primary)"
    }
  }, "Grow the confidence.")), /*#__PURE__*/React.createElement("p", {
    style: {
      marginTop: "var(--sp-6)",
      fontSize: "var(--fs-lead)",
      color: "var(--text-body)",
      maxWidth: "46ch"
    }
  }, "CharmEd Minds is the brain health and cognition program of BHW Medical Group. We evaluate how a mind actually works, then build a plan the patient can use on Monday morning."), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: "var(--sp-4)",
      marginTop: "var(--sp-8)",
      flexWrap: "wrap"
    }
  }, /*#__PURE__*/React.createElement(Button, {
    size: "lg",
    onClick: () => onNav("referrals")
  }, "Book an evaluation"), /*#__PURE__*/React.createElement(Button, {
    size: "lg",
    variant: "secondary",
    onClick: () => onNav("program")
  }, "See the program")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: "var(--sp-12)",
      marginTop: "var(--sp-16)"
    }
  }, /*#__PURE__*/React.createElement(StatBlock, {
    value: "1,240",
    label: "Evaluations",
    caption: "Since 2021"
  }), /*#__PURE__*/React.createElement(StatBlock, {
    value: "24 hrs",
    label: "Report turnaround",
    tone: "teal"
  }), /*#__PURE__*/React.createElement(StatBlock, {
    value: "92%",
    label: "Goal attainment",
    tone: "plain"
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      position: "relative",
      display: "flex",
      justifyContent: "center"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      position: "absolute",
      inset: "-8%",
      background: "radial-gradient(closest-side,rgba(31,153,162,.35),transparent 70%)",
      filter: "blur(8px)"
    }
  }), /*#__PURE__*/React.createElement("img", {
    src: "../../assets/logo-lockup.png",
    alt: "CharmEd Minds",
    style: {
      position: "relative",
      width: "min(100%,340px)",
      borderRadius: "var(--radius-xl)",
      boxShadow: "var(--shadow-lg)"
    }
  }))));
}
function Home({
  onNav
}) {
  const services = [["brain", "Cognitive evaluation", "A full neurocognitive picture — attention, memory, language, executive function — in one visit."], ["compass", "Executive function coaching", "Eight sessions built around a single goal the patient chooses."], ["heart-pulse", "Memory clinic", "Longitudinal follow-up for mild cognitive impairment and early dementia."], ["activity", "Post-concussion care", "Return-to-work and return-to-learn planning after brain injury."]];
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Hero, {
    onNav: onNav
  }), /*#__PURE__*/React.createElement(Section, {
    eyebrow: "What we do",
    title: "Four ways in."
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "repeat(4,1fr)",
      gap: "var(--sp-5)"
    }
  }, services.map(([icon, t, d], i) => /*#__PURE__*/React.createElement(Card, {
    key: t,
    interactive: true,
    glow: i === 0 ? "teal" : "none",
    onClick: () => onNav("program")
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      color: "var(--teal-300)",
      marginBottom: "var(--sp-4)"
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: icon,
    size: 26
  })), /*#__PURE__*/React.createElement("h3", {
    style: {
      fontSize: "var(--fs-h4)"
    }
  }, t), /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: "var(--fs-sm)",
      color: "var(--text-muted)",
      marginBottom: 0
    }
  }, d))))), /*#__PURE__*/React.createElement(Section, {
    eyebrow: "How it works",
    title: "From referral to plan in three weeks.",
    style: {
      paddingTop: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "1fr 1fr",
      gap: "var(--sp-16)",
      alignItems: "start"
    }
  }, /*#__PURE__*/React.createElement(Timeline, {
    items: [{
      title: "Referral & intake",
      meta: "Week 0",
      body: "History, medications, prior imaging and school or work records reviewed before the patient arrives.",
      state: "done"
    }, {
      title: "Testing day",
      meta: "Week 1",
      body: "Three to four hours of standardized testing with a technician, then a clinician debrief.",
      state: "done"
    }, {
      title: "Feedback session",
      meta: "Week 3",
      body: "The results in plain language, plus a written strategy the patient and family keep.",
      state: "current"
    }, {
      title: "Follow-up",
      meta: "Ongoing",
      body: "Coaching blocks, school or employer letters, and re-testing when it will change the plan.",
      state: "upcoming"
    }]
  }), /*#__PURE__*/React.createElement(Card, {
    tone: "raised",
    padding: "var(--sp-8)"
  }, /*#__PURE__*/React.createElement(Filament, null), /*#__PURE__*/React.createElement("blockquote", {
    style: {
      margin: "var(--sp-6) 0 0",
      fontFamily: "var(--font-display)",
      fontWeight: "var(--fw-light)",
      fontSize: "var(--fs-h3)",
      lineHeight: 1.35,
      color: "var(--text-display)"
    }
  }, "\u201CWe stopped guessing. The report told us what my son\u2019s brain does well, and the plan told his teachers what to change.\u201D"), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: "var(--sp-6)",
      fontFamily: "var(--font-display)",
      fontSize: "var(--fs-xs)",
      letterSpacing: "var(--ls-caps)",
      textTransform: "uppercase",
      color: "var(--text-muted)"
    }
  }, "Parent \xB7 Executive function track")))), /*#__PURE__*/React.createElement(Section, {
    light: true,
    eyebrow: "For referring clinicians",
    title: "Send us the hard ones."
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "repeat(3,1fr)",
      gap: "var(--sp-6)"
    }
  }, [["Same-week triage", "Every referral is reviewed by a clinician within one business day."], ["Reports you can bill from", "Findings, ICD-10 impressions and a plan, delivered in 24 hours."], ["Closed loop", "You get the feedback letter the same day the family does."]].map(([t, d]) => /*#__PURE__*/React.createElement("div", {
    key: t
  }, /*#__PURE__*/React.createElement("h3", {
    style: {
      fontSize: "var(--fs-h4)",
      color: "var(--navy-800)"
    }
  }, t), /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: "var(--fs-sm)",
      color: "var(--slate-500)"
    }
  }, d)))), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: "var(--sp-10)"
    }
  }, /*#__PURE__*/React.createElement(Button, {
    variant: "onLight",
    onClick: () => onNav("referrals")
  }, "Refer a patient"))));
}
Object.assign(window, {
  Home,
  Hero
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/website/Home.jsx", error: String((e && e.message) || e) }); }

// ui_kits/website/Program.jsx
try { (() => {
const {
  Card,
  Badge,
  Tabs,
  Button,
  Eyebrow,
  ProgressMeter,
  Filament
} = window.CharmEdMindsDesignSystem_3ab9ff;
function Program({
  onNav
}) {
  const [track, setTrack] = React.useState("attention");
  const tracks = {
    attention: {
      name: "Attention & focus",
      weeks: 8,
      who: "Ages 12 and up with ADHD, attention complaints, or post-treatment fog.",
      does: ["Continuous performance testing", "Executive function interview", "Work or school observation review", "Eight coaching sessions"]
    },
    memory: {
      name: "Memory",
      weeks: 12,
      who: "Adults with subjective memory decline, MCI, or a family history of dementia.",
      does: ["Full neurocognitive battery", "Functional interview with a partner", "Medication and sleep review", "Six-month re-test"]
    },
    concussion: {
      name: "Post-concussion",
      weeks: 6,
      who: "Athletes and workers recovering from mild traumatic brain injury.",
      does: ["Baseline comparison", "Symptom-provocation testing", "Graded return plan", "Employer or school letter"]
    }
  };
  const t = tracks[track];
  return /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "var(--sp-16) var(--sp-8) var(--section-y)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: "var(--container)",
      margin: "0 auto"
    }
  }, /*#__PURE__*/React.createElement(Eyebrow, null, "The program"), /*#__PURE__*/React.createElement("h1", {
    style: {
      fontSize: "var(--fs-h1)",
      marginTop: "var(--sp-4)",
      maxWidth: "20ch"
    }
  }, "Three tracks. One method."), /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: "var(--fs-lead)",
      color: "var(--text-body)",
      maxWidth: "56ch",
      marginTop: "var(--sp-5)"
    }
  }, "Every track runs the same way: measure first, plan second, practice third. What changes is the battery and the length."), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: "var(--sp-12)"
    }
  }, /*#__PURE__*/React.createElement(Tabs, {
    value: track,
    onChange: setTrack,
    tabs: [{
      value: "attention",
      label: "Attention & focus"
    }, {
      value: "memory",
      label: "Memory"
    }, {
      value: "concussion",
      label: "Post-concussion"
    }]
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "1.3fr .7fr",
      gap: "var(--sp-8)",
      marginTop: "var(--sp-8)"
    }
  }, /*#__PURE__*/React.createElement(Card, {
    tone: "raised",
    padding: "var(--sp-8)"
  }, /*#__PURE__*/React.createElement(Filament, null), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: "var(--sp-4)",
      margin: "var(--sp-6) 0 var(--sp-4)"
    }
  }, /*#__PURE__*/React.createElement("h2", {
    style: {
      fontSize: "var(--fs-h2)"
    }
  }, t.name), /*#__PURE__*/React.createElement(Badge, {
    tone: "gold"
  }, t.weeks, " weeks")), /*#__PURE__*/React.createElement("p", {
    style: {
      color: "var(--text-body)",
      maxWidth: "60ch"
    }
  }, t.who), /*#__PURE__*/React.createElement("ul", {
    style: {
      listStyle: "none",
      padding: 0,
      margin: "var(--sp-6) 0 0",
      display: "grid",
      gridTemplateColumns: "1fr 1fr",
      gap: "var(--sp-3)"
    }
  }, t.does.map(d => /*#__PURE__*/React.createElement("li", {
    key: d,
    style: {
      display: "flex",
      gap: "var(--sp-3)",
      alignItems: "center",
      fontSize: "var(--fs-sm)",
      color: "var(--text-body)"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 6,
      height: 6,
      borderRadius: 999,
      background: "var(--teal-400)",
      boxShadow: "var(--glow-teal-sm)",
      flex: "0 0 6px"
    }
  }), d))), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: "var(--sp-8)"
    }
  }, /*#__PURE__*/React.createElement(Button, {
    onClick: () => onNav("referrals")
  }, "Start a referral"))), /*#__PURE__*/React.createElement(Card, null, /*#__PURE__*/React.createElement("div", {
    className: "cm-eyebrow"
  }, "Typical arc"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: "var(--sp-5)",
      marginTop: "var(--sp-5)"
    }
  }, /*#__PURE__*/React.createElement(ProgressMeter, {
    label: "Evaluation",
    value: 100,
    tone: "teal"
  }), /*#__PURE__*/React.createElement(ProgressMeter, {
    label: "Plan built",
    value: 70
  }), /*#__PURE__*/React.createElement(ProgressMeter, {
    label: "Coaching",
    value: 35,
    tone: "gold"
  })), /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: "var(--fs-xs)",
      color: "var(--text-muted)",
      marginBottom: 0,
      marginTop: "var(--sp-6)"
    }
  }, "Progress is tracked against the patient\u2019s own goal, not a normative curve.")))));
}
Object.assign(window, {
  Program
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/website/Program.jsx", error: String((e && e.message) || e) }); }

// ui_kits/website/Referral.jsx
try { (() => {
const {
  Card,
  Input,
  Select,
  Textarea,
  Checkbox,
  Button,
  Alert,
  Eyebrow,
  Badge
} = window.CharmEdMindsDesignSystem_3ab9ff;
function Referral() {
  const [sent, setSent] = React.useState(false);
  return /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "var(--sp-16) var(--sp-8) var(--section-y)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: 940,
      margin: "0 auto"
    }
  }, /*#__PURE__*/React.createElement(Eyebrow, null, "Referrals"), /*#__PURE__*/React.createElement("h1", {
    style: {
      fontSize: "var(--fs-h1)",
      marginTop: "var(--sp-4)"
    }
  }, "Refer a patient."), /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: "var(--fs-lead)",
      color: "var(--text-body)",
      maxWidth: "52ch",
      marginTop: "var(--sp-4)"
    }
  }, "A clinician reviews every referral within one business day. Records can follow \u2014 send the patient first."), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "1.3fr .7fr",
      gap: "var(--sp-8)",
      marginTop: "var(--sp-10)",
      alignItems: "start"
    }
  }, /*#__PURE__*/React.createElement(Card, {
    tone: "raised",
    padding: "var(--sp-8)"
  }, sent ? /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(Alert, {
    tone: "success",
    title: "Referral received"
  }, "We will call the family within one business day. Reference CM-4471."), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: "var(--sp-6)"
    }
  }, /*#__PURE__*/React.createElement(Button, {
    variant: "secondary",
    onClick: () => setSent(false)
  }, "Send another"))) : /*#__PURE__*/React.createElement("form", {
    onSubmit: e => {
      e.preventDefault();
      setSent(true);
    },
    style: {
      display: "grid",
      gap: "var(--sp-5)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "1fr 1fr",
      gap: "var(--sp-5)"
    }
  }, /*#__PURE__*/React.createElement(Input, {
    label: "Patient name",
    placeholder: "Full legal name",
    required: true
  }), /*#__PURE__*/React.createElement(Input, {
    label: "Date of birth",
    placeholder: "MM / DD / YYYY"
  }), /*#__PURE__*/React.createElement(Input, {
    label: "Referring clinician",
    placeholder: "Name and practice"
  }), /*#__PURE__*/React.createElement(Input, {
    label: "Contact email",
    type: "email",
    placeholder: "you@practice.org"
  })), /*#__PURE__*/React.createElement(Select, {
    label: "Program track",
    options: ["Attention & focus", "Memory", "Post-concussion", "Not sure — please triage"]
  }), /*#__PURE__*/React.createElement(Textarea, {
    label: "Reason for referral",
    rows: 4,
    placeholder: "What changed, and what decision is waiting on the results?"
  }), /*#__PURE__*/React.createElement(Checkbox, {
    label: "Records are attached or will follow",
    description: "Prior testing, imaging, IEP or 504 plans.",
    defaultChecked: true
  }), /*#__PURE__*/React.createElement(Checkbox, {
    label: "Family has consented to contact"
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: "var(--sp-4)",
      alignItems: "center"
    }
  }, /*#__PURE__*/React.createElement(Button, {
    type: "submit"
  }, "Send referral"), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: "var(--fs-xs)",
      color: "var(--text-muted)"
    }
  }, "Encrypted. HIPAA-compliant intake.")))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gap: "var(--sp-5)"
    }
  }, /*#__PURE__*/React.createElement(Card, null, /*#__PURE__*/React.createElement(Badge, {
    tone: "teal",
    dot: true
  }, "Response time"), /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: "var(--fs-sm)",
      color: "var(--text-body)",
      marginBottom: 0,
      marginTop: "var(--sp-4)"
    }
  }, "One business day to triage. Two to three weeks to a testing slot. Twenty-four hours from testing to report.")), /*#__PURE__*/React.createElement(Card, {
    tone: "inset"
  }, /*#__PURE__*/React.createElement("div", {
    className: "cm-eyebrow"
  }, "Urgent"), /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: "var(--fs-sm)",
      color: "var(--text-body)",
      marginTop: "var(--sp-3)",
      marginBottom: 0
    }
  }, "For acute safety concerns, call the BHW Medical Group line rather than using this form."))))));
}
Object.assign(window, {
  Referral
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/website/Referral.jsx", error: String((e && e.message) || e) }); }

// ui_kits/website/Shell.jsx
try { (() => {
const {
  NavBar,
  Button,
  Logo,
  Filament,
  Eyebrow
} = window.CharmEdMindsDesignSystem_3ab9ff;
function Icon({
  name,
  size = 18,
  color = "currentColor"
}) {
  const ref = React.useRef(null);
  React.useEffect(() => {
    if (ref.current && window.lucide) {
      ref.current.innerHTML = "";
      const el = document.createElement("i");
      el.setAttribute("data-lucide", name);
      ref.current.appendChild(el);
      window.lucide.createIcons({
        attrs: {
          width: size,
          height: size,
          stroke: color,
          "stroke-width": 1.5
        }
      });
    }
  }, [name, size, color]);
  return /*#__PURE__*/React.createElement("span", {
    ref: ref,
    style: {
      display: "inline-flex",
      lineHeight: 0
    }
  });
}
function SiteFooter() {
  return /*#__PURE__*/React.createElement("footer", {
    style: {
      borderTop: "1px solid var(--border-hairline)",
      padding: "56px var(--sp-8) 40px",
      background: "rgba(2,9,28,.5)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: "var(--container)",
      margin: "0 auto",
      display: "grid",
      gridTemplateColumns: "1.4fr 1fr 1fr",
      gap: "var(--sp-10)"
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(Logo, {
    variant: "stacked",
    size: 190,
    showTagline: true
  }), /*#__PURE__*/React.createElement("p", {
    style: {
      marginTop: "var(--sp-5)",
      color: "var(--text-muted)",
      fontSize: "var(--fs-sm)",
      maxWidth: "34ch"
    }
  }, "The Brain Health and Cognition Program of BHW Medical Group.")), [["Program", ["Cognitive evaluation", "Executive function coaching", "Memory clinic", "Post-concussion care"]], ["Practice", ["About BHW Medical Group", "Our clinicians", "Refer a patient", "Contact"]]].map(([h, items]) => /*#__PURE__*/React.createElement("div", {
    key: h
  }, /*#__PURE__*/React.createElement("div", {
    className: "cm-eyebrow",
    style: {
      marginBottom: "var(--sp-4)"
    }
  }, h), /*#__PURE__*/React.createElement("ul", {
    style: {
      listStyle: "none",
      padding: 0,
      margin: 0,
      display: "flex",
      flexDirection: "column",
      gap: "var(--sp-3)"
    }
  }, items.map(i => /*#__PURE__*/React.createElement("li", {
    key: i,
    style: {
      fontSize: "var(--fs-sm)",
      color: "var(--text-body)"
    }
  }, i)))))), /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: "var(--container)",
      margin: "40px auto 0"
    }
  }, /*#__PURE__*/React.createElement(Filament, {
    animated: false
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: "var(--container)",
      margin: "0 auto",
      paddingTop: "var(--sp-5)",
      display: "flex",
      justifyContent: "space-between",
      fontFamily: "var(--font-mono)",
      fontSize: "var(--fs-xs)",
      color: "var(--text-muted)"
    }
  }, /*#__PURE__*/React.createElement("span", null, "\xA9 2026 BHW Medical Group"), /*#__PURE__*/React.createElement("span", null, "Privacy \xB7 Notice of privacy practices")));
}
function Section({
  eyebrow,
  title,
  children,
  light = false,
  style
}) {
  return /*#__PURE__*/React.createElement("section", {
    style: {
      padding: "var(--section-y) var(--sp-8)",
      background: light ? "var(--surface-light)" : "transparent",
      color: light ? "var(--text-on-light)" : undefined,
      ...style
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: "var(--container)",
      margin: "0 auto"
    }
  }, eyebrow && /*#__PURE__*/React.createElement(Eyebrow, {
    tone: light ? "teal" : "gold"
  }, eyebrow), title && /*#__PURE__*/React.createElement("h2", {
    style: {
      fontSize: "var(--fs-h1)",
      marginTop: "var(--sp-4)",
      maxWidth: "18ch",
      color: light ? "var(--navy-800)" : "var(--text-display)"
    }
  }, title), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: "var(--sp-10)"
    }
  }, children)));
}
Object.assign(window, {
  Icon,
  SiteFooter,
  Section
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/website/Shell.jsx", error: String((e && e.message) || e) }); }

__ds_ns.Filament = __ds_scope.Filament;

__ds_ns.Logo = __ds_scope.Logo;

__ds_ns.SynapseField = __ds_scope.SynapseField;

__ds_ns.Badge = __ds_scope.Badge;

__ds_ns.Button = __ds_scope.Button;

__ds_ns.Card = __ds_scope.Card;

__ds_ns.Eyebrow = __ds_scope.Eyebrow;

__ds_ns.IconButton = __ds_scope.IconButton;

__ds_ns.DataTable = __ds_scope.DataTable;

__ds_ns.StatBlock = __ds_scope.StatBlock;

__ds_ns.Timeline = __ds_scope.Timeline;

__ds_ns.Alert = __ds_scope.Alert;

__ds_ns.Dialog = __ds_scope.Dialog;

__ds_ns.ProgressMeter = __ds_scope.ProgressMeter;

__ds_ns.Checkbox = __ds_scope.Checkbox;

__ds_ns.Input = __ds_scope.Input;

__ds_ns.Radio = __ds_scope.Radio;

__ds_ns.Select = __ds_scope.Select;

__ds_ns.Switch = __ds_scope.Switch;

__ds_ns.Textarea = __ds_scope.Textarea;

__ds_ns.NavBar = __ds_scope.NavBar;

__ds_ns.SideNav = __ds_scope.SideNav;

__ds_ns.Tabs = __ds_scope.Tabs;

})();
