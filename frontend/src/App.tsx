import { useEffect, useRef, useState } from "react";
import "./styles.css";
import { CircleMarker, MapContainer, Popup, TileLayer } from "react-leaflet";
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  Camera,
  CheckCircle2,
  Clock,
  Compass,
  Cpu,
  ExternalLink,
  Flame,
  Gauge,
  History,
  Layers,
  LayoutDashboard,
  LogIn,
  LogOut,
  MapPin,
  MessageSquarePlus,
  RefreshCw,
  Send,
  Shield,
  ShieldAlert,
  Sparkles,
  Waves,
  X,
} from "lucide-react";

import {
  createReading,
  getCommunityReports,
  getDashboardSummary,
  getIncidents,
  getLatestReadings,
  getUnderpassEvents,
  getUnderpassMetrics,
  getUnderpassRisk,
  submitCommunityReport,
  updateIncidentStatus,
} from "./api/client";
import {
  authConfigured,
  beginSignIn,
  endSession,
  isSignedIn,
} from "./auth";
import { PublicLanding } from "./PublicLanding";
import type {
  CommunityReport,
  CommunityReportStatus,
  DashboardSummary,
  Incident,
  IncidentStatus,
  SensorReading,
  UnderpassEvaluationMetrics,
  UnderpassEventRecord,
  UnderpassRiskItem,
  UnderpassRiskResponse,
} from "./types/api";

const tierColors: Record<string, string> = {
  green: "#16a34a",
  yellow: "#ca8a04",
  orange: "#ea580c",
  red: "#dc2626",
  unknown: "#78716c",
};

const statusTransitions: Record<IncidentStatus, IncidentStatus[]> = {
  open: ["assigned", "verified", "dismissed"],
  assigned: ["verified", "resolved", "dismissed"],
  verified: ["resolved", "dismissed"],
  resolved: [],
  dismissed: [],
};

