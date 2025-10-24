# SEP Oracle: AI-Powered Philosophy Research Engine

A full-stack RAG (Retrieval-Augmented Generation) application that provides **evidence-based, AI-powered answers** about philosophy topics using the Stanford Encyclopedia of Philosophy as its knowledge base.

## 🎯 Project Overview

SEP Oracle combines advanced NLP techniques with intelligent search algorithms to answer philosophical questions with precise citations to their source material. Users submit queries, and the system retrieves relevant passages, ranks them, and generates coherent responses with verifiable citations.

**Key Innovation**: Hybrid search combining vector search, BM25 full-text search, and reciprocal rank fusion (RRF) to surface the most relevant philosophical passages, then reranks results before LLM generation for high-quality answers.

## ✨ Key Features

- **Hybrid Search Engine**: Combines semantic (vector) and lexical (BM25) retrieval for comprehensive document matching
- **Evidence-Based Generation**: LLM responses are grounded with citations to specific sections of the Stanford Encyclopedia of Philosophy
- **Intelligent Chunking**: Semantic-aware chunking (max 1024 tokens) with context preservation from adjacent sections
- **Dual-Format Storage**: Maintains two versions of content—optimized for retrieval and optimized for human display
- **RAG Pipeline**: Complete ingestion workflow from fetching articles → preprocessing → vectorization → storage
- **Bot Protection**: Cloudflare Turnstile integration to prevent abuse
- **Rate Limiting**: Built-in API rate limiting (15 requests per 15 minutes per IP)
- **Modern Frontend**: Responsive SvelteKit UI with dark mode, Markdown rendering, citation linking, and LaTeX support

## 🏗️ Architecture

### Backend (TypeScript/Node.js + Express)
- **Vector Database**: Cloudflare Vectorize for semantic search
- **SQL Database**: Cloudflare D1 for chunk metadata and BM25 indexing
- **Object Storage**: Cloudflare R2 for rich-formatted content
- **Worker Integration**: Serverless workers handle distributed tasks (DB queries, embeddings, reranking)
- **LLM Integration**: OpenAI API for response generation

### Frontend (SvelteKit + Vite)
- Real-time search with loading states
- Interactive citation links to jump between evidence and answers
- LaTeX/mathematical notation rendering
- Dark/light theme toggle
- Mobile-responsive design

### Data Pipeline
1. **Ingestion**: Fetch articles from Stanford Encyclopedia RSS/HTML
2. **Preprocessing**: Semantic chunking with dual-format outputs
3. **Vectorization**: Generate embeddings via worker API
4. **Indexing**: Store in Vectorize (vector), D1 (metadata + BM25), R2 (formatted content)

## 🚀 Getting Started

### Prerequisites
- **Node.js** 18+
- **Yarn** 1.22.22+ (as specified in package.json)
- **Environment Variables**: See setup below

### Installation

1. **Clone and install dependencies**
   ```bash
   git clone <repository>
   cd cf_ai_stanford_rag
   yarn install
   ```

2. **Configure environment variables** (create `.env` in root):
   ```bash
   # OpenAI
   OPENAI_API_KEY=sk-...
   
   # Cloudflare
   CLOUDFLARE_ACCOUNT_ID=your-account-id
   CLOUDFLARE_API_TOKEN=your-api-token
   
   # Authentication
   JWT_PRIVATE_KEY=<your-jwt-private-key>
   WORKER_PUBLIC_KEY=<your-worker-public-key>
   
   # Service URLs
   EXPRESS_SERVER_URL=http://localhost:3000
   DB_WORKER_URL=https://your-db-worker.dev
   FRONTEND_URL=http://localhost:5173
   
   # Security
   TURNSTILE_SECRET_KEY=your-turnstile-secret-key
   
   # Server
   PORT=3000
   ```

3. **Set up Cloudflare Workers** (storage-proxy worker for DB/vector/embedding operations)
   ```bash
   cd workers/storage-proxy
   wrangler deploy
   ```

### Running

**Development Mode**
```bash
# Backend API (runs on port 3000)
yarn dev

# Frontend (in separate terminal, from pages/ directory)
cd pages
npm run dev  # runs on port 5173
```

**Production Build**
```bash
yarn build
yarn start  # runs compiled code from dist/
```

### Data Ingestion

**Initial ingestion** (fetches all Stanford Encyclopedia articles):
```bash
yarn ingest
```

**Reset incomplete articles** (e.g., after a failed run):
```bash
yarn reset-incomplete
```

## 📊 Tech Stack

**Backend**:
- Express.js (REST API)
- TypeScript
- OpenAI SDK (gpt-5 models)
- Cheerio (HTML parsing)
- Jose (JWT authentication)
- Helmet (security headers)
- Morgan (HTTP logging)
- Gpt-tokenizer (token counting)

**Frontend**:
- SvelteKit
- Vite
- Marked (Markdown rendering)
- KaTeX (LaTeX math rendering)
- Tailwind CSS

**Infrastructure**:
- Cloudflare Workers (serverless compute)
- Cloudflare Vectorize (vector database)
- Cloudflare D1 (SQL database)
- Cloudflare R2 (object storage)
- Cloudflare Turnstile (bot protection)

## 📝 Project Structure

```
├── index.ts                   # Main Express server & API endpoints
├── lib/
│   ├── auth.ts                # JWT verification
│   ├── cf.ts                  # Cloudflare API utilities
│   ├── fetch.ts               # Fetching data from the SEP
│   ├── generation.ts          # LLM response generation with citations
│   ├── hybrid-search.ts       # Vector + BM25 search with RRF fusion
│   ├── ingestion.ts           # Article processing pipeline
│   ├── preprocess.ts          # Semantic chunking & formatting
│   ├── queue.ts               # Ingestion task queue management
│   ├── search.ts              # Search utilities
│   ├── security.ts            # LLM query classification & bot detection
│   ├── storage.ts             # Database/vector/R2 storage operations
│   ├── worker-api.ts          # Communication with Cloudflare Workers
│   └── shared/
│       ├── types.ts           # Shared TypeScript interfaces
│       ├── constants.ts       # Configuration constants
│       └── utils.ts           # Shared utilities
├── scripts/                   # Utility scripts for maintenance
├── pages/                     # SvelteKit frontend
│   └── src/
│       ├── routes/            # Page components & API endpoints
│       └── lib/
│           ├── api.ts         # Frontend API client
│           ├── components/    # Reusable UI components
│           ├── parse.ts       # LLM output parsing utilities
│           └── types.ts       # Frontend types
└── workers/storage-proxy/     # Cloudflare Worker for database operations
```

## 🔍 How It Works

### Search Flow

1. **User submits query** → Frontend sends to `/search` endpoint
2. **Query validation & bot check** → Turnstile verification, LLM query classifier
3. **Hybrid retrieval** → Parallel queries:
   - Vector search: Semantic similarity in Vectorize
   - BM25 search: Full-text search in D1
4. **Fusion & reranking** → RRF combines vector + BM25 scores, then `@cf/baai/bge-reranker-base` reorders candidates 
5. **Context enrichment** → Retrieves adjacent chunks for context
6. **LLM generation** → OpenAI generates answer with evidence citations
7. **Response formatting** → Returns Markdown with embedded citations

### Citation Format
```
Evidence-based claim (article-slug/section/chunk-id)
Multiple citations (article-slug/section/chunk-1; article-slug/section/chunk-2; article-slug/section/chunk-3)
Unsupported claims (UNSUPPORTED BY PROVIDED SOURCES)
```

## 📋 License

CC-BY-NC-SA-4.0 (Creative Commons Attribution-NonCommercial-ShareAlike)
