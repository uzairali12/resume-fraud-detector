"""
Resume Fraud Detector — FastAPI Backend
Deployed to Railway. Frontend on Vercel calls this.

Endpoints:
  GET  /              → health check
  POST /predict       → analyse a resume file (PDF or DOCX)
  GET  /history       → fetch this user's past predictions (requires auth)
  DELETE /history/{id} → delete one history record (requires auth)
"""
from dotenv import load_dotenv
load_dotenv()
import io
import os
import re
import sys
import uuid
import logging
from datetime import datetime, timezone
from typing import Optional

import joblib
import pdfplumber
from docx import Document
from data_science.features import ResumeFeatureExtractor

from fastapi import FastAPI, File, HTTPException, Request, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from jose import JWTError, jwt
from pydantic import BaseModel
from supabase import Client, create_client

# ── Logging ──────────────────────────────────────────────────────────────────

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("resume-fraud-api")

# ── Environment ───────────────────────────────────────────────────────────────
# Set these in Railway → Variables (never hardcode them here)

SUPABASE_URL       = os.environ["SUPABASE_URL"]
SUPABASE_ANON_KEY  = os.environ["SUPABASE_ANON_KEY"]

# Supabase JWT secret  →  Supabase dashboard → Settings → API → JWT Secret
SUPABASE_JWT_SECRET = os.environ["SUPABASE_JWT_SECRET"]

# Comma-separated list of allowed frontend origins
# e.g. "https://resume-fraud-detector.vercel.app,http://localhost:5500"
DEFAULT_ORIGINS = [
    "http://localhost:5500",
    "http://127.0.0.1:5500",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
]
RAW_ORIGINS = os.environ.get("ALLOWED_ORIGINS", ",".join(DEFAULT_ORIGINS))
ALLOWED_ORIGINS = [o.strip() for o in RAW_ORIGINS.split(",") if o.strip()]

# Log CORS configuration
log.info("CORS allowed origins: %s", ALLOWED_ORIGINS)

# ── Supabase client (for DB reads/writes) ─────────────────────────────────────

supabase: Client = create_client(SUPABASE_URL, SUPABASE_ANON_KEY)


# ── Load ML pipeline (once, at startup) ───────────────────────────────────────
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
MODEL_PATH = os.path.join(BASE_DIR, "resume_fraud_model.pkl")

# If the model was saved when training code ran as __main__, pickle may
# reference ResumeFeatureExtractor in module __main__. Make it available.
sys.modules.setdefault("__main__", sys.modules.get("__main__"))
setattr(sys.modules["__main__"], "ResumeFeatureExtractor", ResumeFeatureExtractor)

# Support old scikit-learn pickle paths from legacy versions.
try:
    import sklearn.preprocessing._data as _sklearn_preprocessing_data
    sys.modules.setdefault('sklearn.preprocessing.data', _sklearn_preprocessing_data)
except ImportError:
    pass

try:
    import sklearn.svm._classes as _sklearn_svm_classes
    sys.modules.setdefault('sklearn.svm.classes', _sklearn_svm_classes)
except ImportError:
    pass

try:
    import sklearn.preprocessing._label as _sklearn_preprocessing_label
    sys.modules.setdefault('sklearn.preprocessing.label', _sklearn_preprocessing_label)
except ImportError:
    pass

try:
    pipeline = joblib.load(MODEL_PATH)
    log.info("Model loaded from %s", MODEL_PATH)
except FileNotFoundError:
    log.error("Model file not found at %s — /predict will fail", MODEL_PATH)
    pipeline = None

# ── FastAPI app ───────────────────────────────────────────────────────────────

app = FastAPI(
    title="Resume Fraud Detector API",
    version="1.0.0",
    docs_url="/docs",       # disable in prod if preferred: docs_url=None
    redoc_url=None,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Auth helper ───────────────────────────────────────────────────────────────

def get_current_user(request: Request) -> Optional[dict]:
    """
    Decode the Supabase JWT from the Authorization header.
    Returns the payload dict (contains 'sub' = user UUID) or None.
    """
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        return None
    token = auth_header.removeprefix("Bearer ").strip()
    try:
        payload = jwt.decode(
            token,
            SUPABASE_JWT_SECRET,
            algorithms=["HS256"],
            options={"verify_aud": False},   # Supabase doesn't set aud claim
        )
        return payload
    except JWTError:
        return None


def require_user(request: Request) -> dict:
    """Like get_current_user but raises 401 if not authenticated."""
    user = get_current_user(request)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or missing auth token",
        )
    return user