function formatLocalTime(value: string) {
  try {
    return new Intl.DateTimeFormat("en-IN", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function timeAgo(dateString: string): string {
  const diffSec = Math.floor((Date.now() - new Date(dateString).getTime()) / 1000);
  if (diffSec < 60) return "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHours = Math.floor(diffMin / 60);
  return `${diffHours}h ago`;
}

export default function App() {
  const [surface, setSurface] = useState<"public" | "dashboard">(() =>
    window.location.hash.startsWith("#/dashboard") ? "dashboard" : "public",
  );
  const [activeTab, setActiveTab] = useState<"landing" | "underpass" | "infrastructure" | "replay">("landing");
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [readings, setReadings] = useState<SensorReading[]>([]);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [selectedIncidentId, setSelectedIncidentId] = useState<string | null>(null);
  const [riskData, setRiskData] = useState<UnderpassRiskResponse | null>(null);
  const [selectedHotspotId, setSelectedHotspotId] = useState<string>("");
  const [communityReports, setCommunityReports] = useState<CommunityReport[]>([]);
  const [metrics, setMetrics] = useState<UnderpassEvaluationMetrics | null>(null);
  const [events, setEvents] = useState<UnderpassEventRecord[]>([]);
  const [selectedReplayDate, setSelectedReplayDate] = useState<string>("2024-06-28");
  const [mapTierFilter, setMapTierFilter] = useState<string>("ALL");

  const [loading, setLoading] = useState(false);
  const [coreError, setCoreError] = useState<string | null>(null);
  const [reportError, setReportError] = useState<string | null>(null);
  const [underpassError, setUnderpassError] = useState<string | null>(null);
  const [simulating, setSimulating] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [authenticated, setAuthenticated] = useState(!authConfigured);
  const [authLoading, setAuthLoading] = useState(authConfigured);

  // Field Report Modal State
  const [showModal, setShowModal] = useState(false);
  const [modalHotspotId, setModalHotspotId] = useState<string>("");
  const [reportLatitude, setReportLatitude] = useState("");
  const [reportLongitude, setReportLongitude] = useState("");
  const [reportRequestId, setReportRequestId] = useState(() => crypto.randomUUID());
  const [reportStatus, setReportStatus] = useState<CommunityReportStatus>("flooded");
  const [reportNotes, setReportNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const modalRef = useRef<HTMLDivElement>(null);

  // Real-time IST clock
  const [currentTime, setCurrentTime] = useState("");
  useEffect(() => {
    const updateClock = () => {
      const now = new Date();
      setCurrentTime(
        now.toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour12: false }) + " IST",
      );
    };
    updateClock();
    const interval = setInterval(updateClock, 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!authConfigured) return;
    void isSignedIn()
      .then(setAuthenticated)
      .finally(() => setAuthLoading(false));
  }, []);

  useEffect(() => {
    const syncRoute = () => {
      const nextSurface = window.location.hash.startsWith("#/dashboard") ? "dashboard" : "public";
      setSurface(nextSurface);
      if (nextSurface === "dashboard") {
        const requestedView = window.location.hash.split("/")[2];
        if (["landing", "underpass", "infrastructure", "replay"].includes(requestedView)) {
          setActiveTab(requestedView as "landing" | "underpass" | "infrastructure" | "replay");
        }
      }
    };
    syncRoute();
    window.addEventListener("hashchange", syncRoute);
    window.addEventListener("popstate", syncRoute);
    return () => {
      window.removeEventListener("hashchange", syncRoute);
      window.removeEventListener("popstate", syncRoute);
    };
  }, []);

  useEffect(() => {
    if (!showModal) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = modalRef.current;
    const focusable = dialog?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href]',
    );
    focusable?.[0]?.focus();

    const handleDialogKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !submitting) {
        setShowModal(false);
        return;
      }
      if (event.key !== "Tab" || !focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleDialogKeyDown);
    return () => {
      document.removeEventListener("keydown", handleDialogKeyDown);
      previousFocus?.focus();
    };
  }, [showModal, submitting]);

  useEffect(() => {
    if (surface !== "dashboard") {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setCoreError(null);
    setReportError(null);
    setUnderpassError(null);

    async function loadDashboard() {
      const [coreResult, reportsResult, underpassResult] = await Promise.allSettled([
        Promise.all([
          getDashboardSummary(controller.signal),
          getLatestReadings(controller.signal),
          getIncidents(controller.signal),
        ]),
        getCommunityReports(undefined, controller.signal),
        Promise.all([
          getUnderpassRisk(controller.signal),
          getUnderpassMetrics(controller.signal),
          getUnderpassEvents(undefined, controller.signal),
        ]),
      ]);

      if (coreResult.status === "fulfilled") {
        const [nextSummary, nextReadings, nextIncidents] = coreResult.value;
        setSummary(nextSummary);
        setReadings(nextReadings);
        setIncidents(nextIncidents);
        setSelectedIncidentId((current) => current ?? nextIncidents[0]?.incident_id ?? null);
      } else if (!controller.signal.aborted) {
        setSummary(null);
        setReadings([]);
        setIncidents([]);
        setSelectedIncidentId(null);
        setCoreError(coreResult.reason instanceof Error ? coreResult.reason.message : "Core API data is unavailable.");
      }

      if (reportsResult.status === "fulfilled") {
        setCommunityReports(reportsResult.value);
      } else if (!controller.signal.aborted) {
        setCommunityReports([]);
        setReportError(
          reportsResult.reason instanceof Error
            ? reportsResult.reason.message
            : "Community reports are unavailable.",
        );
      }

      if (underpassResult.status === "fulfilled") {
        const [nextRisk, nextMetrics, nextEvents] = underpassResult.value;
        setRiskData(nextRisk);
        setMetrics(nextMetrics);
        setEvents(nextEvents);
        if (nextEvents.length) {
          setSelectedReplayDate((current) =>
            nextEvents.some((event) => event.date === current) ? current : nextEvents[0].date,
          );
        }
        if (nextRisk.hotspots.length) {
          const firstHotspot = nextRisk.hotspots[0];
          setSelectedHotspotId((current) => current || nextRisk.hotspots[0].id);
          setModalHotspotId((current) => current || nextRisk.hotspots[0].id);
          setReportLatitude((current) => current || String(firstHotspot.lat));
          setReportLongitude((current) => current || String(firstHotspot.lon));
        }
      } else if (!controller.signal.aborted) {
        setRiskData(null);
        setMetrics(null);
        setEvents([]);
        setUnderpassError(
          underpassResult.reason instanceof Error
            ? underpassResult.reason.message
            : "Underpass dataset is unavailable.",
        );
      }

      if (!controller.signal.aborted) setLoading(false);
    }

    void loadDashboard();

    return () => controller.abort();
  }, [reloadKey, surface]);

  const selectedIncident =
    incidents.find((inc) => inc.incident_id === selectedIncidentId) ?? incidents[0] ?? null;

  const selectedHotspot: UnderpassRiskItem | null =
    riskData?.hotspots?.find((h) => h.id === selectedHotspotId) ??
    riskData?.hotspots?.[0] ??
    null;

  const activeCommunityReports = communityReports.filter(
    (report) => Date.now() - new Date(report.timestamp).getTime() < 45 * 60 * 1000,
  );

  const hotspotReports = activeCommunityReports.filter(
    (rep) => !selectedHotspotId || rep.hotspot_id === selectedHotspotId,
  );

  // Evidence conflict detection (model vs ground truth)
  const evidenceConflict = (() => {
    if (!selectedHotspot || hotspotReports.length === 0) return false;
    const latest = hotspotReports[0];
    const isSevereRisk = selectedHotspot.tier === "orange" || selectedHotspot.tier === "red";
    const isUserClear = latest.status === "passable" || latest.status === "not_flooded";
    const isGreenRisk = selectedHotspot.tier === "green";
    const isUserFlooded = latest.status === "flooded";
    return (isSevereRisk && isUserClear) || (isGreenRisk && isUserFlooded);
  })();

  // Filtered hotspots for map
  const visibleHotspots = riskData?.hotspots?.filter((h) => {
    if (mapTierFilter === "ALL") return true;
    if (mapTierFilter === "CRITICAL") return h.tier === "red" || h.tier === "orange";
    if (mapTierFilter === "ELEVATED") return h.tier === "yellow";
    if (mapTierFilter === "CLEAR") return h.tier === "green";
    return true;
  }) ?? [];

  async function handleStatusTransition(status: IncidentStatus) {
    if (!selectedIncident || status === selectedIncident.status) return;
    setUpdatingStatus(true);
    try {
      const updated = await updateIncidentStatus(selectedIncident.incident_id, status);
      setIncidents((curr) =>
        curr.map((item) => (item.incident_id === updated.incident_id ? updated : item)),
      );
      setReloadKey((v) => v + 1);
    } catch (err) {
      setSummary(null);
      setIncidents([]);
      setSelectedIncidentId(null);
      setCoreError(err instanceof Error ? err.message : "Could not update incident status.");
    } finally {
      setUpdatingStatus(false);
    }
  }

  async function handleSimulateReading(depthCm: number) {
    setSimulating(true);
    try {
      const readingPayload: SensorReading = {
        device_id: "hydrosense-simulator-01",
        location_id: "demo-zone-01",
        water_depth_cm: depthCm,
        distance_cm: Math.max(30.0 - depthCm, 0),
        timestamp: new Date().toISOString(),
        source: "simulated_sensor",
      };
      await createReading(readingPayload);
      setReloadKey((v) => v + 1);
    } catch (err) {
      setSummary(null);
      setReadings([]);
      setIncidents([]);
      setSelectedIncidentId(null);
      setCoreError(err instanceof Error ? err.message : "Could not submit the simulated reading.");
    } finally {
      setSimulating(false);
    }
  }

  async function handleReportSubmit(e: React.FormEvent) {
    e.preventDefault();
    const targetHotspotId = modalHotspotId || selectedHotspotId;
    const latitude = Number(reportLatitude);
    const longitude = Number(reportLongitude);
    if (!targetHotspotId || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      setCoreError("A location ID and valid coordinates are required for a report.");
      return;
    }

    setSubmitting(true);
    try {
      const created = await submitCommunityReport({
        report_id: reportRequestId,
        hotspot_id: targetHotspotId,
        latitude,
        longitude,
        status: reportStatus,
        notes: reportNotes.trim() || undefined,
      });
      setCommunityReports((curr) => [created, ...curr]);
      setShowModal(false);
      setReportNotes("");
      setReportRequestId(crypto.randomUUID());
      setReloadKey((v) => v + 1);
    } catch (err) {
      setCommunityReports([]);
      setReportError(err instanceof Error ? err.message : "Could not submit the community report.");
    } finally {
      setSubmitting(false);
    }
  }

  const hasCurrentDepth = readings.length > 0;
  const currentDepth = readings[0]?.water_depth_cm ?? 0;
  const isDepthHazard = hasCurrentDepth && currentDepth >= 24.0;
  const depthPercentage = Math.min((currentDepth / 30.0) * 100, 100);

  const uniqueStormDates = Array.from(new Set(events.map((e) => e.date))).sort();
  const replayRows = events.filter((e) => e.date === selectedReplayDate);

  const criticalHotspots = riskData?.hotspots?.filter((h) => h.tier === "red" || h.tier === "orange") ?? [];
  const hasUnknownRisk = riskData?.hotspots.some((hotspot) => hotspot.tier === "unknown") ?? true;
  const forecastLabel = riskData
    ? `FORECAST ${riskData.forecast_status.toUpperCase()}`
    : "FORECAST UNAVAILABLE";
  const canMutate = !authConfigured || authenticated;

  async function handleAuthAction() {
    setAuthLoading(true);
    try {
      if (authenticated) {
        await endSession();
        setAuthenticated(false);
      } else {
        await beginSignIn();
      }
    } catch (error) {
      setCoreError(error instanceof Error ? error.message : "Authentication failed.");
      setAuthLoading(false);
    }
  }

  function openDashboard(view: "landing" | "underpass" | "infrastructure" | "replay" = "landing") {
    setSurface("dashboard");
    setActiveTab(view);
    window.location.hash = `#/dashboard/${view}`;
  }

  function openPublicSite() {
    setSurface("public");
    window.history.pushState(null, "", `${window.location.pathname}${window.location.search}`);
  }

  if (surface === "public") {
    return (
      <PublicLanding
        authConfigured={authConfigured}
        authenticated={authenticated}
        authLoading={authLoading}
        onAuthAction={() => void handleAuthAction()}
        onOpenDashboard={() => openDashboard()}
      />
    );
  }

  return (
    <main className="app-shell">
      {/* =====================================================================
          1. TOP STICKY MASTHEAD / NAVBAR
          ===================================================================== */}
      <header className="top-nav-masthead">
        <button className="nav-brand-group" type="button" onClick={openPublicSite}>
          <div className="brand-stamp" aria-hidden="true">
            <Waves size={24} />
          </div>
          <div className="brand-title-wrap">
            <h1>HydroSense</h1>
            <span className="brand-badge">DELHI NCT WATER OBSERVATORY</span>
          </div>
        </button>

        {/* Top Navigation Tabs */}
        <nav className="nav-tab-menu" aria-label="Observatory Sections">
          <button
            className={`nav-tab-btn ${activeTab === "landing" ? "active" : ""}`}
            onClick={() => openDashboard("landing")}
            aria-current={activeTab === "landing" ? "page" : undefined}
          >
            <LayoutDashboard size={15} /> Overview
          </button>
          <button
            className={`nav-tab-btn ${activeTab === "underpass" ? "active" : ""}`}
            onClick={() => openDashboard("underpass")}
            aria-current={activeTab === "underpass" ? "page" : undefined}
          >
            <MapPin size={15} /> Underpass risk
          </button>
          <button
            className={`nav-tab-btn ${activeTab === "infrastructure" ? "active" : ""}`}
            onClick={() => openDashboard("infrastructure")}
            aria-current={activeTab === "infrastructure" ? "page" : undefined}
          >
            <Gauge size={15} /> Monitoring
          </button>
          <button
            className={`nav-tab-btn ${activeTab === "replay" ? "active" : ""}`}
            onClick={() => openDashboard("replay")}
            aria-current={activeTab === "replay" ? "page" : undefined}
          >
            <History size={15} /> Evidence
          </button>
        </nav>

        {/* Telemetry Indicator & Actions */}
        <div className="nav-right-actions">
          <div className="live-beacon-pill">
            <span className="beacon-dot" />
            <span>{underpassError ? "UNDERPASS DATA UNAVAILABLE" : forecastLabel}</span>
          </div>
          <div className="time-readout">
            <Clock size={13} style={{ color: "var(--amber)" }} />
            <span>{currentTime || "--:-- IST"}</span>
          </div>
          <button
            className="btn-transmit-global"
            disabled={!canMutate}
            title={canMutate ? "Submit a ground report" : "Sign in to submit a report"}
            onClick={() => {
              setModalHotspotId(selectedHotspotId);
              if (selectedHotspot) {
                setReportLatitude(String(selectedHotspot.lat));
                setReportLongitude(String(selectedHotspot.lon));
              }
              setShowModal(true);
            }}
          >
            <Camera size={14} /> + Ground Report
          </button>
          {authConfigured && (
            <button
              className="btn-auth"
              onClick={handleAuthAction}
              disabled={authLoading}
              title={authenticated ? "Sign out" : "Sign in to update HydroSense"}
            >
              {authenticated ? <LogOut size={14} /> : <LogIn size={14} />}
              {authLoading ? "Checking..." : authenticated ? "Sign out" : "Sign in"}
            </button>
          )}
          <button
            className="btn-tactile-refresh"
            onClick={() => setReloadKey((v) => v + 1)}
            title="Refresh System Telemetry"
            aria-label="Refresh Telemetry"
          >
            <RefreshCw size={15} className={loading ? "spin" : ""} />
          </button>
        </div>
      </header>

      {coreError && <div className="system-notice error" role="alert">Application notice: {coreError}</div>}
      {reportError && <div className="system-notice warning" role="status">Community reports unavailable: {reportError}</div>}
      {underpassError && <div className="system-notice warning" role="status">Underpass module unavailable: {underpassError}</div>}
      {riskData?.forecast_status === "stale" && (
        <div className="system-notice warning" role="status">
          Forecast data is stale ({riskData.forecast_age_seconds ?? 0} seconds old); risk results are not current.
        </div>
      )}
      {riskData?.forecast_status === "unavailable" && (
        <div className="system-notice warning" role="status">
          Rainfall forecast is unavailable. Underpass risk is unknown, not zero.
        </div>
      )}

      {/* =====================================================================
          2. GLOBAL TELEMETRY STAT STRIP (VISIBLE ACROSS VIEWS)
          ===================================================================== */}
      <section className="stat-strip" aria-label="System Metrics">
        <article className={`stat-tile ${hasUnknownRisk ? "info" : summary?.active_flood_alerts ? "danger" : "safe"}`}>
          <div className="stat-tile-top">
            <span className="stat-tile-label">Critical Flood Warnings</span>
            <ShieldAlert size={16} style={{ color: summary?.active_flood_alerts ? "var(--terracotta)" : "var(--emerald)" }} />
          </div>
          <div className="stat-tile-value">{hasUnknownRisk ? "--" : summary?.active_flood_alerts ?? 0}</div>
          <div className="stat-tile-sub">{hasUnknownRisk ? "Forecast risk unavailable" : "Orange / Red underpasses flagged"}</div>
        </article>

        <article className="stat-tile warn">
          <div className="stat-tile-top">
            <span className="stat-tile-label">Community Field Reports</span>
            <Activity size={16} style={{ color: "var(--amber)" }} />
          </div>
          <div className="stat-tile-value">{activeCommunityReports.length}</div>
          <div className="stat-tile-sub">Unverified observations (45-minute active window)</div>
        </article>

        <article className={`stat-tile ${isDepthHazard ? "danger" : "safe"}`}>
          <div className="stat-tile-top">
            <span className="stat-tile-label">Simulated Ultrasonic Depth</span>
            <Waves size={16} style={{ color: isDepthHazard ? "var(--terracotta)" : "var(--emerald)" }} />
          </div>
          <div className="stat-tile-value">{hasCurrentDepth ? `${currentDepth.toFixed(1)} cm` : "--"}</div>
          <div className="stat-tile-sub">
              {hasCurrentDepth ? `Threshold: 24.0 cm (${isDepthHazard ? "BREACH ALERT" : "BELOW THRESHOLD"})` : "No sensor reading available"}
          </div>
        </article>

        <article className="stat-tile info">
          <div className="stat-tile-top">
            <span className="stat-tile-label">Historical Event Rows</span>
            <Layers size={16} style={{ color: "var(--sky)" }} />
          </div>
          <div className="stat-tile-value">{metrics?.n_rows ?? "--"}</div>
          <div className="stat-tile-sub">{metrics ? `Across ${metrics.n_storm_days} evaluated storm days` : "Dataset not installed"}</div>
        </article>
      </section>

      {/* =====================================================================
          VIEW 0: OPERATIONS OVERVIEW
          ===================================================================== */}
      {activeTab === "landing" && (
        <section className="landing-hub">
          <div className="dashboard-page-header">
            <div className="hero-editorial-copy">
              <span className="hero-tag">DELHI MONITORING DESK</span>
              <h2>Operations overview</h2>
              <p>
                Review current telemetry, incident response, underpass evidence, and field observations. Unavailable inputs remain explicitly unknown.
              </p>
            </div>
            <div className="hero-quick-stats">
              <div className="quick-stat-row">
                <span>CORE API</span>
                <strong>{coreError ? "UNAVAILABLE" : loading ? "LOADING" : "READY"}</strong>
              </div>
              <div className="quick-stat-row">
                <span>UNDERPASS DATA</span>
                <strong>{riskData ? `${riskData.hotspots.length} LOCATIONS` : "NOT INSTALLED"}</strong>
              </div>
              <div className="quick-stat-row">
                <span>TELEMETRY SOURCE</span>
                <strong>SIMULATOR</strong>
              </div>
              <div className="quick-stat-row">
                <span>IMAGE ANALYSIS</span>
                <strong>NOT CONNECTED</strong>
              </div>
            </div>
          </div>

          <div className="section-heading">
            <div>
              <span>WORKSPACES</span>
              <h3>Move directly to an operational task</h3>
            </div>
            <p>Every module preserves the source and limits of the evidence it presents.</p>
          </div>

          <div className="launchpad-grid">
            <button className="launchpad-card underpass" type="button" onClick={() => openDashboard("underpass")}>
              <div className="launchpad-card-header">
                <div className="launchpad-icon">
                  <MapPin size={24} />
                </div>
                <div className="launchpad-info">
                  <h3>Underpass risk</h3>
                  <p>
                    Interactive mapping and Open-Meteo forecast comparison becomes available when the versioned underpass threshold dataset is installed.
                  </p>
                </div>
              </div>
              <div className="launchpad-card-footer">
                <span className="launchpad-meta">OPTIONAL DATASET · OPEN-METEO</span>
                <span className="launchpad-cta">
                  Open map and thresholds <ArrowRight size={14} />
                </span>
              </div>
            </button>

            <button className="launchpad-card arduino" type="button" onClick={() => openDashboard("infrastructure")}>
              <div className="launchpad-card-header">
                <div className="launchpad-icon">
                  <Cpu size={24} />
                </div>
                <div className="launchpad-info">
                  <h3>Monitoring and incidents</h3>
                  <p>
                    Simulated depth telemetry, a 24.0 cm hazard threshold, and incident lifecycle response. Physical sensor validation remains pending.
                  </p>
                </div>
              </div>
              <div className="launchpad-card-footer">
                <span className="launchpad-meta">SIMULATOR · 30.0 CM TEST VESSEL</span>
                <span className="launchpad-cta">
                  Open monitoring desk <ArrowRight size={14} />
                </span>
              </div>
            </button>

            <button className="launchpad-card replay" type="button" onClick={() => openDashboard("replay")}>
              <div className="launchpad-card-header">
                <div className="launchpad-icon">
                  <History size={24} />
                </div>
                <div className="launchpad-info">
                  <h3>Historical evidence</h3>
                  <p>
                    Inspect historical event evidence and evaluation metrics when a reviewed, versioned underpass dataset is installed.
                  </p>
                </div>
              </div>
              <div className="launchpad-card-footer">
                <span className="launchpad-meta">{metrics ? `${metrics.n_rows} RECORDS · ${metrics.n_storm_days} STORM DAYS` : "DATASET NOT INSTALLED"}</span>
                <span className="launchpad-cta">
                  Inspect evaluation <ArrowRight size={14} />
                </span>
              </div>
            </button>

            <button
              className="launchpad-card bedrock"
              type="button"
              onClick={() => {
                if (!canMutate) {
                  void handleAuthAction();
                  return;
                }
                setModalHotspotId(selectedHotspotId);
                if (selectedHotspot) {
                  setReportLatitude(String(selectedHotspot.lat));
                  setReportLongitude(String(selectedHotspot.lon));
                }
                setShowModal(true);
              }}
            >
              <div className="launchpad-card-header">
                <div className="launchpad-icon">
                  <Camera size={24} />
                </div>
                <div className="launchpad-info">
                  <h3>Field reports</h3>
                  <p>
                    Submit clearly labelled, unverified observations with validated coordinates. Photo upload and automated image analysis are not connected.
                  </p>
                </div>
              </div>
              <div className="launchpad-card-footer">
                <span className="launchpad-meta">HUMAN REVIEW · 45-MINUTE ACTIVE WINDOW</span>
                <span className="launchpad-cta">
                  Submit field observation <ArrowRight size={14} />
                </span>
              </div>
            </button>
          </div>

          {/* Landing Dual Columns (Live Alert Preview & Arduino Snapshot) */}
          <div className="landing-preview-grid">
            {/* Left: Active Alerts Summary */}
            <div className="preview-panel">
              <div className="preview-panel-head">
                <h3>
                  <ShieldAlert size={18} style={{ color: "var(--amber)" }} />
                  Current Delhi Flood Alert Hotspots
                </h3>
                <button
                  className="filter-pill active"
                  onClick={() => openDashboard("underpass")}
                >
                  View All on Map →
                </button>
              </div>

              <div className="preview-hotspot-list">
                {!riskData || hasUnknownRisk ? (
                  <p style={{ color: "var(--ink-muted)", fontSize: "13px" }}>
                    Current underpass risk is unavailable or incomplete. No safety conclusion can be made.
                  </p>
                ) : criticalHotspots.length === 0 ? (
                  <p style={{ color: "var(--ink-muted)", fontSize: "13px" }}>
                    No Orange or Red results among {riskData.hotspots.length} currently evaluated underpasses.
                  </p>
                ) : (
                  criticalHotspots.map((h) => (
                    <button
                      key={h.id}
                      className="preview-hotspot-row"
                      onClick={() => {
                        setSelectedHotspotId(h.id);
                        openDashboard("underpass");
                      }}
                    >
                      <div>
                        <div className="preview-hotspot-name">{h.name}</div>
                        <div className="preview-hotspot-evidence">
                          {h.why}
                        </div>
                      </div>
                      <span className={`risk-stamp ${h.tier}`}>
                        {h.tier} RISK
                      </span>
                    </button>
                  ))
                )}
              </div>
            </div>

            {/* Right: Arduino Hardware Quick Snapshot */}
            <div className="preview-panel">
              <div className="preview-panel-head">
                <h3>
                  <Cpu size={18} style={{ color: "var(--sky)" }} />
                  Simulated Sensor Container Status
                </h3>
                <button
                  className="filter-pill active"
                  onClick={() => openDashboard("infrastructure")}
                >
                  Hardware Desk →
                </button>
              </div>

              <div style={{ display: "flex", gap: "20px", alignItems: "center" }}>
                <div className="liquid-chamber" style={{ height: "140px", width: "60px" }}>
                  <div
                    className="threshold-hazard-line"
                    style={{ bottom: `${(24.0 / 30.0) * 100}%` }}
                  />
                  <div
                    className={`water-column ${isDepthHazard ? "breach" : ""}`}
                    style={{ height: `${depthPercentage}%` }}
                  />
                </div>

                <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "10px" }}>
                  <div className="chamber-metric">
                    <small>SIMULATED LEVEL</small>
                    <strong style={{ color: isDepthHazard ? "var(--terracotta)" : "var(--emerald)" }}>
                      {hasCurrentDepth ? `${currentDepth.toFixed(1)} cm / 30.0 cm` : "No reading"}
                    </strong>
                  </div>
                  <div className="chamber-metric">
                    <small>STATUS</small>
                    <strong style={{ fontSize: "14px", color: isDepthHazard ? "var(--terracotta)" : "var(--emerald)" }}>
                      {!hasCurrentDepth ? "NO READING" : isDepthHazard ? "HIGH WATER THRESHOLD BREACH" : "BELOW DEMO THRESHOLD"}
                    </strong>
                  </div>

                  <div style={{ display: "flex", gap: "6px", marginTop: "4px" }}>
                    <button
                      className="btn-inject"
                      style={{ padding: "6px 10px", fontSize: "11px" }}
                      disabled={simulating || !canMutate}
                      onClick={() => handleSimulateReading(14.8)}
                    >
                      Safe (14.8cm)
                    </button>
                    <button
                      className="btn-inject danger-trigger"
                      style={{ padding: "6px 10px", fontSize: "11px" }}
                      disabled={simulating || !canMutate}
                      onClick={() => handleSimulateReading(26.5)}
                    >
                      Breach (26.5cm)
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* =====================================================================
          VIEW 1: URBAN FLOOD EARLY WARNING (MAP + HOTSPOT DOSSIER)
          ===================================================================== */}
      {activeTab === "underpass" && (
        <section className="split-workspace">
          {/* Tactical Map Shell with OpenStreetMap (Free, No API Key Required) */}
          <div className="tactical-map-frame">
            <div className="map-control-bar">
              <h3>
                <Layers size={16} style={{ color: "var(--amber)" }} />
                Delhi NCT Underpass Hotspot Grid
              </h3>
              <div className="filter-pill-group">
                {["ALL", "CRITICAL", "ELEVATED", "CLEAR"].map((pill) => (
                  <button
                    key={pill}
                    className={`filter-pill ${mapTierFilter === pill ? "active" : ""}`}
                    onClick={() => setMapTierFilter(pill)}
                  >
                    {pill}
                  </button>
                ))}
              </div>
            </div>

            <div className="leaflet-frame-inner">
              {riskData ? <MapContainer
                center={[28.625, 77.205]}
                zoom={11}
                scrollWheelZoom={true}
                style={{ width: "100%", height: "100%" }}
              >
                {/* Free OpenStreetMap Tiles — No API Key Required */}
                <TileLayer
                  attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />
                {visibleHotspots.map((hotspot) => {
                  const color = tierColors[hotspot.tier] || tierColors.unknown;
                  const isSelected = hotspot.id === selectedHotspotId;
                  const radius = isSelected ? 12 : 7;
                  return (
                    <CircleMarker
                      key={hotspot.id}
                      center={[hotspot.lat, hotspot.lon]}
                      radius={radius}
                      pathOptions={{
                        color: isSelected ? "#1c1917" : color,
                        fillColor: color,
                        fillOpacity: 0.92,
                        weight: isSelected ? 3 : 1.5,
                      }}
                      eventHandlers={{
                        click: () => {
                          setSelectedHotspotId(hotspot.id);
                          setModalHotspotId(hotspot.id);
                        },
                      }}
                    >
                      <Popup>
                        <div style={{ fontFamily: "var(--font-sans)", color: "#1c1917" }}>
                          <strong style={{ display: "block", fontSize: "14px" }}>{hotspot.name}</strong>
                          <div style={{ fontSize: "12px", marginTop: "4px" }}>
                            Status: <strong style={{ color }}>{hotspot.tier.toUpperCase()} RISK</strong>
                          </div>
                          <div style={{ fontSize: "11px", color: "#555", marginTop: "2px" }}>
                            Forecast 3h: {hotspot.forecast.max_3h_mm ?? "--"} mm (Limit: {hotspot.limit.rain3h_mm ?? "--"} mm)
                          </div>
                        </div>
                      </Popup>
                    </CircleMarker>
                  );
                })}
              </MapContainer> : (
                <div className="empty-state map-unavailable" role="status">
                  <MapPin size={28} aria-hidden="true" />
                  <strong>Hotspot grid unavailable</strong>
                  <span>
                    Install reviewed hotspots, thresholds, metrics, and event records to activate map markers.
                  </span>
                  <code>UNDERPASS_DATA_DIR</code>
                </div>
              )}
            </div>
          </div>

          {/* Underpass Tactical Dossier */}
          <aside className="dossier-frame">
            {selectedHotspot ? (
              <>
                <div className="dossier-hero">
                  <div>
                    <h2>{selectedHotspot.name}</h2>
                    <span className="coord-stamp">
                      COORDINATES: {selectedHotspot.lat.toFixed(3)}°N, {selectedHotspot.lon.toFixed(3)}°E
                    </span>
                  </div>
                  <span className={`risk-stamp ${selectedHotspot.tier}`}>
                    {selectedHotspot.tier} RISK
                  </span>
                </div>

                {/* Visual Precision Meters */}
                <div className="gauge-metric-card">
                  <div className="gauge-metric-header">
                    <span className="gauge-metric-title">1-Hour Peak Burst Rain</span>
                    <span className="gauge-metric-value">
                      {selectedHotspot.forecast.max_1h_mm ?? "--"} mm{" "}
                      <span>/ {selectedHotspot.limit.rain1h_mm ?? "--"} mm limit</span>
                    </span>
                  </div>
                  <div className="gauge-track">
                    <div
                      className={`gauge-fill ${selectedHotspot.tier}`}
                      style={{
                        width: `${Math.min(
                          ((selectedHotspot.forecast.max_1h_mm ?? 0) /
                            Math.max(selectedHotspot.limit.rain1h_mm ?? 10, 1)) *
                            100,
                          100,
                        )}%`,
                      }}
                    />
                  </div>
                </div>

                <div className="gauge-metric-card">
                  <div className="gauge-metric-header">
                    <span className="gauge-metric-title">3-Hour Cumulative Rain</span>
                    <span className="gauge-metric-value">
                      {selectedHotspot.forecast.max_3h_mm ?? "--"} mm{" "}
                      <span>/ {selectedHotspot.limit.rain3h_mm ?? "--"} mm limit</span>
                    </span>
                  </div>
                  <div className="gauge-track">
                    <div
                      className={`gauge-fill ${selectedHotspot.tier}`}
                      style={{
                        width: `${Math.min(
                          ((selectedHotspot.forecast.max_3h_mm ?? 0) /
                            Math.max(selectedHotspot.limit.rain3h_mm ?? 20, 1)) *
                            100,
                          100,
                        )}%`,
                      }}
                    />
                  </div>
                </div>

                {/* Editorial Quote Dossier */}
                <div className="dossier-quote-box">
                  <div className="dossier-quote">"{selectedHotspot.why}"</div>
                  <div className="dossier-cite">
                    HISTORICAL EVIDENCE BASE: {selectedHotspot.evidence.toUpperCase()}
                  </div>
                </div>

                {/* Safety boundary */}
                <div className="bypass-notice">
                  <Compass size={14} style={{ display: "inline", verticalAlign: "middle", marginRight: "6px" }} />
                  <strong>DECISION-SUPPORT ONLY:</strong> Follow current police closures and official travel guidance. HydroSense does not declare a route safe.
                </div>

                {/* Conflict Alert Bulletin */}
                {evidenceConflict && (
                  <div className="operational-bulletin" role="alert">
                    <AlertTriangle size={20} />
                    <div>
                      <strong>EVIDENCE CONFLICT DISPATCH:</strong> Meteorological forecast and active ground community observations disagree for this hotspot. Physical traffic police review advised.
                    </div>
                  </div>
                )}

                {/* Ground Observations Feed */}
                <div className="dispatch-head">
                  <h4>Ground Observations ({hotspotReports.length})</h4>
                  <button
                    className="btn-transmit"
                    disabled={!canMutate}
                    title={canMutate ? "Add report" : "Sign in to add a report"}
                    onClick={() => {
                      setModalHotspotId(selectedHotspot.id);
                      setReportLatitude(String(selectedHotspot.lat));
                      setReportLongitude(String(selectedHotspot.lon));
                      setShowModal(true);
                    }}
                  >
                    <Camera size={13} /> Add Report
                  </button>
                </div>

                {hotspotReports.length === 0 ? (
                  <p style={{ color: "var(--ink-muted)", fontSize: "13px", margin: "10px 0" }}>
                    No field reports submitted in the active 45-minute window for this spot.
                  </p>
                ) : (
                  hotspotReports.map((rep) => (
                      <div className="dispatch-card" key={rep.report_id}>
                        <div className="dispatch-card-top">
                          <span className={`pill-badge ${rep.status}`}>
                            {rep.status.replace("_", " ")}
                          </span>
                          <span style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--ink-muted)" }}>
                            {timeAgo(rep.timestamp)}
                          </span>
                        </div>

                        {rep.notes && (
                          <div style={{ fontSize: "13px", color: "var(--ink-primary)" }}>
                            {rep.notes}
                          </div>
                        )}

                      </div>
                    ))
                )}
              </>
            ) : (
              <div style={{ padding: "40px", textAlign: "center", color: "var(--ink-muted)" }}>
                {underpassError
                  ? "Underpass dossiers are unavailable because the reviewed dataset is not installed."
                  : "Select an underpass on the map to review telemetry dossier."}
              </div>
            )}
          </aside>
        </section>
      )}

      {/* =====================================================================
          VIEW 2: SIMULATED TELEMETRY DESK
          ===================================================================== */}
      {activeTab === "infrastructure" && (
        <section className="infra-three-col">
          {/* Hardware Bench Simulation */}
          <div className="hardware-chassis">
            <h3>Simulated Sensor Bench</h3>
            <p>
              Software-only depth scenarios use the future ESP32-compatible ingestion contract. No physical sensor measurement or calibration is represented here.
            </p>

            <div className="chamber-assembly">
              <div className="liquid-chamber" aria-label="Liquid Level Chamber">
                <div className="threshold-hazard-line" style={{ bottom: `${(24.0 / 30.0) * 100}%` }}>
                  <span className="threshold-hazard-tag">ALERT 24.0cm</span>
                </div>
                <div
                  className={`water-column ${isDepthHazard ? "breach" : ""}`}
                  style={{ height: `${depthPercentage}%` }}
                />
              </div>

              <div className="chamber-readouts">
                <div className="chamber-metric">
                  <small>SIMULATED DEPTH</small>
                  <strong style={{ color: isDepthHazard ? "var(--terracotta)" : "var(--emerald)" }}>
                    {hasCurrentDepth ? `${currentDepth.toFixed(1)} cm` : "--"}
                  </strong>
                </div>
                <div className="chamber-metric">
                  <small>TRANSDUCER DISTANCE</small>
                  <strong>{hasCurrentDepth ? `${Math.max(30.0 - currentDepth, 0).toFixed(1)} cm` : "--"}</strong>
                </div>
                <div className="chamber-metric">
                  <small>OPERATIONAL STATE</small>
                  <strong style={{ color: isDepthHazard ? "var(--terracotta)" : "var(--emerald)" }}>
                    {!hasCurrentDepth ? "NO READING" : isDepthHazard ? "HIGH WATER BREACH ALERT" : "BELOW DEMO THRESHOLD"}
                  </strong>
                </div>
              </div>
            </div>

            <div className="injection-panel">
              <label>INJECT SIMULATED SENSOR SCENARIOS:</label>
              <div className="injection-grid">
                <button
                  className="btn-inject"
                  disabled={simulating || !canMutate}
                  onClick={() => handleSimulateReading(14.2)}
                >
                  Normal Flow (14.2 cm)
                </button>
                <button
                  className="btn-inject"
                  disabled={simulating || !canMutate}
                  onClick={() => handleSimulateReading(22.4)}
                >
                  Caution Zone (22.4 cm)
                </button>
                <button
                  className="btn-inject danger-trigger"
                  disabled={simulating || !canMutate}
                  onClick={() => handleSimulateReading(26.8)}
                  style={{ gridColumn: "1 / -1" }}
                >
                  Trigger Breach Alert (26.8 cm)
                </button>
              </div>
            </div>
          </div>

          {/* Ultrasonic Telemetry Stream */}
          <div className="triage-deck">
            <div className="triage-deck-head">
              <h3>Sensor Ingestion Log</h3>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--ink-muted)" }}>
                {readings.length} FRAMES
              </span>
            </div>
            <div style={{ flex: 1, overflowY: "auto", maxHeight: "540px" }}>
              {readings.map((r) => {
                const alert = r.water_depth_cm >= 24.0;
                return (
                  <div
                    key={`${r.device_id}-${r.timestamp}`}
                    style={{
                      padding: "12px 14px",
                      borderBottom: "1px solid var(--rule-subtle)",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
                  >
                    <div>
                      <div
                        style={{
                          fontFamily: "var(--font-mono)",
                          fontSize: "14px",
                          fontWeight: 700,
                          color: alert ? "var(--terracotta)" : "var(--ink-primary)",
                        }}
                      >
                        {r.water_depth_cm.toFixed(1)} cm depth
                      </div>
                      <div style={{ fontSize: "11px", color: "var(--ink-muted)", marginTop: "2px" }}>
                        Distance: {r.distance_cm.toFixed(1)} cm · {formatLocalTime(r.timestamp)}
                      </div>
                    </div>
                    <span
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: "10px",
                        padding: "3px 8px",
                        borderRadius: "4px",
                        background: "var(--pastel-blue-badge)",
                        color: "var(--pastel-blue-ink)",
                        textTransform: "uppercase",
                        fontWeight: 600,
                      }}
                    >
                      {r.source}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Incident Response Desk */}
          <div className="triage-deck">
            <div className="triage-deck-head">
              <h3>Response Triage Desk</h3>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--ink-muted)" }}>
                {incidents.length} INCIDENTS
              </span>
            </div>

            {selectedIncident ? (
              <div className="triage-dossier-body">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "8px" }}>
                  <h4 style={{ margin: 0, fontSize: "16px", color: "var(--ink-primary)" }}>{selectedIncident.title}</h4>
                  <span className={`pill-badge ${selectedIncident.status}`}>
                    {selectedIncident.status}
                  </span>
                </div>

                <div className="triage-row">
                  <span>LOCATION ID</span>
                  <span>{selectedIncident.location_id}</span>
                </div>
                <div className="triage-row">
                  <span>HAZARD TYPE</span>
                  <span>{selectedIncident.hazard_type.replace(/_/g, " ").toUpperCase()}</span>
                </div>
                <div className="triage-row">
                  <span>SEVERITY</span>
                  <span style={{ color: selectedIncident.severity === "high" || selectedIncident.severity === "very_high" ? "var(--terracotta)" : "var(--amber)" }}>
                    {selectedIncident.severity.toUpperCase()}
                  </span>
                </div>
                <div className="triage-row">
                  <span>CONFIDENCE</span>
                  <span>{(selectedIncident.confidence * 100).toFixed(0)}%</span>
                </div>
                <div className="triage-row">
                  <span>REPORTED AT</span>
                  <span>{formatLocalTime(selectedIncident.created_at)}</span>
                </div>

                <div style={{ marginTop: "16px" }}>
                  <label style={{ fontSize: "11px", fontFamily: "var(--font-mono)", color: "var(--ink-muted)", display: "block" }}>
                    ADVANCE INCIDENT LIFECYCLE:
                  </label>
                  <select
                    className="lifecycle-stepper"
                    value={selectedIncident.status}
                    disabled={updatingStatus || !canMutate}
                    onChange={(e) => handleStatusTransition(e.target.value as IncidentStatus)}
                  >
                    <option value={selectedIncident.status}>CURRENT: {selectedIncident.status.toUpperCase()}</option>
                    {statusTransitions[selectedIncident.status].map((nxt) => (
                      <option key={nxt} value={nxt}>
                        ADVANCE TO {nxt.toUpperCase()}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            ) : (
              <div style={{ padding: "40px", textAlign: "center", color: "var(--ink-muted)" }}>
                No active incidents in queue.
              </div>
            )}
          </div>
        </section>
      )}

      {/* =====================================================================
          VIEW 3: HISTORICAL STORM REPLAY & EVALUATION
          ===================================================================== */}
      {activeTab === "replay" && (
        <section className="replay-two-col">
          {/* LOSO Evaluation Metrics */}
          <div className="eval-summary-card">
            <h3>Leave-One-Storm-Out Evaluation</h3>
            <p>
              To prevent spatial and temporal data leakage across storm days, rainfall thresholds were fitted on the other
              storm days only. Metrics appear here only when the reviewed dataset is installed.
            </p>

            <div className="loso-stat-quad">
              <div className="loso-tile">
                <div className="loso-num">{metrics?.n_rows ?? "--"}</div>
                <div className="loso-label">TOTAL EVENT RECORDS</div>
              </div>
              <div className="loso-tile">
                <div className="loso-num">{metrics?.n_storm_days ?? "--"}</div>
                <div className="loso-label">STORM DAYS (2020–2026)</div>
              </div>
              <div className="loso-tile">
                <div className="loso-num" style={{ color: "var(--emerald)" }}>
                  {metrics && metrics.per_hotspot_thresholds.n_flooded_rows > 0
                    ? `${(
                        (metrics.per_hotspot_thresholds.floods_caught /
                          metrics.per_hotspot_thresholds.n_flooded_rows) *
                        100
                      ).toFixed(1)}%`
                    : "--"}
                </div>
                <div className="loso-label">FLOOD RECALL RATE</div>
              </div>
              <div className="loso-tile">
                <div className="loso-num" style={{ color: "var(--amber)" }}>
                  {metrics && metrics.per_hotspot_thresholds.n_clear_rows > 0
                    ? `${(
                        (metrics.per_hotspot_thresholds.false_alarms /
                          metrics.per_hotspot_thresholds.n_clear_rows) *
                        100
                      ).toFixed(1)}%`
                    : "--"}
                </div>
                <div className="loso-label">FALSE-ALARM RATE</div>
              </div>
            </div>

            <table className="matrix-grid-table">
              <thead>
                <tr>
                  <th>EVALUATION METRIC</th>
                  <th>PER-HOTSPOT THRESHOLDS</th>
                  <th>POOLED BASELINE</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Floods Caught</td>
                  <td>
                    <strong style={{ color: "var(--emerald)" }}>
                      {metrics ? `${metrics.per_hotspot_thresholds.floods_caught} / ${metrics.per_hotspot_thresholds.n_flooded_rows}` : "--"}
                    </strong>
                  </td>
                  <td>{metrics ? `${metrics.pooled_only_baseline.floods_caught} / ${metrics.pooled_only_baseline.n_flooded_rows}` : "--"}</td>
                </tr>
                <tr>
                  <td>Floods Missed</td>
                  <td>{metrics?.per_hotspot_thresholds.floods_missed ?? "--"}</td>
                  <td>{metrics?.pooled_only_baseline.floods_missed ?? "--"}</td>
                </tr>
                <tr>
                  <td>Clear Days Correct</td>
                  <td>{metrics ? `${metrics.per_hotspot_thresholds.correct_clear} / ${metrics.per_hotspot_thresholds.n_clear_rows}` : "--"}</td>
                  <td>{metrics ? `${metrics.pooled_only_baseline.correct_clear} / ${metrics.pooled_only_baseline.n_clear_rows}` : "--"}</td>
                </tr>
                <tr>
                  <td>False Alarms</td>
                  <td style={{ color: "var(--terracotta)" }}>{metrics?.per_hotspot_thresholds.false_alarms ?? "--"}</td>
                  <td>{metrics?.pooled_only_baseline.false_alarms ?? "--"}</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Historical Storm Scrubber */}
          <div className="scrubber-frame">
            <div className="scrubber-header">
              <h3>Monsoon Storm Scrubber</h3>
              <select
                className="storm-date-picker"
                value={selectedReplayDate}
                onChange={(e) => setSelectedReplayDate(e.target.value)}
              >
                {uniqueStormDates.map((d) => (
                  <option key={d} value={d}>
                    {d} ({events.filter((e) => e.date === d).length} Hotspots Recorded)
                  </option>
                ))}
              </select>
            </div>

            <div className="scrubber-table-wrap">
              <table className="scrubber-table">
                <thead>
                  <tr>
                    <th>HOTSPOT</th>
                    <th>OUTCOME</th>
                    <th>OBSERVED INCIDENT</th>
                    <th>REPORTED RAINFALL</th>
                  </tr>
                </thead>
                <tbody>
                  {replayRows.length === 0 && (
                    <tr>
                      <td colSpan={4}>Historical replay is unavailable until reviewed event data is installed.</td>
                    </tr>
                  )}
                  {replayRows.map((ev) => (
                    <tr key={ev.event_id}>
                      <td>
                        <strong>{ev.underpass_name_in_source}</strong>
                      </td>
                      <td>
                        <span className={`pill-badge ${ev.outcome}`}>
                          {ev.outcome.toUpperCase()}
                        </span>
                      </td>
                      <td style={{ color: "var(--ink-secondary)" }}>{ev.what_happened}</td>
                      <td style={{ fontFamily: "var(--font-mono)", fontSize: "12px", color: "var(--ink-muted)" }}>
                        {ev.rain_reported_in_article ?? "--"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}

      {/* =====================================================================
          TACTILE MODAL DIALOG: TRANSMIT FIELD OBSERVATION
          ===================================================================== */}
      {showModal && (
        <div className="modal-scrim">
          <div
            className="modal-sheet"
            ref={modalRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="report-dialog-title"
            aria-describedby="report-dialog-description"
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3 id="report-dialog-title">Transmit Ground Observation</h3>
              <button
                className="btn-tactile-refresh"
                style={{ width: "32px", height: "32px" }}
                onClick={() => setShowModal(false)}
                aria-label="Close report dialog"
              >
                <X size={16} />
              </button>
            </div>
            <p id="report-dialog-description">
              Submit an unverified current observation for human review. Photo upload is disabled until private evidence storage is implemented.
            </p>

            <form onSubmit={handleReportSubmit}>
              <div className="input-block">
                <label htmlFor="modal-hotspot-select">LOCATION ID:</label>
                {riskData?.hotspots.length ? (
                  <select
                    id="modal-hotspot-select"
                    value={modalHotspotId}
                    onChange={(event) => {
                      const hotspot = riskData.hotspots.find((item) => item.id === event.target.value);
                      setModalHotspotId(event.target.value);
                      if (hotspot) {
                        setReportLatitude(String(hotspot.lat));
                        setReportLongitude(String(hotspot.lon));
                      }
                    }}
                  >
                    {riskData.hotspots.map((hotspot) => (
                      <option key={hotspot.id} value={hotspot.id}>
                        {hotspot.name} ({hotspot.tier.toUpperCase()} Risk)
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    id="modal-hotspot-select"
                    value={modalHotspotId}
                    onChange={(event) => setModalHotspotId(event.target.value)}
                    minLength={1}
                    maxLength={100}
                    required
                  />
                )}
              </div>

              <div className="modal-coordinate-grid">
                <div className="input-block">
                  <label htmlFor="report-latitude">LATITUDE:</label>
                  <input
                    id="report-latitude"
                    type="number"
                    min="-90"
                    max="90"
                    step="any"
                    value={reportLatitude}
                    onChange={(event) => setReportLatitude(event.target.value)}
                    required
                  />
                </div>
                <div className="input-block">
                  <label htmlFor="report-longitude">LONGITUDE:</label>
                  <input
                    id="report-longitude"
                    type="number"
                    min="-180"
                    max="180"
                    step="any"
                    value={reportLongitude}
                    onChange={(event) => setReportLongitude(event.target.value)}
                    required
                  />
                </div>
              </div>

              <div className="input-block">
                <label htmlFor="report-status">CURRENT ROAD STATUS:</label>
                <select
                  id="report-status"
                  value={reportStatus}
                  onChange={(e) => setReportStatus(e.target.value as CommunityReportStatus)}
                >
                  <option value="flooded">Flooded / Inundated (Hazardous ponding)</option>
                  <option value="passable">Passable with caution (Minor runoff / curbs visible)</option>
                  <option value="not_flooded">Clear / Free Flow (No structural waterlogging)</option>
                </select>
              </div>

              <div className="input-block">
                <label htmlFor="report-notes">FIELD TELEMETRY NOTES:</label>
                <textarea
                  id="report-notes"
                  rows={2}
                  placeholder="e.g. Sump pumps operating, right lane submerged, traffic crawling..."
                  value={reportNotes}
                  onChange={(e) => setReportNotes(e.target.value)}
                />
              </div>

              <div className="modal-actions-row">
                <button
                  type="button"
                  className="btn-cancel"
                  onClick={() => setShowModal(false)}
                  disabled={submitting}
                >
                  Cancel
                </button>
                <button type="submit" className="btn-transmit-global" disabled={submitting || !canMutate}>
                  <Send size={13} />
                  {submitting ? "Transmitting..." : "Submit to HydroSense"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </main>
  );
}
