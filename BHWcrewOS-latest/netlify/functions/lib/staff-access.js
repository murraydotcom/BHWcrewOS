// Admin Master is a page-specific grant tied to the signed CrewOS staff ID.
const ADMIN_MASTER_STAFF_IDS = new Set([
  "39358075-8d30-81a2-9d5a-d2fbca3cf4b5", // Amaris Murray
  "39358075-8d30-8125-93b0-d54f9e1fb69b", // Margaret
]);

function canAccessAdminMaster(session) {
  return ADMIN_MASTER_STAFF_IDS.has(session?.staffId);
}

function isAdminMasterView(view) {
  const key = String(view ?? "").trim().toLowerCase().replace(/[ _]+/g, "-");
  return key === "admin-master" || key === "operations-overview";
}

module.exports = { canAccessAdminMaster, isAdminMasterView };
