<div align="center">

# 🎾 Tennis Tournament Control Center

**Real-Time Tournament Management & Live Scoring Platform — Cloud-Native, Serverless, Fully Automated**

[![AWS Amplify](https://img.shields.io/badge/AWS%20Amplify-Hosting-FF9900?style=for-the-badge&logo=aws-amplify&logoColor=white)](https://aws.amazon.com/amplify/)
[![React](https://img.shields.io/badge/React-19-61DAFB?style=for-the-badge&logo=react&logoColor=white)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-5-646CFF?style=for-the-badge&logo=vite&logoColor=white)](https://vite.dev/)
[![AWS CDK](https://img.shields.io/badge/AWS%20CDK-Infrastructure%20as%20Code-232F3E?style=for-the-badge&logo=amazon-aws&logoColor=white)](https://aws.amazon.com/cdk/)
[![License](https://img.shields.io/badge/License-MIT-green?style=for-the-badge)](https://github.com/Ru-Dipity/Tennis-Score-Board/blob/main/LICENSE)
[![Live Demo](https://img.shields.io/badge/Live%20Demo-Online-brightgreen?style=for-the-badge&logo=google-chrome&logoColor=white)](https://your-domain.com)

---

**A production-grade, full-stack tennis tournament system** that delivers real-time score updates, automated bracket generation, and responsive match displays — all hosted on **AWS Amplify** with global CDN acceleration, automated CI/CD, and custom domain with TLS/SSL.

</div>

---

## 📡 Architecture Overview

```mermaid
flowchart LR
    A["👨‍💻 Developer Git Push"] --> B["🐙 GitHub Repository"]
    B --> C["⚡ AWS Amplify CI/CD Pipeline"]
    C --> D["📦 Backend Deploy<br/><code>npx ampx pipeline-deploy</code>"]
    C --> E["🎨 Frontend Build<br/><code>npm run build</code>"]

    D --> F["📋 AWS CloudFormation<br/>IaC Orchestration"]
    F --> G["🛢️ AWS AppSync<br/>GraphQL API"]
    F --> H["🔐 Amazon Cognito<br/>User Pools"]
    F --> I["🗄️ Amazon DynamoDB<br/>Managed NoSQL"]

    E --> J["☁️ Amazon CloudFront CDN"]
    J --> K["🌐 Custom DNS<br/>CNAME + ACM SSL"]
    K --> L["🖥️ User Browser"]

    G -.->|Runtime<br/>Data Access| I
    G --> J
    H --> J

    style A fill:#58a6ff,color:#fff
    style B fill:#2dba4e,color:#fff
    style C fill:#ff9900,color:#fff
    style D fill:#ff9900,color:#fff
    style E fill:#646cff,color:#fff
    style F fill:#a855f7,color:#fff
    style G fill:#8b5cf6,color:#fff
    style H fill:#f97316,color:#fff
    style I fill:#3b82f6,color:#fff
    style J fill:#232f3e,color:#fff
    style K fill:#e11d48,color:#fff
    style L fill:#22c55e,color:#fff
```

**Legend:**
- `-->` **Solid arrow** = Deployment / provisioning flow
- `-.->` **Dashed arrow** = Runtime data flow

---

## ☁️ Cloud & DevOps Highlights

| Capability | Implementation |
|---|---|
| **Serverless Hosting** | Hosted on [AWS Amplify](https://github.com/Ru-Dipity/Tennis-Score-Board/blob/main/amplify.yml) with fully managed infrastructure — no servers to provision or maintain. |
| **Global CDN** | Content delivered via [Amazon CloudFront](https://aws.amazon.com/cloudfront/) edge locations for sub-50ms TTFB worldwide. |
| **Automated CI/CD** | GitOps-driven pipeline: every push to `main` triggers dependency install, TypeScript compilation, Vite production build, and incremental Amplify deployment. See [`amplify.yml`](https://github.com/Ru-Dipity/Tennis-Score-Board/blob/main/amplify.yml). |
| **Custom Domain & SSL** | CNAME-based DNS routing with [AWS Certificate Manager (ACM)](https://aws.amazon.com/certificate-manager/) — fully automated HTTPS certificate provisioning and renewal. |
| **Infrastructure as Code** | Backend defined via [AWS CDK](https://aws.amazon.com/cdk/) and orchestrated through [AWS CloudFormation](https://aws.amazon.com/cloudformation/) in [`amplify/`](https://github.com/Ru-Dipity/Tennis-Score-Board/tree/main/amplify) — auth, data models, and permissions are version-controlled and deployable. |
| **GraphQL API** | Real-time data layer via [AWS AppSync](https://aws.amazon.com/appsync/) with subscription support for live score updates. |
| **Managed NoSQL Database** | All tournament data persisted in [Amazon DynamoDB](https://aws.amazon.com/dynamodb/) — serverless, auto-scaling, single-digit-millisecond latency. |

---

## 🎯 Application Features

### 🏆 Tournament Modes
- **Knockout (Single Elimination)** — Automatic bracket generation with seeded draws, bye handling, and winner propagation.
- **Round Robin** — Group-stage standings with configurable group count and **per-group player limit**, a real-time match matrix, and click-to-score cells. Supports **singles** (per-slot player dropdowns) and **doubles** (two-player roster modal) entry assignment with live sync to every group match.
- **Team Battle** — Responsive team-vs-team match panels with lineup editor and mobile/tablet-optimized CSS Flex/Grid layouts.

### 🎲 Match Management
- **Singles & Doubles** support with player and team registration.
- **Random Draw / Shuffle** — Random seeding for fair tournament starts.
- **Multiple Match Formats** — Single set, Best of 3, Best of 5.
- **Real-Time Score Entry** — Admin console with instant GraphQL subscription updates to visitor displays.
- **Score Clearing** — Reset match scores with a single click for re-scoring.
- **Round Robin Entry Assignment** — Singles slots render one-player dropdowns; doubles slots open a roster modal with two independent player selectors per row. Selections sync instantly to the standings and to every wired group match (TBD clears a slot back to pending).
- **Click-to-Score Matrix** — Score-pending matrix cells are clickable and open the shared scoring modal on the exact group match; player info is read directly from the matrix (no re-selection needed — both doubles members are passed intact).
- **Unified Scoring Modal** — Knockout and round-robin reuse the same scoring panel (Save Score / Confirm Match End / Clear); round-robin shows read-only participant names straight from the matrix.

### 📅 Date-Based Tournament Schedule & Archive
- **Event Date Picker** — Assign a specific date to each tournament for organized scheduling.
- **Date-Filtered View** — Filter the tournament management panel by selected date to focus on today's or any specific day's events.
- **Archive System** — Archive completed tournaments to declutter the active management view; archived items are collapsible and still accessible for review, sharing, or deletion.
- **Archived Tournament Exclusion** — Archived tournaments and their matches are excluded from the "Record Match Score" dropdown to prevent accidental score changes.

### 🔗 Shareable Spectator Links
- **One-Click Share** — Generate a shareable link (`?tournamentId=xxx`) for any tournament with a single click.
- **Clipboard Copy** — Cross-environment clipboard API with automatic fallback (`document.execCommand('copy')`) for non-HTTPS local development.
- **Spectator Mode** — Visitors opening a shared link see a dedicated read-only view with hero stats (match count, player count) scoped to that specific tournament.
- **Admin Login on Spectator Page** — Spectator pages include an "Admin Login" button so owners can sign in directly from the shared view.

### 🔐 Authentication & Authorization
- **Public Read-Only (API Key)** — Visitors can view live tournaments without authentication via shareable links.
- **Owner Console (Cognito User Pools)** — Email-based sign-in with full CRUD on own records.
- **Account Registration** — Self-service sign-up with email verification and confirmation code flow.
- **Confirm Password Validation** — Client-side password match check before registration submission.
- **Auto Sign-In Fallback** — After email confirmation, attempts `autoSignIn()` with graceful fallback to regular `signIn()` if the auto-sign-in flow has expired.
- **Auth Modal** — Unified modal popup for sign-in and sign-up, with mode switching between the two forms.
- **URL Cleanup on Login** — Automatic removal of `?tournamentId=xxx` query parameters after sign-in to prevent spectator-mode confusion for authenticated owners.
- **Multi-Tenant Isolation** — Owner-based authorization (`allow.owner()`) ensures each authenticated user sees and manages only their own data.

### 📊 Live Display
- **Bracket View** — Visual knockout bracket with round labels and match progression.
- **Standings Tables** — Round-robin group rankings with points, games won/lost, and tie-break logic.
- **Round Robin Matrix** — Group-vs-group grid with live score summaries; pending cells are clickable to open scoring in place.
- **Team Battle Panels** — Team summary cards and duel-by-duel match results.
- **Responsive Design** — Dedicated mobile/tablet layouts using CSS Grid and Flexbox compression.
- **Context-Aware Hero Stats** — The hero banner dynamically shows stats relevant to the current view: spectator stats for shared links, owner stats for authenticated users, or a welcome message for bare visitors.

---

## 🛠️ Tech Stack

### Cloud & Infrastructure

| Service | Purpose |
|---|---|
| [AWS Amplify](https://aws.amazon.com/amplify/) | Hosting, CI/CD pipeline, backend deployment |
| [Amazon CloudFront](https://aws.amazon.com/cloudfront/) | Global content delivery network (CDN) |
| [AWS AppSync](https://aws.amazon.com/appsync/) | Managed GraphQL API with real-time subscriptions |
| [Amazon DynamoDB](https://aws.amazon.com/dynamodb/) | Serverless NoSQL database — auto-scaling, millisecond latency |
| [Amazon Cognito](https://aws.amazon.com/cognito/) | Authentication, user pools, owner-based authorization |
| [AWS Certificate Manager](https://aws.amazon.com/certificate-manager/) | Automated TLS/SSL certificate provisioning |
| [AWS CloudFormation](https://aws.amazon.com/cloudformation/) | Infrastructure as Code orchestration (via AWS CDK) |
| [AWS CDK](https://aws.amazon.com/cdk/) | Infrastructure as Code for backend resources |

### Frontend

| Technology | Purpose |
|---|---|
| [React 19](https://react.dev/) | UI component library |
| [TypeScript 5](https://www.typescriptlang.org/) | Type-safe application code |
| [Vite 5](https://vite.dev/) | Fast development server & production bundler |
| [AWS Amplify UI](https://ui.docs.amplify.aws/) | Pre-built React components for auth & data |
| [CSS3 Grid / Flexbox](https://developer.mozilla.org/en-US/docs/Web/CSS) | Responsive layout engine |

### Backend (Amplify Gen 2)

| File | Responsibility |
|---|---|
| [`amplify/data/resource.ts`](https://github.com/Ru-Dipity/Tennis-Score-Board/blob/main/amplify/data/resource.ts) | GraphQL schema — models (Player, Team, Tournament, Match, TournamentEntry), enums, owner-based authorization rules |
| [`amplify/auth/resource.ts`](https://github.com/Ru-Dipity/Tennis-Score-Board/blob/main/amplify/auth/resource.ts) | Cognito user pool configuration — email sign-in, owner-based multi-tenant auth |
| [`amplify/backend.ts`](https://github.com/Ru-Dipity/Tennis-Score-Board/blob/main/amplify/backend.ts) | Backend composition — wires auth + data resources |

---

## 🚀 Getting Started — Local Development

### Prerequisites
- **Node.js** >= 18.x
- **npm** >= 9.x

### Steps

```bash
# 1. Clone the repository
git clone https://github.com/Ru-Dipity/Tennis-Score-Board.git
cd Tennis-Score-Board

# 2. Install dependencies
npm install

# 3. Start the Vite development server
npm run dev
```

The app will be available at **http://localhost:5173** with hot module replacement (HMR) enabled.

### Available Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start local dev server with HMR |
| `npm run build` | TypeScript check + Vite production build → `dist/` |
| `npm run preview` | Preview production build locally |
| `npm run lint` | Run ESLint across the codebase |
| `npx tsx scripts/verify-scenarios.ts` | Deterministic verification of tournament logic (knockout / round-robin / team battle scenarios) |

---

## 🌩️ Cloud Deployment Guide

### 1. Connect Repository to AWS Amplify

1. Navigate to **AWS Amplify Console** → **Host web app**.
2. Select **GitHub** as the source provider and authorize access.
3. Choose the `Tennis-Score-Board` repository and `main` branch.

### 2. Configure Build Settings

Amplify automatically detects [`amplify.yml`](https://github.com/Ru-Dipity/Tennis-Score-Board/blob/main/amplify.yml). The pipeline executes:

```
Backend:  npm install → npx ampx pipeline-deploy
Frontend: npm install → npm run build
Artifacts: dist/
```

### 3. Set Up Custom Domain

1. In Amplify Console, go to **Domain management** → **Add domain**.
2. Enter your domain name (e.g., `scoreboard.yourclub.com`).
3. Amplify will:
   - Generate a **CNAME record** for your DNS provider.
   - Request an **ACM certificate** in `us-east-1` (required for CloudFront).
   - Automatically validate domain ownership via DNS.
4. Add the CNAME record to your DNS provider (e.g., Route 53, Cloudflare, Namecheap):
   ```
   scoreboard  CNAME  <amplify-provided-domain>.amplifyapp.com
   ```
5. Wait for DNS propagation and certificate issuance (typically 5–15 minutes).

### 4. Verify Deployment

- ✅ HTTPS is enforced automatically via CloudFront + ACM.
- ✅ Custom domain resolves to the Amplify-hosted app.
- ✅ Subsequent `git push` to `main` triggers incremental builds with zero-downtime deployment.

---

## 📁 Project Structure

```
Tennis-Score-Board/
├── amplify/                    # Backend (Amplify Gen 2 / AWS CDK)
│   ├── auth/
│   │   └── resource.ts         # Cognito user pool config
│   ├── data/
│   │   └── resource.ts         # GraphQL schema & auth rules
│   ├── backend.ts              # Backend composition
│   ├── package.json
│   └── tsconfig.json
├── src/                        # Frontend (React + TypeScript)
│   ├── lib/
│   │   └── tournament.ts       # Tournament logic engine (brackets, round-robin plans, standings, scoring)
│   ├── App.tsx                 # Main app container (UI, live scoring, round-robin entry & matrix)
│   ├── App.css                 # Component styles
│   ├── index.css               # Global styles
│   └── main.tsx                # App entry point
├── scripts/
│   └── verify-scenarios.ts     # Deterministic logic verification (mirrors RR slot-assignment logic)
├── public/                     # Static assets served at site root
│   ├── favicon.svg             # Site favicon
│   └── images/                 # Hero banner background
├── amplify.yml                 # CI/CD pipeline definition
├── amplify_outputs.json        # Generated backend config (gitignored, contains credentials)
├── package.json                # Frontend dependencies & scripts
├── vite.config.ts              # Vite bundler config
├── tsconfig*.json              # TypeScript configurations
└── eslint.config.js            # ESLint flat config
```

---

## 🔄 CI/CD Pipeline

```yaml
# amplify.yml — Full pipeline definition
version: 1
backend:
  phases:
    build:
      commands:
        - npm install
        - npx ampx pipeline-deploy --branch $AWS_BRANCH --app-id $AWS_APP_ID
frontend:
  phases:
    preBuild:
      commands:
        - npm install
    build:
      commands:
        - npm run build
  artifacts:
    baseDirectory: dist
    files:
      - '**/*'
  cache:
    paths:
      - .npm/**/*
      - node_modules/**/*
```

**Pipeline Flow:**
1. **Trigger**: Push to `main` branch.
2. **Backend Phase**: Installs dependencies, synthesizes CDK app into CloudFormation templates, deploys CloudFormation stacks which **provision** Cognito user pools, AppSync GraphQL API, and DynamoDB tables.
3. **Frontend Phase**: Installs dependencies, runs `tsc` type-check, bundles with Vite.
4. **Artifact**: Outputs `dist/` to Amplify hosting.
5. **Serving**: Amplify uploads to S3 → invalidates CloudFront cache → global rollout.

---

## 🔐 Security & Permissions

| Access Level | Auth Provider | Operations |
|---|---|---|
| **Public (Visitor / Share Link)** | API Key | Read-only: view tournaments, matches, standings |
| **Authenticated Owner** | Cognito User Pools (`owner` field) | Full CRUD on own records: players, teams, tournaments, matches |

The schema uses **multi-tenant owner-based authorization** — each authenticated user (owner) has full CRUD access only to their own data, enforced by the [`allow.owner()`](https://docs.amplify.aws/react/build-a-backend/data/authorization/) directive on every model. Public read access is granted via [`allow.publicApiKey().to(['read'])`](https://docs.amplify.aws/react/build-a-backend/data/authorization/) for shareable spectator links.

All authorization rules are defined in [`amplify/data/resource.ts`](https://github.com/Ru-Dipity/Tennis-Score-Board/blob/main/amplify/data/resource.ts).

---

## 📄 License

This project is licensed under the **MIT License**. See the [LICENSE](https://github.com/Ru-Dipity/Tennis-Score-Board/blob/main/LICENSE) file for details.

---

<div align="center">

**Built with ❤️ for tennis enthusiasts, tournament organizers, and cloud engineers.**

[![AWS](https://img.shields.io/badge/Powered%20by-AWS%20Cloud-232F3E?style=flat-square&logo=amazon-aws)](https://aws.amazon.com/)
[![React](https://img.shields.io/badge/Made%20with-React-61DAFB?style=flat-square&logo=react)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/Written%20in-TypeScript-3178C6?style=flat-square&logo=typescript)](https://www.typescriptlang.org/)

</div>
