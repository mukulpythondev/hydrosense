# HydroSense

**Flood-monitoring and waterlogging decision support for urban underpasses.** HydroSense combines rainfall-driven risk estimates, curated flood history, community ground reports, AI-assisted photo advisories, and Arduino-based water-level sensing in one AWS-hosted dashboard.

## Demo and project links

- **Live application:** [https://d348efecbg3b7i.cloudfront.net/](https://d348efecbg3b7i.cloudfront.net/)
- **GitHub repository:** [https://github.com/mukulpythondev/hydrosense](https://github.com/mukulpythondev/hydrosense)
- **YouTube demonstration:** [https://youtu.be/fAbQ15Nhqpw](https://youtu.be/fAbQ15Nhqpw)
- **AWS Builder blog post:** [https://builder.aws.com/content/3KYOzFPGl5ju2toCMaktLoaw7MY/hydrosense](https://builder.aws.com/content/3KYOzFPGl5ju2toCMaktLoaw7MY/hydrosense)

## Problem statement

Heavy rainfall regularly floods underpasses in Delhi, disrupting travel and creating hazardous driving conditions with little advance warning. Commuters have no single place to check which underpasses are currently risky, what evidence supports that risk, or what other people are seeing on the ground right now.

HydroSense brings underpass risk information, rainfall analysis, historical evidence, community reports, and AI image advisories into one platform — without claiming to be an official emergency-warning or road-closure service, and without guaranteeing flood predictions.

## How HydroSense works

1. Users inspect underpass hotspots on the map and open one to see its current risk tier and supporting evidence.
2. Rainfall forecasts and each hotspot's own historical flood thresholds combine into a risk tier (green/yellow/orange/red), or an explicit "unknown" state when forecast data is unavailable.
3. Users submit a community report (flooded / passable / not flooded) with optional notes and an optional photo.
4. A photo uploads directly to a private S3 bucket through a short-lived, report-scoped presigned POST URL — it never passes through the backend server.
5. The backend fetches the uploaded image and invokes Amazon Bedrock Nova Lite for an advisory read of visible waterlogging.
6. The assessment (a short summary plus a fixed safety disclaimer) and its status (`pending` / `completed` / `failed`) persist on the report and display on the dashboard alongside the forecast risk and the user's own report.
7. In parallel, an Arduino + HC-SR04 water-level sensor ([hardware/hydrosense_monitor.ino](hardware/hydrosense_monitor.ino)) reads distance and depth locally and shows a NORMAL/CAUTION/HIGH status on an attached OLED display — the hardware half of the system's sensing architecture. It does not yet post over Wi-Fi to the deployed backend; see [Roadmap](#roadmap).

AI photo advisories describe visible evidence only. They are not a depth measurement, not a certification that a route is safe, and do not replace a physical sensor reading.

## Key features

- **Underpass risk map** — 16 Delhi hotspots with colour-coded risk tiers and a "why this tier?" explanation per location.
- **Rainfall-related risk assessment** — Open-Meteo forecasts compared against each hotspot's own flood history, with an explicit "unknown" state (never a false "safe") when forecast data is missing or stale.
- **Historical waterlogging evidence** — a curated set of past flood/clear events, evaluated with a leave-one-storm-out methodology.
- **Community incident reporting** — flooded/passable/not-flooded reports with persistent DynamoDB storage and a 45-minute active window.
- **Private image uploads and AI-generated advisories** — presigned S3 uploads feeding Amazon Bedrock Nova Lite, with persisted status and a fixed safety disclaimer.
- **AWS-backed dashboard and API** — CloudFront + S3 frontend, API Gateway + Lambda backend, DynamoDB persistence.
- **Arduino sensing architecture** — HC-SR04 ultrasonic depth sensing with local OLED readout, built as the hardware half of the platform (see [Roadmap](#roadmap) for its current connectivity status).

## Overall system architecture

![Overall HydroSense architecture: data sources, Arduino edge sensing, backend risk assessment, community reports, Bedrock image assessment, storage, and dashboard](docs/architecture/hydrosense-overall.png)

Shows the full designed system: rainfall and historical data sources, Arduino-based water-level sensing and its gateway path, backend risk assessment, community report and image-upload flow, Amazon Bedrock image assessment, persistent storage, and the dashboard. The Arduino-to-gateway data path is part of the system design; it is not yet streaming to the deployed backend (see [Roadmap](#roadmap)).

## AWS architecture

![AWS infrastructure: CloudFront, S3, API Gateway, Lambda, DynamoDB, private evidence bucket, and Amazon Bedrock Nova Lite](docs/architecture/hydrosense-aws.png)

Only verified, deployed services are shown:

- **Amazon CloudFront** serving the React SPA from a private **Amazon S3** bucket (origin access control, no public bucket access).
- **Amazon API Gateway (HTTP API)** fronting an **AWS Lambda** function running FastAPI via Mangum.
- **Amazon DynamoDB** — three on-demand tables for readings, incidents, and community reports.
- A private, encrypted **S3 evidence bucket** for community photo uploads via presigned POST, with a 7-day lifecycle expiry.
- **Amazon Bedrock** (`apac.amazon.nova-lite-v1:0`) for image advisory inference.
- A least-privilege Lambda execution role scoped to only the three DynamoDB table ARNs and its own log group.

Amazon Cognito and AWS IoT Core resources are defined in [infrastructure/backend.yaml](infrastructure/backend.yaml) but are **not part of the currently deployed environment** — the live API does not enforce authentication (see [Responsible AI and security](#responsible-ai-and-security)).

## Technology stack

**Frontend:** React, TypeScript, Vite, `react-leaflet` / Leaflet for mapping, `lucide-react` icons.

**Backend:** Python 3.12, FastAPI, Pydantic v2 (`pydantic-settings`), Mangum (ASGI-to-Lambda adapter), boto3.

**AWS services (deployed):** Lambda, API Gateway (HTTP API), DynamoDB, S3, CloudFront, Amazon Bedrock (Nova Lite).

**Data:** Open-Meteo forecast API (ECMWF IFS model), a curated historical underpass events dataset packaged with the backend deployment.

**Testing:** `pytest` (backend, 57 tests passing at the time of writing), `tsc --noEmit` and `vite build` (frontend).

## Local development

### Prerequisites

- Python 3.12+
- Node.js 20+ and npm
- An AWS account and credentials if you want to exercise DynamoDB- or Bedrock-backed functionality locally

### Backend

```powershell
cd backend
py -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload
```

Visit `http://127.0.0.1:8000/health`, readiness at `http://127.0.0.1:8000/ready`, or Swagger UI at `http://127.0.0.1:8000/docs`.

### Frontend

```powershell
cd frontend
npm install
npm run dev
```

Visit `http://localhost:5173`. Set `VITE_API_BASE_URL` to point at your backend (see [.env.example](.env.example)).

### Tests and checks

```powershell
cd backend
.\.venv\Scripts\python.exe -m pytest tests -q

cd ..\frontend
npm run typecheck
npm run build
```

### Configuration

Copy values from [.env.example](.env.example) into a local `.env`. Never commit secrets, certificates, private keys, or real credentials. AWS-backed functionality (DynamoDB storage, the evidence bucket, Bedrock assessment) requires valid AWS credentials and the relevant environment variables (`STORAGE_BACKEND=dynamodb`, `EVIDENCE_BUCKET_NAME`, `BEDROCK_MODEL_ID`, etc.); without them the backend falls back to local JSON storage and the image-upload/assessment routes return `503`.

The underpass module (map, risk, metrics, replay) only activates when `UNDERPASS_DATA_DIR` points to a directory with a reviewed `hotspots.json`, `thresholds.json`, `metrics.json`, and `events.csv`. These files are bundled into the deployed Lambda package but are not committed to this repository (`/data/` is git-ignored); without them, dataset-dependent routes return HTTP 503 and the dashboard shows an explicit unavailable state.

Full endpoint documentation, request/response shapes, and the image-report upload workflow are in [docs/api-contract.md](docs/api-contract.md). The live API does not currently require authentication on any route, including `POST`/`PATCH` — see [Responsible AI and security](#responsible-ai-and-security).

## Data sources and methodology

- **Rainfall forecasts** come from the [Open-Meteo](https://open-meteo.com/) API (ECMWF IFS model). When a forecast request fails or returns stale/incomplete data, the affected hotspot's risk tier is explicitly `unknown` rather than defaulting to a false "safe" state.
- **Historical waterlogging evidence** is a curated set of past flood/clear events across the 16 covered hotspots, used to fit a per-hotspot rainfall threshold (with a pooled fallback for hotspots with fewer than three recorded floods) and evaluated with a leave-one-storm-out methodology to avoid leaking a storm day's own data into its threshold.
- **Community reports** are user-submitted observations (flooded / passable / not flooded, optional notes and photo). They are evidence, not verified fact, and remain active for 45 minutes.
- **AI photo advisories** describe visible evidence in a single submitted photo. They are a separate signal from both the forecast risk and the user's own report status, and the dashboard flags it when they disagree.
- The historical dataset is not independently certified and should not be treated as a complete or sufficient record for validating predictive accuracy on its own.

## Responsible AI and security

**Implemented controls:**
- The evidence S3 bucket blocks all public access, is encrypted at rest (SSE-S3), and expires objects under its `reports/` prefix after 7 days.
- Presigned upload POSTs are scoped to a single report's key prefix, limited to `image/jpeg`, `image/png`, or `image/webp`, and capped at 5 MB (`content-length-range` condition).
- The assessment endpoint verifies an image key belongs to the requesting report before fetching it (`403` on mismatch).
- Bedrock output is validated against a list of forbidden absolute claims (e.g. exact depth figures, "100% safe") before being persisted; a fixed disclaimer accompanies every assessment.
- CloudFront serves a restrictive Content-Security-Policy (explicit `connect-src`/`img-src`/`style-src`/`font-src` allow-lists, `object-src 'none'`, `frame-ancestors 'none'`).

**Current limitations (accurate as of this deployment):**
- The live API does not require authentication on any route. A Cognito user-pool + JWT-authorizer design exists in [infrastructure/backend.yaml](infrastructure/backend.yaml) but has not been deployed to the running environment.
- AI photo advisories are generated from a single image and can be wrong, incomplete, or misleading (e.g. due to angle, lighting, or an outdated photo). They must not be treated as a precise depth measurement, a guaranteed prediction, or a substitute for official guidance or emergency services.

## Roadmap

- **Hardware connectivity:** the Arduino + HC-SR04 firmware reads and displays depth locally but does not yet connect to Wi-Fi or post to the deployed backend; no bench-test recording or demonstration video exists in this repository yet. See [hardware/README.md](hardware/README.md).
- **Authentication:** deploy and enforce the Cognito JWT authorizer already defined in `infrastructure/backend.yaml` for mutation routes.
- **Dataset growth:** expand the historical event dataset and re-run independent evaluation as more storms are recorded.
- **Testing depth:** broaden integration testing and add live monitoring/alerting around the deployed Lambda and DynamoDB tables.

## Contributing

Issues and pull requests are welcome. Before submitting a change:
1. Run `pytest tests -q` in `backend/` and `npm run typecheck && npm run build` in `frontend/`.
2. Keep status/data-provenance labels (e.g. `source: simulated_sensor` vs `arduino`) accurate — don't relabel test data as live telemetry.
3. Avoid introducing claims (connectivity, accuracy, certification) that aren't backed by verified, working code.

## Team Contributions

| Team Member | Contributions |
|---|---|
| **Team Leader** | Led AWS integration, including API deployment, cloud infrastructure, backend connectivity, persistent storage, and Amazon Bedrock integration for AI-assisted image assessment. |
| **Second Team Member** | Led IoT and hardware integration, focusing on Arduino-based water-level sensing and gateway connectivity for the HydroSense monitoring system. |
| **Third Team Member** | Contributed to full-stack development and curated historical waterlogging data for underpass risk assessment, helping connect the dataset with the platform's monitoring features. |
| **Fourth Team Member** | Led frontend development across HydroSense, building and refining the user interface, dashboard, map-based monitoring experience, and community reporting workflow. |

## License and acknowledgments

No `LICENSE` file is currently present in this repository. The maintainers should choose and add a license before treating this project as formally open source.

- [Open-Meteo](https://open-meteo.com/) for rainfall forecast data.
- [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors and [Leaflet](https://leafletjs.com/) for mapping.
- Amazon Web Services — Lambda, API Gateway, DynamoDB, S3, CloudFront, and Amazon Bedrock (Nova Lite).

## Documentation

- [API contract](docs/api-contract.md)
- [Project specification](docs/HydroSense_Project_Specification_for_IDE.md)
- [AWS integration plan](docs/aws-integration-plan.md)
- [Hardware handoff](hardware/README.md)
- [Architecture diagrams (reserved)](docs/architecture/README.md)