# ── File parsing ──────────────────────────────────────────────────────────────

def extract_text_from_pdf(file_bytes: bytes) -> str:
    """Extract all text from a PDF using pdfplumber."""
    text_parts = []
    with pdfplumber.open(io.BytesIO(file_bytes)) as pdf:
        for page in pdf.pages:
            page_text = page.extract_text()
            if page_text:
                text_parts.append(page_text)
    return "\n".join(text_parts).strip()


def extract_text_from_docx(file_bytes: bytes) -> str:
    """Extract all paragraph text from a DOCX file."""
    doc = Document(io.BytesIO(file_bytes))
    paragraphs = [p.text for p in doc.paragraphs if p.text.strip()]
    return "\n".join(paragraphs).strip()


ALLOWED_MIME_TYPES = {
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/msword",
}

ALLOWED_EXTENSIONS = {".pdf", ".docx", ".doc"}

MAX_FILE_SIZE_MB  = 5
MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024


def parse_resume_file(file: UploadFile, file_bytes: bytes) -> str:
    """Validate and extract plain text from a PDF or DOCX upload."""
    filename = (file.filename or "").lower()
    ext = os.path.splitext(filename)[1]

    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail=f"Unsupported file type '{ext}'. Upload a PDF or DOCX.",
        )
    if len(file_bytes) > MAX_FILE_SIZE_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"File exceeds the {MAX_FILE_SIZE_MB} MB limit.",
        )

    if ext == ".pdf":
        text = extract_text_from_pdf(file_bytes)
    else:
        text = extract_text_from_docx(file_bytes)

    if not text or len(text.split()) < 20:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Could not extract enough text from the file. "
                   "Make sure the resume is not a scanned image.",
        )
    return text

# ── Fraud signal extraction (mirrors training features, for the UI) ───────────

VAGUE_SIGNAL_PATTERNS = [
    r'\bexpert[\-\s]level\b',
    r'\ball\s+(programming|languages|frameworks|technologies)\b',
    r'\bhigh[\-\s]impact\b',
    r'\bproven\s+track\s+record\b',
    r'\bsimultaneously\b',
    r'\bmillions\s+of\s+(?:users|customers)\b',
    r'\bFAANG\b', r'\bFortune\s+500\b', r'\b10x\b',
]
BUZZWORDS = [
    'synergy','paradigm','disruptive','cutting-edge','world-class',
    'best-in-class','thought leader','visionary','transformative',
    'bleeding-edge','revolutionary',
]
PRESTIGE_KW = ['google','amazon','microsoft','apple','faang','forbes',
               'fortune 500','mit','stanford','harvard']
YEAR_PAT      = re.compile(r'\b(\d+)\s*\+?\s*years?\s+(?:of\s+)?experience\b', re.I)
DATE_RANGE_PAT = re.compile(r'\b(20\d{2})\s*[-–]\s*(20\d{2})\b')


def extract_signals(text: str) -> dict:
    """
    Return a dict of human-readable fraud signals for the UI to display.
    These are the same features the model uses internally.
    """
    sentences  = [s.strip() for s in text.split('.') if s.strip()]
    words      = text.split()

    vague_hits = [p for p in VAGUE_SIGNAL_PATTERNS if re.search(p, text, re.I)]
    buzz_hits  = [bw for bw in BUZZWORDS if bw in text.lower()]
    prest_hits = [kw for kw in PRESTIGE_KW if kw in text.lower()]

    year_vals  = [int(m) for m in YEAR_PAT.findall(text) if m.isdigit()]
    ranges     = [(int(s), int(e)) for s, e in DATE_RANGE_PAT.findall(text)]
    overlaps   = sum(
        1
        for i in range(len(ranges))
        for j in range(i + 1, len(ranges))
        if max(ranges[i][0], ranges[j][0]) <= min(ranges[i][1], ranges[j][1])
    )

    flags = []
    if sum(year_vals) > 20:
        flags.append(f"Claims {sum(year_vals)} total years of experience")
    if overlaps > 0:
        flags.append(f"Detected {overlaps} overlapping employment date range(s)")
    if len(prest_hits) >= 2:
        flags.append(f"Multiple prestige references: {', '.join(prest_hits[:3])}")
    if len(vague_hits) >= 2:
        flags.append("High density of vague / exaggerated language")
    if len(buzz_hits) >= 3:
        flags.append(f"Buzzword overload: {', '.join(buzz_hits[:4])}")

    return {
        "vague_language_count"  : len(vague_hits),
        "buzzword_count"        : len(buzz_hits),
        "prestige_keyword_count": len(prest_hits),
        "experience_years_sum"  : sum(year_vals),
        "date_overlap_count"    : overlaps,
        "word_count"            : len(words),
        "sentence_count"        : len(sentences),
        "flags"                 : flags,
    }

