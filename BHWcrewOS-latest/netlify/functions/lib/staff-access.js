// Operational oversight does not confer provider or full administrator authority.
function canAccessOperationsOverview(session = {}) {
  if (session.access === "Admin") return true;
  return session.access === "Division Admin"
    && session.role === "Operations and Coordination Lead"
    && (session.divisions || []).includes("All");
}

module.exports = { canAccessOperationsOverview };
