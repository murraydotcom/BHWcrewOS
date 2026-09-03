import {
  createBhwMemoryCloudClient,
  fromCloudMemory,
  getDeviceMetadata,
  toCloudMemory,
} from "/bhw-capture-sync.mjs";
import {
  clearCrewSession,
  crewosSigninUrl,
  validateCrewSession,
} from "/bhw-capture-auth.mjs";
import {
  CLINICAL_LOCKED,
  clinicalSessionValid,
  createClinicalCaptureClient,
  reauthenticateClinical,
} from "/bhw-capture-clinical.mjs";

(function () {
  "use strict";

  var DB_NAME = "bhw_capture_local_v1";
  var STORE = "entries";
  var PIN_KEY = "bhw_capture_pin_v1";
  var FALLBACK_STORE_KEY = "bhw_capture_text_cache_v1";
  var MAX_TRANSCRIPTION_BYTES = 4 * 1024 * 1024;
  var CACHE_STARTUP_TIMEOUT_MS = 4000;
  var db = null;
  var dbPromise = null;
  var cacheFallback = false;
  var currentMode = "Brain Dump";
  var recorder = null;
  var stream = null;
  var chunks = [];
  var audioBlob = null;
  var captureHadAudio = false;
  var startedAt = 0;
  var recordedDurationMs = 0;
  var timerId = null;
  var recognition = null;
  var speechBase = "";
  var currentDetail = null;
  var deferredInstall = null;
  var hiddenAt = 0;
  var filterProject = "All";
  var transcriptionBusy = false;
  var recordingTextBase = "";
  var transcriptionRun = 0;
  var titlePinned = false;
  var projectPinned = false;
  var cloudClient = null;
  var syncInFlight = false;
  var syncTimer = null;
  var device = null;
  var crewUser = null;
  var clinicalSession = null;
  var clinicalClient = null;
  var clinicalConfig = null;
  var clinicalPatients = [];
  var clinicalConsent = null;
  var clinicalReferences = new Map();
  var clinicalLockTimer = null;
  var clinicalDraftId = "";
  var clinicalDraftPatientId = "";

  var $ = function (id) { return document.getElementById(id); };
  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (character) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[character];
    });
  }
  function uid() {
    return crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + "-" + Math.random().toString(36).slice(2);
  }
  function fmtDate(value) {
    return new Date(value).toLocaleString([], { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
  }
  function fmtTime(milliseconds) {
    var seconds = Math.floor(milliseconds / 1000);
    var minutes = Math.floor(seconds / 60);
    return String(minutes).padStart(2, "0") + ":" + String(seconds % 60).padStart(2, "0");
  }
  function errorText(error) {
    return String(error && error.message ? error.message : "Sync unavailable").replace(/\s+/g, " ").slice(0, 180);
  }

  function isClinical() {
    return currentMode === "Clinical";
  }

  function selectedClinicalPatient() {
    return clinicalPatients.find(function (patient) { return patient.bhwPatientId === $("clinicalPatient").value; }) || null;
  }

  function clinicalPatientLabel(bhwPatientId) {
    var patient = clinicalPatients.find(function (item) { return item.bhwPatientId === bhwPatientId; });
    return patient ? patient.displayName + " · " + patient.bhwPatientId : bhwPatientId;
  }

  function clinicalReferenceEntry(reference) {
    return {
      id: "clinical:" + reference.id,
      referenceId: reference.id,
      clinicalReference: true,
      createdAt: Date.parse(reference.createdAt) || Date.now(),
      updatedAt: Date.parse(reference.updatedAt || reference.createdAt) || Date.now(),
      mode: "Clinical",
      title: reference.title || "Clinical capture",
      project: "24-Hour Documentation",
      tags: ["protected"],
      actions: [],
      summary: "Protected draft for " + clinicalPatientLabel(reference.bhwPatientId),
      transcript: "",
      encounterId: reference.encounterId,
      bhwPatientId: reference.bhwPatientId,
      syncStatus: "protected",
    };
  }

  function setModeUi(mode) {
    currentMode = mode;
    var clinical = mode === "Clinical";
    document.querySelectorAll("[data-mode]").forEach(function (item) { item.classList.toggle("active", item.dataset.mode === mode); });
    $("clinicalFields").classList.toggle("hidden", !clinical);
    $("projectField").classList.toggle("hidden", clinical);
    $("liveSpeechLabel").classList.toggle("hidden", clinical);
    $("keepAudioLabel").classList.toggle("hidden", clinical);
    if (clinical) {
      $("liveSpeech").checked = false;
      $("keepAudio").checked = false;
      $("captureNotice").innerHTML = "<b>Protected Clinical mode.</b> Patient-linked text routes directly to the protected 24-hour documentation queue. It is not written to the ordinary BHW Memory endpoint, offline cache, or JSON export.";
      $("recordLabel").textContent = "Full visits use Visit Transcription";
      $("recordStatus").textContent = "Open the protected two-hour recorder above for patient audio.";
      $("audioHelper").textContent = "Clinical Capture accepts typed patient-linked drafts. Patient recording is handled by Visit Transcription so failed audio can be retried safely.";
      $("saveBtn").textContent = "Send to 24-Hour Documentation";
      $("transcript").placeholder = "Speak or type the patient-linked clinical draft here.";
    } else {
      $("captureNotice").innerHTML = "<b>Non-PHI modes.</b> Do not include patient information unless you enter Clinical and complete the additional verification. Non-clinical text synchronizes to BHW Memory; retained audio stays only on this device.";
      $("recordStatus").textContent = "Non-PHI audio is sent for transcription, then discarded by default.";
      if (!recorder) $("recordLabel").textContent = "Tap to capture";
      $("audioHelper").textContent = "After stop, the recording is transcribed, the organization preview appears, and raw audio is discarded unless device-only retention was selected.";
      $("saveBtn").textContent = "Save to Memory";
      $("transcript").placeholder = "Speak or type here. You can also paste a thought, meeting note, or idea.";
      $("liveSpeech").checked = true;
    }
    $("organized").classList.add("hidden");
  }

  function scheduleClinicalLock() {
    if (clinicalLockTimer) clearTimeout(clinicalLockTimer);
    if (!clinicalSessionValid(clinicalSession)) return;
    var delay = Math.max(0, clinicalSession.expiresAt - Date.now());
    clinicalLockTimer = setTimeout(function () { lockClinical(true); }, delay);
  }

  function lockClinical(preserveDraft) {
    if (clinicalLockTimer) clearTimeout(clinicalLockTimer);
    clinicalLockTimer = null;
    clinicalSession = null;
    clinicalClient = null;
    clinicalConfig = null;
    clinicalConsent = null;
    clinicalPatients = [];
    clinicalReferences.clear();
    $("clinicalPatient").innerHTML = '<option value="">Select a patient</option>';
    $("clinicalAgreement").checked = false;
    $("clinicalConsentStatus").dataset.state = "blocked";
    $("clinicalConsentStatus").textContent = "Select a patient to check recording consent.";
    if (currentDetail && currentDetail.clinicalReference) closeDetail();
    renderLibrary();
    if (!preserveDraft || !isClinical()) return;
    showClinicalGate("Clinical access expired. Re-enter your CrewOS PIN to continue this draft.");
  }

  function showClinicalGate(message) {
    $("clinicalGateCopy").textContent = message || "Re-enter your CrewOS PIN. Clinical access lasts 15 minutes and is recorded under your staff identity.";
    $("clinicalGateError").textContent = "";
    $("clinicalPin").value = "";
    $("clinicalGate").classList.remove("hidden");
    $("shell").setAttribute("aria-hidden", "true");
    setTimeout(function () { $("clinicalPin").focus(); }, 80);
  }

  function hideClinicalGate() {
    $("clinicalGate").classList.add("hidden");
    $("shell").setAttribute("aria-hidden", "false");
  }

  async function refreshClinicalReferences() {
    if (!clinicalClient || !clinicalSessionValid(clinicalSession)) return;
    var references = await clinicalClient.listReferences();
    clinicalReferences.clear();
    references.forEach(function (reference) { clinicalReferences.set(reference.id, reference); });
  }

  function populateClinicalPatients() {
    $("clinicalPatient").innerHTML = '<option value="">Select a patient</option>' + clinicalPatients.map(function (patient) {
      return '<option value="' + esc(patient.bhwPatientId) + '">' + esc(patient.displayName + " · " + patient.bhwPatientId) + "</option>";
    }).join("");
    var pinnedPatientAvailable = clinicalDraftPatientId && clinicalPatients.some(function (patient) {
      return patient.bhwPatientId === clinicalDraftPatientId;
    });
    $("clinicalPatient").value = pinnedPatientAvailable ? clinicalDraftPatientId : "";
    $("clinicalPatient").disabled = Boolean(pinnedPatientAvailable);
    $("clinicalAgreement").checked = false;
    $("clinicalConsentStatus").dataset.state = "blocked";
    $("clinicalConsentStatus").textContent = "Select a patient to check recording consent.";
  }

  async function refreshClinicalConsent() {
    clinicalConsent = null;
    $("clinicalAgreement").checked = false;
    var patient = selectedClinicalPatient();
    if (!patient) {
      $("clinicalConsentStatus").dataset.state = "blocked";
      $("clinicalConsentStatus").textContent = "Select a patient to check recording consent.";
      return;
    }
    $("clinicalConsentStatus").dataset.state = "checking";
    $("clinicalConsentStatus").textContent = "Checking signed recording consent…";
    try {
      clinicalConsent = await clinicalClient.recordingConsent(patient.bhwPatientId);
      $("clinicalConsentStatus").dataset.state = clinicalConsent.eligible ? "ready" : "blocked";
      $("clinicalConsentStatus").textContent = clinicalConsent.eligible
        ? "Signed recording and AI-transcription consent is current (" + (clinicalConsent.sourceType || "verified form") + ")."
        : "Recording is blocked until signed recording and AI-transcription consent is verified in the Patient Registry.";
    } catch (error) {
      if (error.code === CLINICAL_LOCKED) showClinicalGate();
      $("clinicalConsentStatus").dataset.state = "blocked";
      $("clinicalConsentStatus").textContent = "Consent could not be verified: " + errorText(error);
    }
  }

  async function handleClinicalUnlock() {
    var pin = $("clinicalPin").value.replace(/\D/g, "");
    if (pin.length < 4 || pin.length > 8) {
      $("clinicalGateError").textContent = "Enter your 4–8 digit CrewOS PIN.";
      return;
    }
    $("clinicalUnlockBtn").disabled = true;
    $("clinicalUnlockBtn").textContent = "Verifying…";
    $("clinicalGateError").textContent = "";
    try {
      clinicalSession = await reauthenticateClinical({ pin: pin });
      clinicalClient = await createClinicalCaptureClient(fetch, { getClinicalSession: function () { return clinicalSession; } });
      if (!clinicalClient) throw new Error("Protected clinical cloud access is not configured for this site");
      clinicalConfig = await clinicalClient.config();
      if (!clinicalConfig.enabled) throw new Error("Clinical Capture has not been enabled in the protected cloud service");
      var loaded = await Promise.all([clinicalClient.listPatients(), clinicalClient.listReferences()]);
      clinicalPatients = loaded[0];
      clinicalReferences.clear();
      loaded[1].forEach(function (reference) { clinicalReferences.set(reference.id, reference); });
      populateClinicalPatients();
      if (clinicalDraftPatientId) await refreshClinicalConsent();
      setModeUi("Clinical");
      scheduleClinicalLock();
      hideClinicalGate();
    } catch (error) {
      lockClinical(false);
      $("clinicalGateError").textContent = errorText(error);
    } finally {
      $("clinicalUnlockBtn").disabled = false;
      $("clinicalUnlockBtn").textContent = "Verify & open Clinical";
    }
  }

  function showAuthGate(message, allowRetry) {
    $("authStatus").textContent = message || "Sign in with your CrewOS staff account to continue.";
    $("authRetry").hidden = !allowRetry;
    $("authGate").classList.remove("hidden");
    $("clinicalGate").classList.add("hidden");
    $("gate").classList.add("hidden");
    $("shell").setAttribute("aria-hidden", "true");
  }

  function showCrewIdentity(user) {
    crewUser = user;
    $("sessionName").textContent = user.name || "BHW staff";
    $("sessionRole").textContent = user.role ? "· " + user.role : user.access ? "· " + user.access : "";
    $("sessionBar").hidden = false;
    $("authGate").classList.add("hidden");
  }

  async function requireCrewSession() {
    $("authStatus").textContent = "Checking your CrewOS session…";
    $("authRetry").hidden = true;
    try {
      var result = await validateCrewSession();
      if (!result.authenticated) {
        showAuthGate(result.reason === "missing" || result.reason === "expired"
          ? "Sign in with your CrewOS staff account to continue."
          : result.message || "Your CrewOS session could not be verified.", result.reason === "unavailable");
        return false;
      }
      showCrewIdentity(result.user);
      return true;
    } catch (error) {
      showAuthGate("CrewOS sign-in verification is temporarily unavailable: " + errorText(error), true);
      return false;
    }
  }

  async function hashPin(pin) {
    var bytes = new TextEncoder().encode("BHW-CAPTURE|" + pin);
    var hash = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(hash)).map(function (value) { return value.toString(16).padStart(2, "0"); }).join("");
  }

  function openGate() {
    var saved = localStorage.getItem(PIN_KEY);
    var identity = crewUser && crewUser.name ? "Signed in as " + crewUser.name + ". " : "";
    $("gateCopy").textContent = saved
      ? identity + "Enter your local BHW Capture PIN."
      : identity + "Set a local 6-digit PIN. This protects the offline cache on this phone; it is not a substitute for device security.";
    $("pinBtn").textContent = saved ? "Open" : "Set PIN & open";
    $("pinInput").value = "";
    $("gateError").textContent = "";
    $("gate").classList.remove("hidden");
    $("shell").setAttribute("aria-hidden", "true");
    setTimeout(function () { $("pinInput").focus(); }, 80);
  }

  function unlock() {
    $("gate").classList.add("hidden");
    sessionStorage.setItem("bhw_capture_unlocked", "1");
    if (isClinical() && !clinicalSessionValid(clinicalSession)) {
      showClinicalGate("Re-enter your CrewOS PIN to resume the protected clinical draft.");
      return;
    }
    $("shell").setAttribute("aria-hidden", "false");
    scheduleSync(40);
  }

  async function handlePin() {
    var pin = $("pinInput").value.replace(/\D/g, "");
    if (pin.length !== 6) {
      $("gateError").textContent = "Use exactly 6 digits.";
      return;
    }
    $("pinBtn").disabled = true;
    $("pinBtn").textContent = "Starting offline cache\u2026";
    try {
      await openDB();
    } catch (error) {
      $("gateError").textContent = "Offline cache could not start. Close other BHW Capture windows and try again: " + errorText(error);
      $("pinBtn").disabled = false;
      $("pinBtn").textContent = "Try again";
      return;
    }
    $("pinBtn").disabled = false;
    var saved = localStorage.getItem(PIN_KEY);
    $("pinBtn").textContent = saved ? "Open" : "Set PIN & open";
    var hash = await hashPin(pin);
    if (!saved) {
      localStorage.setItem(PIN_KEY, hash);
      unlock();
      return;
    }
    if (hash !== saved) {
      $("gateError").textContent = "That PIN does not match.";
      return;
    }
    unlock();
  }

  function readFallbackRecords() {
    var raw = localStorage.getItem(FALLBACK_STORE_KEY);
    if (!raw) return [];
    var parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error("Offline text cache has an invalid format.");
    return parsed;
  }

  function writeFallbackRecords(records) {
    try {
      localStorage.setItem(FALLBACK_STORE_KEY, JSON.stringify(records));
    } catch (error) {
      throw new Error("Offline text cache is full or unavailable: " + errorText(error));
    }
  }

  function enableFallbackCache() {
    // Some embedded phone browsers expose localStorage but not IndexedDB.
    // Keep a text-only cache so captures can still save and reach BHW Memory.
    var records = readFallbackRecords();
    writeFallbackRecords(records);
    cacheFallback = true;
    db = { fallback: true };
    if ($("keepAudio")) {
      $("keepAudio").checked = false;
      $("keepAudio").disabled = true;
    }
    if ($("recordStatus")) {
      $("recordStatus").textContent = "Text-only offline cache ready. Device audio retention is unavailable in this browser.";
    }
    return db;
  }

  function openDB() {
    if (db) return Promise.resolve(db);
    if (dbPromise) return dbPromise;
    if (!globalThis.indexedDB) {
      try {
        return Promise.resolve(enableFallbackCache());
      } catch (error) {
        return Promise.reject(error);
      }
    }
    dbPromise = new Promise(function (resolve, reject) {
      // No Phase 2 schema change is required. Omitting a version opens either
      // the existing v1 cache or any later compatible cache without an
      // upgrade transaction that another browser context could block.
      var request = null;
      var settled = false;
      var timer = setTimeout(function () {
        finishFailure(new Error("Offline cache startup timed out. Close other BHW Capture windows and try again."));
      }, CACHE_STARTUP_TIMEOUT_MS);
      function finishFailure(error) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error || new Error("Offline cache could not start."));
      }
      try {
        request = indexedDB.open(DB_NAME);
      } catch (error) {
        finishFailure(error);
        return;
      }
      request.onupgradeneeded = function () {
        var database = request.result;
        if (!database.objectStoreNames.contains(STORE)) {
          var store = database.createObjectStore(STORE, { keyPath: "id" });
          store.createIndex("createdAt", "createdAt");
          store.createIndex("project", "project");
          store.createIndex("mode", "mode");
        }
      };
      request.onsuccess = function () {
        var database = request.result;
        if (settled) {
          database.close();
          return;
        }
        settled = true;
        clearTimeout(timer);
        db = database;
        database.onversionchange = function () {
          database.close();
          if (db === database) db = null;
          dbPromise = null;
        };
        resolve(database);
      };
      request.onerror = function () { finishFailure(request.error); };
      request.onblocked = function () {
        finishFailure(new Error("Offline cache is open in another BHW Capture window. Close the other window and try again."));
      };
    }).catch(function (indexedDbError) {
      dbPromise = null;
      try {
        return enableFallbackCache();
      } catch (fallbackError) {
        throw new Error(errorText(indexedDbError) + " Text-only fallback also failed: " + errorText(fallbackError));
      }
    });
    return dbPromise;
  }

  function putEntry(entry) {
    return openDB().then(function (database) {
      if (database.fallback) {
        var records = readFallbackRecords();
        var stored = Object.assign({}, entry, { audio: null, audioType: null });
        var existingIndex = records.findIndex(function (record) { return record.id === stored.id; });
        if (existingIndex >= 0) records[existingIndex] = stored;
        else records.push(stored);
        writeFallbackRecords(records);
        return stored;
      }
      return new Promise(function (resolve, reject) {
        var request = database.transaction(STORE, "readwrite").objectStore(STORE).put(entry);
        request.onsuccess = function () { resolve(entry); };
        request.onerror = function () { reject(request.error); };
      });
    });
  }

  function allRecords() {
    return openDB().then(function (database) {
      if (database.fallback) {
        return readFallbackRecords().sort(function (left, right) { return right.createdAt - left.createdAt; });
      }
      return new Promise(function (resolve, reject) {
        var request = database.transaction(STORE, "readonly").objectStore(STORE).getAll();
        request.onsuccess = function () {
          resolve((request.result || []).sort(function (left, right) { return right.createdAt - left.createdAt; }));
        };
        request.onerror = function () { reject(request.error); };
      });
    });
  }

  async function allEntries() {
    return (await allRecords()).filter(function (entry) { return !entry.deletedAt; });
  }

  function getEntry(id) {
    return openDB().then(function (database) {
      if (database.fallback) {
        return readFallbackRecords().find(function (entry) { return entry.id === id; });
      }
      return new Promise(function (resolve, reject) {
        var request = database.transaction(STORE, "readonly").objectStore(STORE).get(id);
        request.onsuccess = function () { resolve(request.result); };
        request.onerror = function () { reject(request.error); };
      });
    });
  }

  function deleteEntry(id) {
    return openDB().then(function (database) {
      if (database.fallback) {
        writeFallbackRecords(readFallbackRecords().filter(function (entry) { return entry.id !== id; }));
        return;
      }
      return new Promise(function (resolve, reject) {
        var request = database.transaction(STORE, "readwrite").objectStore(STORE).delete(id);
        request.onsuccess = function () { resolve(); };
        request.onerror = function () { reject(request.error); };
      });
    });
  }

  function clearEntries() {
    return openDB().then(function (database) {
      if (database.fallback) {
        writeFallbackRecords([]);
        return;
      }
      return new Promise(function (resolve, reject) {
        var request = database.transaction(STORE, "readwrite").objectStore(STORE).clear();
        request.onsuccess = function () { resolve(); };
        request.onerror = function () { reject(request.error); };
      });
    });
  }

  function setSyncUi(state, message) {
    $("syncBar").dataset.state = state;
    $("syncStatus").textContent = message;
    $("syncSignin").hidden = state !== "auth";
    $("syncRetry").hidden = !["error", "offline", "unconfigured"].includes(state);
  }

  function scheduleSync(delay) {
    if (syncTimer) clearTimeout(syncTimer);
    syncTimer = setTimeout(function () { syncMemory(); }, Number(delay) || 0);
  }

  async function syncMemory() {
    if (!db || syncInFlight) return;
    if (navigator.onLine === false) {
      setSyncUi("offline", "Offline · saves stay in this device cache until connection returns");
      return;
    }
    syncInFlight = true;
    setSyncUi("syncing", "Syncing BHW Memory…");
    var activeRecord = null;
    try {
      if (!device) device = getDeviceMetadata();
      if (!cloudClient) cloudClient = await createBhwMemoryCloudClient();
      if (!cloudClient) {
        setSyncUi("unconfigured", "Secure cloud sync is not configured for this site; the offline cache remains available");
        return;
      }

      var records = await allRecords();
      var localOnly = 0;
      for (var i = 0; i < records.length; i += 1) {
        var record = records[i];
        if (record.syncStatus === "synced") continue;
        if (!record.deletedAt && !String(record.transcript || "").trim()) {
          record.syncStatus = "local-only";
          record.lastSyncError = "A transcript is required before this legacy capture can migrate.";
          await putEntry(record);
          localOnly += 1;
          continue;
        }
        activeRecord = record;
        try {
          if (record.deletedAt) {
            await cloudClient.remove(record.id);
            await deleteEntry(record.id);
          } else {
            if (!record.sourceKind) record.sourceKind = "migration";
            var saved = await cloudClient.save(toCloudMemory(record, device));
            await putEntry(fromCloudMemory(saved || toCloudMemory(record, device), record));
          }
        } catch (syncError) {
          record.syncStatus = "error";
          record.lastSyncError = errorText(syncError);
          await putEntry(record);
          throw syncError;
        }
      }
      activeRecord = null;

      var remoteMemories = await cloudClient.list();
      for (var j = 0; j < remoteMemories.length; j += 1) {
        var remote = remoteMemories[j];
        var existing = await getEntry(remote.id);
        if (remote.deletedAt) await deleteEntry(remote.id);
        else await putEntry(fromCloudMemory(remote, existing));
      }
      var visible = await allEntries();
      setSyncUi("synced", "BHW Memory synced · " + visible.length + " memor" + (visible.length === 1 ? "y" : "ies") + (cacheFallback ? " · text-only device cache" : "") + (localOnly ? " · " + localOnly + " device-only legacy item" : ""));
      if (!$("libraryView").classList.contains("hidden")) renderLibrary();
    } catch (error) {
      var status = Number(error && error.status) || 0;
      if (status === 401) {
        cloudClient = null;
        setSyncUi("auth", "Sign in through CrewOS to sync this device; local capture remains available");
      } else if (navigator.onLine === false) {
        setSyncUi("offline", "Offline · saves stay in this device cache until connection returns");
      } else {
        setSyncUi("error", "Sync needs attention · " + errorText(error));
      }
      if (activeRecord && !$("libraryView").classList.contains("hidden")) renderLibrary();
    } finally {
      syncInFlight = false;
    }
  }

  function sentenceParts(text) {
    return text.replace(/\s+/g, " ").trim().split(/[.!?]+\s*/).filter(Boolean);
  }
  function inferProject(text) {
    if (isClinical()) return "24-Hour Documentation";
    var lower = text.toLowerCase();
    var rules = [
      ["PREVENT-ND", ["prevent-nd", "prevent nd", "neurodevelopment", "before psychiatry"]],
      ["PSCM", ["pscm", "physiologic systems", "compensation activation", "amplification network", "energy reserve"]],
      ["CharmEd Minds", ["charmed", "learning disability", "working memory", "processing speed", "executive function"]],
      ["Mind & Mood", ["mind and mood", "mental health", "cocm", "bhi", "psychiatry"]],
      ["Flow", ["vascular", "blood flow", "abi", "tbi", "pwv", "endothelial"]],
      ["EduMedia", ["health irl", "beyond normal", "edumedia", "video idea"]],
      ["BHW Operations", ["crewos", "workflow", "staff", "billing", "front desk", "refill", "check-in", "operations"]],
    ];
    for (var i = 0; i < rules.length; i += 1) {
      if (rules[i][1].some(function (keyword) { return lower.indexOf(keyword) >= 0; })) return rules[i][0];
    }
    return currentMode === "Research" ? "Research" : currentMode === "Operations" ? "BHW Operations" : "Personal work";
  }
  function inferTags(text) {
    var lower = text.toLowerCase();
    var map = [
      ["immune", ["iga", "igg", "immune", "autoimmune", "cytokine"]],
      ["hormones", ["estrogen", "progesterone", "thyroid", "cortisol", "hormone"]],
      ["nutrition", ["zinc", "magnesium", "vitamin", "omega", "nutrition", "micronutrient"]],
      ["neurodevelopment", ["neurodevelopment", "adhd", "autism", "learning", "executive", "processing", "working memory"]],
      ["vascular", ["vascular", "endothelial", "blood flow", "arterial", "abi", "pwv"]],
      ["operations", ["workflow", "staff", "task", "process", "billing", "denial"]],
      ["research", ["study", "research", "hypothesis", "literature", "pilot"]],
      ["education", ["teach", "training", "curriculum", "manual"]],
      ["content", ["video", "post", "content", "episode"]],
    ];
    var out = [];
    map.forEach(function (rule) {
      if (rule[1].some(function (keyword) { return lower.indexOf(keyword) >= 0; })) out.push(rule[0]);
    });
    return out.slice(0, 6);
  }
  function inferActions(text) {
    var expression = /\b(need to|should|remember to|look up|research|follow up|follow-up|create|build|add|check|compare|find|send|write|develop|test|review)\b/i;
    return Array.from(new Set(sentenceParts(text).filter(function (part) { return expression.test(part); }).map(function (part) {
      return part.replace(/^[\-•\s]+/, "").trim();
    }))).slice(0, 6);
  }
  function buildTitle(text) {
    var clean = text.replace(/\s+/g, " ").trim();
    if (!clean) return "Untitled capture";
    var first = clean.split(/[.!?\n]/)[0].trim();
    return first.length > 74 ? first.slice(0, 71) + "…" : first;
  }
  function summarize(text) {
    var clean = text.replace(/\s+/g, " ").trim();
    if (!clean) return "";
    var picked = sentenceParts(clean).slice(0, 2).join(". ");
    if (picked && /[A-Za-z0-9]$/.test(picked)) picked += ".";
    return picked.length > 320 ? picked.slice(0, 317) + "…" : picked;
  }
  function organize() {
    var text = $("transcript").value.trim();
    var projectChoice = $("project").value;
    var project = (!projectPinned || projectChoice === "Auto") ? inferProject(text) : projectChoice;
    var title = titlePinned && $("title").value.trim() ? $("title").value.trim() : buildTitle(text);
    return { title: title, project: project, tags: inferTags(text), actions: inferActions(text), summary: summarize(text) };
  }
  function renderPreview() {
    var text = $("transcript").value.trim();
    var box = $("organized");
    try {
      if (!text) {
        box.innerHTML = '<h3>Add a transcript first</h3><div class="kv"><b>Status</b><span>' + (isClinical() ? "Record, type, or paste the patient-linked draft, then preview again." : "Record, type, or paste a non-PHI thought, then preview again.") + "</span></div>";
        box.classList.remove("hidden");
        return null;
      }
      var organized = organize();
      if (!titlePinned) $("title").value = organized.title;
      if (!projectPinned && Array.from($("project").options).some(function (option) { return option.value === organized.project; })) $("project").value = organized.project;
      box.innerHTML = "<h3>" + esc(organized.title) + '</h3><div class="kv"><b>Project</b><span>' + esc(organized.project) + "</span><b>Summary</b><span>" + esc(organized.summary || "Add more detail to generate a useful summary.") + "</span><b>Tags</b><span>" + esc(organized.tags.join(", ") || "—") + "</span><b>Actions</b><span>" + (organized.actions.length ? '<ul class="actions">' + organized.actions.map(function (action) { return "<li>" + esc(action) + "</li>"; }).join("") + "</ul>" : "—") + "</span></div>";
      box.classList.remove("hidden");
      return organized;
    } catch (error) {
      box.innerHTML = '<h3>Could not organize this capture</h3><div class="kv"><b>Status</b><span>' + esc(errorText(error)) + "</span></div>";
      box.classList.remove("hidden");
      return null;
    }
  }

  function setCaptureBusy(busy) {
    transcriptionBusy = busy;
    $("micBtn").disabled = busy;
    $("organizeBtn").disabled = busy;
    $("saveBtn").disabled = busy;
  }
  function cleanAudioType(type) {
    return String(type || "audio/webm").split(";")[0].trim().toLowerCase() || "audio/webm";
  }
  function combineTranscript(base, spoken) {
    base = String(base || "").trim();
    spoken = String(spoken || "").trim();
    return base && spoken ? base + "\n\n" + spoken : (base || spoken);
  }
  async function transcribeRecording(blob, runId, protectedPatientId) {
    if (!blob || !blob.size) {
      $("recordStatus").textContent = "The recording was empty. Try again or type your thought.";
      return;
    }
    var maxBytes = isClinical() ? Number(clinicalConfig && clinicalConfig.maxAudioBytes) || 9 * 1024 * 1024 : MAX_TRANSCRIPTION_BYTES;
    if (blob.size > maxBytes) {
      $("recordStatus").textContent = "Recording ready, but it is too large for automatic transcription. Shorten it or type a transcript.";
      if ($("transcript").value.trim()) renderPreview();
      return;
    }
    setCaptureBusy(true);
    $("recordLabel").textContent = "Transcribing…";
    $("recordStatus").textContent = isClinical()
      ? "Sending this recording through the protected Google Cloud transcription path…"
      : "Sending this non-PHI recording for server transcription…";
    try {
      var data;
      if (isClinical()) {
        if (!clinicalSessionValid(clinicalSession) || !clinicalClient) throw Object.assign(new Error("Clinical mode is locked"), { code: CLINICAL_LOCKED });
        if (!protectedPatientId) throw new Error("Select a patient before transcribing");
        data = await clinicalClient.transcribe(blob, protectedPatientId);
      } else {
        var response = await fetch("/.netlify/functions/bhw-capture-transcribe", {
          method: "POST",
          headers: { "Content-Type": cleanAudioType(blob.type), "X-BHW-Capture-Non-PHI": "true" },
          body: blob,
        });
        data = {};
        try { data = await response.json(); } catch { /* response had no JSON */ }
        if (!response.ok) throw new Error(data.error || "Transcription service returned " + response.status);
      }
      if (runId !== transcriptionRun) return;
      var spoken = String(data.transcript || "").trim();
      if (!spoken) throw new Error("No speech was detected");
      $("transcript").value = combineTranscript(recordingTextBase, spoken);
      var organized = renderPreview();
      var kept = !isClinical() && $("keepAudio").checked;
      if (!kept) {
        audioBlob = null;
        chunks = [];
      }
      $("recordStatus").textContent = "Transcript ready" + (organized ? " · organization generated" : "") + (kept ? " · audio kept on this device only." : " · raw audio discarded.");
    } catch (error) {
      if (runId !== transcriptionRun) return;
      if (error.code === CLINICAL_LOCKED) showClinicalGate();
      if ($("transcript").value.trim()) renderPreview();
      $("recordStatus").textContent = "Automatic transcription was unavailable (" + errorText(error) + "). Type or paste the " + (isClinical() ? "clinical draft" : "non-PHI text") + " before saving.";
    } finally {
      if (runId === transcriptionRun) {
        setCaptureBusy(false);
        $("recordLabel").textContent = "Tap to capture";
      }
    }
  }
  function speechCtor() { return window.SpeechRecognition || window.webkitSpeechRecognition || null; }
  function startSpeech() {
    if (isClinical()) return;
    var SpeechRecognition = speechCtor();
    if (!SpeechRecognition || !$("liveSpeech").checked) {
      if ($("liveSpeech").checked && !SpeechRecognition) $("recordStatus").textContent = "Live speech-to-text is not available in this browser; server transcription will still run.";
      return;
    }
    try {
      recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = "en-US";
      speechBase = $("transcript").value.trim();
      recognition.onresult = function (event) {
        var finalText = "";
        var interim = "";
        for (var i = event.resultIndex; i < event.results.length; i += 1) {
          var transcript = event.results[i][0].transcript;
          if (event.results[i].isFinal) finalText += transcript + " ";
          else interim += transcript;
        }
        if (finalText) speechBase = (speechBase + " " + finalText).trim();
        $("transcript").value = (speechBase + (interim ? " " + interim : "")).trim();
      };
      recognition.onerror = function (event) {
        if (event.error !== "no-speech") $("recordStatus").textContent = "Live speech-to-text stopped (" + event.error + "). Audio recording continues.";
      };
      recognition.onend = function () {
        if (recorder && recorder.state === "recording") {
          try { recognition.start(); } catch { /* recognition already starting */ }
        }
      };
      recognition.start();
    } catch {
      recognition = null;
      $("recordStatus").textContent = "Could not start live speech-to-text. Audio recording continues.";
    }
  }
  function stopSpeech() {
    if (!recognition) return;
    try { recognition.onend = null; recognition.stop(); } catch { /* already stopped */ }
    recognition = null;
  }
  async function startRecording() {
    if (transcriptionBusy) return;
    if (isClinical()) {
      $("recordStatus").textContent = "Use Open full Visit Transcription above for patient audio. Clinical Capture remains available for typed drafts.";
      return;
    }
    var protectedPatientId = "";
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder) {
      $("recordStatus").textContent = "This browser cannot record audio here. You can still type or paste a thought.";
      return;
    }
    setCaptureBusy(true);
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      chunks = [];
      audioBlob = null;
      captureHadAudio = false;
      recordedDurationMs = 0;
      recordingTextBase = $("transcript").value.trim();
      var runId = ++transcriptionRun;
      var options = {};
      if (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) options.mimeType = "audio/webm;codecs=opus";
      var activeRecorder = new MediaRecorder(stream, options);
      if (protectedPatientId) {
        clinicalDraftPatientId = protectedPatientId;
        $("clinicalPatient").value = protectedPatientId;
        $("clinicalPatient").disabled = true;
      }
      recorder = activeRecorder;
      activeRecorder.ondataavailable = function (event) { if (event.data && event.data.size) chunks.push(event.data); };
      activeRecorder.onstop = function () {
        audioBlob = new Blob(chunks, { type: activeRecorder.mimeType || "audio/webm" });
        captureHadAudio = Boolean(audioBlob.size);
        if (stream) stream.getTracks().forEach(function (track) { track.stop(); });
        stream = null;
        if (recorder === activeRecorder) recorder = null;
        transcribeRecording(audioBlob, runId, protectedPatientId);
      };
      activeRecorder.start(1000);
      setCaptureBusy(false);
      startedAt = Date.now();
      timerId = setInterval(function () { $("timer").textContent = fmtTime(Date.now() - startedAt); }, 250);
      $("micBtn").classList.add("recording");
      $("recordLabel").textContent = "Recording · tap to stop";
      $("recordStatus").textContent = isClinical() ? "Listening… protected Clinical mode." : "Listening… non-PHI only.";
      startSpeech();
    } catch (error) {
      setCaptureBusy(false);
      if (stream) stream.getTracks().forEach(function (track) { track.stop(); });
      stream = null;
      $("recordStatus").textContent = "Microphone permission was not available: " + errorText(error);
    }
  }
  function stopRecording() {
    if (!recorder || recorder.state === "inactive") return;
    recordedDurationMs = Math.max(0, Date.now() - startedAt);
    stopSpeech();
    recorder.stop();
    if (timerId) clearInterval(timerId);
    timerId = null;
    $("micBtn").classList.remove("recording");
    $("recordLabel").textContent = "Finishing recording…";
    $("recordStatus").textContent = isClinical() ? "Preparing protected clinical transcription…" : "Preparing automatic non-PHI transcription…";
  }
  function resetCapture() {
    if (recorder && recorder.state === "recording") stopRecording();
    transcriptionRun += 1;
    setCaptureBusy(false);
    $("transcript").value = "";
    $("title").value = "";
    $("project").value = "Auto";
    $("organized").classList.add("hidden");
    $("timer").textContent = "00:00";
    $("keepAudio").checked = false;
    $("clinicalPatient").value = "";
    $("clinicalAgreement").checked = false;
    clinicalConsent = null;
    clinicalDraftId = "";
    clinicalDraftPatientId = "";
    $("clinicalPatient").disabled = false;
    $("clinicalConsentStatus").dataset.state = "blocked";
    $("clinicalConsentStatus").textContent = "Select a patient to check recording consent.";
    audioBlob = null;
    captureHadAudio = false;
    chunks = [];
    startedAt = 0;
    recordedDurationMs = 0;
    recordingTextBase = "";
    titlePinned = false;
    projectPinned = false;
    setModeUi("Brain Dump");
  }

  async function saveClinicalCapture() {
    if (transcriptionBusy) { alert("Wait for transcription to finish before saving."); return; }
    if (!clinicalSessionValid(clinicalSession) || !clinicalClient) { showClinicalGate(); return; }
    if (recorder && recorder.state === "recording") { alert("Stop the recording before saving."); return; }
    var patient = selectedClinicalPatient();
    if (!patient) { alert("Select the patient for this clinical draft."); return; }
    if (clinicalDraftPatientId && patient.bhwPatientId !== clinicalDraftPatientId) {
      alert("This recorded draft is locked to its original patient. Discard it before selecting another patient.");
      return;
    }
    var text = $("transcript").value.trim();
    if (!text) { alert("Add a transcript or typed clinical draft before saving."); return; }
    var organized = organize();
    var captureId = clinicalDraftId || (clinicalDraftId = uid());
    setCaptureBusy(true);
    $("recordStatus").textContent = "Sending the protected draft to 24-Hour Documentation…";
    try {
      var result = await clinicalClient.saveCapture({
        id: captureId,
        createdAt: new Date().toISOString(),
        bhwPatientId: patient.bhwPatientId,
        title: organized.title,
        sourceTranscript: text,
        sourceKind: captureHadAudio ? (recordingTextBase ? "mixed" : "voice") : "typed",
        durationMs: recordedDurationMs,
      });
      if (result.reference) clinicalReferences.set(result.reference.id, result.reference);
      audioBlob = null;
      chunks = [];
      resetCapture();
      document.querySelector('[data-tab="library"]').click();
    } catch (error) {
      if (error.code === CLINICAL_LOCKED) showClinicalGate();
      $("recordStatus").textContent = "Protected save failed: " + errorText(error) + ". This draft remains only in the current screen; do not close it until saved.";
    } finally {
      setCaptureBusy(false);
    }
  }

  async function saveCapture() {
    if (isClinical()) return saveClinicalCapture();
    if (transcriptionBusy) { alert("Wait for transcription to finish before saving."); return; }
    var text = $("transcript").value.trim();
    if (!text) { alert("Add a transcript or typed non-PHI thought before saving. Raw audio is not stored in BHW Memory."); return; }
    if (recorder && recorder.state === "recording") { alert("Stop the recording before saving."); return; }
    var organized = organize();
    var keepAudio = $("keepAudio").checked && audioBlob;
    var now = Date.now();
    var entry = {
      id: uid(),
      createdAt: now,
      updatedAt: now,
      mode: currentMode,
      title: organized.title,
      project: organized.project,
      tags: organized.tags,
      actions: organized.actions,
      summary: organized.summary,
      transcript: text,
      audio: keepAudio ? audioBlob : null,
      audioType: keepAudio ? audioBlob.type : null,
      durationMs: recordedDurationMs,
      sourceKind: captureHadAudio ? (recordingTextBase ? "mixed" : "voice") : "typed",
      syncStatus: "pending",
      lastSyncError: "",
      deletedAt: "",
      version: 3,
    };
    try {
      await putEntry(entry);
      resetCapture();
      document.querySelector('[data-tab="library"]').click();
      scheduleSync(20);
    } catch (error) {
      alert("Could not save to the offline cache: " + errorText(error));
    }
  }

  async function renderFilters(entries) {
    var projects = ["All"].concat(Array.from(new Set(entries.map(function (entry) { return entry.project; }).filter(Boolean))).sort());
    $("filters").innerHTML = projects.map(function (project) {
      return '<button class="chip' + (project === filterProject ? " active" : "") + '" data-filter="' + esc(project) + '">' + esc(project) + "</button>";
    }).join("");
    Array.from($("filters").querySelectorAll("[data-filter]")).forEach(function (button) {
      button.onclick = function () { filterProject = button.dataset.filter; renderLibrary(); };
    });
  }
  function syncBadge(entry) {
    if (entry.clinicalReference) return '<span class="badge">protected</span>';
    if (entry.syncStatus === "synced") return '<span class="badge">synced</span>';
    if (entry.syncStatus === "local-only") return '<span class="badge">device only</span>';
    if (entry.syncStatus === "error") return '<span class="badge">retry needed</span>';
    return '<span class="badge">pending sync</span>';
  }
  async function renderLibrary() {
    var entries = (await allEntries()).concat(Array.from(clinicalReferences.values()).map(clinicalReferenceEntry));
    var query = $("search").value.trim().toLowerCase();
    await renderFilters(entries);
    var shown = entries.filter(function (entry) {
      if (filterProject !== "All" && entry.project !== filterProject) return false;
      if (!query) return true;
      return [entry.title, entry.project, entry.mode, entry.summary, entry.transcript, (entry.tags || []).join(" "), (entry.actions || []).join(" ")].join(" ").toLowerCase().indexOf(query) >= 0;
    });
    if (!shown.length) {
      $("memoryList").innerHTML = '<div class="empty">' + (entries.length ? "No matching memories." : "No captures yet. Your first brain dump will appear here.") + "</div>";
      return;
    }
    $("memoryList").innerHTML = shown.map(function (entry) {
      return '<button class="memory' + (entry.clinicalReference ? " clinical-memory" : "") + '" data-id="' + entry.id + '"><div class="memory-top"><h3>' + esc(entry.title) + '</h3><span class="date">' + esc(fmtDate(entry.createdAt)) + '</span></div><div class="badges"><span class="badge project">' + esc(entry.project) + '</span><span class="badge">' + esc(entry.mode) + "</span>" + syncBadge(entry) + (entry.audio ? '<span class="badge">device audio</span>' : "") + (entry.tags || []).slice(0, 3).map(function (tag) { return '<span class="badge">' + esc(tag) + "</span>"; }).join("") + "</div><p>" + esc(entry.summary || entry.transcript) + "</p></button>";
    }).join("");
    Array.from($("memoryList").querySelectorAll("[data-id]")).forEach(function (button) {
      button.onclick = function () { openDetail(button.dataset.id); };
    });
  }
  async function openDetail(id) {
    var protectedReference = id.indexOf("clinical:") === 0
      ? clinicalReferences.get(id.slice("clinical:".length)) : null;
    var entry = protectedReference ? clinicalReferenceEntry(protectedReference) : await getEntry(id);
    if (!entry || entry.deletedAt) return;
    currentDetail = entry;
    $("detailMeta").textContent = fmtDate(entry.createdAt) + " · " + entry.mode + " · " + (entry.clinicalReference ? "Protected cloud reference" : entry.syncStatus === "synced" ? "Cloud synced" : entry.syncStatus === "local-only" ? "Device only" : "Sync pending");
    $("detailTitle").textContent = entry.title;
    $("detailBadges").innerHTML = '<span class="badge project">' + esc(entry.project) + "</span>" + syncBadge(entry) + (entry.tags || []).map(function (tag) { return '<span class="badge">' + esc(tag) + "</span>"; }).join("");
    $("detailSummary").innerHTML = entry.clinicalReference
      ? '<div class="kv"><b>Patient</b><span>' + esc(clinicalPatientLabel(entry.bhwPatientId)) + '</span><b>Encounter</b><span>' + esc(entry.encounterId || "Protected draft") + "</span></div>"
      : '<div class="kv"><b>Summary</b><span>' + esc(entry.summary || "—") + "</span><b>Actions</b><span>" + (entry.actions && entry.actions.length ? '<ul class="actions">' + entry.actions.map(function (action) { return "<li>" + esc(action) + "</li>"; }).join("") + "</ul>" : "—") + "</span></div>";
    $("detailText").textContent = entry.clinicalReference
      ? "The clinical transcript is stored only inside the protected encounter packet. Open 24-Hour Documentation to review and complete it."
      : entry.transcript || "No text transcript was saved.";
    var audio = $("detailAudio");
    if (entry.audio) {
      audio.src = URL.createObjectURL(entry.audio);
      audio.classList.remove("hidden");
    } else {
      audio.removeAttribute("src");
      audio.classList.add("hidden");
    }
    $("openEncounterBtn").classList.toggle("hidden", !entry.clinicalReference);
    $("openEncounterBtn").href = entry.clinicalReference
      ? "/provider/workflow.html?encounter=" + encodeURIComponent(entry.encounterId || "")
      : "/provider/workflow.html";
    $("copyBtn").classList.toggle("hidden", Boolean(entry.clinicalReference));
    $("deleteBtn").classList.toggle("hidden", Boolean(entry.clinicalReference));
    $("detailSheet").classList.remove("hidden");
  }
  function closeDetail() {
    var audio = $("detailAudio");
    if (audio.src && audio.src.indexOf("blob:") === 0) URL.revokeObjectURL(audio.src);
    audio.removeAttribute("src");
    $("detailSheet").classList.add("hidden");
    currentDetail = null;
  }
  async function exportMemory() {
    var entries = await allEntries();
    var clean = entries.map(function (entry) {
      return {
        id: entry.id,
        createdAt: new Date(entry.createdAt).toISOString(),
        updatedAt: new Date(entry.updatedAt || entry.createdAt).toISOString(),
        mode: entry.mode,
        title: entry.title,
        project: entry.project,
        tags: entry.tags,
        actions: entry.actions,
        summary: entry.summary,
        transcript: entry.transcript,
        syncStatus: entry.syncStatus,
        hasDeviceAudio: Boolean(entry.audio),
        durationMs: entry.durationMs || 0,
      };
    });
    var blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), product: "BHW Capture", entries: clean }, null, 2)], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "bhw-capture-memory-" + new Date().toISOString().slice(0, 10) + ".json";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function bind() {
    $("pinInput").addEventListener("input", function () { this.value = this.value.replace(/\D/g, "").slice(0, 6); });
    $("pinInput").addEventListener("keydown", function (event) { if (event.key === "Enter") handlePin(); });
    $("pinBtn").onclick = handlePin;
    $("clinicalPin").addEventListener("input", function () { this.value = this.value.replace(/\D/g, "").slice(0, 8); });
    $("clinicalPin").addEventListener("keydown", function (event) { if (event.key === "Enter") handleClinicalUnlock(); });
    $("clinicalUnlockBtn").onclick = handleClinicalUnlock;
    $("clinicalCancelBtn").onclick = function () {
      if (isClinical() && $("transcript").value.trim() && !confirm("Discard the unsaved clinical draft and leave Clinical mode?")) return;
      if (isClinical()) resetCapture();
      hideClinicalGate();
    };
    $("crewSigninBtn").href = crewosSigninUrl();
    $("authRetry").onclick = async function () {
      $("authRetry").hidden = true;
      if (await requireCrewSession()) startLocalCache();
    };
    $("logoutBtn").onclick = function () {
      if (recorder && recorder.state === "recording") {
        alert("Stop and save or discard the current recording before signing out.");
        return;
      }
      clearCrewSession();
      lockClinical(false);
      sessionStorage.removeItem("bhw_capture_unlocked");
      crewUser = null;
      $("sessionBar").hidden = true;
      location.replace(crewosSigninUrl());
    };
    $("lockBtn").onclick = function () {
      lockClinical(false);
      sessionStorage.removeItem("bhw_capture_unlocked");
      openGate();
    };
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) hiddenAt = Date.now();
      else if (hiddenAt && Date.now() - hiddenAt > 5 * 60 * 1000) {
        lockClinical(false);
        sessionStorage.removeItem("bhw_capture_unlocked");
        openGate();
      } else scheduleSync(50);
    });
    document.querySelectorAll("[data-mode]").forEach(function (button) {
      button.onclick = function () {
        if (button.disabled) return;
        if ((recorder && recorder.state === "recording") || transcriptionBusy) {
          alert("Stop the recording and wait for transcription before changing capture mode.");
          return;
        }
        var nextMode = button.dataset.mode;
        if (nextMode === "Clinical") {
          if (clinicalSessionValid(clinicalSession) && clinicalClient) setModeUi("Clinical");
          else showClinicalGate();
          return;
        }
        if (isClinical()) {
          if ($("transcript").value.trim() && !confirm("Discard the unsaved clinical draft before leaving Clinical mode?")) return;
          resetCapture();
        }
        setModeUi(nextMode);
      };
    });
    document.querySelectorAll(".tab").forEach(function (button) {
      button.onclick = function () {
        document.querySelectorAll(".tab").forEach(function (item) { item.classList.toggle("active", item === button); });
        var capture = button.dataset.tab === "capture";
        $("captureView").classList.toggle("hidden", !capture);
        $("libraryView").classList.toggle("hidden", capture);
        if (!capture) {
          if (clinicalSessionValid(clinicalSession) && clinicalClient) {
            refreshClinicalReferences().then(renderLibrary).catch(function (error) {
              if (error.code === CLINICAL_LOCKED) lockClinical(false);
              renderLibrary();
            });
          } else renderLibrary();
          scheduleSync(30);
        }
      };
    });
    $("clinicalPatient").addEventListener("change", refreshClinicalConsent);
    $("organizeBtn").onclick = renderPreview;
    $("micBtn").onclick = function () { if (recorder && recorder.state === "recording") stopRecording(); else startRecording(); };
    $("saveBtn").onclick = saveCapture;
    $("transcript").addEventListener("input", function () { $("organized").classList.add("hidden"); });
    $("title").addEventListener("input", function () { titlePinned = Boolean(this.value.trim()); $("organized").classList.add("hidden"); });
    $("project").addEventListener("change", function () { projectPinned = this.value !== "Auto"; $("organized").classList.add("hidden"); });
    $("search").addEventListener("input", renderLibrary);
    $("syncRetry").onclick = function () { cloudClient = null; scheduleSync(0); };
    $("detailClose").onclick = closeDetail;
    $("detailSheet").addEventListener("click", function (event) { if (event.target === $("detailSheet")) closeDetail(); });
    $("deleteBtn").onclick = async function () {
      if (currentDetail && currentDetail.clinicalReference) return;
      if (!currentDetail || !confirm("Delete this memory from BHW Memory and every synced device?")) return;
      var tombstone = {
        id: currentDetail.id,
        createdAt: currentDetail.createdAt,
        updatedAt: Date.now(),
        deletedAt: new Date().toISOString(),
        syncStatus: "pending",
        lastSyncError: "",
        version: 3,
      };
      await putEntry(tombstone);
      closeDetail();
      renderLibrary();
      scheduleSync(10);
    };
    $("copyBtn").onclick = async function () {
      if (!currentDetail || currentDetail.clinicalReference) return;
      var text = currentDetail.title + "\n\n" + (currentDetail.summary || currentDetail.transcript || "") + (currentDetail.actions && currentDetail.actions.length ? "\n\nActions:\n- " + currentDetail.actions.join("\n- ") : "");
      try {
        await navigator.clipboard.writeText(text);
        $("copyBtn").textContent = "Copied";
        setTimeout(function () { $("copyBtn").textContent = "Copy summary"; }, 1200);
      } catch { alert("Copy was not available."); }
    };
    $("exportBtn").onclick = exportMemory;
    $("clearBtn").onclick = async function () {
      var records = await allRecords();
      var unsynced = records.filter(function (entry) { return entry.syncStatus !== "synced"; });
      if (unsynced.length) {
        alert("This cache contains " + unsynced.length + " item(s) that are not safely synced. Retry sync before clearing it.");
        return;
      }
      if (!confirm("Clear only this device cache? Cloud-synced memories will download again.")) return;
      await clearEntries();
      filterProject = "All";
      await renderLibrary();
      scheduleSync(10);
    };
    window.addEventListener("online", function () { scheduleSync(20); });
    window.addEventListener("offline", function () { setSyncUi("offline", "Offline · saves stay in this device cache until connection returns"); });
    window.addEventListener("beforeinstallprompt", function (event) { event.preventDefault(); deferredInstall = event; $("installBtn").style.display = "inline-flex"; });
    $("installBtn").onclick = async function () {
      if (!deferredInstall) return;
      deferredInstall.prompt();
      await deferredInstall.userChoice;
      deferredInstall = null;
      $("installBtn").style.display = "none";
    };
    window.addEventListener("appinstalled", function () { $("installBtn").style.display = "none"; });
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/bhw-capture-sw.js").catch(function () {});
  }

  function startLocalCache() {
    return openDB().then(function () {
      if (!crewUser) return;
      if (sessionStorage.getItem("bhw_capture_unlocked") === "1") unlock();
      else openGate();
    }).catch(function (error) {
      openGate();
      $("gateError").textContent = "Offline cache could not start. Close other BHW Capture windows and try again: " + errorText(error);
      setSyncUi("error", "Offline cache needs attention \u00b7 " + errorText(error));
    });
  }

  bind();
  requireCrewSession().then(function (authenticated) {
    if (!authenticated) return;
    startLocalCache();
  });
})();