# ── Response schemas ──────────────────────────────────────────────────────────

class PredictionResult(BaseModel):
    prediction   : str          # "genuine" | "fraud"
    confidence   : float        # 0.0 – 1.0
    label        : int          # 0 | 1
    signals      : dict
    filename     : str
    word_count   : int
    analyzed_at  : str          # ISO-8601 UTC

# ── Routes ────────────────────────────────────────────────────────────────────

@app.get("/", tags=["health"])
async def health_check():
    return {
        "status" : "ok",
        "model"  : "loaded" if pipeline else "missing",
        "version": "1.0.0",
    }


@app.post("/predict", response_model=PredictionResult, tags=["prediction"])
async def predict(
    request: Request,
    file: UploadFile = File(..., description="PDF or DOCX resume"),
):
    """
    Analyse a resume file and return a fraud / genuine prediction.
    Auth is optional — if a valid JWT is present the result is saved
    to Supabase for the history dashboard.
    """
    if pipeline is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Model not loaded. Contact the administrator.",
        )

    # Read and parse file
    file_bytes = await file.read()
    text       = parse_resume_file(file, file_bytes)

    # Run model
    label      = int(pipeline.predict([text])[0])
    proba      = pipeline.predict_proba([text])[0]
    confidence = float(max(proba))
    signals    = extract_signals(text)
    analyzed_at = datetime.now(timezone.utc).isoformat()

    result = PredictionResult(
        prediction  = label,
        confidence  = confidence,
        label       = label,
        signals     = signals,
        filename    = file.filename or "unknown",
        word_count  = signals["word_count"],
        analyzed_at = analyzed_at,
    )

    # Persist to Supabase if user is authenticated
    user = get_current_user(request)
    if user:
        try:
            supabase.table("predictions").insert({
                "id"         : str(uuid.uuid4()),
                "user_id"    : user["sub"],
                "filename"   : result.filename,
                "prediction" : result.prediction,
                "confidence" : result.confidence,
                "label"      : result.label,
                "signals"    : result.signals,
                "word_count" : result.word_count,
                "analyzed_at": analyzed_at,
            }).execute()
        except Exception as e:
            # Log but don't fail — prediction result still returns to client
            log.warning("Failed to save prediction to Supabase: %s", e)

    return result


@app.get("/history", tags=["history"])
async def get_history(request: Request, limit: int = 20, offset: int = 0):
    """Return the authenticated user's prediction history."""
    user = require_user(request)
    try:
        res = (
            supabase.table("predictions")
            .select("id, filename, prediction, confidence, label, signals, word_count, analyzed_at")
            .eq("user_id", user["sub"])
            .order("analyzed_at", desc=True)
            .range(offset, offset + limit - 1)
            .execute()
        )
        return {"history": res.data, "total": len(res.data)}
    except Exception as e:
        log.error("History fetch failed: %s", e)
        raise HTTPException(status_code=500, detail="Could not fetch history.")


@app.delete("/history/{record_id}", tags=["history"])
async def delete_history_record(record_id: str, request: Request):
    """Delete one prediction record — only the owner can do this."""
    user = require_user(request)
    try:
        supabase.table("predictions") \
            .delete() \
            .eq("id", record_id) \
            .eq("user_id", user["sub"]) \
            .execute()
        return {"deleted": record_id}
    except Exception as e:
        log.error("Delete failed: %s", e)
        raise HTTPException(status_code=500, detail="Could not delete record.")


# ── Global error handler ──────────────────────────────────────────────────────

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    log.error("Unhandled exception: %s", exc, exc_info=True)
    return JSONResponse(
        status_code=500,
        content={"detail": "An unexpected error occurred. Please try again."},
    )